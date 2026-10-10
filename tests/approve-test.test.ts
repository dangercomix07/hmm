import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import PostalMime from "postal-mime";
import { loadConfig } from "../src/config/load-config.js";
import { loadGoogleGroupsConfig } from "../src/adapters/email/google-groups-config.js";
import { prepareTestApproval, confirmTestApproval } from "../src/adapters/approval/prepare-test-approval.js";
import { validateTestSendingConfig } from "../src/adapters/approval/test-sending-config.js";
import { buildReplyRfc, GmailReplyExecutor, LocalTestExecutionRecords, gmailAccountEmail, requireSameGmailAccount } from "../src/adapters/approval/gmail-reply-executor.js";
import type { GmailClient, GmailMessage } from "../src/adapters/inbox/gmail-client.js";
import type { ApprovalReplyPlan } from "../src/adapters/approval/email-action-plan.js";
import type { EmailReplyExecutor } from "../src/ports/email-reply-executor.js";

const config = await loadConfig("config/example.yaml");
const groups = await loadGoogleGroupsConfig("config/google-groups.example.yaml");
const sending = { enabled: true, test_only: true as const, allowed_groups: ["team@example.com"], allowed_reply_addresses: ["team+msgappr@example.com"] };
const fixture = async (name = "inline-original"): Promise<GmailMessage> => ({ id: "abc123", threadId: "thread123", raw: (await readFile(`fixtures/google-groups/${name}.eml`)).toString("base64url") });
function client(message: GmailMessage): GmailClient {
  return { async listMessages() { assert.fail("No discovery/batches in approve-test"); }, async getMessage(id, options) {
    assert.equal(id, "abc123"); assert.equal(options.format, "raw"); return message;
  } };
}
const prepare = async (message?: GmailMessage) => prepareTestApproval("abc123", client(message ?? await fixture()), "test-account", config, groups, sending);
const prepared = await prepare();
const sender = "moderator@example.com";
const offlineFetch = (() => assert.fail("No real Gmail network allowed")) as typeof fetch;
test.beforeEach(() => { mock.method(globalThis, "fetch", offlineFetch); });
test.afterEach(() => { mock.restoreAll(); });

