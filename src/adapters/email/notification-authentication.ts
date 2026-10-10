import { createHash } from "node:crypto";
import type { ParsedEmail, RawEmail } from "./types.js";
import type { AuthenticationEvidenceProvider, AuthenticationPolicy, NotificationTrust } from "../../ports/notification-authentication.js";
export const defaultAuthenticationPolicy: AuthenticationPolicy = {
  acceptedDomains: ["googlegroups.com"], trustedBoundaryIds: [], authservId: "mx.google.com", requireSpf: true, requireDmarc: true,
};
export function validateAuthenticationPolicy(p: AuthenticationPolicy): void {
  const domain = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
  if (!Array.isArray(p.acceptedDomains) || !p.acceptedDomains.length || p.acceptedDomains.some(d => typeof d !== "string" || !domain.test(d) || d.includes("..")) ||
    !Array.isArray(p.trustedBoundaryIds) || p.trustedBoundaryIds.some(d => typeof d !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(d)) ||
    typeof p.authservId !== "string" || !domain.test(p.authservId) || typeof p.requireSpf !== "boolean" || typeof p.requireDmarc !== "boolean") throw new Error("Invalid authentication policy");
}
export const rawSha256 = (raw: RawEmail): string => createHash("sha256").update(raw.raw).digest("hex");
const result = (status: NotificationTrust["status"], reason: string, testCompatibilityEligible = false): NotificationTrust => ({ status, reason, testCompatibilityEligible });
/** Deliberately restricted Authentication-Results grammar; unsupported evidence is not trusted.
 * Parsing observations does NOT establish header provenance. ARC syntax never establishes crypto trust. */
