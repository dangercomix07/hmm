import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FakeGmailClient, GmailTransport, normalizeGmailMessage, checkEmail, MimeEmailParser, GoogleGroupsParser, FakeEvaluator, loadConfig, loadGoogleGroupsConfig } from "../src/index.js";
import type { GmailClient, GmailMessage } from "../src/adapters/inbox/gmail-client.js";

const records = JSON.parse(await readFile("fixtures/google-groups/gmail-messages.json", "utf8")) as GmailMessage[];
const config = await loadConfig("config/example.yaml");
const groupsConfig = await loadGoogleGroupsConfig("config/google-groups.example.yaml");

test("fake Gmail RAW fixtures traverse list pagination, normalization, MIME, source parsing, policy, and plans", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { assert.fail("No network"); });
  const client = await FakeGmailClient.fromFixture("fixtures/google-groups/gmail-messages.json");
  const emails = await new GmailTransport(client, "moderator@example.com").discover(groupsConfig.gmail_query, 1);
  assert.equal(client.searches.length, 3);
  assert.ok(client.searches.every(request => request.q === groupsConfig.gmail_query));
  assert.deepEqual(client.gets, records.map(record => record.id));
  const checks = [];
  for (const email of emails) checks.push(await checkEmail(email, config, new FakeEvaluator(), new MimeEmailParser(), new GoogleGroupsParser(groupsConfig)));
  assert.deepEqual(checks.map(check => check.moderation.decision.status), ["APPROVE", "REJECT", "REVIEW"]);
  assert.deepEqual(checks.map(check => check.plan.kind), ["approval-reply", "withhold-approval", "moderator-review"]);
  const plan = checks[0]!.plan;
  assert.equal(plan.kind, "approval-reply");
  if (plan.kind === "approval-reply") {
    assert.equal(plan.reply.threadId, "thread-plain-001");
    assert.equal(plan.reply.moderationMessageId, "gmail-plain-001");
    assert.equal(plan.reply.inReplyTo, "<notification-plain@example.com>");
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("transport decodes bytes without confusing Gmail ID, RFC Message-ID, and thread ID", async () => {
  const normalized = normalizeGmailMessage(records[0]!, "fixture-account");
  assert.equal(normalized.id, "gmail-plain-001");
  assert.equal(normalized.threadId, "thread-plain-001");
  assert.deepEqual(normalized.raw, await readFile("fixtures/google-groups/plain.eml"));
  assert.ok(!("payload" in normalized) && !("snippet" in normalized));
});

test("invalid base64url or missing identity is not silently repaired", () => {
  for (const raw of ["!not-base64", "A", "Zg===", "Zg=", "Zh", ""]) assert.throws(() => normalizeGmailMessage({ id: "i", raw }, "fixture-account"));
  assert.throws(() => normalizeGmailMessage({ ...records[0]!, id: "" }, "fixture-account"));
  assert.throws(() => normalizeGmailMessage(records[0]!, ""));
  assert.equal(Buffer.from(normalizeGmailMessage({ id: "i", raw: "Zg==" }, "fixture-account").raw).toString(), "f");
});

test("empty search is valid; duplicate results and repeated pages fail without actions", async () => {
  assert.deepEqual(await new GmailTransport(new FakeGmailClient([]), "fixture-account").discover("test"), []);
  await assert.rejects(new GmailTransport(new FakeGmailClient([records[0]!, records[0]!]), "fixture-account").discover("test"), /duplicate/);
  const client: GmailClient = {
    async listMessages() { return { nextPageToken: "loop" }; },
    async getMessage() { assert.fail("No candidates"); },
  };
  await assert.rejects(new GmailTransport(client, "fixture-account").discover("test"), /repeated/);
});

test("Gmail fetch must match the listed identity and thread", async () => {
  for (const fetched of [{ ...records[0]!, id: "wrong" }, { ...records[0]!, threadId: "wrong-thread" }]) {
    const client: GmailClient = { async listMessages() { return { messages: [{ id: records[0]!.id, threadId: records[0]!.threadId! }] }; }, async getMessage() { return fetched; } };
    await assert.rejects(new GmailTransport(client, "fixture-account").discover("test"), /identity/);
  }
});
