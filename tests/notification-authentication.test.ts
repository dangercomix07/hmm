import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MimeEmailParser } from "../src/adapters/email/mime-parser.js";
import { GoogleGroupsParser } from "../src/adapters/email/google-groups-parser.js";
import { verifyNotificationAuthentication, rawSha256 } from "../src/adapters/email/notification-authentication.js";
import type { AuthenticationPolicy, AuthenticationEvidenceProvider } from "../src/ports/notification-authentication.js";
import type { RawEmail } from "../src/adapters/email/types.js";
import { loadConfig } from "../src/config/load-config.js";
import { loadGoogleGroupsConfig } from "../src/adapters/email/google-groups-config.js";
import { prepareTestApproval, confirmTestApproval } from "../src/adapters/approval/prepare-test-approval.js";
import { GmailReplyExecutor } from "../src/adapters/approval/gmail-reply-executor.js";
import { checkEmail } from "../src/adapters/email/check-email.js";
import { FakeEvaluator } from "../src/adapters/evaluators/fake-evaluator.js";

const fixture = await readFile("fixtures/google-groups/inline-original.eml", "utf8");
const groups = await loadGoogleGroupsConfig("config/google-groups.example.yaml");
const config = await loadConfig("config/example.yaml");
const good = "mx.google.com; dkim=pass header.i=@example.com header.s=synthetic header.b=abc; spf=pass (synthetic receiver observation) smtp.mailfrom=bounce@example.com; dmarc=pass (p=NONE) header.from=example.com";
const policy: AuthenticationPolicy = { acceptedDomains: ["example.com"], trustedBoundaryIds: ["offline-ingress"], authservId: "mx.google.com", requireSpf: true, requireDmarc: true };
// Explicit trusted-infrastructure mock; never constructed from a claimed header in production.
const provider: AuthenticationEvidenceProvider = { async attest(raw) { return { boundaryId: "offline-ingress", rawSha256: rawSha256(raw) }; } };
function raw(header: string | undefined = good, text = fixture): RawEmail {
  return { id: "abc123", threadId: "thread123", source: { type: "gmail", account: "moderator@example.com" }, raw: Buffer.from((header === undefined ? "" : `Authentication-Results: ${header}\r\n`) + text) };
}
async function trust(input: RawEmail, ingress: AuthenticationEvidenceProvider | undefined = provider) {
  const parsed = await new MimeEmailParser().parse(input);
  await new GoogleGroupsParser(groups).parse(parsed);
  return verifyNotificationAuthentication(input, parsed, policy, ingress);
}
const sending = { enabled: true, test_only: true as const, allowed_groups: ["team@example.com"], allowed_reply_addresses: ["team+msgappr@example.com"] };
async function prepare(input = raw(), exception = false, ingress: AuthenticationEvidenceProvider | undefined = provider) {
  return prepareTestApproval(input.id, { async listMessages() { throw new Error("no discovery"); }, async getMessage() { return { id: input.id, threadId: input.threadId!, raw: Buffer.from(input.raw).toString("base64url") }; } }, input.source.account, config, groups,
    { ...sending, test_only_allow_unverified_authentication: exception }, { policy, ...(ingress ? { provider: ingress } : {}) });
}

