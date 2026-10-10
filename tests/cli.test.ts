import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["dist/src/cli/index.js", ...args], { encoding: "utf8" });
}

test("CLI checks good and vague fixtures with meaningful process exit statuses", () => {
  const good = cli("check", "fixtures/good-update.txt", "--config", "config/example.yaml");
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Decision\nAPPROVE/);
  assert.match(good.stdout, /DRY RUN/);
  const vague = cli("check", "fixtures/vague-update.txt", "--config", "config/example.yaml");
  assert.equal(vague.status, 1, vague.stderr);
  assert.match(vague.stdout, /Decision\nREJECT/);
});

test("CLI reports review for missing input, bad configuration, and unsupported commands", async () => {
  assert.equal(cli("check", "does-not-exist.txt").status, 2);
  assert.equal(cli("approve", "fixtures/good-update.txt").status, 2);
  const dir = await mkdtemp(join(tmpdir(), "hmm-test-"));
  try {
    const path = join(dir, "config.yaml");
    await writeFile(path, "rules: []\npolicy: {default_action: approve}");
    const result = cli("check", "fixtures/good-update.txt", "--config", path);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /REVIEW/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
