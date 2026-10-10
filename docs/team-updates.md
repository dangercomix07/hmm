# Engineering update pre-check

Run the check before you send an update:

```bash
npm run cli -- check update.md --config config/team-update.yaml
```

`check` uses this profile by default. It works offline. It needs no credentials or paid service.
It never sends email, approves a Google Groups post, or writes external storage.
Use `--verbose` to show rule IDs and statuses. Exit codes: 0 APPROVE, 1 REJECT, 2 REVIEW/error.

## What the profile checks

Progress and Next steps must exist and contain text. Evidence and Blockers are optional.
If you supply an optional section, it must contain text. `None` and `No blockers` are valid.
The update must contain no more than 12000 Unicode code points after outer whitespace is trimmed.
The profile checks Progress, Evidence and Next steps against configurable placeholder phrases.

Example:

```text
Progress:
- Tested the new camera exposure configuration.
- The target saturated at the expected illumination level.
Evidence:
- Failure reproduced in 4/4 runs.
Blockers:
- None.
Next steps:
- Reduce exposure and repeat the same illumination sweep.
```

A failed experiment, disproved hypothesis, reproduced bug, narrowed root cause, incompatible
interface or rejected component can be useful information. The checks do not require success,
numbers or a list of approved verbs. Content typos and synonyms are not scored.

APPROVE means **the configured requirements passed**. It does not establish truth, technical
correctness, engineering quality, genuine progress, scientific validity or intent. A complete
but vague update can pass. The `vague` and `unsupported-claim` fixtures demonstrate this limit.
The checker does not accuse an engineer of lying or determine that a claim is fabricated.

## Sections and parsing

The profile defines canonical names and aliases. Matching ignores case and repeated whitespace.
Default aliases include Work done/What changed, Results/Observations, Dependencies, and
Next actions/Up next. Teams can change the definitions and rules in their own YAML file.

Supported headings occupy their own line:

```text
Progress:
Progress
## Progress
### Progress
```

Markdown heading levels 1–6 and optional trailing Markdown hashes are supported. Plain headings
without a colon must match a configured name/alias. An unknown heading with a colon or Markdown
marker starts a preserved unknown section. It does not count as the preceding section's content.
Unknown sections pass by default; set `unknown_sections: review` to require review instead.
No fuzzy heading correction, inline `Progress: text`, setext headings or full Markdown AST is used.

Duplicate known sections, malformed hash headings, nonempty preamble and unclosed code fences
produce REVIEW. Fenced code headings are content, not new sections. Original text is retained on
the Item and SectionParse; parsing does not rewrite the engineer's update. Section parsing is
limited to 100000 UTF-16 code units; larger section-profile inputs produce REVIEW before evaluation.
Section definitions are bounded to 50 entries and 100 aliases per entry. Names are at most 80 characters.

## Rule reference

Every rule has a unique `id`, `type: deterministic`, and boolean `required`. A required FAIL uses
`policy.fail_required_rule.action` (reject by default). An optional FAIL is informational.
Any UNCERTAIN produces REVIEW, even if another rule fails. REVIEW is not converted to REJECT.

| Check | Fields | Behavior |
| --- | --- | --- |
| `section_structure` | none | REVIEW for malformed/ambiguous structure, duplicate known sections, or configured unknown-section review |
| `required_section` | `section` | FAIL if the canonical section is absent |
| `nonempty_section` | `section` | FAIL if a present section has no letter/number content after bullet-marker removal |
| `unique_section` | `section` | REVIEW if repeated; structure validation also detects duplicate known sections |
| `section_length` | `section`, `min`, `max` | Count trimmed section content, including formatting, in Unicode code points |
| `total_length` | `min`, `max` | Count trimmed original update in Unicode code points |
| `bullet_count` | `section`, `min`, `max` | Count nonempty Markdown unordered/numbered bullet lines outside fences; nested bullets count too |
| `forbidden_placeholder` | `section`, `phrases` | FAIL for placeholder-only text; REVIEW when placeholders mix with other content |
| `section_url` | `section` | Require a syntactically valid HTTP(S) URL; never fetch it |

