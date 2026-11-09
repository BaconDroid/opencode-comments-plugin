# Design constraints

The invariants behind the guards. A change that breaks one of these changes the
product, not just the implementation.

## Advisory, never blocking

- Severity is `off` or `warn`. There is no blocking severity, and
  `guard validate-config` rejects `"block"`.
- The guards never block a tool call and never rewrite the file. They report;
  the agent decides what to do next.
- Fail-open everywhere: an internal guard error is swallowed and logged, so a
  guard defect cannot prevent the agent's action. This is a quality guard, not a
  security guard.
- The LLM judges, the mutation runner and the external parser adapter are opt-in
  analyzers: advisory, per-session cooldown, disabled by default, never a gate.
- No aggregate "test smell count" gate and no coverage gate: smell detectors are
  low precision, and coverage does not correlate with test effectiveness. No
  oracle/reference-based category, which needs a reference implementation to
  judge.

## Detection

- The comment guard delegates detection to the `comment-checker` binary; the
  test guard defaults to the `test-checker` binary and falls back to the
  in-process regex rules. The shared layer orchestrates analyzers; the engines
  stay distinct.
- Comment output is the binary's message appended raw, with no `Finding` model
  and no idempotent marker. Test findings are structured and carry the marker.
  This asymmetry is each guard's output contract.
- No bundled AST parser. AST precision comes from the downloaded binary or from
  the user-provided parser adapter.
- Java is unsupported. Other unsupported languages are ignored rather than
  matched with unvalidated rules.
- Content rules inspect added (`+`) lines only. Comments are stripped and blank
  lines ignored before counting, conditional skips do not count as skips, and the
  audit/CI pass cancels a moved test instead of counting it as deleted.
- Cross-file duplicate detection stays in the audit and CI paths; the live hook
  is per file.

## Configuration

- Precedence is environment > plugin tuple option; a config object is the lowest
  layer when a host supplies one. The exported entrypoint supplies none, so the
  observable precedence is environment > tuple. Env vars mirror tuple options
  under `COMMENT_CHECKER_` and `TEST_GUARD_`.
- Options live in the plugin tuple because OpenCode drops unknown top-level
  keys. The plugin never writes another plugin's config; a future config-hook
  contribution merges keys instead of overwriting the host's.
- Each guard owns its `enabled`, trigger tools and bypass markers; the test guard
  also owns per-rule severity. Neither reads another plugin's `disabled_hooks` or
  shares its per-session state.

## Host coexistence

- The plugin id and package name are unique. No `plugin` or `plugins` wrapper
  directory name is used, which would collide on a host scan.
- `tool.execute.after` never throws. It appends to `output.output` (marker for
  the test guard, raw for the comment guard) and never replaces existing output.
- Tool arguments are accepted in their normalized forms: `filePath` / `path` /
  `file_path` and `patchText` / `patch`.
- Every rule factory is wrapped (`try`/`catch` to `null`) so one broken rule
  cannot take down the plugin.
- The guards are written against the V1 hook contract (`createHooks`). The
  exported `Plugin.define` setup adapter translates V2 host events into that
  contract; it does not reimplement a guard.

## Reuse

- A mechanism one guard already uses may serve the other unless reuse changes
  observable output or breaks a constraint above.
- Shared: config resolution, diff and pre-image reads, budget, bypass markers,
  runner, glob, idle-advisory plumbing, judge plumbing, schema and
  `validate-config`, the `Finding` model, and the output append.
- Never shared: comment feedback through the `Finding` model or marker, comment
  detection through regex, a bundled parser, the LLM as a gate, Java support.

## Engineering

- Zero new runtime dependencies. Use the standard library and existing
  dependencies; detectors are downloaded binaries or user-provided commands.
- Ported rule motifs cite their origin and license in code: tamperguard (MIT),
  tampercheck (Apache-2.0), pr-test-guard (MIT), veredicto up to v0.3.3.
- The plugin never runs a destructive command. The mutation adapter runs only
  the configured command; test-command detection reports, it does not execute.
- Audit is read-only and bounded: git-tracked files where available, excluded
  dependency and vendor directories, a 500-file cap, secret-file patterns
  skipped, and no file content in logs. Debug logging truncates the tool payload
  to 200 characters.
- Each rule ships three tests: a positive, a negative that stays silent, and an
  anti-false-positive case.
