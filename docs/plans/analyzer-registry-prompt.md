# Analyzer Registry - Execution Prompt

Read `docs/plans/analyzer-registry-plan.md` first, then
`docs/plans/comment-test-unification-plan.md`. Implement the plan in this
repository, slice by slice, without changing the observable output of the
comment guard or the test guard.

## Context

- Repository: `opencode-comments-plugin` (this repo). Read `src/index.ts`,
  `src/core/dispatch.ts`, `src/core/feedback.ts`, `src/core/idle-advisory.ts`,
  `src/core/judge.ts`, `src/core/mutation.ts`, `src/core/parser-adapter.ts`,
  `src/rules/comments/index.ts`, `src/rules/tests/content.ts`, `src/audit.ts`,
  `src/core/ci.ts`, and the `*.test.ts` files before editing.
- Runtime target: OpenCode 1.x, plugin API v1 (`@opencode-ai/plugin`). Do NOT
  migrate to v2.
- The plugin is configured through the tuple
  `["opencode-comments-plugin", { comment_checker: {...}, test_guard: {...} }]`.
- Hooks: `config`, `event` (`session.idle`), `permission.ask`,
  `tool.execute.before`, `tool.execute.after`, plus the custom `tool` map.

## What to build

A single analyzer registry (types + `AnalyzerRegistry`) that both guards, the
idle analyzers, the on-demand tools, the audit and the CI share, with one result
pipeline for structured findings (test) and raw messages (comment). See the plan
for the `Analyzer` / `AnalyzerResult` shapes and the provider adapters.

## Reuse exception (read the plan, section 3)

A mechanism used on one side MAY be reused on the other, unless it changes
observable output or violates a hard constraint. Explicitly NOT allowed:
comment feedback -> `Finding`/marker, comment detection -> regex, bundling an
AST parser, LLM as a gate, Java. When a slice cannot preserve both guards'
output, stop and report; do not weaken tests.

## Slices (in order)

1. `core/analyzer.ts`: types + registry + fail-open `run` (no wiring).
2. Register the idle analyzers (mutation, test judge, parser, comment judge);
   `index.ts` iterates `registry.forTrigger("idle")`.
3. Wrap `runTestRules` as a `RuleAnalyzer`; `dispatch.after` consumes it.
4. (risk: high, needs explicit approval) Route the comment binary through a
   `CommentBinaryAnalyzer` returning `raw`.
5. Unify the append step (`renderAnalyzerResults`: findings + raw + bypass).
6. Audit/CI consume the registry where it reduces duplication.

Slices 4-5 are optional and require explicit approval before starting.

## Per-slice rules

- One concern per slice; smallest correct change.
- After each slice, in order: `bun test`, `bun run typecheck`,
  `bun run build`, `npx -y tsc --noEmit --noUnusedLocals --noUnusedParameters`.
- On failure: diagnose; never disable an assertion, narrow scope, or widen the
  change to pass. Stop and report if it cannot pass honestly.
- Commit the regenerated `dist/` with the source.
- Git: branch, one clear WHY commit, push, PR, wait for CI `test` success,
  squash-merge, delete the branch, `git pull --ff-only`. Never force-push
  `master`.
- Re-analyze after each merge; stop when nothing actionable remains.
- Do not implement marginal, low-value, or risky changes without a request.

## Hard constraints

- Comment guard output byte-identical; the comment tests are the contract.
- Never `throw` in `tool.execute.after`; append only (test marker / comment
  raw).
- Config in the tuple; merge config-hook keys, never overwrite.
- Zero new runtime dependency; cite origin (tool + license) of any ported motif.
- `warn` by default, `block` opt-in; no aggregate/coverage gate.
- Fail-open everywhere; the LLM judge is advisory and disabled by default.
- Java stays removed.

## Verification

`bun test`, `bun run typecheck`, `bun run build`,
`npx -y tsc --noEmit --noUnusedLocals --noUnusedParameters`, plus the comment
guard non-regression suite. Report exact outputs and any gap not verified.

## Deliverable

Git diff, the list of slices implemented (with PR/merge), exact verification
output, remaining limits, and anything deliberately not done (with reason).
