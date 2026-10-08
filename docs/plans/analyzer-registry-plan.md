# Analyzer Registry - Design and Plan

Status: design proposed, not implemented.
Scope: unify the orchestration of every detector (deterministic rules, the
comment binary, the opt-in external/model analyzers) behind one analyzer
registry and one result pipeline, without changing the observable output of the
comment guard or the test guard.

Companion file: `docs/plans/analyzer-registry-prompt.md` (execution prompt).
Prior context: `docs/plans/ai-test-guard-plan.md`,
`docs/plans/comment-test-unification-plan.md`.

## 1. Why

After the comment/test unification pass, the two guards share their plumbing
(`core/config`, `core/diff`, `core/budget`, `core/bypass`, `core/runner`,
`core/glob`, `core/idle-advisory`, the judge plumbing, `core/schema`), but the
**detectors and their orchestration** are still wired in three different ways:

- deterministic test rules: `runTestRules` inside `core/dispatch.ts`;
- the comment binary: `createCommentGuard` in `src/rules/comments/index.ts`;
- opt-in analyzers: an ad-hoc array in the `session.idle` handler in
  `src/index.ts` plus three on-demand tools.

There is no single place that knows "which detectors exist, when they run, and
how their results are rendered". This plan introduces that place.

## 2. Non-goals (do NOT do)

- Do not merge the detection engines. The comment side is an external binary
  (tree-sitter, comment-specific contract); the test side is in-process regex.
- Do not convert the comment binary output into `Finding[]`. The comment guard
  keeps its raw append (`output.output += "\n\n" + message`) with no marker.
  Converting it changes the observable output.
- Do not bundle an AST parser (zero new runtime dependency).
- Do not make the LLM judge a gate; it stays advisory.
- Do not migrate to the OpenCode v2 plugin API.

## 3. Reuse exception (explicit rules)

The project runs under a deliberate exception: **a mechanism already used on one
side MAY be reused on the other, unless doing so changes observable output or
violates a hard constraint.**

Allowed to share (already shared or to share): config resolution, diff /
pre-image, budget, bypass markers, runner, glob, idle-advisory, judge plumbing,
schema/validate-config, the `Finding` model, the feedback append.

NOT allowed:
- comment feedback -> `Finding`/marker (comment stays raw);
- comment detection -> regex (stays the binary);
- bundling a parser (stays opt-in and user-provided);
- LLM as a blocking gate (stays advisory);
- Java (stays removed).

When a slice cannot preserve both guards' observable output, stop and report;
do not weaken tests to proceed.

## 4. Current state (evidence at the start of this plan)

- `core/dispatch.ts`: `createTestGuard` owns `before`/`after`/`permission` and
  calls `runTestRules`; renders structured findings via `core/feedback`.
- `rules/comments/index.ts`: `createCommentGuard` owns its `before`/`after`,
  the binary call (`runCommentChecker`), the raw append, the budget and the
  bypass.
- `core/judge.ts`: `createDiffJudge` + `createJudge` (test) +
  `createCommentJudge`; each returns an `IdleAdvisoryController`.
- `core/mutation.ts`, `core/parser-adapter.ts`: each returns an
  `IdleAdvisoryController`.
- `core/idle-advisory.ts`: `createIdleAdvisory` (cooldown, on-idle, on-demand)
  and `createAdvisoryTool`.
- `index.ts`: the `session.idle` handler iterates a literal array
  `[mutation, judge, parser, commentJudge]`; tools are registered literally.
- `audit.ts` and `core/ci.ts` re-implement their own loops over files.

## 5. Design

### 5.1 Analyzer

```ts
type AnalyzerTrigger = "after" | "idle" | "on-demand"

interface AnalyzerContext {
  tool: string
  sessionID: string
  callID?: string
  change?: ExtractedChange
  args?: Record<string, unknown>
  directory: string
}

interface AnalyzerResult {
  findings?: Finding[]   // structured: shared renderer (test guard)
  raw?: string           // opaque: appended as-is (comment guard)
  bypasses?: Bypass[]    // surfaced in a footer
  note?: string          // queued for the next tool call (idle analyzers)
}

interface Analyzer {
  id: string
  trigger: AnalyzerTrigger
  isEnabled(): boolean
  analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> | AnalyzerResult
}
```

### 5.2 Registry

```ts
class AnalyzerRegistry {
  register(analyzer: Analyzer): void
  forTrigger(trigger: AnalyzerTrigger): Analyzer[]
  // Fail-open per analyzer: an analyzer error never propagates.
  run(trigger: AnalyzerTrigger, ctx: AnalyzerContext): Promise<AnalyzerResult[]>
}
```

