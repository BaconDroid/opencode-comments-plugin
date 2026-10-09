# Test Checker - Execution Prompt

You are starting a new, self-contained piece of work. Build `test-checker`: a
standalone engine that detects weakened tests. It is the test-side twin of
`comment-checker`, the binary that already powers the comment guard of
`opencode-comments-plugin`. Once integrated, `test-checker` becomes the DEFAULT
engine of the test guard, exactly as `comment-checker` is the default engine of
the comment guard — the goal is to unify the two guards on the same
binary-engine architecture.

The user explicitly LIFTS the project constraint "do not bundle an AST parser /
zero new runtime dependency" for this engine. Everything else in the hard
constraints still applies.

## 1. Repos and workflow

- Engine repo (create it): https://github.com/BaconDroid/go-claude-code-test-checker
- Plugin repo (integration): https://github.com/BaconDroid/opencode-comments-plugin (branch `master`).
- Make a dedicated branch (e.g. `feat/test-checker`) and open ONE pull request per repo. Do NOT touch other branches or unrelated work. Never force-push `master`.
- Git flow: branch, clear WHY commit(s), push, open PR, wait for CI `test` = success, squash-merge, delete the branch, `git pull --ff-only`.

## 2. Inspiration (study first, do not skip)

Primary template: **https://github.com/code-yeongyu/go-claude-code-comment-checker**
(the Go binary behind `@code-yeongyu/comment-checker`). Study its CLI contract,
tree-sitter usage, release asset naming, platform matrix, and exit codes.
`test-checker` must be the same machine, aimed at tests instead of comments.

Then read the plugin side:
- `src/cli.ts` (`commentHookInput`, `runCommentChecker`) — invocation contract.
- `src/downloader.ts` — release resolution, cache, extraction, platform map.
- `src/constants.ts`, `src/types.ts` (`HookInput`, `CheckResult`).
- Test detection to port: `src/rules/tests/content.ts`, `src/rules/tests/patterns.ts`, `src/rules/tests/index.ts`, `src/rules/tests/types.ts`, `src/rules/tests/analyzer.ts`.
- Orchestration to reuse: `src/core/analyzer.ts`, `src/core/result-pipeline.ts`, `src/core/dispatch.ts`, `src/core/runner.ts`.
- Background: `docs/plans/ai-test-guard-plan.md`, `docs/plans/analyzer-registry-plan.md`, `docs/plans/comment-test-unification-plan.md`.

## 3. Engine contract (mirror comment-checker)

- Binary name: `test-checker`.
- Invocation: `test-checker [--prompt <text>]`, JSON on stdin, with a timeout.
- Input JSON: reuse the plugin's `HookInput` shape:
  `{ session_id, tool_name, transcript_path, cwd, hook_event_name, tool_input: { file_path?, content?, old_string?, new_string?, edits? }, tool_response? }`.
  The binary MAY read the file at `cwd`/`file_path` on disk to obtain the full
  content needed for AST analysis.
- Exit codes (same as comment-checker):
  - `0` = no findings;
  - `2` = findings (also print structured JSON on stdout);
  - any other exit code = ignored (fail-open).
- Output (stdout, on exit 2): `{"findings":[{"file","line","rule","message","confidence"}]}` with `confidence` in `high|medium|low`, so the plugin renders findings with its existing severity/budget pipeline. (The comment side appends raw; the test side keeps structured findings — the ARCHITECTURE is unified, the output contract stays per guard.)
- Cross-platform releases: `darwin|linux|windows` x `arm64|amd64`. Asset naming:
  `test-checker_v<version>_<os>_<arch>.<tar.gz|zip>` (Windows = zip).
- Version resolution: GitHub `releases/latest` redirect `Location` header, tag
  `v<semver>` (same approach as `src/downloader.ts`).

## 4. Detection rules to implement

Port the plugin's rules to AST-grade detection. Same rule ids, same semantics.

Deterministic (default severity `warn`):
- `protected-paths` — edit/delete of an existing test file (new files exempt).
- `skip-focus-added` — `.skip`/`.only`/`.todo`, `xit`, `skipif`, `#[ignore]`, `t.Skip`.
- `tautological-assertion` — `assert True`, `expect(true).toBe(true)`, `assertEquals(x, x)`.
- `empty-test` — test body with no executable statement.
- `unknown-test` — test with no assertion/expect/fail.
- `gutted-test` — all assertions removed.
- `matcher-loosened` — `assertEqual -> assertTrue`, `toBe -> toBeTruthy`, ...
- `swallowed-error` — `except Exception: pass`, empty `catch {}`.
- `duplicate-test` — identical test bodies in the same file.

