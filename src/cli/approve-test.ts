import { createInterface } from "node:readline/promises";
import { authenticateGmail } from "../adapters/auth/gmail-oauth.js";
import { RealGmailClient } from "../adapters/inbox/real-gmail-client.js";
import { loadGoogleGroupsConfig } from "../adapters/email/google-groups-config.js";
import { loadConfig } from "../config/load-config.js";
import { loadTestSendingConfig } from "../adapters/approval/test-sending-config.js";
import { prepareTestApproval, confirmTestApproval, validateSelectedId } from "../adapters/approval/prepare-test-approval.js";
import { GmailReplyExecutor, gmailAccountEmail, buildReplyRfc, requireSameGmailAccount } from "../adapters/approval/gmail-reply-executor.js";

export async function approveTest(args: string[]): Promise<void> {
  validateSelectedId(args[0] ?? "");
  const options = new Map<string, string>();
  let reauthorize = false;
  for (let index = 1; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--reauthorize" && !reauthorize) { reauthorize = true; continue; }
    if (!["--config", "--email-config", "--sending-config"].includes(key) || options.has(key) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("Invalid approve-test option; no batch or confirmation bypass is supported");
    options.set(key, args[++index]!);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("approve-test requires an interactive terminal; piped confirmation is not accepted");
  const config = await loadConfig(options.get("--config") ?? "config/example.yaml");
  const groups = await loadGoogleGroupsConfig(options.get("--email-config") ?? "config/google-groups.local.yaml");
  const sending = await loadTestSendingConfig(options.get("--sending-config") ?? "config/gmail-sending.local.yaml");
  if (!sending.enabled || !sending.allowed_groups.some(group => group.toLowerCase() === groups.group_address.toLowerCase())) throw new Error("Enable the dedicated test sending config for the explicitly allowed test group first");
  if (config.evaluator.provider !== "fake") throw new Error("approve-test requires provider: fake");
  const readAuth = await authenticateGmail(".secrets/gmail-desktop.json", ".tokens/gmail.json", undefined, reauthorize ? "read-send" : "readonly", reauthorize);
  const sender = await gmailAccountEmail(readAuth.accessToken);
  const prepared = await prepareTestApproval(args[0]!, new RealGmailClient(readAuth.accessToken), sender, config, groups, sending);
  // Both commands share the client and token; read commands still have no send path.
  const sendAuth = reauthorize ? readAuth : await authenticateGmail(".secrets/gmail-desktop.json", ".tokens/gmail.json", undefined, "read-send");
  const sendAccount = await gmailAccountEmail(sendAuth.accessToken);
  requireSameGmailAccount(sender, sendAccount);
  buildReplyRfc(prepared.plan, sender); // All RFC validation happens before asking the user.
  const result = await confirmTestApproval(prepared, sender, new GmailReplyExecutor(sendAuth.accessToken, sender), console.log, async () => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { return await terminal.question('Type exactly APPROVE TEST to send, or anything else to cancel: ', { signal: AbortSignal.timeout(300_000) }); }
    finally { terminal.close(); }
  });
  if (!result) { console.log("Cancelled. No email sent."); return; }
  console.log(`Reply sent successfully.\n${JSON.stringify(result, null, 2)}\nGoogle Groups approval is NOT programmatically verified. Check the test group manually.`);
  if (!result.recordSaved) console.log("Success record could not be updated; the blocking reservation remains. Do not resend.");
  if (result.gmailThreadId !== prepared.plan.threadId) console.log("Gmail returned a different thread ID. Inspect Gmail Sent and the group manually; do not resend.");
}
