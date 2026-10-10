import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { JevEvaluator, createEvaluator, FakeEvaluator, loadConfig, parseConfig, moderate, createHmm, FakeInbox, FakeApprovalAdapter } from "../src/index.js";
import type { SemanticRule } from "../src/domain/rule.js";

const config = await loadConfig("config/jev.example.yaml");
const body = await readFile("fixtures/good-update.txt", "utf8");
const item = { id: "test-item", body, source: { type: "text" } };
const raw = { id: item.id, body, format: "text" as const };
const rules = config.rules.filter(rule => rule.type === "semantic");
const question = (id: string): SemanticRule => ({ id, type: "semantic", required: true, instruction: `Check the requirement called ${id}.` });
const answer = (noul: unknown) => ({ type: "noul", noul });
const response = (answers: unknown) => JSON.stringify({ model: "jev-latest", answers, usage: { input_tokens: 100, output_tokens: 2 } });
const allPass = () => response(Object.fromEntries(rules.map(rule => [rule.id, answer(0.96)])));
function mock(text: string, status = 200): JevEvaluator {
  return new JevEvaluator("test-key-not-real", async () => new Response(text, { status }));
}

test("Jev sends the documented endpoint, bearer auth, state and arbitrary named Noul questions in one request", async () => {
  let calls = 0;
  const custom = [question("blocker_quality"), question("evidence/detail"), question("__proto__")];
  const controller = new AbortController();
  const evaluator = new JevEvaluator("test-key-not-real", async (url, init) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, controller.signal);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-key-not-real");
    assert.equal(new Headers(init.headers).get("content-type"), "application/json");
    const sent = JSON.parse(String(init.body));
    assert.equal(sent.model, "jev-latest");
    assert.deepEqual(sent.state, { item });
    assert.deepEqual(Object.keys(sent.questions), custom.map(rule => rule.id));
    for (const rule of custom) {
      assert.equal(sent.questions[rule.id].type, "noul");
      assert.ok(sent.questions[rule.id].instructions.includes(rule.instruction));
      assert.equal(sent.questions[rule.id].criteria.true, "The item satisfies the requirement.");
    }
    return new Response(response(Object.fromEntries(custom.map(rule => [rule.id, answer(0.97)]))));
  });
  const result = await evaluator.evaluate(item, custom, controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(result.ruleResults.map(entry => [entry.ruleId, entry.result]), custom.map(rule => [rule.id, "PASS"]));
});

for (const [probability, status, confidence] of [
  [1, "PASS", 1], [0.94, "PASS", 0.94], [0.09, "FAIL", 0.91], [0, "FAIL", 1], [0.5, "UNCERTAIN", 0.5],
] as const) {
  test(`Noul ${probability} maps to ${status} with selected-answer probability`, async () => {
    const result = (await mock(response({ custom: answer(probability) })).evaluate(item, [question("custom")])).ruleResults[0]!;
    assert.equal(result.result, status);
    assert.equal(result.confidence, confidence);
    assert.match(result.reason!, /No generated explanation/);
  });
}

test("all semantic and deterministic passes produce APPROVE through unchanged core", async () => {
  assert.equal((await moderate(raw, config, mock(allPass()))).decision.status, "APPROVE");
});

test("confident no produces REJECT; tie and low-confidence yes/no produce REVIEW", async () => {
  for (const [p, expected] of [[0.05, "REJECT"], [0.5, "REVIEW"], [0.6, "REVIEW"], [0.4, "REVIEW"], [0.8, "APPROVE"]] as const) {
    const evaluator = mock(response({ real_progress: answer(0.99), next_steps: answer(p) }));
    assert.equal((await moderate(raw, config, evaluator)).decision.status, expected);
  }
});

const invalidBodies: [string, string][] = [
  ["missing answer", response({ real_progress: answer(0.99) })],
  ["extra answer", response({ real_progress: answer(0.99), next_steps: answer(0.99), extra: answer(1) })],
  ["unknown answer replacing a required answer", response({ real_progress: answer(1), unknown: answer(1) })],
  ["duplicate answer", '{"answers":{"real_progress":{"type":"noul","noul":0},"real_progress":{"type":"noul","noul":1},"next_steps":{"type":"noul","noul":1}}}'],
  ["escaped duplicate answer", '{"answers":{"real_progress":{"type":"noul","noul":0},"real_\\u0070rogress":{"type":"noul","noul":1},"next_steps":{"type":"noul","noul":1}}}'],
  ["duplicate probability", '{"answers":{"real_progress":{"type":"noul","noul":0,"noul":1},"next_steps":{"type":"noul","noul":1}}}'],
  ["malformed JSON", "not JSON"],
  ["YAML instead of JSON", "answers: {}"],
  ["null root", "null"],
  ["array root", "[]"],
  ["missing answers", "{}"],
  ["array answers", response([])],
  ["null answer", response({ real_progress: null, next_steps: answer(1) })],
  ["unmappable answer type", response({ real_progress: { type: "choice", choice: "yes", confidence: 1 }, next_steps: answer(1) })],
  ["missing probability", response({ real_progress: { type: "noul" }, next_steps: answer(1) })],
  ...[-0.01, 1.01, "0.99", null, true].map((p): [string, string] => [`invalid probability ${String(p)}`, response({ real_progress: answer(p), next_steps: answer(1) })]),
  ["nonfinite JSON number", '{"answers":{"real_progress":{"type":"noul","noul":1e999},"next_steps":{"type":"noul","noul":1}}}'],
];
for (const [label, text] of invalidBodies) {
  test(`${label} throws at adapter boundary and becomes REVIEW in hmm`, async () => {
    await assert.rejects(mock(text).evaluate(item, rules));
    assert.equal((await moderate(raw, config, mock(text))).decision.status, "REVIEW");
  });
}

