# AI Test Guard - Build Plan

Status: design frozen, not yet implemented.
Scope: add a "test guard" to `opencode-comments-plugin`, reusing the existing
comment-guard infrastructure, and improve the comment guard in return.

Companion file: `docs/plans/ai-test-guard-prompt.md` (execution prompt).

## 1. Goal and non-negotiable principles

- Add deterministic anti-cheating rules on tests, plus an on-demand audit
  command for existing comments and tests.
- Reuse the current plugin engine: config resolution, before/after hooks,
  per-session budget, tool-output feedback, apply_patch handling, external
  binary runner.
- All content rules default to `warn`; `block` is opt-in per rule only.
- Fail-open: any internal guard error is swallowed and logged; it must never
  prevent the agent's action (quality guard, not a security guard).
- Keep the comment guard behavior unchanged; `bun test` and
  `bun run typecheck` stay green at every step.
- Target OpenCode v1 plugin API (`@opencode-ai/plugin` 1.x). Do not migrate to
  v2.

## 2. References

Reliability tags: [A] peer-reviewed/preprint empirical, [B] official/project
docs, [V] vendor, [Bl] blog, [C] secondary.

### Base repository
- `github.com/BaconDroid/opencode-comments-plugin` - `src/index.ts`, `cli.ts`,
  `downloader.ts`, `types.ts`, `constants.ts`, `index.test.ts`. [B]

### Reference comment-checker integration
- `github.com/code-yeongyu/go-claude-code-comment-checker` - binary protocol:
  exit `0`/`2`, message on stderr, XML `<comments file><comment line-number>`,
  `--prompt "{{comments}}"`. [B]
- `github.com/code-yeongyu/oh-my-openagent` -
  `packages/comment-checker-core` (parse/run), and
  `packages/omo-opencode/src/hooks/comment-checker/{hook.ts,cli-runner.ts}`
  (hook factory, `withCommentCheckerLock` single-flight,
  `DEDUP_WINDOW_MS = 30_000`, `hasNewCommentsOnly`, `hasCommentSyntax`),
  `hooks/comment-checker/pending-calls.ts` (`PENDING_CALL_TTL = 60_000`),
  `shared/safe-create-hook.ts` (`safeCreateHook` fault isolation),
  `hooks/write-existing-file-guard/hook.ts` (throw-to-block + bounded
  per-session maps), `hooks/claude-code-hooks/*` (exit 2 -> deny, exit 1 -> ask,
  PostToolUse `decision: "block"`). [B]

### OpenCode integration
- `opencode.ai/docs/plugins` (v1, `tool.execute.before` throw blocks). [B]
- `opencode.ai/v2/docs/build/plugins` (v2 is incompatible: `plugins`,
  `Plugin.define`, `ctx.tool.hook`). [B]
- OpenCode SDK: `session.create/prompt`; issue #20387 (sub-agent spawn
  `not_planned`); issue #4122 (`session.idle` + `client.session.prompt`);
  issue #5894 (sub-agent tool calls may bypass `tool.execute.before`). [B]
- `remorses/opencode-injection-guard` (LLM judge in a sandboxed deny-all
  session), `tjvjk/opencode-policy` (`experimental.chat.messages.transform`),
  `lgladysz/opencode-ignore`, `boxpositron/envsitter-guard`,
  `kenryu42/cc-safety-net`, `AZetaDev/opencode-guard`,
  `inkdust2021/opencode-vibeguard`, `opencode-bestest` (locks test files),
  `jesseemus/block`, `joeyism/opencode-anti-loop` (duplicate tests),
  `momomuchu/make-no-mistakes`, `nahuelcio/opencode-live-compaction`
  (zero-dep jsonc loader + glob). [B]
- Claude Code hooks (Pre/PostToolUse mapping, exit 0/2,
  `hookSpecificOutput.additionalContext`): `code.claude.com/docs/en/hooks`. [B]

### Prior-art test-tampering detectors (patterns to port)
- `fernforge/tamperguard` - MIT - delta rules, real-line assertion census,
  ambiguous-rule downgrade, scoring. [B]
- `scottconverse/tampercheck` - Apache-2.0 - per-language regex table,
  `tampercheck: allow <reason>`. [B]
- `tigerless-labs/pr-test-guard` - MIT - PTG001-010, AST `mock_analysis`,
  test-path classification. [B]
- `JoniMartin27/veredicto` - MIT up to v0.3.3 only (detectors are byte-identical
  at v0.3.3; `main` is source-available commercial) - `deleted-tests`,
  `gutted-tests`, `weakened-assertions`, `circular-mocks`. Port from the v0.3.3
  tag. [B]
