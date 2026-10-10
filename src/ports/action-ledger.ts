/** Source identity is independent of OAuth grants and evaluator output. */
export type ActionState = "RESERVED" | "DISPATCHING" | "SENT" | "CONFIRMED" | "FAILED_SAFE" | "UNCERTAIN";
export interface ActionIdentity { actionId: string; sourceKey: string; planDigest: string }
export interface ActionRecord extends ActionIdentity {
  state: ActionState;
  revision: number;
  updatedAt: string;
  receipt?: { messageId: string; threadId: string };
  evidenceDigest?: string;
}
export type ReconciliationResult =
  | { outcome: "CONFIRMED" | "NO_EXTERNAL_EFFECT"; evidenceDigest: string }
  | { outcome: "NOT_CONFIRMED" | "STILL_UNKNOWN" };
/** Implementations must compare revisions atomically. No state permits automatic re-reservation. */
export interface ActionLedger {
  reserve(action: ActionIdentity): Promise<ActionRecord>;
  get(actionId: string): Promise<ActionRecord | undefined>;
  transition(record: ActionRecord, state: ActionState, receipt?: ActionRecord["receipt"]): Promise<ActionRecord>;
  reconcile(record: ActionRecord, evidence: ReconciliationResult): Promise<ActionRecord>;
}
