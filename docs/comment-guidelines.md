# Ideal prompt for the plugin

Merged from the "AGENTS.md Guidelines" gist (<https://gist.github.com/jerdaw/3917eab775d3e4bbcf37928101fbc3db>, comment/output parts only) and the plugin's built-in warning. Intended as a full replacement: set it as `comment_checker.custom_prompt`; `{{comments}}` is filled with the detected comments.

```text
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Detected comments/docstrings:
{{comments}}

This message MUST NEVER be ignored and applies to every occurrence. Fix the code that
triggered it; do not merely acknowledge it.

Rules, in priority order:
1. Necessary comment: keep it. Necessary means it explains why - a business rule, an
   external constraint, a complex algorithm, security, performance, regex, math, or public
   API documentation. Most docstrings are unnecessary; keep only the essential ones.
2. Otherwise: remove it and make the code self-documenting - clearer names, extracted
   functions, less nesting. Never replace it with another comment.

A comment may explain why; it must never restate what the code does. Memo notes that
describe what you changed or how implementation works are not allowed: git already records
that. Use meaningful names instead.

Act; do not narrate, explain, or apologize. These rules apply to all future code, not only
this change.

Be concise, specific, and direct by default.
```
