# AI Test Guard - Execution Prompt

Read `docs/plans/ai-test-guard-plan.md` first. Then implement the plan in this
repository. Work slice by slice, keep the comment guard unchanged, and verify at
every step.

## Context

- Repository: `opencode-comments-plugin` (this repo). Read `src/index.ts`,
  `src/cli.ts`, `src/downloader.ts`, `src/types.ts`, `src/constants.ts`,
  `src/index.test.ts` first.
- Runtime target: OpenCode 1.x, plugin API v1 (`@opencode-ai/plugin`). Do NOT
  migrate to v2.
- The plugin is configured through the tuple
  `["opencode-comments-plugin", { comment_checker: {...} }]` because OpenCode
  drops unknown top-level config keys. Add a sibling `test_guard` block.
- Hooks available: `config`, `tool.execute.before` (throw blocks),
  `tool.execute.after` (mutate `output.output`). The plugin receives `client`
  (SDK) and `$` (Bun shell).

## Non-negotiable principles

1. DEFAULTS: every content rule is `warn`. `block` only when a rule is
   explicitly configured as `severity: "block"`. Never block by default.
   UPDATE (#51): superseded - `block` was deleted; severity is `off|warn` only
   and `"block"` fails `guard validate-config`.
2. Fail-open: swallow and log any internal guard error; never prevent the
   agent's action.
3. Do not break the comment guard: `bun test` and `bun run typecheck` stay
   green at every step.
4. No new runtime dependency. Zero-dep glob + jsonc handling.
5. Cite the origin of every ported regex in a code comment (tool + license).
   Reusable licenses: tamperguard MIT, tampercheck Apache-2.0, pr-test-guard
   MIT, veredicto only up to v0.3.3. Java rules are home-grown and must be
   marked unvalidated.

## Compatibility (mandatory, loaded alongside oh-my-opencode-slim)

- Distinct package name / plugin id. Do not use `plugin`/`plugins` wrapper
  directory names.
- Always `output.output += <idempotent marker>`; never replace it.
  UPDATE: as shipped, only the test guard uses the marker; the comment guard
  keeps a raw append with no marker (`src/core/feedback.ts`, unification
  decision 1).
- Never `throw` in `tool.execute.after`.
- `tool.execute.before`: throw only when a `block`-configured rule matches.
  Tolerate normalized args (`filePath`/`path`/`file_path`,
  `patchText`/`patch`).
  UPDATE (#51): no throw/permission path exists anymore (advisory-only guard).
- Config in the plugin tuple only. Never write to
  `oh-my-opencode-slim.json`. If a `config` hook is added, merge keys; do not
  overwrite (`agent`, `mcp`, `default_agent` may already be set).
- Do not depend on slim's `disabled_hooks`.
- Wrap each rule factory in a `safeCreateHook` equivalent (try/catch -> null).

## Architecture to build

```
src/core/
  config.ts    optionContainer + coercions (asString/asCount/asTools/asPatterns/
               asLevel) + resolveRuleConfig(schema, envPrefix).
               Precedence: env > tuple options > config hook.
  diff.ts      extractChange(tool, args, preimage) ->
               { filePath, oldText, newText, addedLines, removedLines,
                 isNew, isDelete, language }. write/edit/apply_patch.
               Comment stripping + real-line census.
  feedback.ts  render message; custom_prompt/append_prompt; {{findings}}.
  budget.ts    key (ruleId,file) + session TTL + 30s dedup + single-flight.
               UPDATE: `single-flight` was removed by #35; `GuardBudget` is now
               shared by both guards.
  runner.ts    spawn + timeout (generalize cli.ts).
  glob.ts      zero-dep matchesGlob (*, **, ?).
  dispatch.ts  before/after orchestration + rule registry.
src/rules/comments/  existing behavior, unchanged.
src/rules/tests/     deterministic rules + patterns.ts (per-language regexes).
```

UPDATE: this tree is the original sketch; the shipped `core/` also gained
`analyzer`, `schema`, `ci`, `bypass`, `judge`, `mutation`, `parser-adapter`,
`pending`, `idle-advisory`, `advisory-queue`, `result-pipeline` and `triggers`,
and `budget.ts` / `diff.ts` APIs moved on (see `docs/plans/ai-test-guard-plan.md`
section 4 UPDATE).

## Steps (in order, verify each)

1. Extract `core/*` from `index.ts` without changing comment behavior.
   Verify: `bun test` + `bun run typecheck` green; comment output identical.
2. `protected-paths`: existing test file matching `test_patterns` (new files
   exempt). `warn` default, `block` opt-in (throw in before).
   UPDATE (#51): no `block`/throw - severity is `off|warn` only.
3. Content rules (all warn):
   - `skip-focus-added`: `.skip(` / `.only(` / `.todo(`, `xit/xdescribe/xtest`,
     `@pytest.mark.skip(?!if)`, `@unittest.skip(?!If|Unless)`, `#[ignore]`,
     `t.Skip`. Exclude conditional skips.
   - `tautological-assertion`: `assert True`, `assertTrue(True)`,
     `expect(true).toBe(true)`, `assert.ok(true)`, `assertEquals(x,x)`.
   - `empty-test`: test body with no executable statement.
   - `unknown-test`: test with no assert/expect/fail/expected-exception.
   - `net-assertion-loss`: removed(assert|expect|verify) - added >= 2, no
     helper/parametrize added, test-def delta == 0.
     UPDATE: never shipped as-is - the rule was cut in #20 (`d5a802a`).
   - `matcher-loosened`: `assertEqual -> assertTrue`,
     `toBe -> toBeTruthy/toBeDefined`, `assertRaises(narrow) -> (Exception)`,
     `not.toThrow`.
   - `swallowed-error`: `except Exception: pass`, empty `catch {}`,
     `Err(_) => {}`.
   Anti-FP mandatory: only `+` lines fire; strip comments; net-delta; cross-file
   move detection; conditional-skip exclusion; vacuity subtraction; expected
   value normalization. Downgrade ambiguous rules.
   UPDATE: vacuity subtraction was never implemented (no such logic in `src/`);
   cross-file move detection shipped only for `gutted-test` in the audit/CI
   paths, not for a `deleted-tests` id (which never existed).
4. Comment guard: read the on-disk pre-image in `before` for `write` so only
   net-new comments are reported (fixes the README limitation); reuse
   `hasNewContentOnly` + 30s dedup.
   UPDATE: the shipped helper is `hasNewCommentLines`
   (`src/rules/comments/index.ts`) - `hasNewContentOnly` never existed here;
   the dedup window came later (#35), default unified to 30 s (#52).
5. `block` opt-in + `apply_patch` `type:"delete"` (test deletion) + bypass
   `// test-guard: allow <reason>` (+/-2 lines) and `// test-guard-disable-file`.
   UPDATE (#51): `block` deleted; bypass markers and delete handling shipped.
6. (off by default, never block) `over-mocking` (identifiers
   dummy/stub/mock/spy/fake + monkeypatch + context-gated patch;
   added-minus-deleted), `assertion-roulette` (>1 assert with no message),
   `weakened-config` (`|| true`, `--passWithNoTests`, `@ts-nocheck`,
   `fail_under` lowered).
7. Audit: custom tool `guard_audit` + slash command `/guard-audit`.
   - Args: `scope` (comments|tests|both), `paths?`, `format`
     (markdown|json), `include_advisory`.
   - Comments: run the `comment-checker` binary per file in `Write` mode,
     parse XML, apply the relevance filter -> remove|adjust|keep.
   - Tests: apply the catalog over the whole file
     (empty/unknown/tautological/redundant/skip-focus/duplicate/over-mocking).
   - Output: report + checklist `file:line`, rule, action, confidence. READ
     ONLY; the agent applies edits afterwards. Reject placeholder evidence
     (reuse OmO `PLACEHOLDER_PATTERN`). Fail-open on unparsable files.
   - Respect `.gitignore` and secret files; never log file content.
     UPDATE: debug mode (`COMMENT_CHECKER_DEBUG=1`) logs the first 200 chars of
     the tool payload (`src/cli.ts`).

## Config

Add `test_guard` beside `comment_checker` in the same tuple:
`enabled`, `test_patterns`, `test_command`, `checks{<rule>: off|warn|block}`,
`max_warnings_per_file`, `custom_prompt`, `mutation{enabled:false}`.
UPDATE (#51): severities are `off|warn` only - `"block"` fails
`guard validate-config`; the shipped schema also accepts `engine`, `tools`,
`append_prompt`, `judge` and `parser`.
Env `TEST_GUARD_*` with the same precedence as `COMMENT_CHECKER_*`.

## Tests to write (bun test)

- Reuse the `index.test.ts` harness (fake binary via `XDG_CACHE_HOME`).
- For each rule: one positive, one negative (must stay silent), one anti-FP
  (comment line, conditional skip, cross-file move, strengthening edit).
- Comment guard: rewriting a file must not re-report existing comments.
- Coexistence smoke test with `oh-my-opencode-slim` (no output clobbering, no
  duplicate warnings).
  UPDATE: the shipped test fakes the other plugin's output string instead of
  loading it (`src/core/dispatch.test.ts`).

## Verification

`bun test` then `bun run typecheck` then `bun run build`. If a check fails,
diagnose; do not disable an assertion or widen scope to make it pass.

## Do not

- No v2 API migration.
- No aggregate "test smell count" gate.
- No coverage gate.
- No oracle/reference-based OG/REF category.
- No mutation testing or LLM judge in this delivery (phase 2, opt-in).

## Deliverable

Git diff, list of implemented rules, exact output of `bun test` /
`bun run typecheck` / `bun run build`, and the list of gaps (rules not ported,
known limits).
