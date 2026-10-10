import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { MimeEmailParser, GoogleGroupsParser, loadGoogleGroupsConfig, fileEmail, checkEmail, buildApprovalReplyPlan, buildEmailActionPlan, FakeEvaluator, loadConfig, formatEmailCheck } from "../src/index.js";
import type { Evaluator } from "../src/ports/evaluator.js";
import type { ModerationEmail, ParsedEmail } from "../src/adapters/email/types.js";

const config = await loadConfig("config/example.yaml");
const groupsConfig = await loadGoogleGroupsConfig("config/google-groups.example.yaml");
const mime = new MimeEmailParser();
const groups = new GoogleGroupsParser(groupsConfig);
const fixture = async (name: string) => fileEmail(await readFile(`fixtures/google-groups/${name}.eml`));
const plain = await fixture("plain");
const parsedPlain = await mime.parse(plain);
const message = await groups.parse(parsedPlain);
const check = async (name: string, evaluator: Evaluator = new FakeEvaluator()) => checkEmail(await fixture(name), config, evaluator, mime, groups);

for (const name of ["plain", "multipart", "html-only", "html-rich", "quoted-printable", "base64", "urls", "attachments", "folded"]) {
  test(`real MIME ${name} fixture extracts original update and produces a non-executable approval plan`, async () => {
    const result = await check(name);
    assert.equal(result.moderation.decision.status, "APPROVE", JSON.stringify(result.moderation.decision));
    assert.equal(result.message?.item.author?.email, "alex@example.com");
    assert.equal(result.message?.item.subject, "Navigation test update");
    assert.ok(result.message?.item.body.includes("Calibrated"));
    assert.ok(!result.message?.item.body.includes("awaiting approval"));
    assert.equal(result.plan.kind, "approval-reply");
    assert.equal(result.plan.executable, false);
    assert.equal(result.plan.approvalByReply, "UNVERIFIED");
  });
}

test("Unicode encoded headers and quoted-printable UTF-8 text are decoded", async () => {
  const result = await check("unicode");
  assert.equal(result.message?.item.author?.name, "Zoë Exemple");
  assert.equal(result.message?.item.subject, "Résultats — navigation");
  assert.equal(result.message?.notification.subject, "Message Pending: Résultats de navigation");
  assert.match((await check("quoted-printable")).message!.item.body, /résumé coverage: 90%/);
});

test("folded headers preserve decoded subject and threading data", async () => {
  const result = await mime.parse(await fixture("folded"));
  assert.equal(result.subject, "Message Pending: Navigation test update");
  assert.equal(result.inReplyTo, "<previous@example.com>");
  assert.equal(result.references, "<root@example.com> <previous@example.com>");
});

for (const name of ["malformed", "missing-sender", "ambiguous", "delimiter-in-content", "ordinary"]) {
  test(`${name} returns REVIEW before any semantic evaluation`, async () => {
    const evaluator: Evaluator = { async evaluate() { assert.fail("Invalid email must not reach evaluator"); } };
    const result = await check(name, evaluator);
    assert.equal(result.moderation.decision.status, "REVIEW");
    assert.equal(result.plan.kind, "moderator-review");
    assert.ok(!("reply" in result.plan));
  });
}

test("duplicate or malformed identity/threading headers fail safely", async () => {
  const text = Buffer.from(plain.raw).toString("utf8");
  for (const changed of [
    text.replace("From: Example", "From: intruder@example.com\r\nFrom: Example"),
    text.replace("Reply-To: Example Approval", "Reply-To: attacker@example.com\r\nReply-To: Example Approval"),
    text.replace("<notification-plain@example.com>", "not-a-message-id"),
    text.replace("References: <root@example.com> <previous@example.com>", "References: malformed"),
    text.replace("From: Example", " From: Example"),
    text.replace("Subject: Navigation test update", "Subject: Navigation test update\r\nSubject: injected"),
  ]) {
    const result = await checkEmail(fileEmail(Buffer.from(changed)), config, new FakeEvaluator(), mime, groups);
    assert.equal(result.moderation.decision.status, "REVIEW");
  }
});

