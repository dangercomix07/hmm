import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmm, FakeInbox, FakeEvaluator, FakeApprovalAdapter, MemoryStore, loadConfig } from "../src/index.js";
import type { Evaluator } from "../src/ports/evaluator.js";

const config = await loadConfig("config/example.yaml");
const body = await readFile("fixtures/good-update.txt", "utf8");
const raw = { id: "fake-moderation-001", format: "text" as const, body };

test("dry run skips approval, external storage, and external notifications", async () => {
  const approval = new FakeApprovalAdapter();
  const hmm = createHmm({ config, inbox: new FakeInbox([raw]), evaluator: new FakeEvaluator(), approval,
    store: { scope: "external", async saveResult() { assert.fail("External write in dry run"); } },
    notifier: { scope: "external", async notify() { assert.fail("External notification in dry run"); } },
  });
  const results = await hmm.run();
  assert.equal(results[0]?.decision.status, "APPROVE");
  assert.deepEqual(approval.approvedIds, []);
});

test("dry run stores local test results and emits local notifications", async () => {
  const store = new MemoryStore();
  let notices = 0;
  await createHmm({ config, inbox: new FakeInbox([raw]), evaluator: new FakeEvaluator(), store,
    notifier: { scope: "local", async notify(result, dryRun) { notices++; assert.equal(dryRun, true); assert.equal(result.decision.status, "APPROVE"); } },
  }).run();
  assert.equal(store.results.length, 1);
  assert.equal(notices, 1);
});

test("enabled fake approval receives only approved ids; rejected and review items are stored", async () => {
  const approval = new FakeApprovalAdapter();
  const store = new MemoryStore();
  const results = await createHmm({ config: { ...config, dry_run: false }, evaluator: new FakeEvaluator(), approval, store,
    inbox: new FakeInbox([raw, { ...raw, id: "bad", body: "No progress." }, { ...raw, id: "invalid", body: "" }]),
  }).run();
  assert.deepEqual(results.map(result => result.decision.status), ["APPROVE", "REJECT", "REVIEW"]);
  assert.deepEqual(approval.approvedIds, [raw.id]);
  assert.equal(store.results.length, 3);
});

test("provider failures cannot reach approval even when dry_run is false", async () => {
  const approval = new FakeApprovalAdapter();
  const evaluator: Evaluator = { async evaluate() { throw new Error("Unavailable"); } };
  const results = await createHmm({ config: { ...config, dry_run: false }, inbox: new FakeInbox([raw]), evaluator, approval }).run();
  assert.equal(results[0]?.decision.status, "REVIEW");
  assert.deepEqual(approval.approvedIds, []);
});

test("duplicate inbox ids abort the batch before approval", async () => {
  const approval = new FakeApprovalAdapter();
  await assert.rejects(createHmm({ config: { ...config, dry_run: false }, inbox: new FakeInbox([raw, raw]), evaluator: new FakeEvaluator(), approval }).run(), /duplicate/);
  assert.deepEqual(approval.approvedIds, []);
});

test("approval error propagates without retrying or claiming storage succeeded", async () => {
  const store = new MemoryStore();
  let attempts = 0;
  await assert.rejects(createHmm({ config: { ...config, dry_run: false }, inbox: new FakeInbox([raw]), evaluator: new FakeEvaluator(), store,
    approval: { async approve() { attempts++; throw new Error("Action failed"); } },
  }).run(), /Action failed/);
  assert.equal(attempts, 1);
  assert.equal(store.results.length, 0);
});

test("fixture moderator message passes through the complete fake pipeline", async () => {
  const approval = new FakeApprovalAdapter();
  const message = { id: "fixture-moderation-001", format: "google-groups-fixture" as const, body: await readFile("fixtures/moderation-email.txt", "utf8") };
  const results = await createHmm({ config: { ...config, dry_run: false }, inbox: new FakeInbox([message]), evaluator: new FakeEvaluator(), approval }).run();
  assert.equal(results[0]?.item?.author?.email, "alex@example.com");
  assert.deepEqual(approval.approvedIds, [message.id]);
});
