import type { ModerationResult } from "../domain/decision.js";

export interface Notifier {
  readonly scope: "local" | "external";
  notify(result: ModerationResult, dryRun: boolean): Promise<void>;
}
