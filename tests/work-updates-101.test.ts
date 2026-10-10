import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig, validateConfig } from "../src/config/load-config.js";
import { moderate, moderateItem } from "../src/core/moderate.js";
import { MimeEmailParser } from "../src/adapters/email/mime-parser.js";
import { fileEmail } from "../src/adapters/email/check-email.js";
import { observeContent } from "../src/adapters/email/content-observations.js";
import { imageAttachmentStatus } from "../src/core/image-attachments.js";
import type { ContentObservations, ImagePart } from "../src/domain/content-observations.js";
const profile = await loadConfig("config/work-updates-101.yaml");
const run = (body: string) => moderate({ id: "test", body, format: "text" }, profile);
const fixture = (name: string) => readFile(`fixtures/work-updates-101/${name}`);
for (const [name, status] of Object.entries({ "valid-concise": "APPROVE", "missing-next": "REJECT", "placeholder-next": "REJECT", "blockers-none": "APPROVE", "code-ten": "APPROVE", "code-eleven": "REJECT", "quoted-gmail": "REJECT", "ambiguous-quote": "REVIEW" })) test(`WORK UPDATES text ${name}: ${status}`, async () => {
  const body = (await fixture(name + ".txt")).toString(); const result = await run(body);
  assert.equal(result.decision.status, status, JSON.stringify(result.feedback)); assert.equal(result.item!.body, body);
});
for (const [name, status] of Object.entries({ "inline-matched": "APPROVE", "inline-missing": "REJECT", "inline-multiple": "APPROVE", "inline-ambiguous": "REVIEW", "no-images": "APPROVE", "html-quoted": "REJECT", "html-ambiguous-quote": "REVIEW", "html-code-eleven": "REJECT" })) test(`WORK UPDATES MIME ${name}: ${status}`, async () => {
  const bytes = await fixture(name + ".eml"); const parsed = await new MimeEmailParser().parse(fileEmail(bytes));
  const result = await moderateItem({ id: "test", body: parsed.text, source: { type: "fixture" }, contentObservations: parsed.contentObservations! }, profile);
  assert.equal(result.decision.status, status, JSON.stringify({ facts: parsed.contentObservations, feedback: result.feedback }));
  assert.equal(result.item!.body, parsed.text); assert.ok(!JSON.stringify(parsed.contentObservations).includes("image-fixture"));
});
test("empty/trivial bodies reject with configured sanity rule; no semantic usefulness judgment", async () => {
  for (const body of ["", "   ", "---\n* * *", "Next steps:\n- [ ]", "TODO\nNext steps:\nTBD"]) assert.equal((await run(body)).decision.status, "REJECT", body);
  assert.equal((await run("Worked on the project today.\nNext steps:\nContinue tomorrow.")).decision.status, "APPROVE");
});
test("next-step aliases ignore case and accept any non-placeholder prose", async () => {
  for (const alias of ["Next steps", "Future work", "Next actions", "Plan", "Up next", "fUtUrE wOrK"]) assert.equal((await run(`Tested the patch.\n${alias}:\nContinue tomorrow.`)).decision.status, "APPROVE");
});
test("placeholder scope and mixed text do not prohibit None, N/A or ordinary TODO discussion", async () => {
  for (const value of ["TBD", "TODO", "Will update later", "Nothing yet", "Same as before", "No update"]) assert.equal((await run(`Tested the patch.\nNext steps:\n${value}`)).decision.status, "REJECT");
  for (const value of ["None", "N/A", "Removed the TODO marker; inspect the trace next.", "TODO\nInspect the trace."]) assert.equal((await run(`Tested the patch.\nBlockers:\nNone\nNext steps:\n${value}`)).decision.status, "APPROVE");
});
test("code boundaries: CRLF, tilde fences, multiple short blocks, internal blank lines, ambiguity", async () => {
  const wrap = (code: string) => `Tested the patch.\n${code}\nNext steps:\nInspect the trace.`;
  assert.equal((await run(wrap('~~~c\n'+Array(10).fill('x();').join('\r\n')+'\n~~~'))).decision.status, "APPROVE");
  assert.equal((await run(wrap(('```\nx();\n```\n').repeat(12)))).decision.status, "APPROVE");
  assert.equal((await run(wrap('```\n'+Array(11).fill('').join('\n')+'\n```'))).decision.status, "REJECT");
  assert.equal((await run(wrap('```\nx();'))).decision.status, "REVIEW");
  assert.equal((await run(wrap('    x();'))).decision.status, "REVIEW");
  assert.equal((await run(wrap('The value is `ready`.'))).decision.status, "APPROVE");
});
test("reply markers require clear envelope context; code containing quote samples is not history", async () => {
  const base = 'Tested the patch.\nNext steps:\nInspect the trace.\n';
  assert.equal((await run(base+'-----Original Message-----\nFrom: alex@example.com\nTo: team@example.com\nSubject: old\nold body')).decision.status, "REJECT");
  assert.equal((await run(base+'-----Original Message-----')).decision.status, "REVIEW");
  assert.equal((await run(base+'```text\n> quote example\n```')).decision.status, "APPROVE");
});
const part = (disposition: string | null, filename: string | null, contentId?: string): ImagePart => ({ disposition, filename, mimeType: "image/png", size: 5, ...(contentId ? { contentId } : {}) });
const facts = (images: string[], parts: ImagePart[]): ContentObservations => ({ htmlQuote: "none", htmlCodeLines: [], htmlCodeAmbiguous: false, images: images.map(source => ({ source })), imageParts: parts, mimeComplete: true });
test("image matching is one-to-one; count fallback never overrides contradictory names", () => {
  assert.equal(imageAttachmentStatus(facts([], [part('inline','a.png'), part('inline','b.png'), part('attachment','a.png')]), ''), 'FAIL');
  assert.equal(imageAttachmentStatus(facts([], [part('inline','a.png'), part('attachment','b.png')]), ''), 'FAIL');
  assert.equal(imageAttachmentStatus(facts([], [part('inline',null), part('attachment',null)]), ''), 'PASS');
  assert.equal(imageAttachmentStatus(facts(['cid:a'], [part('attachment','a.png','a')]), ''), 'PASS');
  assert.equal(imageAttachmentStatus(facts(['cid:a'], [part(null,'a.png','a')]), ''), 'UNCERTAIN');
  assert.equal(imageAttachmentStatus(facts(['cid:a'], [part('inline','a.png','a'),part('attachment','a.png','a')]), ''), 'UNCERTAIN');
  assert.equal(imageAttachmentStatus(facts(['cid:missing'], []), ''), 'UNCERTAIN');
});
test("remote/data images are never fetched and missing attachments fail; text without MIME stays uncertain", () => {
  for (const source of ['https://example.com/image.png', 'data:image/png;base64,YQ==']) {
    const observed = observeContent(`<img src="${source}">`, []);
    assert.equal(observed.images.length, 1); assert.equal(imageAttachmentStatus(observed, ''), 'FAIL');
  }
  assert.equal(imageAttachmentStatus(undefined, '![plot](plot.png)'), 'UNCERTAIN');
  assert.equal(imageAttachmentStatus(undefined, 'no images'), 'PASS');
});
test("rule settings are configurable and invalid code/placeholder policies are rejected", async () => {
  const changed = validateConfig({ ...profile, rules: profile.rules.map(r => r.type === 'deterministic' && r.check === 'inline_code_limit' ? { ...r, max_lines: 11 } : r) });
  assert.equal((await moderate({ id: 'test', format: 'text', body: (await fixture('code-eleven.txt')).toString() }, changed)).decision.status, 'APPROVE');
  for (const max_lines of [0, -1, 1.5, '10']) assert.throws(() => validateConfig({ ...profile, rules: [{ id: 'code', type: 'deterministic', required: true, check: 'inline_code_limit', max_lines }] }));
  assert.throws(() => validateConfig({ ...profile, preamble: 'guess' }));
});

