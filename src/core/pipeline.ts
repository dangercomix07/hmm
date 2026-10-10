import { validateConfig } from "../config/load-config.js";
import type { Config } from "../config/types.js";
import type { ModerationResult } from "../domain/decision.js";
import type { Inbox } from "../ports/inbox.js";
import type { Evaluator } from "../ports/evaluator.js";
import type { ApprovalAdapter } from "../ports/approval.js";
import type { Store } from "../ports/store.js";
import type { Notifier } from "../ports/notifier.js";
import { moderate } from "./moderate.js";

export interface HmmOptions {
  inbox: Inbox;
  evaluator: Evaluator;
  approval?: ApprovalAdapter;
  store?: Store;
  notifier?: Notifier;
  config: Config;
}

export function createHmm(options: HmmOptions): { run(): Promise<ModerationResult[]> } {
  const config = validateConfig(structuredClone(options.config));
  return {
    async run() {
      const results: ModerationResult[] = [];
      const pending = await options.inbox.getPendingItems();
      const seen = new Set<string>();
      // Validate identities before taking any actions in this batch.
      for (const raw of pending) {
        if (!raw.id || seen.has(raw.id)) throw new Error("Inbox returned missing or duplicate ids");
        seen.add(raw.id);
      }
      for (const raw of pending) {
        const result = await moderate(raw, config, options.evaluator);
        if (!config.dry_run && result.decision.status === "APPROVE" && options.approval) {
          await options.approval.approve(raw.id);
        }
        if (options.store && (!config.dry_run || options.store.scope === "local")) await options.store.saveResult(structuredClone(result));
        if (options.notifier && (!config.dry_run || options.notifier.scope === "local")) await options.notifier.notify(structuredClone(result), config.dry_run);
        results.push(result);
      }
      return results;
    },
  };
}
