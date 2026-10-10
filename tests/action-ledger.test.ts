import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { LocalActionLedger } from "../src/adapters/ledger/local-action-ledger.js";
import { sourceKey, actionIdFor, digest } from "../src/adapters/approval/action-identity.js";
const key = sourceKey("moderator@example.com", "notification123");
const action = { actionId: actionIdFor(key), sourceKey: key, planDigest: digest(["synthetic plan"]) };
async function temporary(run: (ledger: LocalActionLedger, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "hmm-ledger-"));
  try { await run(new LocalActionLedger(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test("stable source identity independent of grant/evaluation and sensitive to mailbox/notification", () => {
  assert.equal(sourceKey("Moderator@example.com", "notification123"), key);
  assert.notEqual(sourceKey("other@example.com", "notification123"), key);
  assert.notEqual(sourceKey("moderator@example.com", "notification124"), key);
  assert.equal(actionIdFor(key), action.actionId);
});
test("reservation persists across restart and duplicate acquisition is refused", async () => temporary(async (ledger, directory) => {
  const r = await ledger.reserve(action); assert.equal(r.state, "RESERVED");
  assert.deepEqual(await new LocalActionLedger(directory).get(action.actionId), r);
  await assert.rejects(new LocalActionLedger(directory).reserve(action), /record exists/);
}));
test("concurrent reservations acquire exactly once", async () => temporary(async (_, directory) => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => new LocalActionLedger(directory).reserve(action)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
}));
test("SENT and externally CONFIRMED persist; sending alone is not confirmation", async () => temporary(async (ledger, directory) => {
  let r = await ledger.reserve(action);
  r = await ledger.transition(r, "DISPATCHING");
  r = await ledger.transition(r, "SENT", { messageId: "sent123", threadId: "thread123" });
  assert.equal((await new LocalActionLedger(directory).get(action.actionId))!.state, "SENT");
  assert.deepEqual(await ledger.reconcile(r, { outcome: "NOT_CONFIRMED" }), r);
  r = await ledger.reconcile(r, { outcome: "CONFIRMED", evidenceDigest: digest("manual publication evidence") });
  assert.equal((await new LocalActionLedger(directory).get(action.actionId))!.state, "CONFIRMED");
  await assert.rejects(ledger.transition(r, "RESERVED"), /Illegal/);
  await assert.rejects(ledger.reserve(action), /record exists/);
}));
test("FAILED_SAFE remains blocked; no automatic retry even with definite pre-send failure", async () => temporary(async ledger => {
  const r = await ledger.transition(await ledger.reserve(action), "FAILED_SAFE");
  assert.equal((await ledger.get(action.actionId))!.state, "FAILED_SAFE");
  await assert.rejects(ledger.transition(r, "RESERVED"), /Illegal/);
  await assert.rejects(ledger.reserve(action), /record exists/);
}));
test("UNCERTAIN requires affirmative external evidence; not found is not proof of no send", async () => temporary(async ledger => {
  let r = await ledger.transition(await ledger.reserve(action), "DISPATCHING");
  r = await ledger.transition(r, "UNCERTAIN");
  for (const outcome of ["STILL_UNKNOWN", "NOT_CONFIRMED"] as const) assert.deepEqual(await ledger.reconcile(r, { outcome }), r);
  await assert.rejects(ledger.transition(r, "DISPATCHING"), /Illegal/);
  await assert.rejects(ledger.reconcile(r, { outcome: "CONFIRMED", evidenceDigest: "" }), /evidence/);
  await assert.rejects(ledger.reserve(action), /record exists/);
  r = await ledger.reconcile(r, { outcome: "NO_EXTERNAL_EFFECT", evidenceDigest: digest("authoritative no-effect evidence") });
  assert.equal(r.state, "FAILED_SAFE");
  await assert.rejects(ledger.reserve(action), /record exists/);
}));
test("uncertain can be confirmed, SENT cannot become FAILED_SAFE", async () => temporary(async (ledger, directory) => {
  let r = await ledger.transition(await ledger.reserve(action), "UNCERTAIN");
  r = await ledger.reconcile(r, { outcome: "CONFIRMED", evidenceDigest: digest("publication") });
  assert.equal(r.state, "CONFIRMED");
  const secondKey = sourceKey("moderator@example.com", "second");
  r = await ledger.reserve({ ...action, sourceKey: secondKey, actionId: actionIdFor(secondKey) });
  r = await ledger.transition(r, "DISPATCHING"); r = await ledger.transition(r, "SENT", { messageId: "sent", threadId: "thread" });
  await assert.rejects(ledger.reconcile(r, { outcome: "NO_EXTERNAL_EFFECT", evidenceDigest: digest("absence") }));
  assert.equal((await new LocalActionLedger(directory).get(r.actionId))!.state, "SENT");
}));
test("concurrent transitions cannot both advance a revision", async () => temporary(async ledger => {
  const r = await ledger.reserve(action);
  const outcomes = await Promise.allSettled([ledger.transition(r, "DISPATCHING"), ledger.transition(r, "FAILED_SAFE")]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  await assert.rejects(ledger.transition(r, "UNCERTAIN"), /Stale/);
}));
test("invalid transitions, fake records and mismatched ActionId are rejected", async () => temporary(async ledger => {
  await assert.rejects(ledger.reserve({ ...action, actionId: "a".repeat(64) }), /mismatch/);
  await assert.rejects(ledger.get("../../escape"), /Invalid/);
  const r = await ledger.reserve(action);
  await assert.rejects(ledger.transition(r, "SENT", { messageId: "sent", threadId: "thread" }), /Illegal/);
  await assert.rejects(ledger.transition({ ...r, planDigest: "a".repeat(64) }, "DISPATCHING"), /mismatch/);
  await assert.rejects(ledger.reconcile(r, { outcome: "CONFIRMED", evidenceDigest: digest("false") }));
}));
for (const corruption of ["bad-json", "checksum", "missing-sequence", "empty-journal", "sentinel"]) test(`${corruption} fails closed without resetting`, async () => temporary(async (ledger, directory) => {
  await ledger.reserve(action);
  const file = join(directory, action.actionId, "0.json");
  if (corruption === "bad-json") await writeFile(file, "{");
  if (corruption === "checksum") await writeFile(file, (await readFile(file, "utf8")).replace("RESERVED", "CONFIRMED"));
  if (corruption === "missing-sequence") await writeFile(join(directory, action.actionId, "2.json"), await readFile(file));
  if (corruption === "empty-journal") await rm(file);
  if (corruption === "sentinel") await writeFile(join(directory, `${key}.json`), "{}");
  await assert.rejects(ledger.get(action.actionId)); await assert.rejects(ledger.reserve(action));
}));
for (const status of ["ATTEMPTING", "SENT", "corrupted"]) test(`legacy ${status} blocks new reservation`, async () => temporary(async (ledger, directory) => {
  await writeFile(join(directory, `${key}.json`), status === "corrupted" ? "{" : JSON.stringify({ status, actionId: "legacy" }));
  await assert.rejects(ledger.reserve(action), /record exists/);
  assert.equal((await readdir(directory)).length, 1);
}));
test("separate processes compete atomically and abrupt process exit leaves a blocked action", async () => temporary(async (ledger, directory) => {
  const script = `import { LocalActionLedger } from './dist/src/adapters/ledger/local-action-ledger.js';
    const ledger = new LocalActionLedger(process.argv[1]);
    try { await ledger.reserve(JSON.parse(process.argv[2])); process.exit(0); } catch { process.exit(7); }`;
  const run = () => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, directory, JSON.stringify(action)], { stdio: "ignore" });
    child.on("error", reject); child.on("exit", resolve);
  });
  const codes = await Promise.all([run(), run(), run()]); assert.equal(codes.filter(c => c === 0).length, 1);
  let r = (await ledger.get(action.actionId))!; assert.equal(r.state, "RESERVED");
  // Operator recovery after a process crash classifies uncertainty; never frees a reservation.
  r = await ledger.transition(r, "UNCERTAIN"); assert.equal(r.state, "UNCERTAIN");
  await assert.rejects(ledger.reserve(action));
}));
test("crash after DISPATCHING never permits another process to reserve", async () => temporary(async (ledger, directory) => {
  const script = `import { LocalActionLedger } from './dist/src/adapters/ledger/local-action-ledger.js';
    const l = new LocalActionLedger(process.argv[1]); const r = await l.reserve(JSON.parse(process.argv[2])); await l.transition(r, 'DISPATCHING'); process.exit(0);`;
  assert.equal(spawnSync(process.execPath, ["--input-type=module", "-e", script, directory, JSON.stringify(action)]).status, 0);
  const r = (await ledger.get(action.actionId))!; assert.equal(r.state, "DISPATCHING");
  await assert.rejects(ledger.reserve(action));
  assert.equal((await ledger.transition(r, "UNCERTAIN")).state, "UNCERTAIN");
}));
test("journal contains only bounded identity/state metadata, no email body or credentials", async () => temporary(async (ledger, directory) => {
  await ledger.reserve({ ...action, body: "private message", token: "private token" } as typeof action);
  const journal = await readFile(join(directory, action.actionId, "0.json"), "utf8");
  assert.doesNotMatch(journal, /private|moderator@example|synthetic plan/);
  assert.ok(journal.length < 1024);
}));
test("unwritable/non-directory ledger never yields a reservation", async () => temporary(async (_, directory) => {
  const path = join(directory, "file"); await writeFile(path, "not a directory");
  await assert.rejects(new LocalActionLedger(path).reserve(action));
}));