for (const status of [400, 401, 403, 422, 429, 500, 503]) {
  test(`HTTP ${status} causes REVIEW, makes no retries and does not expose response body`, async () => {
    let calls = 0;
    const evaluator = new JevEvaluator("test-key-not-real", async () => {
      calls++;
      return new Response("private-provider-error", { status });
    });
    const result = await moderate(raw, config, evaluator);
    assert.equal(result.decision.status, "REVIEW");
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes("private-provider-error"));
  });
}

test("network failure never invokes approval", async () => {
  const approval = new FakeApprovalAdapter();
  const evaluator = new JevEvaluator("test-key-not-real", async () => { throw new Error("private connection detail"); });
  const results = await createHmm({ config: { ...config, dry_run: false }, inbox: new FakeInbox([raw]), evaluator, approval }).run();
  assert.equal(results[0]?.decision.status, "REVIEW");
  assert.deepEqual(approval.approvedIds, []);
  assert.ok(!JSON.stringify(results).includes("private connection detail"));
});

test("existing timeout aborts the Jev HTTP request and returns REVIEW", async () => {
  let aborted = false;
  const evaluator = new JevEvaluator("test-key-not-real", async (_url, init) => new Promise<Response>((_resolve, reject) => {
    assert.ok(init.signal);
    init.signal.addEventListener("abort", () => { aborted = true; reject(init.signal!.reason); }, { once: true });
  }));
  const result = await moderate(raw, { ...config, evaluator: { provider: "jev", timeout_ms: 10 } }, evaluator);
  assert.equal(result.decision.status, "REVIEW");
  assert.equal(aborted, true);
});

test("abort applies while consuming the response body too", async () => {
  let aborted = false;
  const evaluator = new JevEvaluator("test-key-not-real", async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init.signal!.addEventListener("abort", () => { aborted = true; controller.error(init.signal!.reason); }, { once: true });
    },
  })));
  assert.equal((await moderate(raw, { ...config, evaluator: { provider: "jev", timeout_ms: 10 } }, evaluator)).decision.status, "REVIEW");
  assert.equal(aborted, true);
});

test("pre-aborted signal prevents any request", async () => {
  const evaluator = new JevEvaluator("test-key-not-real", async () => { assert.fail("No request allowed"); });
  await assert.rejects(evaluator.evaluate(item, rules, AbortSignal.abort()));
});

test("missing key, duplicate rule IDs, and empty instructions do not issue a request", async () => {
  const noFetch = async (): Promise<Response> => { assert.fail("No request allowed"); };
  assert.equal((await moderate(raw, config, new JevEvaluator("", noFetch))).decision.status, "REVIEW");
  const evaluator = new JevEvaluator("test-key-not-real", noFetch);
  await assert.rejects(evaluator.evaluate(item, [question("duplicate"), question("duplicate")]));
  await assert.rejects(evaluator.evaluate(item, [{ ...question("empty"), instruction: " " }]));
  assert.deepEqual(await evaluator.evaluate(item, []), { ruleResults: [] });
});

test("dry run still evaluates with Jev but skips approvals and external writes", async () => {
  let calls = 0;
  const approval = new FakeApprovalAdapter();
  const evaluator = new JevEvaluator("test-key-not-real", async () => { calls++; return new Response(allPass()); });
  const results = await createHmm({ config, evaluator, approval, inbox: new FakeInbox([raw]),
    store: { scope: "external", async saveResult() { assert.fail("External write"); } },
    notifier: { scope: "external", async notify() { assert.fail("External notification"); } },
  }).run();
  assert.equal(calls, 1);
  assert.equal(results[0]?.decision.status, "APPROVE");
  assert.deepEqual(approval.approvedIds, []);
});

test("provider factory defaults to disabled and explicitly selects fake or Jev; YAML never accepts API keys", () => {
  assert.equal(parseConfig("rules: []").evaluator.provider, "none");
  assert.ok(createEvaluator(parseConfig("rules: []\nevaluator: {provider: fake}")) instanceof FakeEvaluator);
  assert.ok(createEvaluator(config) instanceof JevEvaluator);
  assert.throws(() => parseConfig("rules: []\nevaluator: {provider: jev, api_key: forbidden}"));
});

test("Jev CLI config selects Jev and missing key returns REVIEW without network access", () => {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const result = spawnSync(process.execPath, ["dist/src/cli/index.js", "check", "fixtures/good-update.txt", "--config", "config/jev.example.yaml"], { env, encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /Decision\nREVIEW/);
});
