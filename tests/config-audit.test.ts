import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfigurations } from "../src/cli/check-config.js";

test("every shipped configuration matches the current loaders and examples agree", async () => {
  const checked = await checkConfigurations();
  assert.equal(checked.valid, true, checked.lines.join("\n"));
  assert.ok(checked.lines.some(line => line.includes("local.example.yaml: group")));
});
test("local audit detects schema errors and mismatched allow-lists without changing files", async t => {
  const dir = await mkdtemp(join(tmpdir(), "hmm-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const groups = await readFile("config/google-groups.local.example.yaml", "utf8");
  const sending = await readFile("config/gmail-sending.local.example.yaml", "utf8");
  const groupPath = join(dir, "google-groups.local.yaml");
  const sendingPath = join(dir, "gmail-sending.local.yaml");
  await writeFile(groupPath, groups);
  await writeFile(sendingPath, sending);
  assert.equal((await checkConfigurations(dir)).valid, true);
  const wrong = sending.replace("hmm-testing+msgappr@", "wrong+msgappr@");
  await writeFile(sendingPath, wrong);
  assert.equal((await checkConfigurations(dir)).valid, false);
  assert.equal(await readFile(sendingPath, "utf8"), wrong);
  await writeFile(sendingPath, sending + "\nsecret: DO_NOT_PRINT_THIS\n");
  const invalid = await checkConfigurations(dir);
  assert.equal(invalid.valid, false);
  assert.ok(!invalid.lines.join("\n").includes("DO_NOT_PRINT_THIS"));
});
