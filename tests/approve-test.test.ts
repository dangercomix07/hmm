import { LocalActionLedger } from "../src/adapters/ledger/local-action-ledger.js";
import type { ActionRecord, ActionState } from "../src/ports/action-ledger.js";
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import PostalMime from "postal-mime";
import { loadConfig } from "../src/config/load-config.js";
import { loadGoogleGroupsConfig } from "../src/adapters/email/google-groups-config.js";
import { prepareTestApproval, confirmTestApproval, formatTestApproval } from "../src/adapters/approval/prepare-test-approval.js";
import { validateTestSendingConfig } from "../src/adapters/approval/test-sending-config.js";
import { buildReplyRfc, GmailReplyExecutor, gmailAccountEmail, requireSameGmailAccount } from "../src/adapters/approval/gmail-reply-executor.js";
import type { GmailClient, GmailMessage } from "../src/adapters/inbox/gmail-client.js";
import type { ApprovalReplyPlan } from "../src/adapters/approval/email-action-plan.js";
import type { EmailReplyExecutor } from "../src/ports/email-reply-executor.js";

const config = await loadConfig("config/example.yaml");
const groups = await loadGoogleGroupsConfig("config/google-groups.example.yaml");
const sending = { enabled: true, test_only_allow_unverified_authentication: true, test_only: true as const, allowed_groups: ["team@example.com"], allowed_reply_addresses: ["team+msgappr@example.com"] };
const fixture = async (name = "inline-original"): Promise<GmailMessage> => ({ id: "abc123", threadId: "thread123", raw: (await readFile(`fixtures/google-groups/${name}.eml`)).toString("base64url") });
function client(message: GmailMessage): GmailClient {
  return { async listMessages() { assert.fail("No discovery/batches in approve-test"); }, async getMessage(id, options) {
    assert.equal(id, "abc123"); assert.equal(options.format, "raw"); return message;
  } };
}
const prepare = async (message?: GmailMessage) => prepareTestApproval("abc123", client(message ?? await fixture()), "moderator@example.com", config, groups, sending);
const prepared = await prepare();
const execute = async (executor: EmailReplyExecutor) => (await confirmTestApproval(await prepare(), "moderator@example.com", executor, () => {}, async () => "APPROVE TEST"))!;
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
  await assert.rejects(prepareTestApproval("abc123", client(data), "moderator@example.com", config, groups, { ...sending, enabled: false }), /disabled/);
  await assert.rejects(prepareTestApproval("abc123", client(data), "moderator@example.com", config, { ...groups, group_address: "other@example.com" }, sending), /allowed test group/);
  const changed = Buffer.from(data.raw, "base64url").toString().replace("To: Team <team@example.com>", "To: Other <other@example.com>");
  await assert.rejects(prepare({ ...data, raw: Buffer.from(changed).toString("base64url") }), /REVIEW/);
  await assert.rejects(prepareTestApproval("abc123", client(data), "moderator@example.com", config, groups, { ...sending, allowed_reply_addresses: ["other@example.com"] }), /reply recipient/i);
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
  const selected = await prepare(); let shown = ""; let calls = 0;
  const result = await confirmTestApproval(selected, sender, { async execute(plan) {
    calls++; assert.equal(plan.body, "Approve."); assert.match(shown, /THIS WILL SEND ONE REAL EMAIL/);
    assert.match(shown, /TEST-ONLY UNVERIFIED AUTHENTICATION EXCEPTION/);
    assert.match(shown, /In-Reply-To:/); assert.match(shown, /References:/); assert.ok(shown.includes(plan.targetReplyAddress));
    return { actionId: plan.actionId, status: "SENT", gmailMessageId: "sent123", gmailThreadId: "thread123", recordSaved: true };
  } }, text => { shown = text; }, async () => { assert.throws(() => { selected.plan.body = "changed after display"; }); return "APPROVE TEST"; });
  assert.equal(result!.status, "SENT"); assert.equal(calls, 1);
  await assert.rejects(confirmTestApproval(structuredClone(selected), sender, { async execute() { assert.fail(); } }, () => {}, async () => "APPROVE TEST"), /capability/);
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
    const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalActionLedger(directory), (async (url, init) => {
      calls++; assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      assert.equal(init!.method, "POST"); assert.equal(init!.redirect, "error");
      const data = JSON.parse(init!.body as string); assert.deepEqual(Object.keys(data).sort(), ["raw", "threadId"]);
      assert.equal(data.threadId, "thread123"); assert.match(data.raw, /^[A-Za-z0-9_-]+$/);
      const mail = await PostalMime.parse(Buffer.from(data.raw, "base64url")); assert.equal(mail.subject, prepared.plan.subject);
      return new Response(JSON.stringify({ id: "sent123", threadId: "thread123" }));
    }) as typeof fetch);
    const result = await execute(executor); assert.equal(result.status, "SENT"); assert.equal(result.recordSaved, true);
    await assert.rejects(execute(executor), /record exists/); assert.equal(calls, 1);
    const record = (await new LocalActionLedger(directory).get(prepared.plan.actionId))!;
    assert.equal(record.actionId, prepared.plan.actionId); assert.equal(record.state, "SENT");
    assert.ok(!JSON.stringify(record).includes("test-token"));
    const newExecutor = new GmailReplyExecutor(async () => "test-token", sender, new LocalActionLedger(directory), offlineFetch);
    await assert.rejects(execute(newExecutor), /record exists/);
    await assert.rejects(newExecutor.execute({ ...prepared.plan, actionId: "a".repeat(64) }), /capability/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("send 4xx/5xx never retries or leaks response contents; reservations block cross-run repeats", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const directory = await mkdtemp(join(tmpdir(), "hmm-send-error-")); let calls = 0;
    try {
      const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalActionLedger(directory), (async () => {
        calls++; return new Response("private-error-secret", { status });
      }) as typeof fetch);
      await assert.rejects(execute(executor), error => {
        assert.ok(error instanceof Error); assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.doesNotMatch(error.message, /private-error-secret/); return true;
      });
      await assert.rejects(execute(executor), /record exists/); assert.equal(calls, 1);
      const next = new GmailReplyExecutor(async () => "test-token", sender, new LocalActionLedger(directory), offlineFetch);
      await assert.rejects(execute(next), /record exists/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test("uncertain network or malformed success responses retain reservation and never retry", async () => {
  for (const boundary of [async () => { throw new Error("secret token in timeout"); }, async () => new Response("not JSON"), async () => new Response("{}")]) {
    const directory = await mkdtemp(join(tmpdir(), "hmm-send-unknown-")); let calls = 0;
    try {
      const executor = new GmailReplyExecutor(async () => "test-token", sender, new LocalActionLedger(directory), (async () => { calls++; return boundary(); }) as typeof fetch);
      await assert.rejects(execute(executor), /outcome UNKNOWN/); assert.equal(calls, 1);
      const record = (await new LocalActionLedger(directory).get(prepared.plan.actionId))!; assert.equal(record.state, "UNCERTAIN");
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test("concurrent commands cannot reserve the same selected notification twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-race-")); let calls = 0;
  try {
    const boundary = (async () => { calls++; return new Response('{"id":"sent123","threadId":"thread123"}'); }) as typeof fetch;
    const a = new GmailReplyExecutor(async () => "token", sender, new LocalActionLedger(directory), boundary);
    const b = new GmailReplyExecutor(async () => "token", sender, new LocalActionLedger(directory), boundary);
    const results = await Promise.allSettled([execute(a), execute(b)]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("authorization failure submits nothing and successful send remains SENT if final record update fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-record-"));
  try {
    const executor = new GmailReplyExecutor(async () => { throw new Error("private token"); }, sender, new LocalActionLedger(directory), offlineFetch);
    await assert.rejects(execute(executor), /before submission/); assert.equal((await new LocalActionLedger(directory).get(prepared.plan.actionId))!.state, "FAILED_SAFE");
    await rm(directory, { recursive: true });
    class RecordFailure extends LocalActionLedger {
      override async transition(record: ActionRecord, state: ActionState, receipt?: ActionRecord["receipt"]) {
        if (state === "SENT") throw new Error("disk failure");
        return super.transition(record, state, receipt);
      }
    }
    const success = new GmailReplyExecutor(async () => "token", sender, new RecordFailure(directory), (async () => new Response('{"id":"sent123","threadId":"different-thread"}')) as typeof fetch);
    const result = await execute(success); assert.equal(result.status, "SENT"); assert.equal(result.recordSaved, false); assert.equal(result.gmailThreadId, "different-thread");
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

test("ledger reservation or durable dispatch failure stops before the send boundary", async () => {
  for (const failAt of ["reserve", "DISPATCHING"]) {
    const directory = await mkdtemp(join(tmpdir(), "hmm-ledger-fault-"));
    try {
      class FaultLedger extends LocalActionLedger {
        override async reserve(action: Parameters<LocalActionLedger["reserve"]>[0]) {
          if (failAt === "reserve") throw new Error("disk unavailable");
          return super.reserve(action);
        }
        override async transition(record: ActionRecord, state: ActionState, receipt?: ActionRecord["receipt"]) {
          if (state === failAt) throw new Error("disk unavailable");
          return super.transition(record, state, receipt);
        }
      }
      let tokenCalls = 0;
      const executor = new GmailReplyExecutor(async () => { tokenCalls++; return "token"; }, sender, new FaultLedger(directory), offlineFetch);
      await assert.rejects(execute(executor), /disk unavailable/);
      assert.equal(tokenCalls, failAt === "reserve" ? 0 : 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test("an expired or concurrent confirmation cannot issue multiple capabilities", async () => {
  const selected = await prepare(); let calls = 0;
  const executor: EmailReplyExecutor = { async execute(plan) {
    calls++; return { actionId: plan.actionId, status: "SENT", gmailMessageId: "sent", gmailThreadId: "thread", recordSaved: true };
  } };
  const outcomes = await Promise.allSettled([1, 2].map(() => confirmTestApproval(selected, sender, executor, () => {}, async () => "APPROVE TEST")));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1); assert.equal(calls, 1);
  const expiring = await prepare(); const now = Date.now();
  await assert.rejects(confirmTestApproval(expiring, sender, executor, () => {}, async () => {
    mock.method(Date, "now", () => now + 300_001); return "APPROVE TEST";
  }), /expired/);
  assert.equal(calls, 1);
});

test("confirmation display escapes controls in source-derived subject text", () => {
  const display = formatTestApproval({ ...prepared, originalSubject: "untrusted \u009b2J \u202e title" }, sender);
  assert.ok(!display.includes("\u009b")); assert.ok(!display.includes("\u202e"));
  assert.match(display, /\\u009b/); assert.match(display, /\\u202e/);
});