Presence and content are separate requirements. Other section checks PASS when the section is
absent. Add `required_section` to require its presence. Use the canonical name in rule definitions;
aliases apply to input headings. Section profiles must include a required `section_structure` rule.
Lengths/counts are integers from 0 to 100000. Omitted min/max values default to 0/100000.
Legacy checks remain supported: minimum_length, required_heading, required_url, required_keyword,
and email_domain. Custom regex rules are deliberately not included.

To require Evidence, append:

```yaml
- id: evidence-present
  type: deterministic
  required: true
  check: required_section
  section: Evidence
```

To require a reference link, also append a `section_url` rule for Evidence. This checks only that
a URL exists, not its availability, contents, relevance or authority. To route structural failures
to review, set `policy.fail_required_rule.action: review`.

Placeholder phrases are explicit configuration. Matching ignores case and terminal periods or
exclamation marks for placeholder-only lines. Simple emphasis around a placeholder is supported.
Bullet prefixes are stripped. Literal phrase occurrences mixed with other text cause REVIEW,
not a claim that the surrounding text lacks meaning. Quoting a TODO in a useful explanation may
therefore need review. Teams can adjust the phrase list. `None` is not globally forbidden.

Configuration rejects duplicate IDs, conflicting section names/aliases, duplicate presence rules,
unknown checks/fields, invalid policy actions, invalid bounds and conflicting required numeric
ranges. It rejects a required nonempty section with a zero maximum, or section minima that exceed
a configured total maximum. It does not attempt general logical proof across arbitrary rules.
Unsupported regex/severity fields fail validation rather than being silently ignored.

## Optional meaning checks

No evaluator is needed for deterministic checks. Omitting evaluator configuration selects `none`.
The old fake evaluator's number/verb heuristics are confined to `config/example.yaml`; they are
not used by the product profile. Jev remains explicitly selectable behind the Evaluator interface.
No provider-specific rule ID is needed. Providers return PASS, FAIL or UNCERTAIN with confidence.

If a workflow requires judgment, append a semantic requirement:

```yaml
- id: meaningful-update
  type: semantic
  required: true
  instruction: Determine whether the update describes concrete work and an actionable next step.
```

Leave `evaluator.provider: none` for human review. Structurally valid updates then produce REVIEW,
because the question is unresolved. The deterministic checker does not guess which updates are
meaningful with regex. Enable a semantic provider only as a separate explicit choice. This milestone
uses mocks only; it makes no Jev call and requires no API key. Missing results, low confidence,
timeouts, invalid output and provider failures remain REVIEW under the existing policy.

## Feedback and safety

Feedback contains ruleId, category, severity, message and optional section. Categories are missing,
incomplete, malformed, placeholder, ambiguous and semantic-review. Severity is error, review or
warning. Human output groups messages and omits IDs unless verbose mode is selected.
Feedback uses factual code/config templates. Neither normal nor verbose pre-check output presents
model-generated rewrites as advice. For example, missing Next steps produces:

```text
Decision
REJECT

Missing:
- Missing required section: Next steps.
```

The checker must not turn “Worked on calibration” into an invented measurement or accomplishment.
Semantic feedback asks for review of the configured question; it does not manufacture evidence.
Prompt-injection text remains content and cannot change rules, configuration, feedback templates,
recipients, group identity, ActionId, thread IDs or execution. No send adapter is attached to check.

The Gmail/Groups test commands retain their existing configuration and fake-evaluator restrictions.
Milestone 5A authentication, durable reservations, uncertainty, no-retry and exact confirmation
boundaries are unchanged. This profile does not relax them or add automatic moderation.

## Compatibility

`check` now defaults to `config/team-update.yaml`. Select `config/example.yaml` explicitly to use
old demo fixtures. `check-email`, `gmail-check` and `approve-test` retain their existing defaults.
An omitted evaluator now means disabled, not fake. Existing explicit fake/Jev configurations work.
The human pre-check display changes; use `ModerationResult` for structured integration rather
than parsing console text. The unchanged decision policy remains provider-independent.