Advisory (default severity `off`):
- `over-mocking` — new mock identifiers (`dummy`/`stub`/`mock`/`spy`/`fake`).
- `assertion-roulette` — several assertions with no message.
- `redundant-assertion` — the same assertion repeated in one test.
- `weakened-config` — `|| true`, `--passWithNoTests`, `@ts-nocheck`.
- `tests-not-run` — a test command that excludes/skips tests.

Languages: Python, JS/TS, Rust, Go. Ignore other languages (no unvalidated rules).
Anti-false-positive semantics: only added (`+`) lines are candidates; comments are
stripped before counting; see `docs/plans/ai-test-guard-plan.md` section 6.
Cross-file duplicate detection is OUT OF SCOPE for a per-file binary: leave it in
the plugin's audit/CI paths and note it.

## 5. Engine repo layout

- Language: Go (to match comment-checker) or Rust. Tree-sitter grammars for the five languages.
- CLI entrypoint + rule modules + tests (table-driven).
- `.github/workflows/release.yml`: build the platform matrix and attach assets to a tag/release.
- README documenting the contract, rules, and exit codes.
- License: check the comment-checker repo's license BEFORE copying code; cite every ported motif's origin + license (comment-checker; tamperguard MIT; tampercheck Apache-2.0; pr-test-guard MIT; veredicto).

## 6. Plugin integration (separate PR in the plugin repo)

Goal: `test-checker` becomes the DEFAULT test-guard engine, mirroring the comment
guard. The two guards end up sharing the same binary-engine architecture.

- Generalize `src/downloader.ts` and `src/cli.ts` to TWO binaries: parameterize
  repo, binary name, asset name, cache subdir, and version env
  (e.g. `TEST_CHECKER_VERSION`). Keep the comment-checker path BYTE-IDENTICAL.
- Add a `TestBinaryAnalyzer` (`trigger: "after"`, via `src/core/analyzer.ts`)
  that runs `test-checker` over the change and returns `Finding[]`.
- Make the binary the default engine. Config: `test_guard.engine` with values
  `"binary"` (default) and `"regex"`, plus env `TEST_GUARD_ENGINE`. When the
  binary is unavailable (offline, unsupported platform, download failure), fall
  back to the in-process regex rules so detection still works (fail-open), the
  way the comment guard falls back to its cached/installed binary. Document this
  fallback explicitly.
- Keep budget, severity resolution, grouping, `BLOCK BYPASSED` and rendering in
  `dispatch.after`; the analyzer only produces findings (same split as the
  comment binary via `createCommentBinaryAnalyzer`).
- Because the default engine changes, the test guard's observable output may
  change when the binary is present. Update the test-guard tests accordingly,
  but keep the regex fallback tests (they still cover the offline path) and add
  a stub-binary test (like the fake comment-checker in `src/index.test.ts`).
- Fail-open everywhere. Never `throw` in `tool.execute.after`. No new npm
  dependency (the binary is downloaded, exactly like comment-checker).

## 7. Hard constraints (still non-negotiable)

- Comment-guard observable output byte-identical (the comment tests are the contract). Only the TEST guard's engine may change.
- Never `throw` in `tool.execute.after`; append only.
- Fail-open everywhere; the LLM judge stays advisory and disabled by default.
- `warn` by default, `block` opt-in; no aggregate/coverage gate.
- Java stays removed.
- Config lives in the plugin tuple; env > options > config-hook precedence.
- Zero new npm dependency (the engine is a downloaded binary).

## 8. Verification (report exact output)

In the plugin: `bun test`, `bun run typecheck`, `bun run build`,
`npx -y tsc --noEmit --noUnusedLocals --noUnusedParameters`, and the full comment
suite must stay byte-identical. Add tests for the generalized downloader, the
default binary engine and the regex fallback (use a stub binary, like the fake
comment-checker in `src/index.test.ts`).
In the engine: build + run its own test suite.

## 9. Deliverable

- The engine repo (source + CI + README) and the plugin PR.
- Exact verification output.
- Remaining limits and anything deliberately not done (with reason).
- State the fallback behavior (binary unavailable -> regex) and the exact config keys.
