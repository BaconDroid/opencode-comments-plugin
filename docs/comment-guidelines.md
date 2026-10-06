# Ideal prompt for the plugin

The plugin's default warning, plus the comment and writing rules from the "AGENTS.md Guidelines" gist (<https://gist.github.com/jerdaw/3917eab775d3e4bbcf37928101fbc3db>). Use it as `comment_checker.custom_prompt`; `{{comments}}` is replaced by the comments found.

```text
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Found these comments/docstrings:
{{comments}}

You must act on them. Never ignore this warning.

Rules:
1. Keep a comment if it explains why: a business rule, something outside your control, a complex algorithm, security, performance, regex, math, or public API docs. Most docstrings are not needed; keep only the important ones.
2. Otherwise, remove it and make the code explain itself: clearer names, smaller functions, less nesting. Do not replace it with another comment.

A comment may explain why. It must never repeat what the code already says. Do not leave notes about what you changed or how you did it; git already shows that. Use clear names instead.

Remove the comments yourself. Do not explain, narrate, or apologize. Apply this to the rest of this session.
```