test("TRUSTED requires all required results and exact-byte-bound configured ingress attestation", async () => {
  assert.equal((await trust(raw())).status, "TRUSTED");
  const parsed = await new MimeEmailParser().parse(raw());
  assert.equal((await verifyNotificationAuthentication(raw(), parsed, policy)).status, "INDETERMINATE");
  for (const evidence of [{ boundaryId: "attacker", rawSha256: rawSha256(raw()) }, { boundaryId: "offline-ingress", rawSha256: "a".repeat(64) }]) {
    assert.notEqual((await trust(raw(), { async attest() { return evidence; } })).status, "TRUSTED");
  }
  assert.notEqual((await trust(raw(), { async attest() { throw new Error("private secret"); } })).status, "TRUSTED");
});
for (const name of ["spf", "dkim", "dmarc"]) test(`${name} fail is UNTRUSTED despite correct Groups structure`, async () => {
  const input = raw(good.replace(`${name}=pass`, `${name}=fail`));
  assert.equal((await trust(input)).status, "UNTRUSTED");
  await assert.rejects(prepare(input, true), /Authentication UNTRUSTED/);
});
for (const [name, header] of [
  ["contradictory", `${good}; dkim=fail header.i=@example.com`],
  ["duplicate", `${good}\r\nAuthentication-Results: ${good}`],
  ["wrong domain", good.replace("header.i=@example.com", "header.i=@attacker.invalid")],
  ["missing DKIM", "mx.google.com; spf=pass smtp.mailfrom=bounce@example.com; dmarc=pass header.from=example.com"],
  ["bad authserv", good.replace("mx.google.com", "attacker.invalid")],
  ["malformed comment", `${good} (`],
  ["malformed ARC", `${good}\r\nARC-Seal: i=2; cv=pass; b=synthetic`],
]) test(`${name} evidence fails closed`, async () => {
  const input = raw(header); assert.notEqual((await trust(input)).status, "TRUSTED");
  await assert.rejects(prepare(input, true), /Authentication/);
});
test("forged From with absent auth, body text and forwarded auth never confer trust", async () => {
  const absent = raw(good); absent.raw = Buffer.from(fixture);
  assert.equal((await trust(absent)).status, "INDETERMINATE");
  await assert.rejects(prepare(absent), /Authentication INDETERMINATE/);
  const body = { ...absent, raw: Buffer.from(fixture.replace("Completed", "Authentication-Results: mx.google.com; dkim=pass header.i=@example.com\r\nCompleted")) };
  assert.notEqual((await verifyNotificationAuthentication(body, await new MimeEmailParser().parse(body), policy, provider)).status, "TRUSTED");
  const nested = raw(good, fixture.replace("From: Alex", `Authentication-Results: ${good}\r\nFrom: Alex`));
  // Nested results cannot alter independently attested outer authentication.
  assert.deepEqual(await trust(nested), await trust(raw(good)));
  const nestedOnly = { ...nested, raw: Buffer.from(fixture.replace("From: Alex", `Authentication-Results: ${good}\r\nFrom: Alex`)) };
  assert.equal((await trust(nestedOnly)).status, "INDETERMINATE");
});
test("duplicate Message-ID, altered reply target, altered group and parser ambiguity cannot prepare", async () => {
  for (const text of [
    fixture.replace("Message-ID:", "Message-ID: <extra@example.com>\r\nMessage-ID:"),
    fixture.replace("From: Team", "Reply-To: attacker@example.com\r\nFrom: Team"),
    fixture.replace("To: Team <team@example.com>", "To: Other <other@example.com>"),
    fixture.replace("Message-ID:", "Subject: conflicting\r\nMessage-ID:"),
  ]) await assert.rejects(prepare(raw(good, text)));
});
test("explicit controlled exception is visible, never upgrades trust, and is absent by default", async () => {
  const absent = raw(); absent.raw = Buffer.from(fixture);
  await assert.rejects(prepare(absent), /Authentication/);
  const prepared = await prepare(absent, true);
  assert.equal(prepared.trust.status, "INDETERMINATE");
  let shown = "";
  await confirmTestApproval(prepared, "moderator@example.com", { async execute() { assert.fail("cancelled"); } }, text => { shown = text; }, async () => "cancel");
  assert.match(shown, /WARNING: TEST-ONLY/);
});
test("plain, cloned, mutated and unconfirmed plans cannot reach token or send boundary", async () => {
  const p = await prepare();
  assert.equal(p.trust.status, "TRUSTED");
  assert.throws(() => { p.plan.targetReplyAddress = "attacker@example.com"; });
  assert.throws(() => p.plan.references.push("<attacker@example.com>"));
  const executor = new GmailReplyExecutor(async () => { assert.fail("No token access"); }, "moderator@example.com");
  await assert.rejects(executor.execute(p.plan), /capability/);
  await assert.rejects(executor.execute(structuredClone(p.plan)), /capability/);
});
test("identity is stable across evaluation wording and ignores injected AI identity/recipient fields", async () => {
  const input = raw();
  const normal = await checkEmail(input, config, new FakeEvaluator(), new MimeEmailParser(), new GoogleGroupsParser(groups));
  const evil = await checkEmail(input, config, { async evaluate(item, rules) {
    const evaluation = await new FakeEvaluator().evaluate(item, rules);
    item.id = "injected";
    return { ...evaluation, actionId: "evil", threadId: "evil", targetReplyAddress: "attacker@example.com", ruleResults: evaluation.ruleResults.map(r => ({ ...r, explanation: "different wording" })) };
  } }, new MimeEmailParser(), new GoogleGroupsParser(groups));
  assert.deepEqual(evil.plan, normal.plan);
  const other = await checkEmail({ ...input, id: "different" }, config, new FakeEvaluator(), new MimeEmailParser(), new GoogleGroupsParser(groups));
  assert.notDeepEqual(other.plan, normal.plan);
});

test("conflicting DKIM identities and incomplete but indexed ARC cannot be TRUSTED", async () => {
  for (const headers of [
    good.replace("header.i=@example.com", "header.d=example.com header.i=@attacker.invalid"),
    `${good}\r\nARC-Seal: i=1; cv=none\r\nARC-Message-Signature: i=1\r\nARC-Authentication-Results: i=1; mx.google.com; dkim=pass`,
  ]) assert.notEqual((await trust(raw(headers))).status, "TRUSTED");
});


test("nested AR/ARC cannot rescue failed, absent, duplicate or malformed outer authentication", async () => {
  const nested = fixture.replace("From: Alex", `Authentication-Results: ${good}\r\nARC-Seal: i=9; forged\r\nFrom: Alex`);
  for (const header of [good.replace("spf=pass", "spf=fail"),
    `${good}\r\nAuthentication-Results: ${good}`, `${good}\r\nARC-Seal: broken`]) {
    const input = raw(header, nested);
    assert.notEqual((await trust(input)).status, "TRUSTED");
    await assert.rejects(prepare(input, true), /Authentication/);
  }
  const input = raw(good, nested);
  const parsed = await new MimeEmailParser().parse(input);
  const unproven = await verifyNotificationAuthentication(input, parsed, policy);
  assert.equal(unproven.status, "INDETERMINATE");
  assert.equal(unproven.reason, "No trusted ingress provenance");
  assert.equal(unproven.testCompatibilityEligible, true);
  // The configured provider, not nested headers, is what establishes wrapper trust.
  assert.equal((await trust(input)).status, "TRUSTED");
});
