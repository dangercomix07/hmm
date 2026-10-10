import type { ModerationResult } from "../domain/decision.js";

export interface Store {
  readonly scope: "local" | "external";
  saveResult(result: ModerationResult): Promise<void>;
}