### 5.3 Providers (adapters, not rewrites)

- `RuleAnalyzer`: wraps `runTestRules` for the test guard
  (`trigger: "after"`). Dispatch keeps ownership of budget, severity, grouping
  and `BLOCK BYPASSED`; the analyzer only produces findings.
- `CommentBinaryAnalyzer`: wraps `runCommentChecker` and returns `{ raw }`
  (`trigger: "after"`). The comment guard keeps its `before`, budget, bypass and
  raw append.
- `IdleAnalyzer`: wraps an `IdleAdvisoryController` as an `Analyzer` with
  `trigger: "idle"` and `note` = the message.
- On-demand tools stay as they are; the registry does not replace
  `createAdvisoryTool`.

### 5.4 Result pipeline

One renderer that takes `AnalyzerResult[]` and appends to `output.output`:

- structured findings -> `renderFeedback` + `appendFeedback` (test marker);
- raw -> `output.output += "\n\n" + raw` (comment, unchanged);
- bypasses -> footer (title per guard);
- never throws (fail-open).

## 6. Slices (one concern per slice, verify each)

1. `core/analyzer.ts`: types + `AnalyzerRegistry` + fail-open `run`. No wiring.
   Tests: registration, ordering, per-analyzer fail-open, disabled analyzer
   skipped.
2. Register the idle analyzers (mutation, test judge, parser, comment judge) in
   the registry; `index.ts` iterates `registry.forTrigger("idle")`.
   Tests: `session.idle` runs enabled analyzers with cooldown; disabled = no-op.
3. Wrap `runTestRules` in a `RuleAnalyzer` and have `dispatch.after` consume it.
   Tests: the whole `core/dispatch.test.ts` suite stays green (identical
   output).
4. (risk: high) Wrap the comment binary in a `CommentBinaryAnalyzer` returning
   `raw`, and route the comment guard through the shared pipeline. Gate with the
   full `src/index.test.ts` comment suite (byte-identical output) + bypass tests.
   If any output differs, revert this slice and keep the guard as-is.
5. Unify the append step behind `renderAnalyzerResults` (findings + raw +
   bypass footer). Tests: test-guard marker behavior and comment raw append both
   preserved.
6. Audit/CI consume the registry where it reduces duplication; keep their
   existing output shape.

Slices 4-5 are optional and must be explicitly approved before starting, because
they touch the comment guard's observable output contract.

## 7. Step-by-step execution rules

1. Read this plan and `docs/plans/comment-test-unification-plan.md` first.
2. Implement one slice at a time, smallest correct change.
3. After each slice run, in order:
   `bun test`, `bun run typecheck`, `bun run build`,
   `npx -y tsc --noEmit --noUnusedLocals --noUnusedParameters`.
4. If a check fails: diagnose; never disable an assertion, narrow scope, or
   widen the change to pass. If it cannot pass honestly, stop and report.
5. Commit `dist/` with the source (the build regenerates it).
6. Git: branch `refactor/...` or `feat/...`, one clear commit that says WHY,
   push, open a PR, wait for CI `test` = success, squash-merge, delete the
   branch, `git pull --ff-only`. Never force-push `master`.
7. Re-analyze after each merge; stop when nothing actionable remains.
8. Do not implement marginal, low-value, or risky changes without explicit
   request.

## 8. Hard constraints (invariant)

- Comment guard observable output byte-identical (the original comment tests are
  the contract).
- Never `throw` in `tool.execute.after`; append only, with the idempotent marker
  for the test guard and raw append for the comment guard.
- Config in the plugin tuple; merge config-hook keys, never overwrite.
- Zero new runtime dependency; cite origin (tool + license) of any ported motif.
- `warn` by default, `block` opt-in; never gate on an aggregate or on coverage.
- Fail-open everywhere; the LLM judge is advisory and disabled by default.
- Java stays removed.

## 9. Verification

`bun test`, `bun run typecheck`, `bun run build`,
`npx -y tsc --noEmit --noUnusedLocals --noUnusedParameters`, plus the comment
guard non-regression suite. State any gap that could not be verified.

## 10. Open decisions

- Whether to attempt slices 4-5 (comment guard through the pipeline) at all.
- Whether on-demand tools should be registry-driven or stay explicit.
- Whether `audit.ts` / `core/ci.ts` should read the registry or keep their
  current loops.