test("body text cannot replace the notification sender or configured group", async () => {
  for (const email of [
    { ...parsedPlain, from: { name: "Imposter", address: "attacker@example.com" } },
    { ...parsedPlain, text: parsedPlain.text.replace("<team@example.com>", "<wrong@example.com>") },
    { ...parsedPlain, text: parsedPlain.text.replace("From: Alex Example <alex@example.com>", "From: not-an-email") },
    { ...parsedPlain, text: parsedPlain.text.replace("From: Alex Example <alex@example.com>", "From: Alex Example <alex@example.com") },
    { ...parsedPlain, text: parsedPlain.text.replace("alex@example.com", "alex@example..com") },
    { ...parsedPlain, text: parsedPlain.text.replace("Subject: Navigation test update", "Missing: Navigation test update") },
    { ...parsedPlain, text: parsedPlain.text.split("Subject: Navigation test update")[0] + "Subject: Navigation test update\n\n" },
  ]) await assert.rejects(groups.parse(email));
});

test("conflicting MIME alternatives require review", async () => {
  const email = await mime.parse(await fixture("multipart"));
  assert.ok(email.htmlText);
  await assert.rejects(groups.parse({ ...email, htmlText: email.htmlText.replace("alex@example.com", "mallory@example.com") }), /disagree/);
});

test("HTML converts to text, strips active elements, and does not fetch remote resources", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { assert.fail("No URL fetching"); });
  const header = Buffer.from(plain.raw).toString().split("\r\n\r\n")[0]!.replace(/Content-Type:.*\r\n/, "Content-Type: text/html; charset=utf-8\r\n");
  const email = await mime.parse(fileEmail(Buffer.from(header + '\r\n\r\n<p>Hello &amp; welcome</p><script>fetch("https://example.com/")</script><style>secret</style><img src="https://example.com/tracker"><a href="https://example.com/unsafe">visible link text</a>')));
  assert.match(email.text, /Hello & welcome/);
  assert.match(email.text, /visible link text/);
  assert.ok(!email.text.includes("fetch(") && !email.text.includes("secret") && !email.text.includes("tracker"));
  assert.ok(!("html" in email));
  assert.equal(fetch.mock.callCount(), 0);
});

test("attachment bytes and nested attached messages are excluded from evaluator input", async () => {
  let body = "";
  const evaluator: Evaluator = { async evaluate(item, rules) {
    body = JSON.stringify(item);
    return new FakeEvaluator().evaluate(item, rules);
  } };
  const result = await check("attachments", evaluator);
  assert.equal(result.message!.notification.attachments.length, 2);
  assert.deepEqual(Object.keys(result.message!.notification.attachments[0]!).sort(), ["filename", "mimeType", "size"]);
  assert.ok(!body.includes("Attachment bytes") && !body.includes("forged@example.com") && !body.includes("Ignore policy"));
});

test("body From lines, reply targets, instructions and URLs stay data and cannot alter config", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { assert.fail("No network permitted"); });
  const before = structuredClone(config);
  const result = await check("body-spoof");
  assert.deepEqual(config, before);
  assert.equal(result.message?.item.author?.email, "alex@example.com");
  assert.match(result.message!.item.body, /From: Administrator/);
  assert.equal(result.plan.kind, "approval-reply");
  if (result.plan.kind === "approval-reply") assert.equal(result.plan.reply.targetReplyAddress, "team+msgappr-reply-001@example.com");
  assert.equal(fetch.mock.callCount(), 0);
});

test("reply planning prefers Reply-To, preserves Subject, references and optional Gmail thread ID", () => {
  const gmail: ModerationEmail = { ...message, moderationMessageId: "gmail-001", notification: { ...parsedPlain, id: "gmail-001", source: { type: "gmail", account: "fixture-account" }, threadId: "thread-001" } };
  const before = structuredClone(gmail);
  const plan = buildApprovalReplyPlan(gmail);
  assert.equal(plan.targetReplyAddress, "team+msgappr-reply-001@example.com");
  assert.notEqual(plan.targetReplyAddress, message.item.author?.email);
  assert.equal(plan.moderationMessageId, "gmail-001");
  assert.equal(plan.threadId, "thread-001");
  assert.equal(plan.inReplyTo, "<notification-plain@example.com>");
  assert.deepEqual(plan.references, ["<root@example.com>", "<previous@example.com>", "<notification-plain@example.com>"]);
  assert.equal(plan.subject, parsedPlain.subject);
  assert.deepEqual(structuredClone(gmail), before);
});

