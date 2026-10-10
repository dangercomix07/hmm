import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runSupervisedSession } from "../src/cli/moderate-gmail.js";
import { loadGoogleGroupsConfig } from "../src/adapters/email/google-groups-config.js";
import { LocalActionLedger } from "../src/adapters/ledger/local-action-ledger.js";
import { GmailReplyExecutor } from "../src/adapters/approval/gmail-reply-executor.js";
import { actionIdFor, sourceKey } from "../src/adapters/approval/action-identity.js";
import type { GmailMessage } from "../src/adapters/inbox/gmail-client.js";

const groups = await loadGoogleGroupsConfig("config/google-groups.example.yaml");
const sending = { enabled: true, test_only: true as const, test_only_allow_unverified_authentication: true,
  allowed_groups: ["team@example.com"], allowed_reply_addresses: ["team+msgappr@example.com"] };
const account = "moderator@example.com";
const template = await readFile("fixtures/google-groups/inline-original.eml", "utf8");
const valid = "Reproduced the reset.\r\n\r\nFuture work:\r\nInspect trace.";
function message(body = valid, id = "candidate1"): GmailMessage {
  const raw = template.slice(0, template.indexOf("From: Alex Example")) +
    "From: Alex <alex@example.com>\r\nTo: team@example.com\r\nSubject: Synthetic update\r\n" +
    "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body + "\r\n--outer-mixed--\r\n";
  return { id, threadId: "thread1", raw: Buffer.from(raw).toString("base64url") };
}
async function harness(t: TestContext, initial = message()) {
  const dir = await mkdtemp(join(tmpdir(), "hmm-supervised-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = new LocalActionLedger(dir);
  let reads = 0, sends = 0, prompts = 0;
  let fresh = initial, answer: string | undefined = "APPROVE TEST", timeout = false;
  const output: string[] = [];
  const executor = new GmailReplyExecutor(async () => "mock-token", account, ledger, (async () => {
    sends++;
    if (timeout) throw new Error("response lost");
    return new Response(JSON.stringify({ id: "sent1", threadId: "thread1" }), { status: 200 });
  }) as typeof fetch);
  const session = {
    client: {
      async listMessages() { return { messages: [{ id: initial.id, threadId: initial.threadId! }] }; },
      async getMessage() { return ++reads % 2 === 1 ? initial : fresh; },
    },
    account, groups, sending, ledger, executor,
    display(text: string) { output.push(text); },
    async confirm() { prompts++; assert.match(output.join("\n"), /THIS WILL SEND ONE REAL EMAIL/); return answer; },
  };
  return { session, output, ledger, dir, counts: () => ({ sends, prompts }), change: (value: GmailMessage) => { fresh = value; },
    answer: (value: string | undefined) => { answer = value; }, timeout: () => { timeout = true; } };
}
test("supervised deterministic profile approves concise Future work without API keys and persists one send", async t => {
  const h = await harness(t);
  await runSupervisedSession(h.session);
  assert.deepEqual(h.counts(), { sends: 1, prompts: 1 });
  assert.match(h.output.join("\n"), /Decision: APPROVE/);
  assert.match(h.output.join("\n"), /WARNING: Notification origin/);
  assert.equal((await h.ledger.get(actionIdFor(sourceKey(account, "candidate1"))))?.state, "SENT");
  await runSupervisedSession(h.session);
  assert.deepEqual(h.counts(), { sends: 1, prompts: 1 });
  assert.match(h.output.join("\n"), /Ledger: SENT/);
});
for (const answer of [undefined, "", "yes", "APPROVE", "APPROVE TEST "]) {
  test(`cancel/wrong confirmation ${JSON.stringify(answer)} sends nothing and does not reserve`, async t => {
    const h = await harness(t); h.answer(answer);
    await runSupervisedSession(h.session);
    assert.deepEqual(h.counts(), { sends: 0, prompts: 1 });
    assert.equal(await h.ledger.get(actionIdFor(sourceKey(account, "candidate1"))), undefined);
  });
}
for (const [body, decision] of [
  ["Reproduced the reset.", "REJECT"],
  ["Reproduced the reset.\r\nNext steps:\r\nTODO", "REJECT"],
  [valid + "\r\n> A generic quotation", "REVIEW"],
  [valid + "\r\n\r\n```\r\n" + Array(11).fill("line").join("\r\n") + "\r\n```", "REJECT"],
]) {
  test(`${decision} deterministic case never reaches confirmation/send: ${body!.slice(-25)}`, async t => {
    const h = await harness(t, message(body));
    await runSupervisedSession(h.session);
    assert.match(h.output.join("\n"), new RegExp(`Decision: ${decision}`));
    assert.deepEqual(h.counts(), { sends: 0, prompts: 0 });
    assert.match(h.output.join("\n"), /External action: NONE/);
  });
}
test("fresh content, thread, and Gmail identity changes block before confirmation", async t => {
  for (const fresh of [message(valid + " Changed."), { ...message(), threadId: "changed" }, message(valid, "other")]) {
    const h = await harness(t); h.change(fresh);
    await assert.rejects(runSupervisedSession(h.session), /changed|selected ID/);
    assert.deepEqual(h.counts(), { sends: 0, prompts: 0 });
  }
});
test("UNCERTAIN send stops session and is never retried", async t => {
  const h = await harness(t); h.timeout();
  await assert.rejects(runSupervisedSession(h.session), /UNKNOWN/);
  await runSupervisedSession(h.session);
  assert.deepEqual(h.counts(), { sends: 1, prompts: 1 });
  assert.match(h.output.join("\n"), /Ledger: UNCERTAIN/);
});
test("wrong configured group and absent authentication exception block", async t => {
  const h = await harness(t);
  await assert.rejects(runSupervisedSession({ ...h.session, sending: { ...sending, allowed_groups: ["wrong@example.com"] } }), /allowed group/);
  await assert.rejects(runSupervisedSession({ ...h.session, sending: { ...sending, test_only_allow_unverified_authentication: false } }), /Authentication INDETERMINATE/);
  assert.deepEqual(h.counts(), { sends: 0, prompts: 0 });
});
test("interactive command refuses pipes and force/evaluator override before OAuth", () => {
  for (const args of [[], ["--force"], ["--config", "config/example.yaml"]]) {
    const child = spawnSync(process.execPath, ["dist/src/cli/index.js", "moderate-gmail", ...args], { encoding: "utf8" });
    assert.equal(child.status, 2);
    assert.match(child.stderr, /interactive terminal|Invalid moderate-gmail option/);
    assert.doesNotMatch(child.stdout, /accounts.google.com/);
  }
});
test("every existing ledger state blocks a new confirmation including FAILED_SAFE", async t => {
  const { digest } = await import("../src/adapters/approval/action-identity.js");
  for (const state of ["RESERVED", "DISPATCHING", "SENT", "CONFIRMED", "FAILED_SAFE", "UNCERTAIN"] as const) {
    const h = await harness(t);
    const key = sourceKey(account, "candidate1");
    let record = await h.ledger.reserve({ actionId: actionIdFor(key), sourceKey: key, planDigest: digest("fixture") });
    if (state === "FAILED_SAFE" || state === "UNCERTAIN") record = await h.ledger.transition(record, state);
    if (["DISPATCHING", "SENT", "CONFIRMED"].includes(state)) record = await h.ledger.transition(record, "DISPATCHING");
    if (state === "SENT" || state === "CONFIRMED") record = await h.ledger.transition(record, "SENT", { messageId: "sent1", threadId: "thread1" });
    if (state === "CONFIRMED") await h.ledger.reconcile(record, { outcome: "CONFIRMED", evidenceDigest: digest("manual evidence") });
    await runSupervisedSession(h.session);
    assert.deepEqual(h.counts(), { sends: 0, prompts: 0 });
    assert.match(h.output.join("\n"), new RegExp(`Ledger: ${state}`));
  }
});
test("wrong parsed group and disallowed reply recipient cannot send", async t => {
  const altered = message();
  altered.raw = Buffer.from(Buffer.from(altered.raw, "base64url").toString().replace("To: team@example.com", "To: other@example.com")).toString("base64url");
  const h = await harness(t, altered);
  await runSupervisedSession(h.session);
  assert.deepEqual(h.counts(), { sends: 0, prompts: 0 });
  assert.match(h.output.join("\n"), /Decision: REVIEW/);
  const other = await harness(t);
  await assert.rejects(runSupervisedSession({ ...other.session, sending: { ...sending, allowed_reply_addresses: ["other@example.com"] } }), /reply recipient/i);
  assert.deepEqual(other.counts(), { sends: 0, prompts: 0 });
});
test("two simultaneous sessions cannot both submit the same confirmed action", async t => {
  const h = await harness(t);
  const results = await Promise.allSettled([runSupervisedSession(h.session), runSupervisedSession(h.session)]);
  assert.equal(h.counts().sends, 1);
  assert.ok(results.some(r => r.status === "fulfilled"));
});

test("Groups wrapper with nested original authentication reaches only explicit supervised confirmation", async t => {
  const data = message();
  data.raw = (await readFile("fixtures/google-groups/supervised-nested-auth.eml")).toString("base64url");
  const h = await harness(t, data);
  h.answer("cancel");
  await runSupervisedSession({
    ...h.session,
    groups: { ...groups, group_address: "team@googlegroups.com", notification_senders: ["team+msgappr@googlegroups.com"] },
    sending: { ...sending, allowed_groups: ["team@googlegroups.com"], allowed_reply_addresses: ["team+msgappr@googlegroups.com"] },
  });
  assert.deepEqual(h.counts(), { prompts: 1, sends: 0 });
  assert.match(h.output.join("\n"), /Authentication: INDETERMINATE/);
  assert.match(h.output.join("\n"), /WARNING: Notification origin/);
  assert.match(h.output.join("\n"), /PASS next-present/);
  assert.doesNotMatch(h.output.join("\n"), /PASS [^\n]*Missing required section|PASS [^\n]*section is empty|PASS [^\n]*placeholder text/);
});

test("legacy and partial execution records skip confirmation without modifying records", async t => {
  for (const content of ['{"status":"SENT"}', '{"status":"ATTEMPTING"}', '', 'corrupt']) {
    const h = await harness(t);
    const path = join(h.dir, sourceKey(account, "candidate1") + ".json");
    await writeFile(path, content);
    await runSupervisedSession(h.session);
    assert.deepEqual(h.counts(), { prompts: 0, sends: 0 });
    assert.match(h.output.join("\n"), /Ledger: LEGACY_OR_INCOMPLETE/);
    assert.equal(await readFile(path, "utf8"), content);
  }
});
test("real-shape nested authentication retains every supervised gate", async t => {
  const original = await readFile("fixtures/google-groups/supervised-nested-auth.eml", "utf8");
  const data = { ...message(), raw: Buffer.from(original).toString("base64url") };
  const boundGroups = { ...groups, group_address: "team@googlegroups.com", notification_senders: ["team+msgappr@googlegroups.com"] };
  const allowed = { ...sending, allowed_groups: ["team@googlegroups.com"], allowed_reply_addresses: ["team+msgappr@googlegroups.com"] };
  for (const change of [
    { test_only_allow_unverified_authentication: false }, { enabled: false }, { test_only: false },
    { allowed_groups: ["wrong@example.com"] }, { allowed_reply_addresses: ["wrong@example.com"] },
  ]) {
    const h = await harness(t, data);
    await assert.rejects(runSupervisedSession({ ...h.session, groups: boundGroups, sending: { ...allowed, ...change } as typeof allowed }));
    assert.deepEqual(h.counts(), { prompts: 0, sends: 0 });
  }
  for (const text of [
    original.replace("dkim=pass", "dkim=fail"),
    original.replace("Authentication-Results: mx.google.com;", "Authentication-Results: mx.google.com; dkim=fail header.i=@googlegroups.com;"),
    original.replace("ARC-Seal: i=1;", "ARC-Seal: i=9;"),
  ]) {
    const h = await harness(t, { ...data, raw: Buffer.from(text).toString("base64url") });
    await assert.rejects(runSupervisedSession({ ...h.session, groups: boundGroups, sending: allowed }), /Authentication/);
    assert.deepEqual(h.counts(), { prompts: 0, sends: 0 });
  }
});
