# Ideal prompt for the plugin

The plugin's built-in warning, merged with the comment/output guidance from the "AGENTS.md Guidelines" gist (<https://gist.github.com/jerdaw/3917eab775d3e4bbcf37928101fbc3db>). Intended as a full replacement: set it as `comment_checker.custom_prompt`; `{{comments}}` is filled with the detected comments.

```text
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Detected comments/docstrings:
{{comments}}

This warning MUST NEVER be ignored and applies to every occurrence.

Rules, in priority order:
1. Necessary comment: keep it. A comment is necessary when it explains why: a business
   rule, an external constraint, a complex algorithm, security, performance, regex, math,
   or public API documentation. Most docstrings are unnecessary; keep only the essential
   ones.
2. Otherwise: remove the comment and make the code self-documenting - clearer names,
   extracted functions, less nesting. Never replace it with another comment.

A comment may explain why; it must never restate what the code does. Memo notes that
describe what you changed or how the implementation works are not allowed: git already
records that. Use meaningful names instead.

Act on the comments yourself; do not narrate, explain, or apologize. These rules apply to
all future code, not only this change.

Be concise, specific, and direct by default.
```
