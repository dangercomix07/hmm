import { singleMailbox } from "../email/mime-parser.js";
import type { AccessTokenProvider } from "./real-gmail-client.js";
function bareAddress(value: string): string {
  if (singleMailbox(value, "account").address !== value) throw new Error("A bare mailbox address is required");
  return value;
}
/** Profile is read-only and binds the read/send grants to the same actual mailbox. */
export async function gmailAccountEmail(token: AccessTokenProvider, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const value = await token();
    if (!value) throw new Error();
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      method: "GET", headers: { Authorization: `Bearer ${value}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json() as { emailAddress?: unknown };
    if (typeof data.emailAddress !== "string") throw new Error();
    return bareAddress(data.emailAddress);
  } catch { throw new Error("Cannot verify the Gmail account identity. Check authorization and connectivity. No send attempted."); }
}

export function requireSameGmailAccount(reader: string, sender: string): void {
  bareAddress(reader); bareAddress(sender);
  if (reader.toLowerCase() !== sender.toLowerCase()) throw new Error("Read and send OAuth accounts differ. No send attempted. Reauthorize the existing client as the same moderator.");
}

