import test from "node:test";
import assert from "node:assert/strict";
import { sectionRule } from "../src/core/section-rules.js";
import { parseSections } from "../src/core/sections.js";
import type { DeterministicRule } from "../src/domain/rule.js";
const run = (body: string, rule: DeterministicRule) => sectionRule(rule, parseSections(body,
  [{ name: "Next steps", aliases: ["Future work"] }], "allow"), "preserve")!;
const base = { id: "check", required: true, type: "deterministic" as const, section: "Next steps" };
test("required section aliases have positive feedback; missing sections have failure feedback", () => {
  for (const heading of ["Next steps", "Future work"]) {
    const r = run(heading + ":\nInspect trace.", { ...base, check: "required_section" });
    assert.equal(r.result, "PASS"); assert.equal(r.reason, "Required section 'Next steps' is present.");
    assert.equal(r.feedback?.message, r.reason);
  }
  const r = run("Worked today.", { ...base, check: "required_section" });
  assert.equal(r.result, "FAIL"); assert.equal(r.reason, "Missing required section: Next steps.");
});
test("nonempty section messages match populated and empty results", () => {
  for (const [content, status, reason] of [["Inspect trace.", "PASS", "Next steps contains content."],
    ["", "FAIL", "Next steps section is empty."]]) {
    const r = run("Next steps:\n" + content, { ...base, check: "nonempty_section" });
    assert.equal(r.result, status); assert.equal(r.reason, reason);
  }
});
test("placeholder feedback preserves fail, review and configured mixed-ignore behavior", () => {
  for (const mixed_action of ["ignore", "review"] as const) {
    const rule = { ...base, check: "forbidden_placeholder" as const, phrases: ["TODO"], mixed_action };
    const clean = run("Next steps:\nInspect trace.", rule);
    assert.equal(clean.result, "PASS"); assert.equal(clean.reason, "No forbidden placeholder-only content found in Next steps.");
    const placeholder = run("Next steps:\nTODO", rule);
    assert.equal(placeholder.result, "FAIL"); assert.equal(placeholder.reason, "Next steps section contains only placeholder text.");
    const mixed = run("Next steps:\nTODO\nInspect trace.", rule);
    assert.equal(mixed.result, mixed_action === "ignore" ? "PASS" : "UNCERTAIN");
    assert.equal(mixed.reason, mixed_action === "ignore" ? clean.reason : "Next steps mixes placeholder text with other content; review the unfinished entries.");
  }
});
