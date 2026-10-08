# opencode-comments-plugin

Stop the comment slop.

OpenCode plugin that guards comments and tests: it warns when new comments or
docstrings are added (wrapping the `comment-checker` CLI from
`go-claude-code-comment-checker`) and ships a deterministic test guard that
discourages weakened tests. Both surface their findings in tool output.

## Origin and independence

This project began as a fork of
[`ajoslin/opencode-comments-plugin`](https://github.com/ajoslin/opencode-comments-plugin),
which itself derives from the comment-checker hook in
[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode). It is now an
independent project maintained by BaconDroid and has grown beyond comments: the
test guard, the audit tooling and the opt-in analyzers are original work. The
original credits are kept below.

## Credits

The comment guard is derived from the comment-checker hook logic in `oh-my-opencode`.
Credit to [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) for the original hook integration,
and to [ajoslin/opencode-comments-plugin](https://github.com/ajoslin/opencode-comments-plugin) for the plugin this one forked from.

## Install

### NPM/Bun

```bash
bun add opencode-comments-plugin
# or
npm install opencode-comments-plugin
```

### Local plugin

```bash
bun install
bun run build
```

Then point your OpenCode config at the built file:

```json
{
  "plugin": ["opencode-comments-plugin"]
}
```

## Configuration

Options are passed as the second element of the plugin tuple. opencode calls the plugin with that object:

```json
{
  "plugin": [
    ["opencode-comments-plugin", { "comment_checker": { "custom_prompt": "DETECTED:\n{{comments}}\nFix it." } }]
  ]
}
```

Why the tuple and not a top-level `comment_checker` key: opencode validates its config against a fixed schema, so unknown top-level keys are dropped before plugins see them. The tuple is the supported per-plugin channel; a top-level `comment_checker` block is still read if a future opencode version forwards it.

A full `custom_prompt` example (the plugin's warning rewritten in simple English) is in [`examples/custom-prompt.json`](examples/custom-prompt.json), with the prompt itself explained in [`docs/comment-guidelines.md`](docs/comment-guidelines.md).

Available options (all under `comment_checker`):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `custom_prompt` | string | CLI default | Replaces the warning message. `{{comments}}` is replaced by the detected comments. |
| `max_warnings_per_file` | number | `0` | Stop warning after N warnings about the same file in one session. `0` = unlimited. |
| `tools` | string[] or CSV string | `["write","edit","apply_patch"]` | Which tools trigger the check. |
| `timeout_ms` | number | `5000` | How long to wait for the CLI before ignoring it. |
| `append_prompt` | string | unset | Opt-in text appended after the warning, keeping the default (or `custom_prompt`) message intact. |

Keep the default CLI warning and add your own line to it, for example:

```json
{
  "plugin": [
    ["opencode-comments-plugin", { "comment_checker": { "append_prompt": "Be concise, specific, and direct by default." } }]
  ]
}
```

`append_prompt` is not passed to the CLI; the plugin appends it to the warning it already injects.

The options may also be given flat, without the `comment_checker` wrapper (`["opencode-comments-plugin", { "tools": ["write"] }]`); both forms are equivalent.

Every option can also be set (and overridden) through the environment, which always wins:

| Env var | Option |
|---|---|
| `COMMENT_CHECKER_CUSTOM_PROMPT` | `custom_prompt` |
| `COMMENT_CHECKER_MAX_WARNINGS_PER_FILE` | `max_warnings_per_file` |
| `COMMENT_CHECKER_TOOLS` | `tools` (comma separated) |
| `COMMENT_CHECKER_TIMEOUT_MS` | `timeout_ms` |
| `COMMENT_CHECKER_APPEND_PROMPT` | `append_prompt` |

## Behavior

- Runs on the tools in `tools` (`write`, `edit`, and `apply_patch` by default).
- If the CLI detects comments, it appends the warning message to the tool output, so the model that called the tool reads it on its next turn. Nothing is blocked and the file is never rewritten.
- Only comments introduced by the change are candidates: for `edit` and `apply_patch` the plugin passes the old and the new snippet, so a comment that was already on the changed lines is not reported; for `write` the whole new content is checked, because the hook cannot see the previous content (rewriting a file keeps flagging the comments it contains).
- The `comment-checker` binary is resolved from the latest GitHub release (checked at most once a day), cached under `~/.cache/opencode-comments-plugin/bin/<version>/`, and downloaded on demand. If the network is unavailable it falls back to the cached or installed version.
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
    ["opencode-comments-plugin", { "comment_checker": { "judge": { "enabled": true, "model": "opencode/big-pickle" } } }]
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
    ["opencode-comments-plugin", {
      "comment_checker": { "custom_prompt": "DETECTED:\n{{comments}}\nFix it." },
      "test_guard": {
        "enabled": true,
        "test_patterns": ["**/*.test.*", "**/*_test.*", "**/test_*.py", "**/tests/**"],
        "checks": { "protected-paths": "warn", "skip-focus-added": "warn" },
        "mutation": { "enabled": false, "command": "npx stryker run --reporters json", "timeout_ms": 120000 },
        "judge": { "enabled": false, "model": "opencode/big-pickle", "timeout_ms": 30000 },
        "parser": { "enabled": false, "command": "my-ast-check --json", "timeout_ms": 30000 }
      }
    }]
  ]
}
```

Every content rule defaults to `warn`. `block` is opt-in per rule and only then
can `tool.execute.before` throw. When `protected-paths` is `block`, the plugin
also denies the `edit`/`write` permission through `permission.ask`, which
covers sub-agents that bypass `tool.execute.before` (opencode issue #5894); if
such a change still reaches the after hook, the warning is prefixed with
`BLOCK BYPASSED`. All internal guard errors are swallowed (fail-open), so the
guard can never prevent the agent's action.

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
| `over-mocking` | new mock identifiers (dummy/stub/mock/spy/fake) | off |
| `assertion-roulette` | several assertions with no message | off |
| `redundant-assertion` | the same assertion repeated in one test | off |
| `weakened-config` | `\|\| true`, `--passWithNoTests`, `@ts-nocheck` | off |
| `tests-not-run` | a test command excludes/skips tests | off |

Only added (`+`) lines trigger a finding; comments are stripped before
counting. Inline bypass: `// test-guard: allow <reason>` (within +/-2 lines) or
file-level `// test-guard-disable-file`.

`tools` restricts which tools the guard reacts to (default
`["write","edit","apply_patch"]`), mirroring `comment_checker.tools`. Queued
advisory notes still surface on the next tool call regardless of this filter.

Env vars mirror the comment guard: `TEST_GUARD_ENABLED`,
`TEST_GUARD_TEST_PATTERNS`, `TEST_GUARD_TOOLS`,
`TEST_GUARD_MAX_WARNINGS_PER_FILE`,
`TEST_GUARD_CUSTOM_PROMPT`,
`TEST_GUARD_APPEND_PROMPT`, `TEST_GUARD_MUTATION_ENABLED`,
`TEST_GUARD_MUTATION_COMMAND`, `TEST_GUARD_MUTATION_TIMEOUT_MS`,
`TEST_GUARD_JUDGE_ENABLED`, `TEST_GUARD_JUDGE_MODEL`,
`TEST_GUARD_JUDGE_TIMEOUT_MS`, `TEST_GUARD_PARSER_ENABLED`,
`TEST_GUARD_PARSER_COMMAND`, `TEST_GUARD_PARSER_TIMEOUT_MS`, and
`TEST_GUARD_CHECK_<RULE>` (env > tuple options > config hook).

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

### CLI (CI parity)

The same engine is exposed as a CLI for pre-merge use. `test_command` is
auto-detected from `package.json`, `pytest.ini`/`pyproject.toml`, `go.mod`,
`Cargo.toml`, `pom.xml` or `build.gradle`, and can be overridden via the
`test_command` option or `TEST_GUARD_TEST_COMMAND`.

```bash
opencode-comments-plugin guard check --diff [--base <rev>] [--json] [--include-advisory]
opencode-comments-plugin guard validate-config [config.json]
opencode-comments-plugin guard audit [--scope comments|tests|both] [--paths a,b] [--json]
```

`guard check` exits non-zero when the diff trips a rule, so it can gate a PR.

### Language matrix and limits

Patterns cover Python, JS/TS, Rust and Go (ported from tamperguard MIT,
tampercheck Apache-2.0, pr-test-guard MIT and veredicto up to v0.3.3). Other
languages are ignored by the test guard rather than matched with unvalidated
rules.

Known limits: the built-in rules are regex-based (no AST), so a test
declaration written inside a string or a regex literal can be misread — use the
opt-in external parser adapter for AST-grade precision. `block` is not airtight
because sub-agents may bypass `tool.execute.before` (opencode issue #5894);
cross-file duplicate detection runs in the audit/CI paths, not the live
per-file hook.

## Debug

Set `COMMENT_CHECKER_DEBUG=1` to log what the plugin and the CLI do to stderr. Any other value (including `0`) logs nothing. `TEST_GUARD_DEBUG=1` enables test-guard logs.

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```
