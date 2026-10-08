# Comment/test guard unification - plan and decisions

Status: decisions frozen, implementation in progress.
Scope: bring the comment guard and the test guard closer together on their
shared `src/core/*` engine, without changing the observable behavior of the
comment guard except where explicitly decided here.

Companion: `docs/plans/ai-test-guard-plan.md` (the plan that introduced the
test guard).

## 1. Method

- Inventory both guards' mechanisms.
- Compare them in a matrix.
- Pick opportunities by impact x risk, and decide the material ones.
- Implement one concern per slice, each with tests, then `bun test`,
  `bun run typecheck`, `bun run build`.
- Each slice goes through branch -> commit -> push -> PR -> CI -> squash merge.
- Re-run the analysis after each merge; stop when nothing actionable remains.

## 2. Comparison matrix (state at commit 74851f0)

| mechanism | comment guard | test guard | status | opportunity | risk | effort |
|---|---|---|---|---|---|---|
| config precedence `env > tuple > config` | yes (`COMMENT_CHECKER_*`) | yes (`TEST_GUARD_*`) | shared (`core/config`) | - | - | - |
| JSON schema + `guard validate-config` | yes (`validateCommentChecker`) | yes | shared | already done | - | - |
| global `enabled` | absent | yes | divergent | low value, not done | low | low |
| per-rule severity `checks` | absent (binary always warns) | yes | divergent | not applicable | - | - |
| trigger-tool filter | yes (`triggerTools`) | absent | divergent | add `test_guard.tools` | low | low |
| pre-image read on `write` | yes (inline) | yes (inline) | duplicated | share a `core` helper | low | low |
| net-new-only | `hasNewCommentLines` | `extractToolChange` | divergent | share `addedLinesOf` | low | low |
| `apply_patch` extraction | `splitPatch`/`toPatchEntries` | `extractPatchChanges` | divergent (same `core/diff`) | unify on `extractPatchChanges` | low | low |
| budget max warnings/file | `warningCounts` | `GuardBudget` | duplicated | not unified (would change behavior) | medium | medium |
| dedup window (30 s) | absent | yes | divergent | not added to comment (behavior) | medium | low |
| pending-call TTL cleanup | yes | absent | divergent | add cleanup to the test guard | low | low |
| feedback rendering | raw append | `renderFeedback` + `Finding` | divergent | not unified for the comment guard | medium | medium |
| idempotent marker | absent (kept) | yes | divergent | keep as-is (decision) | - | - |
| rule registry | absent (binary) | `TestRule[]` | divergent | not applicable to a binary | - | - |
| bypass markers | absent | `test-guard: allow` | divergent | add `comment-guard: allow` | low | medium |
| idle analyzers | absent | mutation/judge/parser | absent | add opt-in comment relevance judge | medium | high |
| on-demand tools | absent | audit/judge/parse | absent | `guard_comment_judge` | medium | medium |
| cross-file detection | absent | audit/CI | absent | not applicable | - | - |
| `guard_audit` both scopes | yes | yes | shared | already done | - | - |

## 3. Decisions (explicit)

1. **Comment marker**: keep the raw append. The 35 original tests are the
   contract; the observable output of the comment guard is unchanged.
2. **`test_guard.tools`**: add a configurable trigger-tool filter, mirroring
   `comment_checker.tools`. Default `write,edit,apply_patch`.
3. **Comment idle analyzer**: add an opt-in comment relevance LLM judge, reusing
   `core/idle-advisory` and the model runner. Disabled by default, fail-open.
4. **Comment bypass**: add `comment-guard: allow <reason>` (within +/-2 lines)
   and file-level `comment-guard-disable-file`, mirroring the test guard.

## 4. Slices

1. `test_guard.tools` configurable filter (symmetry with `comment_checker.tools`).
2. Test-guard pending-call TTL cleanup (parity with the comment guard) + drop
   the dead `mutationEnabled` field in `bin.ts`.
3. Shared pre-image reader and added-line helper in `core/diff`, used by both
   guards (internal refactor, no behavior change).
4. Comment bypass markers (`comment-guard: allow` / `comment-guard-disable-file`).
5. Opt-in comment relevance judge on `session.idle` + `guard_comment_judge`.
6. Unify the comment `apply_patch` extraction on `extractPatchChanges`.

Each slice: tests (positive, negative, anti-FP) + `bun test` + `bun run
typecheck` + `bun run build`, then PR and squash merge.

## 5. Deliberately not done

- Shared budget for the comment guard: the comment guard has no dedup window and
  its `max_warnings_per_file` semantics differ; unifying on `GuardBudget` would
  change observable output, which the decisions above do not authorize.
- Shared feedback/`Finding` pipeline for the comment guard: same reason (raw
  append kept on purpose).
- Unifying the rule registry: the comment guard delegates to an external binary,
  so there is no regex rule registry to merge.

## 6. Residual limits

- Regex rules without AST (test guard); AST only through the opt-in parser.
- `block` is not airtight (sub-agents may bypass `tool.execute.before`).
- Opt-in analyzers are per-session cooldown, fail-open, disabled by default.
- The comment relevance judge, when enabled, sends the added comment lines to
  the configured model (the test judge sends the test diff).
- Java remains unsupported.

## 7. Slice status

All slices landed via squash-merged PRs:

1. `test_guard.tools` configurable filter (#26).
2. Test-guard pending-call TTL cleanup + drop dead `mutationEnabled` (#27).
3. Shared `readPreimage` in `core/diff` (#28).
4. Comment `comment-guard: allow` / `comment-guard-disable-file` bypass (#29).
5. Opt-in comment relevance judge + `guard_comment_judge` (#30).
6. Comment guard reuses `extractPatchChanges` (#31).

## 8. Detaching from the fork network (manual)

The repository is a GitHub fork of `ajoslin/opencode-comments-plugin`. The
GitHub REST API has no endpoint to leave the fork network (only `GET`/`POST
/repos/{owner}/{repo}/forks`), so this cannot be done with a token. The
non-destructive metadata/README independence changes are done in-repo; the fork
link itself must be removed from the GitHub UI:

1. Repository -> Settings -> General -> Danger Zone -> "Leave fork network".
2. Type the repository name to confirm.

Conditions (all met): public, < 1 GB, no child forks. GitHub warns that the
standalone repository may not retain issues, pull requests, wikis, stars,
watchers or comments; git commit history is preserved. Alternatively, contact
GitHub Support to detach without recreating. A delete-and-recreate mirror is
the only fully scriptable route and is destructive, so it is not performed.

