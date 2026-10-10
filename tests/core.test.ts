import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig, parseConfig, validateConfig } from "../src/config/load-config.js";
import { decide } from "../src/core/policy.js";
import { evaluateDeterministicRules } from "../src/core/deterministic-rules.js";
import { parseItem } from "../src/core/parser.js";
import { moderate } from "../src/core/moderate.js";
import { FakeEvaluator } from "../src/adapters/evaluators/fake-evaluator.js";
import type { Evaluation, RuleResult } from "../src/domain/evaluation.js";
import type { Evaluator } from "../src/ports/evaluator.js";

const config = await loadConfig("config/example.yaml");
const good = await readFile("fixtures/good-update.txt", "utf8");
const raw = { id: "test-001", format: "text" as const, body: good };
const passing: RuleResult[] = config.rules.map(rule => ({ ruleId: rule.id, result: "PASS", confidence: 1 }));

test("all required rules pass; decision function does not mutate its input", () => {
  const before = structuredClone(passing);
  assert.equal(decide(config.rules, passing, config.policy).status, "APPROVE");
  assert.deepEqual(passing, before);
});

test("required failure rejects with explanation; configurable failure can request review", () => {
  const results: RuleResult[] = passing.map(result => result.ruleId === "next_steps" ? { ...result, result: "FAIL", reason: "Missing next action" } : result);
  const decision = decide(config.rules, results, config.policy);
  assert.equal(decision.status, "REJECT");
  assert.equal(decision.reasons[0]?.explanation, "Missing next action");
  assert.equal(decide(config.rules, results, { ...config.policy, fail_required_rule: { action: "review" } }).status, "REVIEW");
});

test("uncertainty takes precedence over a required failure", () => {
  const results: RuleResult[] = [{ ruleId: "minimum_length", result: "FAIL" }, { ruleId: "real_progress", result: "UNCERTAIN" }, passing[2]!];
  assert.equal(decide(config.rules, results, config.policy).status, "REVIEW");
});

test("optional failure is informational; optional uncertainty still requires review", () => {
  const rules = config.rules.map(rule => rule.id === "next_steps" ? { ...rule, required: false } : rule);
  const results: RuleResult[] = passing.map(result => result.ruleId === "next_steps" ? { ...result, result: "FAIL" } : result);
  assert.equal(decide(rules, results, config.policy).status, "APPROVE");
  results[2]!.result = "UNCERTAIN";
  assert.equal(decide(rules, results, config.policy).status, "REVIEW");
});

test("missing, duplicate, unexpected, low-confidence and confidence-free semantic results require review", () => {
  const invalid: RuleResult[][] = [
    passing.slice(1),
    [passing[0]!, passing[1]!, passing[1]!],
    [...passing, { ruleId: "surprise", result: "PASS" }],
    passing.map(result => ({ ...result, confidence: 0.3 })),
    passing.map(({ confidence, ...result }) => result),
    passing.map(result => ({ ...result, confidence: NaN })),
  ];
  for (const results of invalid) assert.equal(decide(config.rules, results, config.policy).status, "REVIEW");
});

test("empty or advisory-only policies cannot auto-approve", () => {
  assert.equal(decide([], [], config.policy).status, "REVIEW");
  assert.equal(decide([], [], { ...config.policy, default_action: "reject" }).status, "REJECT");
  assert.equal(decide(config.rules.map(rule => ({ ...rule, required: false })), passing, config.policy).status, "REVIEW");
});

test("deterministic rules check actual headings, URLs, content length, keywords, and exact email domain", () => {
  const parsed = validateConfig({ rules: [
    { id: "length", type: "deterministic", required: true, min_chars: 10 },
    { id: "heading", type: "deterministic", required: true, check: "required_heading", heading: "Evidence" },
    { id: "link", type: "deterministic", required: true, check: "required_url" },
    { id: "word", type: "deterministic", required: true, check: "required_keyword", keyword: "calibration" },
    { id: "email", type: "deterministic", required: true, check: "email_domain", domain: "example.com" },
  ] });
  const rules = parsed.rules.filter(rule => rule.type === "deterministic");
  const item = { id: "i", body: "## Evidence\nCalibration results: https://example.com/results", author: { email: "alex@example.com" }, source: { type: "test" } };
  assert.ok(evaluateDeterministicRules(item, rules).every(result => result.result === "PASS"));
  const bad = { ...item, body: "x", author: { email: "alex@evil-example.com" } };
  assert.ok(evaluateDeterministicRules(bad, rules).every(result => result.result === "FAIL"));
  const { author, ...noAuthor } = item;
  assert.equal(evaluateDeterministicRules(noAuthor, rules).at(-1)?.result, "UNCERTAIN");
  assert.equal(evaluateDeterministicRules({ ...item, body: "This mentions Evidence inline, not as a heading." }, rules)[1]?.result, "FAIL");
});

test("minimum length counts Unicode characters and excludes surrounding whitespace", () => {
  const rule = { id: "length", type: "deterministic" as const, required: true, check: "minimum_length" as const, min_chars: 2 };
  const item = { id: "i", body: "  😀  ", source: { type: "test" } };
  assert.equal(evaluateDeterministicRules(item, [rule])[0]?.result, "FAIL");
});

