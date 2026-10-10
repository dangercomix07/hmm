import type { Config } from "../config/types.js";
import type { ModerationResult } from "../domain/decision.js";
import type { Evaluation } from "../domain/evaluation.js";
import type { Item, PendingItem } from "../domain/item.js";
import type { SemanticRule } from "../domain/rule.js";
import type { Evaluator } from "../ports/evaluator.js";
import { parseItem } from "./parser.js";
import { evaluateDeterministicRules } from "./deterministic-rules.js";
import { decide } from "./policy.js";

function validateEvaluation(value: unknown, rules: SemanticRule[]): Evaluation {
  if (!value || typeof value !== "object") throw new Error("Malformed evaluator response");
  const evaluation = value as Evaluation;
  if (!Array.isArray(evaluation.ruleResults)) throw new Error("Missing ruleResults");
  if (evaluation.confidence !== undefined && (typeof evaluation.confidence !== "number" || !Number.isFinite(evaluation.confidence) || evaluation.confidence < 0 || evaluation.confidence > 1)) throw new Error("Invalid evaluation confidence");
  const ids = new Set(rules.map(rule => rule.id));
  const seen = new Set<string>();
  for (const result of evaluation.ruleResults) {
    if (!result || !ids.has(result.ruleId) || seen.has(result.ruleId) || !["PASS", "FAIL", "UNCERTAIN"].includes(result.result) ||
      (result.reason !== undefined && typeof result.reason !== "string") ||
      (result.confidence !== undefined && (typeof result.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1))) {
      throw new Error("Malformed, duplicate, or unknown rule result");
    }
    seen.add(result.ruleId);
  }
  if (seen.size !== ids.size) throw new Error("Missing semantic rule results");
  if (evaluation.progress !== undefined) {
    if (!evaluation.progress || typeof evaluation.progress !== "object" || Array.isArray(evaluation.progress)) throw new Error("Malformed progress record");
    const allowed = ["completed", "inProgress", "blockers", "nextActions", "concerns"];
    for (const [key, entries] of Object.entries(evaluation.progress)) {
      if (!allowed.includes(key) || !Array.isArray(entries) || !entries.every(entry => typeof entry === "string")) throw new Error("Malformed progress field");
    }
  }
  // Copy validated data so later adapter mutation cannot change a decision record.
  return structuredClone(evaluation);
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error("Evaluator timed out")); controller.abort(); }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function moderate(raw: PendingItem, config: Config, evaluator: Evaluator): Promise<ModerationResult> {
  const result: ModerationResult = { inputId: raw.id, deterministic: [], semantic: { ruleResults: [] }, decision: { status: "REVIEW", reasons: [] } };
  try {
    result.item = parseItem(raw);
  } catch (error) {
    result.decision.reasons.push({ ruleId: "parser", explanation: error instanceof Error ? error.message : "Parsing failed" });
    return result;
  }
  return moderateItem(result.item, config, evaluator);
}

/** Adapter entry point for an already normalized Item; no transport-specific data. */
export async function moderateItem(item: Item, config: Config, evaluator: Evaluator): Promise<ModerationResult> {
  const result: ModerationResult = { inputId: item.id, item, deterministic: [], semantic: { ruleResults: [] }, decision: { status: "REVIEW", reasons: [] } };
  if (!item.id.trim() || !item.body.trim()) {
    result.decision.reasons.push({ ruleId: "parser", explanation: "Missing input id or message body" });
    return result;
  }
  result.deterministic = evaluateDeterministicRules(item, config.rules.filter(rule => rule.type === "deterministic"));
  const rules = config.rules.filter(rule => rule.type === "semantic");
  if (rules.length) {
    try {
      const evaluationItem = structuredClone(item);
      result.semantic = validateEvaluation(await withTimeout(signal => evaluator.evaluate(evaluationItem, structuredClone(rules), signal), config.evaluator.timeout_ms), rules);
      if (result.semantic.confidence !== undefined && result.semantic.confidence < config.policy.min_confidence) throw new Error("Overall evaluator confidence is too low");
      result.semantic.ruleResults = result.semantic.ruleResults.map(entry => ({
        ...entry,
        ...(entry.confidence === undefined && result.semantic.confidence !== undefined ? { confidence: result.semantic.confidence } : {}),
      }));
    } catch (error) {
      // Do not log provider exception text: it may contain credentials or private data.
      result.decision.reasons.push({ ruleId: "evaluator", explanation: "Evaluator failed, timed out, returned invalid output, or reported low confidence." });
      return result;
    }
  }
  result.decision = decide(config.rules, [...result.deterministic, ...result.semantic.ruleResults], config.policy);
  return result;
}
