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

You can override the CLI warning message using `comment_checker.custom_prompt`:

```json
{
  "comment_checker": {
    "custom_prompt": "DETECTED:\n{{comments}}\nFix it."
  }
}
```

`comment_checker.max_warnings_per_file` stops warning after N warnings about the same file in the same session. `0` (the default) keeps warning every time:

```json
{
  "comment_checker": {
    "max_warnings_per_file": 2
  }
}
```

opencode validates its config against a fixed schema and drops unknown top-level keys, so `comment_checker` may never reach the plugin. When it does not, set the same limit through the environment instead:

```bash
COMMENT_CHECKER_MAX_WARNINGS_PER_FILE=2 opencode
```

## Behavior

- Runs on `Write`, `Edit`, and `apply_patch` tool calls.
- If the CLI detects comments, it appends the warning message to tool output.
- If the CLI binary is missing, the plugin auto-downloads the correct release.

## Debug

Set `COMMENT_CHECKER_DEBUG=1` to log what the plugin and the CLI do to stderr. Nothing is logged without it.

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```