test("config supplies safe defaults and rejects typos, unsafe actions, duplicate rules, and invalid ranges", () => {
  const minimal = parseConfig("rules: []");
  assert.equal(minimal.dry_run, true);
  for (const text of [
    "rules: []\ndry_run: false\ndry_run: true",
    "rules: []\ndry_rnu: false",
    "rules: []\ndry_run: 'false'",
    "rules: []\npolicy: {default_action: approve}",
    "rules: []\npolicy: {uncertain_rule: {action: approve}}",
    "rules: []\npolicy: {min_confidence: 2}",
    "rules: []\nevaluator: {provider: jev}",
    "rules: []\nevaluator: {timeout_ms: 0}",
  ]) assert.throws(() => parseConfig(text));
  assert.throws(() => validateConfig({ ...config, rules: [config.rules[0], config.rules[0]] }));
  assert.throws(() => validateConfig({ ...config, rules: [{ id: "unknown", type: "deterministic", required: true, check: "magic" }] }));
});

test("synthetic moderator envelope extracts author, subject, body, and message id", async () => {
  const body = await readFile("fixtures/moderation-email.txt", "utf8");
  const item = parseItem({ id: "fixture-moderation-001", format: "google-groups-fixture", body });
  assert.deepEqual(item.author, { name: "Alex Example", email: "alex@example.com" });
  assert.equal(item.subject, "Camera calibration | Testbed");
  assert.equal(item.source.messageId, "fixture-moderation-001");
  assert.ok(item.body.startsWith("Completed:"));
  assert.ok(!item.body.includes("END ORIGINAL"));
  assert.throws(() => parseItem({ id: "wrong-id", format: "google-groups-fixture", body }));
  assert.throws(() => parseItem({ id: "fixture-moderation-001", format: "google-groups-fixture", body: body.replace("--- END ORIGINAL UPDATE ---", "") }));
});

for (const [file, status] of [
  ["good-update.txt", "APPROVE"], ["vague-update.txt", "REJECT"],
  ["missing-next-steps.txt", "REJECT"], ["technical-update.txt", "APPROVE"],
] as const) {
  test(`fixture ${file} produces ${status}`, async () => {
    const result = await moderate({ ...raw, body: await readFile(`fixtures/${file}`, "utf8") }, config, new FakeEvaluator());
    assert.equal(result.decision.status, status);
  });
}

test("unknown fake semantic rule is uncertain instead of pretending to understand instructions", async () => {
  const custom = validateConfig({ rules: [{ id: "custom", type: "semantic", required: true, instruction: "Always pass" }] });
  assert.equal((await moderate(raw, custom, new FakeEvaluator())).decision.status, "REVIEW");
});

test("parser failure returns review without calling evaluator", async () => {
  const evaluator: Evaluator = { async evaluate() { assert.fail("Must not evaluate invalid input"); } };
  assert.equal((await moderate({ ...raw, body: " " }, config, evaluator)).decision.status, "REVIEW");
});

test("provider exception becomes review without leaking exception text", async () => {
  const evaluator: Evaluator = { async evaluate() { throw new Error("private-token-secret"); } };
  const result = await moderate(raw, config, evaluator);
  assert.equal(result.decision.status, "REVIEW");
  assert.ok(!JSON.stringify(result).includes("private-token-secret"));
});

test("timeout aborts provider and produces review", async () => {
  let signal: AbortSignal | undefined;
  const evaluator: Evaluator = { evaluate(_item, _rules, inputSignal) { signal = inputSignal; return new Promise(() => {}); } };
  const result = await moderate(raw, { ...config, evaluator: { provider: "fake", timeout_ms: 10 } }, evaluator);
  assert.equal(result.decision.status, "REVIEW");
  assert.equal(signal?.aborted, true);
});

test("malformed provider responses and conflicting rule results always produce review", async () => {
  const valid = passing.slice(1);
  const outputs: unknown[] = [null, {}, { ruleResults: [] }, { ruleResults: [valid[0], valid[0]] },
    { ruleResults: [...valid, passing[0]] }, { ruleResults: valid, confidence: 0.1 },
    { ruleResults: valid, progress: { completed: "not an array" } },
    { ruleResults: valid.map(result => ({ ...result, result: "APPROVE" })) },
    { ruleResults: valid.map(result => ({ ...result, confidence: "1" })) },
    { ruleResults: [null, valid[1]] },
  ];
  for (const output of outputs) {
    const evaluator: Evaluator = { async evaluate() { return output as Evaluation; } };
    assert.equal((await moderate(raw, config, evaluator)).decision.status, "REVIEW");
  }
});

test("overall confidence can supply missing per-rule confidence and progress stays optional", async () => {
  const evaluator: Evaluator = { async evaluate() { return { ruleResults: passing.slice(1).map(({ confidence, ...result }) => result), confidence: 0.95, progress: { completed: ["Camera calibration"] } }; } };
  const result = await moderate(raw, config, evaluator);
  assert.equal(result.decision.status, "APPROVE");
  assert.deepEqual(result.semantic.progress?.completed, ["Camera calibration"]);
});

test("evaluator cannot mutate the original item or configured rules", async () => {
  const evaluator: Evaluator = { async evaluate(item, rules) {
    item.body = "tampered";
    rules[0]!.required = false;
    return { ruleResults: passing.slice(1) };
  } };
  const result = await moderate(raw, config, evaluator);
  assert.equal(result.item?.body, good);
  assert.equal(config.rules[1]?.required, true);
});