- `LandryPouth/coding-flow` PR #37 (`harness.json`, "NOT PROVEN" rung). [B]
- Named linter rules to reuse ids: `jest/no-disabled-tests`,
  `jest/expect-expect`; ruff / flake8-pytest-style `PT015`, `PT018`, `B011`;
  SonarJS `S1607`, SonarQube `S2699`. [B]

### Literature (rule selection)
- Mathews & Nagappan, arXiv:2412.14137; IEEE Software 43(1):98-104, 2026 -
  tests that validate bugs (OG/REF cross-product is NOT portable). [A]
- VibeCheck, arXiv:2609.05978 (POVC'26) - 5-dimension rubric; assertion only
  inside `catch` anti-pattern. [A]
- Hora & Robbes, arXiv:2602.00409 (MSR 2026) - exact mock-identifier list,
  added-minus-deleted classification. [A]
- Zhu et al., arXiv:2503.19284 (FSE 2025) - mock verification ratio ~9%. [A]
- Peruma et al., TsDetect, FSE 2020 (10.1145/3368089.3417921) - exact AST
  algorithms: Empty/Unknown/Redundant/Ignored/Assertion Roulette. [A]
- Panichella et al., EMSE 2022 (10.1007/s10664-022-10207-5) and Pontillo et al.,
  EMSE 2024 (10.1007/s10664-023-10436-2) - smell detectors are low precision,
  never gate on an aggregate. [A]
- Zhang & Mesbah, FSE 2015 (10.1145/2786805.2786858) - assertion count
  correlates with effectiveness. [A]
- Inozemtseva & Holmes, ICSE 2014 (10.1145/2568225.2568271) - coverage not
  correlated; do not gate on coverage. [A]
- Spadini et al., MSR 2017 / ICSME 2018 - mocking coupling and smelly-test
  defect association; "The smell of fear" study is retracted (avoid). [A]

### Mutation testing (phase 2 only)
- MutGen, arXiv:2506.02954 / IEEE TSE 2026; artifact `Amocy-Wang/MUTGEN` -
  feedback tuple `(id, statement, status, operator)`, ~4 iterations. [A]
- Meta ACH arXiv:2501.12862; Facebook arXiv:2010.13464 - change-scoped,
  actionable survivors. [A]
- `awesome-testing.com/2026/08/mutation-testing-for-agent-written-code` -
  two-layer mutation; a new test must pass on the original and fail on the
  frozen mutant. [Bl]
- Tool docs: StrykerJS (`mutate`, `--mutate`, JSON reporter, incremental);
  mutmut (`run "module*"`, `export-cicd-stats`); PIT (`targetClasses`/
  `targetTests`, HTML/XML/CSV, `withHistory`). [B]

## 3. Compatibility contract

The plugin must coexist in the same host with `oh-my-opencode-slim`
(`alvinunreal/oh-my-opencode-slim`, v3.0.3) and any other plugin.

- Distinct package name / plugin id. Do not use `plugin` or `plugins` wrapper
  directory names (duplicate-id hard fail on v2 scan).
- Always append to `output.output` with an idempotent marker; never replace it.
- Never `throw` in `tool.execute.after`.
- `tool.execute.before`: throw only when a rule explicitly configured as
  `block` matches. Tolerate normalized args (`filePath` / `path` /
  `file_path`; `patchText` / `patch`).
- Config lives in the plugin tuple only. Never write to
  `oh-my-opencode-slim.json`. If a `config` hook is added, merge keys, do not
  overwrite (slim already sets `agent`, `mcp`, `default_agent`).
- Do not depend on slim's `disabled_hooks`; keep our own `enabled` / `severity`
  / bypass.
- v1 target. A v2 host would need a separate `setup(ctx)` (out of scope).
- Add a smoke test loading both plugins and asserting tool output is not
  clobbered and warnings are not duplicated.

## 4. Architecture

```
src/
  core/
    config.ts    optionContainer + coercions (asString/asCount/asTools/
                 asPatterns/asLevel) + resolveRuleConfig(schema, envPrefix).
                 Precedence: env > tuple options > config hook.
    diff.ts      extractChange(tool, args, preimage) ->
                 { filePath, oldText, newText, addedLines, removedLines,
                   isNew, isDelete, language }.
                 write/edit/apply_patch. Comment stripping + real-line census.
    feedback.ts  render message; custom_prompt / append_prompt / {{findings}}.
    budget.ts    key (ruleId,file) + session TTL + 30s dedup + single-flight.
    runner.ts    spawn + timeout (generalizes cli.ts).
    glob.ts      zero-dep matchesGlob (*, **, ?).
    dispatch.ts  before/after orchestration + rule registry.
  rules/comments/   existing behavior, unchanged (calls the binary).
  rules/tests/      deterministic rules + patterns.ts (per-language regexes).
```

Rule factories are wrapped in a `safeCreateHook` equivalent (try/catch -> null)
so a broken rule never kills the plugin.

## 5. Rule catalog

All content rules default to `warn`. `protected-paths` is `warn` by default and
`block` only when configured.

| id | deterministic signal | scope | default |
|---|---|---|---|
| `protected-paths` | edit/write of an EXISTING test file matching `test_patterns` (new files exempt) | path | warn |
| `skip-focus-added` | `.skip(` / `.only(` / `.todo(`, `xit/xdescribe/xtest`, `@pytest.mark.skip(?!if)`, `@unittest.skip(?!If|Unless)`, `#[ignore]`, `t.Skip`. Conditional skips excluded | added lines | warn |
| `tautological-assertion` | `assert True`, `assertTrue(True)`, `expect(true).toBe(true)`, `assert.ok(true)`, `assertEquals(x,x)` | added lines | warn |
| `empty-test` | test body with zero executable statements | whole function | warn |
| `unknown-test` | test with no assert/expect/fail/expected-exception | whole function | warn |
| `net-assertion-loss` | removed(assert|expect|verify) - added >= 2, no helper/parametrize added, test-def delta == 0 | delta | warn |
| `gutted-test` | assertions removed > 0 AND added == 0 AND no declaration removed/added | removed | warn |
| `matcher-loosened` | `assertEqual -> assertTrue`, `toBe -> toBeTruthy/toBeDefined`, `assertRaises(narrow) -> (Exception)`, `not.toThrow` | delta | warn |
| `swallowed-error` | `except Exception: pass`, empty `catch {}`, `Err(_) => {}` | added lines | warn |
| `duplicate-test` | identical test bodies across the suite | whole file(s) | warn |
| `over-mocking` | new mock identifiers (`dummy/stub/mock/spy/fake`, `monkeypatch`, context-gated `patch`) with added-minus-deleted >= 1 | delta | off |
| `assertion-roulette` | > 1 assertion with no message | added lines | off |
| `weakened-config` | `|| true`, `--passWithNoTests`, `exit 0` near a test cmd, `continue-on-error: true`, `fail_under` lowered, `@ts-nocheck`, `# ruff: noqa` | delta | off |
| `tests-not-run` | a test command is skipped on a required leg / all tests skipped | advisory | off |

Do not ship an aggregate "test smell count" gate (proven low precision). Do not
gate on coverage. Do not use the OG/REF bug-validating category (needs an
oracle/reference).

## 6. Anti-false-positive requirements (core/diff)

- Only `+` (added) lines trigger a finding.
- Strip comments before counting assertions.
- Count "real" lines (ignore blank/comment-only).
- Net-delta semantics (`removed - added`), threshold >= 2 for assertion loss.
- Cross-file move detection (a test re-added under the same title elsewhere
  cancels a `deleted-tests`).
- Exclude conditional skips (`skipif`, `skipIf/Unless`, `skip(...)` with args).
- Subtract vacuous/trivial bodies so "replaced by vacuous" is not counted as
  coverage.
- Normalize expected values before diffing assertions (flag only skeleton
  edits with changed literals).
- Anchor command patterns to a real test runner.
- Downgrade ambiguous rules; never escalate them.
- Inline justification: `// test-guard: allow <reason>` (within +/-2 lines) and
  file-level `// test-guard-disable-file`. Log every bypass for the summary.

## 7. Configuration

```jsonc
["opencode-comments-plugin", {
  "comment_checker": { /* unchanged */ },
  "test_guard": {
    "enabled": true,
    "test_patterns": ["**/*.test.*","**/*_test.*","**/test_*.py","**/tests/**"],
    "test_command": null,
    "checks": {
      "protected-paths": "warn",
      "skip-focus-added": "warn",
      "tautological-assertion": "warn",
      "empty-test": "warn",
      "unknown-test": "warn",
      "net-assertion-loss": "warn",
      "gutted-test": "warn",
      "matcher-loosened": "warn",
      "swallowed-error": "warn",
      "duplicate-test": "warn",
      "over-mocking": "off",
      "assertion-roulette": "off",
      "weakened-config": "off",
      "tests-not-run": "off"
    },
    "max_warnings_per_file": 0,
    "custom_prompt": "TEST QUALITY DETECTED:\n{{findings}}\n\nFix the cause, do not weaken the test.",
    "mutation": { "enabled": false }
  }
}]
```

Env: `TEST_GUARD_*` with the same precedence as `COMMENT_CHECKER_*`.

Add a JSON schema for the tuple options plus a `guard validate-config` path.
`test_command` is auto-detected (package.json `scripts.test`, `pytest.ini`,
`go.mod`, `Cargo.toml`, `pom.xml`) and overridable.

## 8. Audit command (agent-executable)

Purpose: a command the AGENT runs itself to review the relevance of EXISTING
comments and tests (not just the diff) and produce a cleanup plan, which the
agent then applies (remove/adjust).

Form: custom tool `guard_audit` (model-invocable) + slash command
`/guard-audit` (user wrapper), registered via the `tool` hook (unique name; do
not mutate shared config for this).

Arguments:
```jsonc
{ "scope": "both", "paths": ["src/","tests/"], "format": "markdown", "include_advisory": false }
```

Behavior (deterministic, read-only):
1. Enumerate files (`git ls-files` or `paths`), filter to supported extensions,
   honor `.gitignore` and skip secret files.
2. Comments: feed each file to the `comment-checker` binary as a `Write`
   `tool_input` (content = file text), parse the returned XML. Then apply a
   relevance filter (restates code, agent memo such as `// changed` / `// now` /
   `Note:`, `TODO/FIXME` without owner, commented-out code, obvious docstring)
   -> `remove`; otherwise `keep` (`adjust` when it explains why: business rule,
   out of control, security, performance, regex/math, public API).
3. Tests: apply the catalog over the whole file - `empty-test`, `unknown-test`,
   `tautological-assertion`, `redundant-assertion`, `skip-focus` (existing),
   `duplicate-test`, `over-mocking` (off by default) -> `remove` / `adjust` /
   `keep`.
4. Emit a structured report + checklist grouped per file: `file:line`, rule,
   excerpt, suggested action, confidence. Format `markdown` (default) or `json`.
5. Never modify files. The report is the plan; the agent applies edits next.
   Reject placeholder "evidence" (reuse OmO `PLACEHOLDER_PATTERN`:
   `/^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i`).

Relevance criteria:
- Comment is relevant if it explains WHY; otherwise remove.
- Test is relevant if it has an assertion tied to behavior and can fail;
  otherwise remove/strengthen.
- Before removing any test: green baseline required. Never remove a currently
  failing test, or the sole test covering a case.

Guardrails: read-only tool; report first, agent edits after; fail-open
(unparsable file is reported, not fatal).

## 9. Cross-cutting additions

- Test-command detection/override (see section 7); never run destructive
  commands.
- Baseline-green gate before any test removal/adjustment.
- Secret/privacy: never log file content; log rule id + truncated excerpt;
  respect `.gitignore` and secret-file patterns.
- Performance caps: max file count, per-file timeout, bounded concurrency,
  exclude `node_modules`/vendored directories.
- CI parity: expose the same engine as `opencode-comments-plugin guard check
  --diff` reusing `core/`, for pre-merge use.
- Language matrix documented: Python, JS/TS, Rust, Go (from prior art); Java is
  experimental/unvalidated.
- Bypass audit trail: list every `allow` / `disable-file` in the session
  summary.
- Coexistence smoke test with `oh-my-opencode-slim`.
- v2 note: not supported without a dedicated `setup(ctx)`.

## 10. Slices and acceptance

1. Extract `core/*` from `index.ts` without changing comment behavior.
   Accept: `bun test` + `bun run typecheck` green; comment output identical.
2. `protected-paths` (+ `core/glob.ts`). Accept: warns on existing test edit,
   exempts new files, `block` opt-in throws.
3. Deterministic content rules (`warn`): `skip-focus-added`,
   `tautological-assertion`, `empty-test`, `unknown-test`,
   `net-assertion-loss`, `matcher-loosened`, `swallowed-error`.
   Accept: each rule has positive + negative + anti-FP tests.
4. Comment guard: pre-image read on `write` so only net-new comments are
   reported; reuse `hasNewContentOnly` + dedup.
5. `block` opt-in + `apply_patch` `type:"delete"` (test deletion) + bypass
   markers.
6. Advisory rules (`off`): `over-mocking`, `assertion-roulette`,
   `weakened-config`.
7. `guard_audit` tool + `/guard-audit`.
8. Phase 2 (separate): mutation on `session.idle` + optional sandboxed LLM
   judge. Not in this plan's initial delivery.

Acceptance for the whole plan: `bun test`, `bun run typecheck`, `bun run build`
green; coexistence smoke test green; comment guard unchanged.

## 11. Verified vs assumed

Verified: existing plugin engine; OpenCode hook semantics; OmO hook/lock/dedup
and config patterns; classic per-language regexes and licenses; literature
verdicts on rule selection; slim compatibility findings; sub-agent bypass and
`permission.ask` caveats.

Assumed: `net-assertion-loss` threshold; precision of our adapted regexes;
home-grown Java rules; stability of experimental hooks.

## 12. Known limits

- `block` is not airtight (sub-agents may bypass `tool.execute.before`, #5894).
- No deterministic detection of subtly wrong assertions or of an expected value
  aligned to the output under test (prior art reports 0/20).
- Java unsupported by prior art; home rules unvalidated.
- `net-assertion-loss` threshold is a heuristic, not empirical.
