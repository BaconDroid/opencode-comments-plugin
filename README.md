# opencode-comments-plugin

Stop the comment slop.

OpenCode plugin that warns when new comments or docstrings are added.
It wraps the `comment-checker` CLI from `go-claude-code-comment-checker` and surfaces warnings in tool output.

## Credits

This plugin is derived from the comment-checker hook logic in `oh-my-opencode`.
Credit to [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) for the original hook integration.

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

## Debug

Set `COMMENT_CHECKER_DEBUG=1` to log what the plugin and the CLI do to stderr. Any other value (including `0`) logs nothing.

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```
