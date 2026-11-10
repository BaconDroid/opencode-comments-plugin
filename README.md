# opencode-guard-plugin

Stop the comment slop.

OpenCode plugin that guards comments and tests: it warns when new comments or
docstrings are added (wrapping the `comment-checker` CLI from
`BaconDroid/comment-checker`) and ships a deterministic test guard that
discourages weakened tests. Both surface their findings in tool output.

## Origin and credits

The comment guard derives from the comment-checker hook in
[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode), through
[`ajoslin/opencode-comments-plugin`](https://github.com/ajoslin/opencode-comments-plugin).
This is an independent project maintained by BaconDroid; the test guard, the
audit tooling and the opt-in analyzers are original work.

Credit to [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) for the hook integration,
and to [ajoslin/opencode-comments-plugin](https://github.com/ajoslin/opencode-comments-plugin) for the plugin this project derives from.

## Install

### From Git

There is no npm package. Install the plugin straight from its repository:

```bash
bun add github:BaconDroid/opencode-guard-plugin
```

Or clone it and build locally:

```bash
git clone https://github.com/BaconDroid/opencode-guard-plugin
cd opencode-guard-plugin
bun install
bun run build
```

Then point your OpenCode config at the installed package, or at the built
`dist/index.js` from a local checkout:

```json
{
  "plugin": ["opencode-guard-plugin"]
}
```

## Configuration

Options are passed as the second element of the plugin tuple; the plugin reads them from its setup context (`ctx.options`):

```json
{
  "plugin": [
    ["opencode-guard-plugin", { "comment_checker": { "custom_prompt": "DETECTED:\n{{comments}}\nFix it." } }]
  ]
}
```

Why the tuple and not a top-level `comment_checker` key: opencode validates its config against a fixed schema, so unknown top-level keys are dropped before plugins see them. The tuple is the supported per-plugin channel and the only one this plugin reads.

A full `custom_prompt` example (the plugin's warning rewritten in simple English) is in [`examples/custom-prompt.json`](examples/custom-prompt.json), with the prompt itself explained in [`docs/comment-guidelines.md`](docs/comment-guidelines.md).

Available options (all under `comment_checker`):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Disable the comment guard entirely. |
| `custom_prompt` | string | CLI default | Replaces the warning message. `{{comments}}` is replaced by the detected comments. |
| `max_warnings_per_file` | number | `0` | Stop warning after N warnings about the same file in one session. `0` = unlimited. |
| `dedup_window_ms` | number | `30000` | Suppress a repeat warning about the same file within this window. `0` = no dedup. |
| `tools` | string[] or CSV string | `["write","edit","apply_patch"]` | Which tools trigger the check. |
| `paths` | string[] or CSV string | unset | Only check files matching these globs. Unset = every file. |
| `keyword_acquit` | `"proven-only"` or `"never"` | `"proven-only"` | How a prose keyword may acquit a comment: `proven-only` lets the CLI decide, `never` leaves only its structural classes. |
| `timeout_ms` | number | `5000` | How long to wait for the CLI before ignoring it. |
| `append_prompt` | string | unset | Opt-in text appended after the warning, keeping the default (or `custom_prompt`) message intact. |
| `judge` | object | `{"enabled": false}` | Comment relevance judge: `enabled`, `model` (default `opencode/big-pickle`), `timeout_ms` (default `30000`). See [Comment relevance judge](#comment-relevance-judge-opt-in). |

Keep the default CLI warning and add your own line to it, for example:

```json
{
  "plugin": [
    ["opencode-guard-plugin", { "comment_checker": { "append_prompt": "Be concise, specific, and direct by default." } }]
  ]
}
```

`append_prompt` is not passed to the CLI; the plugin appends it to the warning it already injects.

The options may also be given flat, without the `comment_checker` wrapper (`["opencode-guard-plugin", { "tools": ["write"] }]`); both forms are equivalent.

Every option can also be set (and overridden) through the environment, which always wins:

| Env var | Option |
|---|---|
| `COMMENT_CHECKER_ENABLED` | `enabled` |
| `COMMENT_CHECKER_CUSTOM_PROMPT` | `custom_prompt` |
| `COMMENT_CHECKER_MAX_WARNINGS_PER_FILE` | `max_warnings_per_file` |
| `COMMENT_CHECKER_DEDUP_WINDOW_MS` | `dedup_window_ms` |
| `COMMENT_CHECKER_TOOLS` | `tools` (comma separated) |
| `COMMENT_CHECKER_PATHS` | `paths` (comma separated) |
| `COMMENT_CHECKER_KEYWORD_ACQUIT` | `keyword_acquit` |
| `COMMENT_CHECKER_TIMEOUT_MS` | `timeout_ms` |
| `COMMENT_CHECKER_APPEND_PROMPT` | `append_prompt` |

## Behavior

- Runs on the tools in `tools` (`write`, `edit`, and `apply_patch` by default).
- If the CLI detects comments, it appends the warning message to the tool output, so the model that called the tool reads it on its next turn. Nothing is blocked and the file is never rewritten.
- Only comments introduced by the change are candidates: for `edit` and `apply_patch` the plugin passes the old and the new snippet, so a comment that was already on the changed lines is not reported; for `write` the plugin reads the previous on-disk content first and, when that previous content exists, skips the check when no comment line was added - rewriting a file does not re-flag the comments it already contained. When new comment lines are added, the whole new content is checked.
- The `comment-checker` version is resolved from the latest GitHub release (checked at most once a day); offline it falls back to a cached release tag or the built-in fallback version. The binary for that version is downloaded on demand into `~/.cache/opencode-comments-plugin/bin/<version>/` when the cache does not already have it - the exact order is listed under [Detection engine](#detection-engine). A cached binary that reports a different `--version` than the resolved cache version is rejected with a warning shown once per session, instead of running comment checks through the wrong engine.
- Inline bypass: `// comment-guard: allow <reason>` within +/-2 lines of the added comments suppresses the file's warning; file-level `// comment-guard-disable-file` suppresses it outright. A suppressed or warned file with markers reports them under a "Comment guard bypass recorded" footer.

## Detection

Detection is local and deterministic (tree-sitter parsing in the `comment-checker` binary); no LLM is involved. The rules, with examples:

| Input | Result |
|---|---|
| `// adds a and b` (new) | flagged |
| `def f():\n    """Return one."""` | flagged (docstrings are comments too) |
| `const s = "// not a comment"` | ignored (inside a string, not a comment) |
| `// eslint-disable-next-line`, `// prettier-ignore`, `// @ts-expect-error`, `// noqa` | ignored (directives) |
| `#!/usr/bin/env node` | ignored (shebang) |
| `// TODO: fix this` | flagged |
| `// given a\n// when b\n// then c` | flagged |
| `// Note: we do X here` | flagged with a distinct "agent memo" alert |
| an `edit` that keeps an existing comment unchanged | not flagged |

Directive and shebang handling is heuristic: `biome-ignore`, for example, is currently flagged.

### Comment relevance judge (opt-in)

If `comment_checker.judge.enabled` is set, the plugin reviews the newly added
comments with `comment_checker.judge.model` (same default as the test judge,
`opencode/big-pickle`) inside a sandboxed session, on `session.idle` (at most
once per minute per session) and on demand via the `guard_comment_judge` tool.
It flags comments that restate the code, agent memos, ownerless TODO/FIXME or
commented-out code. Advisory only, fail-open, disabled by default. When enabled,
the added comment lines (not the whole repo) are sent to the configured model.

```json
{
  "plugin": [
    ["opencode-guard-plugin", { "comment_checker": { "judge": { "enabled": true, "model": "opencode/big-pickle" } } }]
  ]
}
```

Env: `COMMENT_CHECKER_JUDGE_ENABLED`, `COMMENT_CHECKER_JUDGE_MODEL`,
`COMMENT_CHECKER_JUDGE_TIMEOUT_MS`.

## Test guard

The plugin also ships a deterministic **test guard** that discourages weakening
tests. It reuses the same tuple, under a sibling `test_guard` key:

```json
{
  "plugin": [
    ["opencode-guard-plugin", {
      "comment_checker": { "custom_prompt": "DETECTED:\n{{comments}}\nFix it." },
      "test_guard": {
        "enabled": true,
        "engine": "binary",
        "checks": { "protected-paths": "warn", "skip-focus-added": "warn" },
        "mutation": { "enabled": false, "command": "npx stryker run --reporters json", "timeout_ms": 120000 },
        "judge": { "enabled": false, "model": "opencode/big-pickle", "timeout_ms": 30000 },
        "parser": { "enabled": false, "command": "my-ast-check --json", "timeout_ms": 30000 }
      }
    }]
  ]
}
```

Deterministic regex rules default to `warn`, advisory regex rules to `off`;
every `test-checker` binary id defaults to `warn` because the binary already
applies its own confidence gate. `off` disables a rule. The test guard is
advisory only: it never blocks and never rewrites the file. All internal guard
errors are swallowed (fail-open), so the guard can never prevent the agent's
action.

### Detection engine

The test guard detects through the downloaded `test-checker` binary by default
(`test_guard.engine: "binary"`), mirroring how the comment guard uses the
`comment-checker` binary. The binary is resolved from the latest GitHub release of
`BaconDroid/test-checker` (checked at most once a day), cached
under `~/.cache/opencode-comments-plugin/test-checker/<version>/`, and downloaded
on demand. It is AST-grade (tree-sitter) for Python, JS/TS, Rust and Go.

If the binary is unavailable (offline, unsupported platform, timeout or a
download failure), the guard falls back to the in-process regex rules below, so a
missing binary only degrades precision - never the guard's safety. Set
`test_guard.engine: "regex"` (or `TEST_GUARD_ENGINE=regex`) to force the
deterministic regex engine. `TEST_CHECKER_VERSION` pins the binary version and
outranks a cached release tag; the binary has no npm package, so an explicit
version is the only offline source.

Before using a cached binary, the plugin probes its `--version` and compares it
with the version it resolved for the cache directory. On a mismatch it warns once
per session, names both versions, and uses the in-process regex rules for that
run instead of silently trusting the wrong engine. The same check applies to
`comment-checker`.

`test_patterns` overrides the built-in test-path table; leave it unset to use
the table. The table matches the binary's `is_test_path`: a directory segment
`tests`, `test`, `__tests__`, `spec`, or `specs`; a filename prefix `test_` or
`test-`; or a filename infix `_test.`, `.test.`, `.spec.`, or `_spec.`.

Harness/config paths (CI workflows, `.test-checker.json`,
`jest`/`vitest`/`karma` config, `pytest.ini`, `tox.ini`, `conftest.py`,
`package.json`, ...) are classified independently, mirroring the binary's
`is_harness_path`, and are always forwarded to the binary so
`config-edited`/`harness-edited`/`gate-weakened` fire even when they do not match
`test_patterns`. The live hook, audit, CI check and cleanup share this gate, and
a path that is both a test path and a harness path (for example
`tests/conftest.py`) is handled as harness.

The plugin never spawns a binary by name from `PATH`; each binary is resolved to an absolute path in this order:

- comment guard: the cache at
  `$XDG_CACHE_HOME/opencode-comments-plugin/bin/<version>/comment-checker`
  (with `XDG_CACHE_HOME` unset, `~/.cache/...`), downloading on demand
- test guard: the cache only, at
  `$XDG_CACHE_HOME/opencode-comments-plugin/test-checker/<version>/test-checker`
  (the binary has no npm package), downloading on demand

This is deliberately different from the test-checker's own documented Claude
Code/OpenCode hook command, which invokes `test-checker` by name and therefore
resolves it from `PATH`; if that command is not on `PATH` the edit goes
unchecked and the wrapper stays silent. The plugin never shells out by name, so
a stale `PATH` cannot change which engine it uses.

Rule ids are a generated contract with the binary. `src/rules/tests/binary-rule-ids.json`
is rewritten from the test-checker README `## Rules` paragraph (33 ids at tc
`60e58e0`) by `node scripts/generate-rule-ids.mjs`; point `TC_REPO` at a current
checkout when the default `../test-checker` is stale or absent. Every binary id
is enabled at `warn` because the binary has already applied its own confidence
gate. `npm run check:rule-ids` compares the parsed id set and exits non-zero only
when an id is added, removed or renamed, so a tc bump that leaves the ids intact
does not demand a contract refresh.

Older regex ids keep working through these aliases. An explicit legacy override
applies to every listed binary id unless that id is configured itself:

| legacy regex id | binary id(s) | why |
|---|---|---|
| `skip-focus-added` | `skip-added`, `focus-added` | the regex flagged `.skip` and `.only` together; the binary splits them |
| `tautological-assertion` | `tautological-assertion`, `constant-assertion` | the regex's always-true check also covered literal-vs-literal comparisons |
| `matcher-loosened` | `weakened-assertion` | a weaker matcher for the same assertion subject is the binary's diff-aware weakening rule |
| `empty-test` | `gutted-test` | the regex only flagged an empty/trivial body, which the binary reports as an emptied test; it did not flag executable bodies that merely lack an assertion |
| `forced-success` | `gate-weakened` | forcing a command to pass weakens the test gate itself |
| `expected-from-sut` | `expected-copied-from-actual` | an expectation produced by the code under test copies the actual value |
| `weakened-config` | `gate-weakened`, `harness-edited` | the regex flagged gate bypasses (`@ts-nocheck`, `--no-verify`, `ruff: noqa`), coverage gates (`fail_under=0`/lowered), and config files; it had no retry or numeric-tolerance pattern |

Findings are also gated by the binary's confidence: `low` is hidden by default,
matching tc's default `medium` gate, so only `medium`/`high` findings reach the
tool output (each is shown with its `(confidence: ...)`). The plugin re-applies
that Low filter in case the binary's gate is lowered.

The rule-id check is **advisory, not a required check**. CI runs it with
`continue-on-error: true` after cloning tc main, so a stale checkout of the
test-checker repo cannot block an unrelated PR.

The real-binary contract test is opt-in: set `TC_BINARY` to a local
test-checker build, e.g.
`TC_BINARY=/path/to/test-checker bun test src/rules/tests/real-binary.test.ts`.

| Rule | Signal | Default |
|---|---|---|
| `protected-paths` | edit/delete of an existing test file (new files exempt) | warn |
| `skip-focus-added` | `.skip`/`.only`/`.todo`, `xit`, `skipif`, `#[ignore]`, `t.Skip` | warn |
| `tautological-assertion` | `assert True`, `expect(true).toBe(true)`, `assertEquals(x,x)` | warn |
| `empty-test` | test body with no executable statement | warn |
| `unknown-test` | test with no assertion/expect/fail | warn |
| `gutted-test` | all assertions removed | warn |
| `matcher-loosened` | `assertEqual -> assertTrue`, `toBe -> toBeTruthy`, ... | warn |
| `swallowed-error` | `except Exception: pass`, empty `catch {}` | warn |
| `duplicate-test` | identical test bodies in the same file | warn |
| `forced-success` | `\|\| true`, `exit 0`, `sys.exit(0)`, `process.exit(0)`, `continue-on-error: true`, `--passWithNoTests` | warn |
| `mock-of-sut` | `vi`/`jest.mock` of the module under test, `spyOn` of an import from it, Python `patch` of it (JS/TS + Python only) | warn |
| `over-mocking` | new mock identifiers (dummy/stub/mock/spy/fake) | warn (shared with the binary) |
| `assertion-roulette` | several assertions with no message | off |
| `redundant-assertion` | the same assertion repeated in one test | off |
| `weakened-config` | `@ts-nocheck`, `--no-verify`, lowered `fail_under`/`cov-fail-under` | off |
| `tests-not-run` | a test command excludes/skips tests | off |
| `expected-from-sut` | assertion whose expected value is produced by the code under test (same call identifier on both sides) | off |
| `negative-control-unrelated` | `pytest.raises(Exception)`, `assertRaises(Exception)`, `.toThrow()`/`.toThrow(Error)`, `expect(...).not.toThrow()` | off |

`mock-of-sut` is implemented only for JavaScript/TypeScript and Python: Go and
Rust expose no reliable circular-mock idiom, so the rule never fires for them.

#### Legacy regex-only ids

Twelve regex ids are plugin-only (not shared with the binary): six map to a
binary id through the alias table above, and six have no binary counterpart at
all. All twelve are **legacy regex advisories**. In the live hook they run when
the binary engine is unavailable or `engine: "regex"` is forced, and also for
changes the binary engine does not handle - deletions and changes with empty
new text - even when `engine: "binary"`. The audit and `guard check` paths always
run the regex analyzer, whatever `engine` says. Most binary rules -
`allow-invalid`, `config-edited`, `snapshot-regenerated`,
`expected-copied-from-actual`, `harness-edited`, and others - have no regex
fallback equivalent, so offline coverage is intentionally narrower. The live
hook forwards test files and test harness/config paths (`.test-checker.json`, CI
workflows, `jest`/`vitest`/`karma` config, `pytest.ini`, `tox.ini`,
`conftest.py`, `package.json`, ...) to the binary, so its
`config-edited`/`harness-edited`/`gate-weakened` ids surface in OpenCode. The
regex fallback stays silent on those harness paths; Low-confidence harness findings stay hidden at the default
gate, as in Claude Code.

| Regex id | Default | Detectable from an edit hook |
|---|---|---|
| `protected-paths` | warn | yes — any edit/delete of an existing test file |
| `skip-focus-added` | warn | yes — added `.skip`/`.only`/ignore lines |
| `empty-test` | warn | only when the edit fragment contains the whole test |
| `unknown-test` | warn | only when the edit fragment contains the whole test |
| `matcher-loosened` | warn | yes — removed and added matcher lines are compared |
| `forced-success` | warn | yes — added `\|\| true`/`exit 0`/`--passWithNoTests` lines |
| `weakened-config` | off | yes — added config lines; threshold deltas need removed+added lines |
| `assertion-roulette` | off | only when the edit fragment contains the whole test |
| `redundant-assertion` | off | only when the edit fragment contains the whole test |
| `tests-not-run` | off | yes — added command lines that exclude tests |
| `expected-from-sut` | off | yes — added assertion lines |
| `negative-control-unrelated` | off | yes — added overly broad negative-control lines |

The six shared ids (`tautological-assertion`, `gutted-test`, `swallowed-error`,
`duplicate-test`, `mock-of-sut`, `over-mocking`) exist in both engines.

Only added (`+`) lines trigger a finding; comments are stripped before
counting. Inline bypass: `// test-guard: allow <reason>` (within +/-2 lines) or
file-level `// test-guard-disable-file`.

`tools` restricts which tools the guard reacts to (default
`["write","edit","apply_patch"]`), mirroring `comment_checker.tools`. Queued
advisory notes still surface on the next tool call regardless of this filter.

Env vars mirror the comment guard: `TEST_GUARD_ENABLED`,
`TEST_GUARD_ENGINE`, `TEST_GUARD_TEST_PATTERNS`, `TEST_GUARD_TOOLS`,
`TEST_GUARD_MAX_WARNINGS_PER_FILE`, `TEST_GUARD_DEDUP_WINDOW_MS`,
`TEST_GUARD_CUSTOM_PROMPT`,
`TEST_GUARD_APPEND_PROMPT`, `TEST_GUARD_MUTATION_ENABLED`,
`TEST_GUARD_MUTATION_COMMAND`, `TEST_GUARD_MUTATION_TIMEOUT_MS`,
`TEST_GUARD_JUDGE_ENABLED`, `TEST_GUARD_JUDGE_MODEL`,
`TEST_GUARD_JUDGE_TIMEOUT_MS`, `TEST_GUARD_PARSER_ENABLED`,
`TEST_GUARD_PARSER_COMMAND`, `TEST_GUARD_PARSER_TIMEOUT_MS`, and
`TEST_GUARD_CHECK_<RULE>` (env > tuple options).
`TEST_CHECKER_VERSION` pins the installed `test-checker` binary version.

### Mutation (opt-in, phase 2)

The plugin does not bundle a mutation engine. If `mutation.enabled` is set with
a `mutation.command` (Stryker, mutmut, PIT, …), it runs on `session.idle`
(at most once per minute per session), parses the report (Stryker JSON
`files[].mutants[]` or a generic `{ "survivors": [...] }`) and queues the
survivors for the next tool call's output. Disabled by default, fail-open,
never runs a destructive command.

### LLM judge (opt-in, phase 2B)

If `judge.enabled` is set, the plugin reviews the current test diff with
`judge.model` (default `opencode/big-pickle`, a free OpenCode Zen model; set it
to `host` to reuse the model opencode is already configured with),
inside a sandboxed session with tools disabled, on `session.idle` (at most once
per minute per session) and on demand via the `guard_judge` tool. It returns
**advisory** findings only, is fail-open, and never handles provider
credentials — the model and keys stay in opencode. Note that, when enabled,
the test diff (test code only, not the whole repo) is sent to the configured
model. Disabled by default.

### External parser adapter (opt-in)

For AST-grade precision without bundling a parser, `parser.enabled` runs a
configured command over the current test diff. The command receives
`{"files":[{"path","language","added","removed"}]}` on stdin and must return
`{"findings":[{"file","line","rule?","message","confidence?"}]}` on stdout. It
runs on `session.idle` (per-session cooldown) and on demand via the
`guard_parse` tool. Findings are advisory, fail-open, and disabled by default.

### Audit

A read-only custom tool `guard_audit` (plus the `/guard-audit` command)
reviews EXISTING comments and tests and returns a cleanup plan the agent
applies afterwards:

```jsonc
{ "scope": "both", "paths": ["src/", "tests/"], "format": "markdown", "include_advisory": false }
```

### Cleanup

`guard_cleanup` (plus `/guard-cleanup`) runs test-checker's `--strip` cleanup
pass over the repository's test files. The tool takes no arguments.

The binary analyzes each file on disk as a whole and removes only test blocks
covered by a human-approved `remove` entry in the git root's
`.test-checker.json`. The plugin never rewrites an unapproved candidate and
never relaxes the approval gate. The report lists what was removed and what was
kept awaiting approval.

The intended workflow is report first, approve narrowly, then clean up:

1. Run `guard_audit` or `opencode-guard-plugin guard audit --scope tests` to
   see the cleanup candidates.
2. A human adds a `remove` entry to `<git root>/.test-checker.json`:

```jsonc
{
  "remove": [
    {
      "glob": "tests/report.test.ts",
      "rules": ["duplicate-test"],
      "reason": "covered by report-format.test.ts since the table rewrite"
    }
  ]
}
```

   `reason` must be at least 12 characters. Keep both the glob and the rule list
   as narrow as the case allows.
3. Run `guard_cleanup`, `/guard-cleanup` or
   `opencode-guard-plugin guard cleanup`. Only approved candidates are
   removed; the rest are reported again.

### CLI (CI parity)

The same engine is exposed as a CLI for pre-merge use. `test_command` is
auto-detected from `package.json`, `pytest.ini`/`pyproject.toml`, `go.mod`,
`Cargo.toml`, `pom.xml` or `build.gradle`, and can be overridden via the
`test_command` option or `TEST_GUARD_TEST_COMMAND`.

```bash
opencode-guard-plugin guard check --diff [--base <rev>] [--scope tests|comments|both] [--json] [--include-advisory]
opencode-guard-plugin guard validate-config [config.json]
opencode-guard-plugin guard audit [--scope comments|tests|both] [--paths a,b] [--json] [--include-advisory]
opencode-guard-plugin guard cleanup
```

`guard validate-config` reads the tuple options object - the same object passed
as the plugin's second tuple element (`{ "comment_checker": {...},
"test_guard": {...} }`), not a full opencode config (a config containing
`plugin` and other top-level keys would validate vacuously).

`--include-advisory` includes advisory-severity rules in `check` and `audit`
output (they are hidden by default).

`guard check` exits non-zero when the diff trips a rule, so it can gate a PR.
`--scope` defaults to `tests`; `comments` runs the comment-checker binary over
the added lines of the changed files, and `both` runs both.

`guard cleanup` walks the repository's test files, runs the test-checker
`--strip` pass on each, and prints the removed and kept-awaiting-approval items.
Harness/config files are selected by the shared gate and listed as skipped
because `--strip` runs on test bodies. It exits 0 on success, including when
nothing was approved or removed. A missing binary is reported and treated as a
no-op rather than a failure.

### Language matrix and limits

The regex rule tables cover Python, JS/TS, Rust and Go (ported from tamperguard
MIT, tampercheck Apache-2.0, pr-test-guard MIT and veredicto up to v0.3.3).
Language detection covers every extension the bundled `test-checker` builds
parse - 35 languages including Ruby, Java, C#, PHP, Kotlin, Swift, Scala,
Elixir, Lua, C, C++, Groovy, OCaml, Elm and Bats - so audit, CI and cleanup
select those test files too. A language without per-language regex rules still
runs the language-agnostic rules (`forced-success`, `tests-not-run`,
`weakened-config`) and receives the binary's findings; no unvalidated
per-language rule runs.

### Known limits

The default `test-checker` binary is AST-grade (tree-sitter), but
the regex fallback that runs when it is unavailable can misread a test
declaration written inside a string or a regex literal - use the opt-in external
parser adapter for AST-grade precision without the binary. Cross-file duplicate
detection runs in the audit/CI paths, not the live per-file hook.

Switching to the regex fallback is announced once per session: a missing,
stale/wrong-version or unparseable binary never changes the rule ids silently.

`config-edited`, `harness-edited` and `gate-weakened` require the
`test-checker` binary; the regex fallback that runs without it has no equivalent,
so harness edits are unchecked offline.

`guard cleanup` requires a test-checker release that includes `--strip`. The
stale-binary warning covers an older cached binary on the hook path. A binary
that predates `--strip` ignores the flag and prints no cleanup summary, so the
cleanup reports that the binary predates `--strip` and rewrites nothing
(fail-open). Upgrade the test-checker release and run the cleanup again.

## Debug

Set `COMMENT_CHECKER_DEBUG=1` to log what the plugin and the CLI do to stderr. Any other value (including `0`) logs nothing. `TEST_GUARD_DEBUG=1` enables test-guard logs.

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```

Two JSON files are generated contracts with the `test-checker` binary; do not
edit them by hand. Set `TC_REPO` to a current checkout when the default
`../test-checker` is stale or absent.

| file                                   | source                                                                            | refresh                         | drift check                     |
| -------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------- |
| `src/rules/tests/binary-rule-ids.json` | test-checker README `## Rules` paragraph                                          | `npm run rules:generate`        | `npm run check:rule-ids`        |
| `src/rules/tests/path-predicates.json` | test-checker `eval/path-predicates.json`, itself generated from `src/language.rs` | `npm run rules:path-predicates` | `npm run check:path-predicates` |

Each `check:` command compares the contract content: `check:rule-ids` compares
the id set, and `check:path-predicates` compares the predicate body. The recorded
`ref` is provenance only, so a sibling commit that leaves the content unchanged
does not fail the check. The path-predicate artifact records the `source`
repository and `ref` it came from; `src/rules/tests/patterns.ts` reads its
tables, so the test and harness path predicates track the binary instead of a
hand transcription.

The invariants a change must preserve are in
[`docs/design-constraints.md`](docs/design-constraints.md).
