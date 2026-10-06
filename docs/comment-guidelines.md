# Ideal prompt for the plugin

The plugin's default warning, plus the comment guidance from the "AGENTS.md Guidelines" gist (<https://gist.github.com/jerdaw/3917eab775d3e4bbcf37928101fbc3db>). Use it as `comment_checker.custom_prompt`; `{{comments}}` is replaced by the comments found.

```text
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your changes contain comments/docstrings that were flagged:
{{comments}}

You must act on them. Never ignore this warning.

1. Keep a comment only if it explains why: a business rule, something outside your control, a complex algorithm, security, performance, regex, math, or public API docs (including complex module or class interfaces). Most docstrings are not needed; keep only the essential ones.
2. Otherwise, remove it and make the code explain itself: clearer names, extract complex logic into well-named functions, less nesting.

Do not leave notes about what you changed or how you did it; git already shows that.

Do not explain, narrate, or apologize; be specific. Apply this to the rest of this session.
```
