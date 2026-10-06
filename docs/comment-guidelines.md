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