export async function verifyNotificationAuthentication(raw: RawEmail, parsed: ParsedEmail,
  policy: AuthenticationPolicy = defaultAuthenticationPolicy, provider?: AuthenticationEvidenceProvider): Promise<NotificationTrust> {
  try {
    validateAuthenticationPolicy(policy);
    const headers = parsed.headers;
    // Only the outer notification is the authentication subject. A message/rfc822
    // original legitimately carries its own AR/ARC headers. They are untrusted
    // member content: neither evidence for the wrapper nor a reason to veto it.
    // Never merge them into this header map or consult them for ingress provenance.
    const arcNames = ["arc-seal", "arc-message-signature", "arc-authentication-results"];
    const arc = arcNames.map(n => headers[n] ?? []);
    if (arc.some(a => a.length)) {
      if (!arc[0]!.length || arc.some(a => a.length !== arc[0]!.length) || arc[0]!.length > 10) return result("INDETERMINATE", "Malformed ARC chain");
      for (let n = 0; n < arc.length; n++) {
        const instances = new Set<number>();
        for (const value of arc[n]!) {
          const m = /^\s*i=(\d+)\s*;/.exec(value); const i = Number(m?.[1]);
          if (!m || i < 1 || i > arc[0]!.length || instances.has(i)) return result("INDETERMINATE", "Malformed ARC chain");
          instances.add(i);
          if (n < 2) {
            const tags = new Map<string, string>();
            for (const part of value.split(";").filter(p => p.trim())) {
              const tag = /^\s*([a-z]+)\s*=\s*(.*?)\s*$/i.exec(part);
              if (!tag || tags.has(tag[1]!.toLowerCase())) return result("INDETERMINATE", "Malformed ARC chain");
              tags.set(tag[1]!.toLowerCase(), tag[2]!);
            }
            const required = n === 0 ? ["i", "a", "d", "s", "cv", "b"] : ["i", "a", "d", "s", "h", "bh", "b"];
            if (required.some(t => !tags.get(t)) || !/^[A-Za-z0-9+/]+={0,2}$/.test(tags.get("b")!.replace(/\s/g, ""))) return result("INDETERMINATE", "Malformed ARC chain");
          } else if (!/^\s*i=\d+\s*;\s*[a-z0-9.-]+\s*;\s*[a-z]+=\w+/i.test(value)) return result("INDETERMINATE", "Malformed ARC chain");
          if (n === 0 && !new RegExp(`(?:^|;)\\s*cv=${i === 1 ? "none" : "pass"}\\s*(?:;|$)`, "i").test(value)) return result("INDETERMINATE", "Malformed ARC chain");
        }
      }
    }
    const values = headers["authentication-results"] ?? [];
    if (!values.length) return result("INDETERMINATE", "Missing authentication evidence", true);
    if (values.length !== 1) return result("INDETERMINATE", "Duplicate Authentication-Results");
    // Remove bounded RFC comments; reject escaped/unterminated or excessive nesting rather than guessing.
    let depth = 0, clean = "";
    for (const ch of values[0]!) {
      if (ch === "\\") return result("INDETERMINATE", "Unsupported authentication grammar");
      if (ch === "(") { if (++depth > 8) throw new Error(); }
      else if (ch === ")") { if (--depth < 0) throw new Error(); }
      else if (!depth) clean += ch;
    }
    if (depth) throw new Error();
    const parts = clean.split(";").map(s => s.trim());
    if (parts.shift()?.toLowerCase() !== policy.authservId) return result("INDETERMINATE", "Unexpected authentication service");
    const methods = new Map<string, { verdict: string; properties: Map<string, string> }>();
    for (const part of parts) {
      const match = /^([a-z][a-z0-9_-]*)=([a-z]+)(.*)$/i.exec(part);
      if (!match || methods.has(match[1]!.toLowerCase())) return result("INDETERMINATE", "Malformed or contradictory authentication results");
      const properties = new Map<string, string>();
      const tail = match[3]!.trim();
      for (const token of tail ? tail.split(/\s+/) : []) {
        const p = /^([a-z][a-z0-9_.-]*)=(?:"([^"\s]*)"|([^"\s]+))$/i.exec(token);
        if (!p || properties.has(p[1]!.toLowerCase())) return result("INDETERMINATE", "Malformed authentication property");
        properties.set(p[1]!.toLowerCase(), (p[2] ?? p[3]!).toLowerCase());
      }
      methods.set(match[1]!.toLowerCase(), { verdict: match[2]!.toLowerCase(), properties });
    }
    for (const name of ["spf", "dkim", "dmarc"]) {
      const method = methods.get(name);
      if (method && method.verdict !== "pass") return result("UNTRUSTED", `${name} did not pass`);
      if (!method && (name === "dkim" || name === "spf" && policy.requireSpf || name === "dmarc" && policy.requireDmarc)) return result("INDETERMINATE", `Missing required ${name}`);
      if (!method) continue;
      const property = name === "dkim" ? method.properties.get("header.d") ?? method.properties.get("header.i") : method.properties.get(name === "spf" ? "smtp.mailfrom" : "header.from");
      const domain = property?.split("@").at(-1);
      if (name === "dkim" && method.properties.has("header.d") && method.properties.has("header.i") && method.properties.get("header.i")!.split("@").at(-1) !== domain) return result("INDETERMINATE", "Contradictory DKIM identities");
      if (!domain || !policy.acceptedDomains.includes(domain)) return result("UNTRUSTED", `Unaccepted ${name} domain`);
      if (name === "dmarc" && parsed.from?.address.split("@").at(-1)?.toLowerCase() !== domain) return result("UNTRUSTED", "DMARC From alignment mismatch");
    }
    if (!provider) return result("INDETERMINATE", "No trusted ingress provenance", true);
    const evidence = await provider.attest(structuredClone(raw));
    if (!evidence || evidence.rawSha256 !== rawSha256(raw) || !policy.trustedBoundaryIds.includes(evidence.boundaryId)) return result("INDETERMINATE", "Ingress attestation absent or mismatched");
    return result("TRUSTED", "Required authentication passes at configured trusted ingress");
  } catch { return result("INDETERMINATE", "Authentication verification failed"); }
}
