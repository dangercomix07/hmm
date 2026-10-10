import { createInterface } from "node:readline/promises";
import { loadConfig } from "../config/load-config.js";
import { authenticateGmail } from "../adapters/auth/gmail-oauth.js";
import { RealGmailClient } from "../adapters/inbox/real-gmail-client.js";
import type { GmailClient } from "../adapters/inbox/gmail-client.js";
import { gmailAccountEmail } from "../adapters/inbox/gmail-account.js";
import { GmailTransport } from "../adapters/inbox/gmail-transport.js";
import { loadGoogleGroupsConfig, type GoogleGroupsConfig } from "../adapters/email/google-groups-config.js";
import { loadTestSendingConfig, validateTestSendingConfig, type TestSendingConfig } from "../adapters/approval/test-sending-config.js";
import { checkEmail } from "../adapters/email/check-email.js";
import { MimeEmailParser } from "../adapters/email/mime-parser.js";
import { GoogleGroupsParser } from "../adapters/email/google-groups-parser.js";
import { createEvaluator } from "../adapters/evaluators/create-evaluator.js";
import { confirmTestApproval, notificationSnapshot, prepareSupervisedApproval } from "../adapters/approval/prepare-test-approval.js";
import { GmailReplyExecutor } from "../adapters/approval/gmail-reply-executor.js";
import { LocalActionLedger } from "../adapters/ledger/local-action-ledger.js";
import type { ActionLedger } from "../ports/action-ledger.js";
import type { EmailReplyExecutor } from "../ports/email-reply-executor.js";
import { digest, sourceKey } from "../adapters/approval/action-identity.js";

// Source text cannot insert terminal controls, fake labels or confirmation prompts.
const quoted = (s: string): string => JSON.stringify(s).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
export interface SupervisedSession {
  client: GmailClient;
  account: string;
  groups: GoogleGroupsConfig;
  sending: TestSendingConfig;
  ledger: ActionLedger;
  executor: EmailReplyExecutor;
  display(text: string): void;
  confirm(): Promise<string | undefined>;
}
/** One finite discovery pass. No evaluator/network-provider injection and no retry path. */
export async function runSupervisedSession(session: SupervisedSession): Promise<void> {
  const { client, account, groups, ledger, executor, display, confirm } = session;
  const sending = validateTestSendingConfig({ sending: session.sending });
  if (!sending.enabled || !sending.allowed_groups.some(g => g.toLowerCase() === groups.group_address.toLowerCase())) {
    throw new Error("Enable sending for the explicitly configured allowed group first.");
  }
  const config = await loadConfig("config/work-updates-101.yaml");
  if (config.evaluator.provider !== "none" || config.rules.some(r => r.type !== "deterministic")) {
    throw new Error("moderate-gmail requires the deterministic WORK UPDATES 101 profile with provider: none.");
  }
  const candidates = await new GmailTransport(client, account).discover(groups.gmail_query);
  display(`Found ${candidates.length} moderation candidates. Each send requires its own confirmation.`);
  for (const raw of candidates) {
    const result = await checkEmail(raw, config, createEvaluator(config), new MimeEmailParser(), new GoogleGroupsParser(groups));
    const item = result.message?.item;
    display([
      "--------------------------------------------------",
      `Gmail message ID: ${quoted(raw.id)}`,
      `Original author: ${quoted(item?.author?.email ?? "(unavailable)")}`,
      `Original subject: ${quoted(item?.subject ?? "(unavailable)")}`,
      `Group: ${quoted(result.message?.groupAddress ?? "(unavailable)")}`,
      "Original update (each source line quoted):",
      ...(item?.body ?? "(unavailable)").split(/\r?\n/).map(line => "  " + quoted(line)),
      `Decision: ${result.moderation.decision.status}`,
      ...result.moderation.deterministic.map(r => `${r.result} ${r.ruleId}: ${quoted(r.reason ?? "")}`),
      ...result.moderation.decision.reasons.map(r => quoted(r.explanation)),
    ].join("\n"));
    if (result.plan.kind !== "approval-reply") {
      display("External action: NONE — message remains pending.");
      continue;
    }
    const previous = await ledger.executionStatus(result.plan.reply.actionId, sourceKey(account, raw.id));
    if (previous) {
      display(`Ledger: ${previous}. External action: NONE — this action cannot be resent.`);
      continue;
    }
    // Re-fetch and re-evaluate after displaying the update, immediately before confirmation.
    const prepared = await prepareSupervisedApproval(raw.id, client, account, config, groups, sending, notificationSnapshot(raw));
    if (digest(prepared.plan) !== digest(result.plan.reply)) throw new Error("Regenerated action plan or ActionId changed. No send.");
    if (prepared.testOnlyAuthenticationException) display(
      "WARNING: Notification origin is not yet cryptographically trusted by hmm.\n" +
      "This supervised mode relies on the configured Gmail mailbox, group allow-list, fresh re-fetch and explicit human confirmation."
    );
    // The existing executor reserves atomically after confirmation and before any send.
    // Cancellation must not create a permanent reservation for an unsent candidate.
    const receipt = await confirmTestApproval(prepared, account, executor, display, confirm);
    if (!receipt) { display("Cancelled. No email sent."); continue; }
    display(`Reply sent. Ledger receipt: ${JSON.stringify(receipt)}\nPublication is NOT verified. Check Google Groups manually.`);
    if (!receipt.recordSaved || receipt.gmailThreadId !== prepared.plan.threadId) {
      throw new Error("Send requires manual reconciliation; do not resend. Session stopped.");
    }
  }
}
export async function moderateGmail(args: string[]): Promise<void> {
  const options = new Map<string, string>();
  let reauthorize = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--reauthorize" && !reauthorize) { reauthorize = true; continue; }
    if (!["--email-config", "--sending-config"].includes(key) || options.has(key) || !args[i + 1] || args[i + 1]!.startsWith("--")) {
      throw new Error("Invalid moderate-gmail option. No force, batch confirmation, or evaluator override is supported.");
    }
    options.set(key, args[++i]!);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("moderate-gmail requires an interactive terminal; piped confirmation is not accepted.");
  const groups = await loadGoogleGroupsConfig(options.get("--email-config") ?? "config/google-groups.local.yaml");
  const sending = await loadTestSendingConfig(options.get("--sending-config") ?? "config/gmail-sending.local.yaml");
  if (!sending.enabled || !sending.allowed_groups.some(g => g.toLowerCase() === groups.group_address.toLowerCase())) throw new Error("Enable sending for the explicitly allowed group first.");
  const auth = await authenticateGmail(".secrets/gmail-desktop.json", ".tokens/gmail.json", undefined, "read-send", reauthorize);
  const account = await gmailAccountEmail(auth.accessToken);
  const ledger = new LocalActionLedger();
  await runSupervisedSession({
    client: new RealGmailClient(auth.accessToken), account, groups, sending, ledger,
    executor: new GmailReplyExecutor(auth.accessToken, account, ledger),
    display: console.log,
    confirm: async () => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question("Type exactly APPROVE TEST to send this one reply, or anything else to cancel: ", { signal: AbortSignal.timeout(300_000) }); }
      finally { terminal.close(); }
    },
  });
}
