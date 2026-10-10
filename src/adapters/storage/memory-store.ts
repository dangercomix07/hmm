import type { ModerationResult } from "../../domain/decision.js";
import type { Store } from "../../ports/store.js";

export class MemoryStore implements Store {
  readonly scope = "local";
  readonly results: ModerationResult[] = [];
  async saveResult(result: ModerationResult): Promise<void> { this.results.push(structuredClone(result)); }
}
