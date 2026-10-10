import type { RawEmail } from "../adapters/email/types.js";
/** Infrastructure port, never evaluator input/output or an email header.
 * A provider must establish which outer authentication results were inserted by its trusted ingress.
 * No production provider is implemented for Gmail raw messages in this milestone. */
export interface AuthenticationAttestation { boundaryId: string; rawSha256: string }
export interface AuthenticationEvidenceProvider {
  attest(raw: RawEmail): Promise<AuthenticationAttestation | undefined>;
}
export interface AuthenticationPolicy {
  acceptedDomains: string[];
  trustedBoundaryIds: string[];
  authservId: string;
  requireSpf: boolean;
  requireDmarc: boolean;
}
export interface NotificationTrust {
  status: "TRUSTED" | "UNTRUSTED" | "INDETERMINATE";
  reason: string;
  /** Only these explicit uncertainty reasons may enter the controlled test exception. */
  testCompatibilityEligible: boolean;
}
