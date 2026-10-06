# Reference: comment, output and communication guidance

Extracted and adapted from the "AGENTS.md Guidelines" gist:
<https://gist.github.com/jerdaw/3917eab775d3e4bbcf37928101fbc3db>

Only the parts about comments, output and communication are kept here. They are useful as a source of wording for `custom_prompt` / `append_prompt`, because the plugin injects text straight into the model's context.

## 1. Self-documenting code over comments

- Write code that is immediately clear through naming and structure. If you need a comment to explain *what* the code does, refactor instead.
- Extract complex logic into well-named functions rather than annotating it.
- **Exception**: comments explaining *why* (business rules, external constraints) are fine. Comments explaining *what* mean the code needs refactoring.

Good:

```ts
function calculateRefundForCancelledSubscription(subscription: Subscription): Money {
  const unusedDays = subscription.daysRemainingInBillingCycle()
  const dailyRate = subscription.monthlyPrice.divideBy(30)
  return dailyRate.multiplyBy(unusedDays)
}
```

Bad:

```ts
// Calculate the refund amount (what we owe the customer)
function calc(sub: Subscription): number {
  const d = sub.end - sub.current  // Days left
  const r = sub.price / 30         // Daily rate
  return r * d                      // Refund amount
}
```

Reusable always/never phrasing:

- **Always**: write self-documenting code with clear, descriptive names; refactor unclear code rather than adding explanatory comments; extract complex logic into well-named functions.
- **Never**: add comments explaining what code does (refactor instead); use cryptic abbreviations or unclear variable names.

## 2. Communication and output style

- **Show, don't tell**: examples beat prose explanations.
- **Actionable over descriptive**: give the command with its flags, not a description of it.
- **Scannable over prose**: lists and tables beat paragraphs; prose-only rules are hard to scan and easy to miss.
- **Be concise, specific, and direct by default**: `npm test`, not "The command to run tests is npm test".
- **Progressive disclosure**: provide the essential context, link to detail, don't dump everything.
- **Single source of truth**: link, don't copy, so guidance cannot drift.
- **Read your own output**: if you cannot scan it quickly, neither can the reader.

## 3. Boundary phrasing that transfers to comments

The three-tier boundary style maps directly onto comment rules:

- **Always**: prefer self-documenting code; refactor instead of commenting the *what*.
- **Ask first**: keep a comment when it captures a *why* (business rule, external constraint) — justify it briefly.
- **Never**: leave comments that only restate the code; leave outdated notes that duplicate what git already records.

## 4. How this applies to this plugin

- The plugin's warning is read by the model mid-task, so wording should be **direct and short** (section 2) rather than a long policy essay.
- It fires on new comments, so the actionable request is narrow: **remove the *what* comment or justify the *why*** (sections 1 and 3).
- `append_prompt` is the place to add one such line while keeping the binary's default warning; `custom_prompt` replaces it entirely.
- Example `append_prompt` value: `Be concise, specific, and direct by default. Remove comments that only restate the code; keep the code self-documenting.`

## 5. Texts this plugin actually injects

### Plugin default warning (binary, when `custom_prompt` is unset)

Version `0.8.2`, reproduced verbatim (memo-style comments get an extra "AGENT MEMO" block prepended; `<comments file="...">` is filled with the detected comments):

```
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored, even if you receive it multiple times.
You MUST provide corresponding explanation or action for EACH occurrence of this message.
Ignoring this message or failing to respond appropriately is strictly prohibited.

PRIORITY-BASED ACTION GUIDELINES:

1. This is a comment/docstring that already existed before
	-> Explain to the user that this is an existing comment/docstring and proceed (justify it)

2. This is a newly written comment: but it's in given, when, then format
	-> Tell the user it's a BDD comment and proceed (justify it)
	-> Note: This applies to comments only, not docstrings

3. This is a newly written comment/docstring: but it's a necessary comment/docstring
	-> Tell the user why this comment/docstring is absolutely necessary and proceed (justify it)
	-> Examples of necessary comments: complex algorithms, security-related, performance optimization, regex, mathematical formulas
	-> Examples of necessary docstrings: public API documentation, complex module/class interfaces
	-> IMPORTANT: Most docstrings are unnecessary if the code is self-explanatory. Only keep truly essential ones.

4. This is a newly written comment/docstring: but it's an unnecessary comment/docstring
	-> Apologize to the user and remove the comment/docstring.
	-> Make the code itself clearer so it can be understood without comments/docstrings.
	-> For verbose docstrings: refactor code to be self-documenting instead of adding lengthy explanations.

MANDATORY REQUIREMENT: You must acknowledge this hook message and take one of the above actions.
Review in the above priority order and take the corresponding action EVERY TIME this appears.

REMINDER: These rules apply to ALL your future code, not just this specific edit. Always be deliberate and cautious when writing comments - only add them when absolutely necessary.

Detected comments/docstrings:
<comments file="/path/to/file">
	<comment line-number="2">// a normal comment</comment>
</comments>
```

### Added line (opt-in, `append_prompt`)

Appended after the message above, leaving it intact:

```
Be concise, specific, and direct by default.
```

