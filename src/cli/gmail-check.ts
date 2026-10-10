import { gmailAccountEmail } from "../adapters/inbox/gmail-account.js";
import { authenticateGmail } from "../adapters/auth/gmail-oauth.js";
import { RealGmailClient } from "../adapters/inbox/real-gmail-client.js";
import { GmailTransport } from "../adapters/inbox/gmail-transport.js";
import { MimeEmailParser } from "../adapters/email/mime-parser.js";
import { GoogleGroupsParser } from "../adapters/email/google-groups-parser.js";
import { loadGoogleGroupsConfig } from "../adapters/email/google-groups-config.js";
import { checkEmail, formatEmailCheck } from "../adapters/email/check-email.js";
import { loadConfig } from "../config/load-config.js";
import { createEvaluator } from "../adapters/evaluators/create-evaluator.js";
import type { ParsedEmail } from "../adapters/email/types.js";

const clean = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
export function observations(email: ParsedEmail): string {
  const names = ["from", "reply-to", "subject", "message-id", "references", "in-reply-to", "to", "cc", "delivered-to", "authentication-results", "received-spf", "dkim-signature", "arc-authentication-results", "arc-seal", "arc-message-signature"];
  const lines = ["Observed notification headers (private; redact before sharing):"];
  for (const name of names) lines.push(`${name}: ${(email.headers[name] ?? ["(absent)"]).join(" | ")}`);
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  lines.push(`MIME parsing: succeeded`, `Gmail threadId: ${email.threadId ?? "absent"}`,
    `Plain/HTML agreement: ${email.htmlText === undefined ? "no HTML alternative" : normalize(email.text) === normalize(email.htmlText) ? "match" : "differ"}`,
    `Inline RFC822 original: ${email.inlineMessage ? "present" : "absent"}`,
    `Original plain/HTML agreement: ${!email.inlineMessage ? "not applicable" : email.inlineMessage.htmlText === undefined ? "no HTML alternative" : normalize(email.inlineMessage.text) === normalize(email.inlineMessage.htmlText) ? "match" : "differ"}`,
    `English forwarded delimiters: ${[...email.text.matchAll(/^-{5,}\s*Forwarded message\s*-{5,}\s*$/gim)].length}`,
    `Known approval-by-reply wording present: ${/you can approve this message by replying to this email\./i.test(email.text)}`,
    "Authentication headers are observations only; sender authentication is NOT verified.");
  return lines.map(clean).join("\n");
}
export async function gmailCheck(args: string[]): Promise<number> {
  const options = new Map<string, string>();
  let inspect = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--inspect" && !inspect) { inspect = true; continue; }
    if (!["--config", "--email-config", "--credentials", "--token"].includes(key) || options.has(key) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("Invalid gmail-check option");
    options.set(key, args[++index]!);
  }
  const config = await loadConfig(options.get("--config") ?? "config/example.yaml");
  if (config.evaluator.provider !== "fake") throw new Error("gmail-check requires provider: fake; private email is not sent to an AI provider.");
  const groups = await loadGoogleGroupsConfig(options.get("--email-config") ?? "config/google-groups.local.yaml");
  const auth = await authenticateGmail(options.get("--credentials") ?? ".secrets/gmail-desktop.json", options.get("--token") ?? ".tokens/gmail.json");
  const account = await gmailAccountEmail(auth.accessToken);
  const emails = await new GmailTransport(new RealGmailClient(auth.accessToken), account).discover(groups.gmail_query);
  console.log(`hmm\nFound ${emails.length} moderation candidates\nREAD ONLY — NO EMAIL SENT`);
  let exitCode = 0;
  for (const raw of emails) {
    console.log(`\nGmail message: ${clean(raw.id)}\nThread ID: ${clean(raw.threadId ?? "absent")}`);
    const mime = new MimeEmailParser();
    if (inspect) {
      try { console.log(observations(await mime.parse(raw))); }
      catch { console.log("MIME parsing failed; no header observations available."); }
    }
    const result = await checkEmail(raw, config, createEvaluator(config), mime, new GoogleGroupsParser(groups));
    console.log(formatEmailCheck(result));
    const status = result.plan.kind === "moderator-review" ? 2 : result.moderation.decision.status === "REJECT" ? 1 : 0;
    exitCode = Math.max(exitCode, status);
  }
  return exitCode;
}