test("fresh APPROVE and explicitly allowed test group yields plan for exactly selected ID", async () => {
  const result = await prepare();
  assert.equal(result.group, "team@example.com"); assert.equal(result.author, "alex@example.com");
  assert.equal(result.plan.moderationMessageId, "abc123"); assert.equal(result.plan.threadId, "thread123");
  assert.equal(result.plan.targetReplyAddress, "team+msgappr@example.com");
});
test("fresh REJECT and REVIEW refuse sending instead of trusting a previous approval", async () => {
  await assert.rejects(prepare(await fixture("vague")), /fresh decision is REJECT/);
  await assert.rejects(prepare(await fixture("ambiguous")), /fresh decision is REVIEW/);
});
test("wrong configured or parsed group, recipient and disabled sending fail closed", async () => {
  const data = await fixture();
  await assert.rejects(prepareTestApproval("abc123", client(data), "test", config, groups, { ...sending, enabled: false }), /disabled/);
  await assert.rejects(prepareTestApproval("abc123", client(data), "test", config, { ...groups, group_address: "other@example.com" }, sending), /allowed test group/);
  const changed = Buffer.from(data.raw, "base64url").toString().replace("To: Team <team@example.com>", "To: Other <other@example.com>");
  await assert.rejects(prepare({ ...data, raw: Buffer.from(changed).toString("base64url") }), /REVIEW/);
  await assert.rejects(prepareTestApproval("abc123", client(data), "test", config, groups, { ...sending, allowed_reply_addresses: ["other@example.com"] }), /reply recipient/i);
});
test("missing threading metadata, mismatched Gmail ID and malformed notification refuse sending", async () => {
  const data = await fixture();
  const { threadId: _, ...noThread } = data;
  await assert.rejects(prepare(noThread), /moderator-review/);
  await assert.rejects(prepare({ ...data, id: "different" }), /selected ID/);
  await assert.rejects(prepare({ ...data, raw: Buffer.from("not an email").toString("base64url") }), /REVIEW/);
  const missingId = Buffer.from(data.raw, "base64url").toString().replace("Message-ID: <notification-inline@example.com>\r\n", "");
  await assert.rejects(prepare({ ...data, raw: Buffer.from(missingId).toString("base64url") }), /REVIEW/);
});
test("test sending configuration requires one explicit group and recipient, no wildcards or coercion", () => {
  assert.deepEqual(validateTestSendingConfig({ sending }), sending);
  for (const bad of [
    { ...sending, test_only: false }, { ...sending, enabled: "true" }, { ...sending, allowed_groups: [] },
    { ...sending, allowed_groups: ["*@example.com"] }, { ...sending, allowed_groups: ["team@example.com", "other@example.com"] },
    { ...sending, allowed_reply_addresses: ["Name <team@example.com>"] }, { ...sending, surprise: true },
  ]) assert.throws(() => validateTestSendingConfig({ sending: bad }));
});
test("absent/wrong confirmation, EOF, whitespace and simple yes all cancel without execution", async () => {
  const executor: EmailReplyExecutor = { async execute() { assert.fail("No send"); } };
  for (const answer of [undefined, "", "yes", "y", "APPROVE TEST ", "approve test", "NO"]) {
    assert.equal(await confirmTestApproval(prepared, sender, executor, () => {}, async () => answer), undefined);
  }
  assert.equal(await confirmTestApproval(prepared, sender, executor, () => {}, async () => { throw new Error("EOF"); }), undefined);
});
test("exact confirmation displays full action first and executes only one immutable snapshot", async () => {
  const selected = structuredClone(prepared); selected.originalSubject = "Untrusted \u009b2J title"; let shown = ""; let calls = 0;
  const result = await confirmTestApproval(selected, sender, { async execute(plan) {
    calls++; assert.equal(plan.body, "Approve."); assert.match(shown, /THIS WILL SEND ONE REAL EMAIL/);
    assert.ok(!shown.includes("\u009b"));
    assert.match(shown, /In-Reply-To:/); assert.match(shown, /References:/); assert.ok(shown.includes(plan.targetReplyAddress));
    return { actionId: plan.actionId, status: "SENT", gmailMessageId: "sent123", gmailThreadId: "thread123", recordSaved: true };
  } }, text => { shown = text; }, async () => { selected.plan.body = "changed after display"; return "APPROVE TEST"; });
  assert.equal(result!.status, "SENT"); assert.equal(calls, 1);
});
test("RFC reply round-trips exact Unicode subject, recipient, body and parent threading", async () => {
  const plan = { ...prepared.plan, subject: "Test — progrès 世界 ".repeat(20) };
  const rfc = buildReplyRfc(plan, sender);
  assert.equal(rfc.replace(/\r\n/g, "").includes("\n"), false);
  assert.ok(rfc.split("\r\n").every(line => Buffer.byteLength(line) <= 998));
  const parsed = await PostalMime.parse(rfc);
  assert.equal(parsed.subject, plan.subject); assert.equal(parsed.from!.address, sender);
  assert.equal(parsed.to![0]!.address, plan.targetReplyAddress); assert.equal(parsed.text!.trim(), "Approve.");
  assert.equal(parsed.inReplyTo, plan.inReplyTo); assert.equal(parsed.references, plan.references.join(" "));
  assert.equal(parsed.cc, undefined); assert.equal(parsed.bcc, undefined);
});
test("RFC construction rejects header injection, missing parents, arbitrary body and invalid identities", () => {
  for (const plan of [
    { ...prepared.plan, subject: "test\r\nBcc: victim@example.com" },
    { ...prepared.plan, targetReplyAddress: "bad@example.com\r\nCc: victim@example.com" },
    { ...prepared.plan, references: [] }, { ...prepared.plan, inReplyTo: "<bad>" },
    { ...prepared.plan, threadId: "" }, { ...prepared.plan, actionId: "../unsafe" }, { ...prepared.plan, body: "arbitrary mail" },
  ]) assert.throws(() => buildReplyRfc(plan, sender));
});
test("executor sends one base64url RFC reply with the plan thread and records SENT", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-")); let calls = 0;
  try {
    const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalTestExecutionRecords(directory), (async (url, init) => {
      calls++; assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      assert.equal(init!.method, "POST"); assert.equal(init!.redirect, "error");
      const data = JSON.parse(init!.body as string); assert.deepEqual(Object.keys(data).sort(), ["raw", "threadId"]);
      assert.equal(data.threadId, "thread123"); assert.match(data.raw, /^[A-Za-z0-9_-]+$/);
      const mail = await PostalMime.parse(Buffer.from(data.raw, "base64url")); assert.equal(mail.subject, prepared.plan.subject);
      return new Response(JSON.stringify({ id: "sent123", threadId: "thread123" }));
    }) as typeof fetch);
    const result = await executor.execute(prepared.plan); assert.equal(result.status, "SENT"); assert.equal(result.recordSaved, true);
    await assert.rejects(executor.execute(prepared.plan), /Duplicate/); assert.equal(calls, 1);
    const record = JSON.parse(await readFile(join(directory, (await readdir(directory))[0]!), "utf8"));
    assert.equal(record.actionId, prepared.plan.actionId); assert.equal(record.status, "SENT");
    assert.ok(!JSON.stringify(record).includes("test-token"));
    const newExecutor = new GmailReplyExecutor(async () => "test-token", sender, new LocalTestExecutionRecords(directory), offlineFetch);
    await assert.rejects(newExecutor.execute(prepared.plan), /record exists/);
    await assert.rejects(newExecutor.execute({ ...prepared.plan, actionId: "a".repeat(64) }), /record exists/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("send 4xx/5xx never retries or leaks response contents; reservations block cross-run repeats", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const directory = await mkdtemp(join(tmpdir(), "hmm-send-error-")); let calls = 0;
    try {
      const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalTestExecutionRecords(directory), (async () => {
        calls++; return new Response("private-error-secret", { status });
      }) as typeof fetch);
      await assert.rejects(executor.execute(prepared.plan), error => {
        assert.ok(error instanceof Error); assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.doesNotMatch(error.message, /private-error-secret/); return true;
      });
      await assert.rejects(executor.execute(prepared.plan), /Duplicate/); assert.equal(calls, 1);
      const next = new GmailReplyExecutor(async () => "test-token", sender, new LocalTestExecutionRecords(directory), offlineFetch);
      await assert.rejects(next.execute(prepared.plan), /record exists/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test("uncertain network or malformed success responses retain reservation and never retry", async () => {
  for (const boundary of [async () => { throw new Error("secret token in timeout"); }, async () => new Response("not JSON"), async () => new Response("{}")]) {
    const directory = await mkdtemp(join(tmpdir(), "hmm-send-unknown-")); let calls = 0;
    try {
      const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalTestExecutionRecords(directory), (async () => { calls++; return boundary(); }) as typeof fetch);
      await assert.rejects(executor.execute(prepared.plan), /outcome UNKNOWN/); assert.equal(calls, 1);
      const record = JSON.parse(await readFile(join(directory, (await readdir(directory))[0]!), "utf8")); assert.equal(record.status, "ATTEMPTING");
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test("concurrent commands cannot reserve the same selected notification twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-race-")); let calls = 0;
  try {
    const boundary = (async () => { calls++; return new Response('{"id":"sent123","threadId":"thread123"}'); }) as typeof fetch;
    const a = new GmailReplyExecutor(async () => "token", sender, new LocalTestExecutionRecords(directory), boundary);
    const b = new GmailReplyExecutor(async () => "token", sender, new LocalTestExecutionRecords(directory), boundary);
    const results = await Promise.allSettled([a.execute(prepared.plan), b.execute(prepared.plan)]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("authorization failure submits nothing and successful send remains SENT if final record update fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-record-"));
  try {
    const executor = new GmailReplyExecutor(async () => { throw new Error("private token"); }, sender, new LocalTestExecutionRecords(directory), offlineFetch);
    await assert.rejects(executor.execute(prepared.plan), /before submission/); assert.deepEqual(await readdir(directory), []);
    class RecordFailure extends LocalTestExecutionRecords { override async finish() { return false; } }
    const success = new GmailReplyExecutor(async () => "token", sender, new RecordFailure(directory), (async () => new Response('{"id":"sent123","threadId":"different-thread"}')) as typeof fetch);
    const result = await success.execute(prepared.plan); assert.equal(result.status, "SENT"); assert.equal(result.recordSaved, false); assert.equal(result.gmailThreadId, "different-thread");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("profile lookup uses a read-only endpoint and rejects invalid account identity", async () => {
  assert.equal(await gmailAccountEmail(async () => "token", (async (url, init) => {
    assert.ok(String(url).endsWith("/users/me/profile")); assert.equal(init!.method, "GET"); return new Response('{"emailAddress":"moderator@example.com"}');
  }) as typeof fetch), sender);
  await assert.rejects(gmailAccountEmail(async () => "token", (async () => new Response('{"emailAddress":"bad"}')) as typeof fetch), /Cannot verify/);
});
test("CLI refuses missing/batch/latest IDs, confirmation bypasses and piped input before any OAuth", () => {
  for (const args of [["abc123", "--reauthorize"], ["abc123", "--config", "config/example.yaml", "--reauthorize"]]) {
    const result = spawnSync(process.execPath, ["dist/src/cli/index.js", "approve-test", ...args], { input: "APPROVE TEST\n", encoding: "utf8" });
    assert.equal(result.status, 2); assert.match(result.stderr, /requires an interactive terminal/);
  }
  for (const args of [[], ["latest"], ["all"], ["abc123", "def456"], ["abc123", "--yes"], ["abc123"]]) {
    const result = spawnSync(process.execPath, ["dist/src/cli/index.js", "approve-test", ...args], { input: "APPROVE TEST\n", encoding: "utf8" });
    assert.equal(result.status, 2); assert.doesNotMatch(result.stdout, /accounts.google.com|Reply sent successfully/);
  }
});

test("different read/send accounts cannot proceed to confirmation", () => {
  requireSameGmailAccount("moderator@example.com", "Moderator@example.com");
  assert.throws(() => requireSameGmailAccount("moderator@example.com", "other@example.com"), /accounts differ/);
});
