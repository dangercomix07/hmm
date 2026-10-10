# Milestone 5B completion report

> Historical development record. See the [current release](releases/v0.2.0-supervised-mvp.md)
> and [current setup](supervised-moderation.md) instead of historical branch commands.


Completed on 11 October 2026. Branch: `milestone5b-deterministic-product`.
Baseline: Milestone 5A commit `b7b72f3`. Historical milestone branches and main are unchanged.

- **Architecture:** the existing evaluator/policy/adapter separation remains. Section parsing and
  reusable checks extend deterministic evaluation. Evaluators are optional in the core pipeline.
  ModerationResult exposes structured feedback. The policy itself remains unchanged.
- **Primitives:** section_structure, required_section, nonempty_section, unique_section,
  section_length, total_length, bullet_count, forbidden_placeholder and section_url. Existing
  primitives remain. Arbitrary regex rules are intentionally unsupported and rejected.
- **Parser:** case-insensitive configured names/aliases; plain, colon and Markdown headings;
  duplicate/ambiguous structure review; preserved unknown sections; fenced-code handling;
  retained original input and bounded parsing. No content rewriting or fuzzy heading correction.
- **Feedback:** ruleId, category, severity, message and optional section. Factual templates identify
  missing/empty/placeholder/ambiguous content and unresolved semantic questions. Normal output
  hides rule IDs; verbose includes IDs/statuses. Neither mode invents engineering work or forwards
  model-generated rewrites as advice.
- **Profile:** `config/team-update.yaml` requires nonempty Progress and Next steps. Evidence and
  Blockers are optional, checked if present. Numbers and positive outcomes are not required.
  Section aliases, lengths, placeholders and presence requirements are configurable.
- **REVIEW:** malformed/duplicate sections, mixed placeholders, configured unknown sections,
  unresolved semantic requirements, low confidence and failed/malformed/timed-out evaluators.
  Existing policy gives uncertainty precedence over other failures.
- **Optional semantics:** omitted evaluator selects none. Explicit fake/Jev providers remain.
  Semantic rules retain provider-independent IDs/instructions/required flags. Missing evaluation
  produces uncertainty, never regex guesses. No paid service or key is needed for this profile.
- **Tests:** 20 realistic synthetic fixtures plus parser, placeholders, bounds, invalid config,
  human output, no-key/default CLI, semantic mock outcomes, evaluator/source identity isolation,
  injection and safety regression tests. All existing 5A safety tests remain.
- **Validation:** `npm test`: **242 passed, 0 failed, 0 skipped** (195 baseline + 47 added).
  `npm run typecheck`: passed. `git diff --check`: passed. The inherited loopback-only test guard
  remains active. Test success was verified locally; this report does not assert a GitHub CI result.
- **Files:** complete inventory below.
- **Dependencies:** none added. package.json and package-lock.json are unchanged.
- **Limits:** deterministic checks cannot prove truth, technical correctness, engineering quality,
  genuine progress, scientific validity or intent. Vague/unsupported but structurally complete
  examples can pass. Add semantic requirements for human review when the workflow needs those
  judgments. The parser supports a documented subset of Markdown, not every writing format.
- **External services:** no live Gmail, Groups, TypeSafe/Jev, OpenAI or other product API was called.
  No credentials were used. Development/tests were offline; repository publication uses GitHub only.
- **Automation/safety:** no scheduler, polling, autonomous approval/rejection or send path was added.
  Authentication, durable ledger, uncertainty, source identity and supervised-send code are unchanged.
  No merge or next milestone work was performed.

## Compatibility changes

`check` now defaults to the deterministic team profile. The old demo is still available with
`--config config/example.yaml`. Omitted evaluator configuration now disables evaluation instead
of choosing fake. Explicit fake/Jev configs remain supported. Gmail command defaults and the
controlled fake-only approval test are unchanged. Console output is for people; integrations
should use the typed result rather than parse console text.

See the [team-update guide](team-updates.md) for use, configuration, parser limits and review policy.

## Changed files

- `README.md`
- `SECURITY.md`
- `config/team-update.yaml`
- `docs/milestone5b-completion.md`
- `docs/team-updates.md`
- `fixtures/team-updates/README.md`
- `fixtures/team-updates/blocker-present.md`
- `fixtures/team-updates/duplicate-section.md`
- `fixtures/team-updates/evidence-link.md`
- `fixtures/team-updates/expectations.json`
- `fixtures/team-updates/failed-experiment.md`
- `fixtures/team-updates/long-rambling.md`
- `fixtures/team-updates/malformed-heading.md`
- `fixtures/team-updates/missing-next-steps.md`
- `fixtures/team-updates/missing-progress.md`
- `fixtures/team-updates/no-blockers.md`
- `fixtures/team-updates/placeholder-heavy.md`
- `fixtures/team-updates/prompt-injection.md`
- `fixtures/team-updates/qualitative-no-numbers.md`
- `fixtures/team-updates/template-only.md`
- `fixtures/team-updates/terse-useful.md`
- `fixtures/team-updates/unknown-sections.md`
- `fixtures/team-updates/unsupported-claim.md`
- `fixtures/team-updates/unusual-wording.md`
- `fixtures/team-updates/useful-concise.md`
- `fixtures/team-updates/useful-detailed.md`
- `fixtures/team-updates/vague.md`
- `src/adapters/evaluators/create-evaluator.ts`
- `src/adapters/notifications/console-notifier.ts`
- `src/cli/index.ts`
- `src/config/load-config.ts`
- `src/config/types.ts`
- `src/core/deterministic-rules.ts`
- `src/core/moderate.ts`
- `src/core/pipeline.ts`
- `src/core/section-rules.ts`
- `src/core/sections.ts`
- `src/domain/decision.ts`
- `src/domain/evaluation.ts`
- `src/domain/feedback.ts`
- `src/domain/rule.ts`
- `src/index.ts`
- `tests/cli.test.ts`
- `tests/jev.test.ts`
- `tests/team-update.test.ts`