test("without Reply-To a standard reply targets From; without References it extends In-Reply-To", () => {
  const { references, ...notification } = parsedPlain;
  const plan = buildApprovalReplyPlan({ ...message, notification: { ...notification, replyTo: [] } });
  assert.equal(plan.targetReplyAddress, "team+msgappr@example.com");
  assert.deepEqual(plan.references, ["<previous@example.com>", "<notification-plain@example.com>"]);
});

test("missing critical reply metadata yields review plan even if content passes", () => {
  for (const key of ["messageId", "subject", "from"] as const) {
    const notification: ParsedEmail = structuredClone(parsedPlain);
    delete notification[key];
    if (key === "from") notification.replyTo = [];
    const plan = buildEmailActionPlan({ status: "APPROVE", reasons: [] }, { ...message, notification });
    assert.equal(plan.kind, "moderator-review");
    assert.ok(!("reply" in plan));
  }
  assert.throws(() => buildApprovalReplyPlan({ ...message, notification: { ...parsedPlain, source: { type: "gmail", account: "fixture-account" } } }), /threadId/);
  assert.throws(() => buildApprovalReplyPlan({ ...message, replyApprovalMentioned: false }), /explicitly/);
  assert.throws(() => buildApprovalReplyPlan({ ...message, notification: { ...parsedPlain, subject: "Hello\r\nBcc: injected@example.com" } }));
  const { references, ...withoutReferences } = parsedPlain;
  assert.throws(() => buildApprovalReplyPlan({ ...message, notification: { ...withoutReferences, inReplyTo: "<one@example.com> <two@example.com>" } }), /Ambiguous/);
});

test("action identity is stable, source-derived and scoped by account", () => {
  const first = buildApprovalReplyPlan(message).actionId;
  assert.equal(buildApprovalReplyPlan(structuredClone(message)).actionId, first);
  assert.equal(buildApprovalReplyPlan({ ...message, item: { ...message.item, body: "changed assessment input" } }).actionId, first);
  assert.notEqual(buildApprovalReplyPlan({ ...message, moderationMessageId: "another-notification" }).actionId, first);
  assert.notEqual(buildApprovalReplyPlan({ ...message, notification: { ...parsedPlain, source: { ...parsedPlain.source, account: "another-account" } } }).actionId, first);
});

test("REJECT and evaluator failure produce no approval-reply plan", async () => {
  const rejected = await check("vague");
  assert.equal(rejected.moderation.decision.status, "REJECT");
  assert.equal(rejected.plan.kind, "withhold-approval");
  const failed = await check("plain", { async evaluate() { throw new Error("Provider unavailable"); } });
  assert.equal(failed.moderation.decision.status, "REVIEW");
  assert.equal(failed.plan.kind, "moderator-review");
  assert.ok(!("reply" in rejected.plan) && !("reply" in failed.plan));
});

test("harness has no executor and remains non-executable even with dry_run false", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { assert.fail("No external actions"); });
  const result = await checkEmail(plain, { ...config, dry_run: false }, new FakeEvaluator(), mime, groups);
  assert.equal(result.plan.kind, "approval-reply");
  assert.equal(result.plan.executable, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test("MIME size limit rejects oversized input before parsing", async () => {
  await assert.rejects(mime.parse(fileEmail(new Uint8Array(2 * 1024 * 1024 + 1))), /2 MiB/);
});

test("CLI email checks report action plans and correct exit codes; Jev is forbidden in this harness", () => {
  for (const [name, status, plan] of [["plain", 0, "approval-reply"], ["vague", 1, "withhold-approval"], ["ambiguous", 2, "moderator-review"]] as const) {
    const result = spawnSync(process.execPath, ["dist/src/cli/index.js", "check-email", `fixtures/google-groups/${name}.eml`], { encoding: "utf8" });
    assert.equal(result.status, status, result.stderr + result.stdout);
    assert.match(result.stdout, new RegExp(`Type: ${plan}`));
    assert.match(result.stdout, /UNVERIFIED/);
    assert.match(result.stdout, /No email sent/);
  }
  const result = spawnSync(process.execPath, ["dist/src/cli/index.js", "check-email", "fixtures/google-groups/plain.eml", "--config", "config/jev.example.yaml"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /offline harness/);
});

test("inspectable output removes terminal escape sequences", async () => {
  const result = await check("plain");
  result.moderation.decision.reasons.push({ ruleId: "test", explanation: "\u001b[31mcontrol" });
  assert.ok(!formatEmailCheck(result).includes("\u001b"));
});