test("Groups evaluation uses only the member MIME facts, never wrapper logos or forwarding envelope", async () => {
  const { checkEmail } = await import('../src/adapters/email/check-email.js');
  const { GoogleGroupsParser } = await import('../src/adapters/email/google-groups-parser.js');
  const { loadGoogleGroupsConfig } = await import('../src/adapters/email/google-groups-config.js');
  const groups = await loadGoogleGroupsConfig('config/google-groups.example.yaml');
  for (const [name, status] of [['groups-inline-matched', 'APPROVE'], ['groups-inline-missing', 'REJECT']]) {
    const raw = fileEmail(await fixture(name+'.eml'));
    const result = await checkEmail(raw, profile, { async evaluate() { assert.fail('No semantic provider'); } }, new MimeEmailParser(), new GoogleGroupsParser(groups));
    assert.equal(result.moderation.decision.status, status, JSON.stringify(result.moderation));
    assert.equal(result.message!.item.contentObservations!.images.length, 1);
    assert.equal(result.message!.item.contentObservations!.images[0]!.source, 'cid:trace');
    assert.equal(result.plan.executable, false);
  }
});
test("ambiguous multiline inline-code spans and repeated filenames require review", async () => {
  assert.equal((await run('Tested `the\npatch`.\nNext steps:\nInspect the trace.')).decision.status, 'REVIEW');
  assert.equal(imageAttachmentStatus(facts([], [part('inline','same.png','a'),part('inline','same.png','b'),part('attachment','same.png','attached')]), ''), 'UNCERTAIN');
});

test("formatting-only lines do not disguise a placeholder-only required section", async () => {
  for (const body of ['TBD\n---', '**TBD**.', '- TODO\n- [ ]', '**TODO.**']) {
    assert.equal((await run(`Tested the patch.\nNext steps:\n${body}`)).decision.status, 'REJECT', body);
  }
});
