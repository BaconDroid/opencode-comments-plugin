# Roadmap

Planned work, in blocks. Each block is independently shippable; entries inside a
block are ordered. Status is `now`, `next` or `later`. Finished work leaves this
file.

The Rust guard binaries own their own roadmaps (`comment-checker/docs/roadmap.md`,
`test-checker/docs/roadmap.md`). This file covers the plugin only.

## Block A - Guard surface

| # | Item | Status |
|:-:|:-----|:------|
| A1 | Rule-id contract check compares the rule ids instead of the pinned test-checker ref, so an unrelated sibling commit stops reporting drift. | next |
| A2 | `extension_test_name_rules` from the path-predicate contract is carried but not consumed by `isTestPath`; consuming it changes which JVM paths count as tests. | later |
| A3 | A complete extension>language section in the upstream contract, replacing the hand-checked alignment in `src/core/diff.ts`. | later |
| A4 | Per-language regex rules for the languages that currently get language-agnostic rules only (Ruby `end` blocks, Java annotations). | later |

## Block B - Analyzers

| # | Item | Status |
|:-:|:-----|:------|
| B1 | The pre-strip `test-checker` binary is detected only by the missing cleanup summary at run time; add a version preflight once the binary advertises the capability. | later |
| B2 | `test_guard.test_command` is detected and reported but never executed; executing it turns the guard into a runner, which conflicts with the advisory-only constraint. Keep reporting unless the product stance changes. | later |

## Block C - Packaging

| # | Item | Status |
|:-:|:-----|:------|
| C1 | The binary cache directory keeps the pre-rename `opencode-comments-plugin` name so existing caches are not orphaned; rename when a migration step exists. | later |
| C2 | No npm publication. Install is from git; `package.json` stays `private`. | done |
