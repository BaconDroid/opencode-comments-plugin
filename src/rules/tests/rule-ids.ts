// Rule-id contract between this plugin and the `test-checker` binary.
//
// The binary is the source of truth: `binary-rule-ids.json` is generated from
// the test-checker README `## Rules` paragraph by
// `scripts/generate-rule-ids.mjs`. Every id in that table is enabled at `warn`
// by default, because the binary already applies its own confidence gate.
//
// The in-process regex fallback predates the binary and used different ids for
// several rules. The aliases below keep old `checks`/environment configs
// working: an old id maps to the binary id(s) that now express the same signal.
// Plugin-only ids (protected-paths, unknown-test, assertion-roulette,
// redundant-assertion, tests-not-run, negative-control-unrelated) have no
// binary counterpart and stay plugin-only.
import type { Severity } from "../../core/config"
import binaryRuleIds from "./binary-rule-ids.json"

export interface BinaryRuleIdTable {
  source: string
  ref: string
  rules: string[]
}

export const BINARY_RULE_ID_TABLE = binaryRuleIds as BinaryRuleIdTable
export const BINARY_RULE_IDS: readonly string[] = BINARY_RULE_ID_TABLE.rules

// Legacy regex id -> binary id(s) carrying the same signal, one line each:
// skip-focus-added -> skip-added, focus-added: the regex flagged `.skip` and `.only` together; the binary splits them.
// tautological-assertion -> tautological-assertion, constant-assertion: the regex's always-true check also covered literal-vs-literal comparisons.
// matcher-loosened -> weakened-assertion: a weaker matcher for the same assertion subject is the binary's diff-aware weakening rule.
// empty-test -> gutted-test: the regex only flagged an empty/trivial body, which the binary reports as an emptied (gutted) test; it did not flag executable bodies that merely lack an assertion.
// forced-success -> gate-weakened: forcing a command to pass weakens the test gate itself.
// expected-from-sut -> expected-copied-from-actual: an expectation produced by the code under test copies the actual value.
// weakened-config -> gate-weakened, harness-edited: the regex flagged gate bypasses (@ts-nocheck, --no-verify, ruff: noqa), coverage gates (fail_under=0 or lowered), and config files; it had no retry or numeric-tolerance pattern.
export const LEGACY_RULE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "skip-focus-added": ["skip-added", "focus-added"],
  "tautological-assertion": ["tautological-assertion", "constant-assertion"],
  "matcher-loosened": ["weakened-assertion"],
  "empty-test": ["gutted-test"],
  "forced-success": ["gate-weakened"],
  "expected-from-sut": ["expected-copied-from-actual"],
  "weakened-config": ["gate-weakened", "harness-edited"],
}

export const DEFAULT_RULE_SEVERITY: Severity = "warn"

export interface RuleSeverityResolution {
  severity: Severity
  // False only when the id is absent from the binary table, absent from the
  // aliases, and absent from the checks map. Callers may log that once.
  known: boolean
}

const KNOWN_RULE_IDS = new Set<string>([
  ...BINARY_RULE_IDS,
  ...Object.keys(LEGACY_RULE_ALIASES),
  ...Object.values(LEGACY_RULE_ALIASES).flat(),
])

// Exact key first, then a legacy alias key, then `warn`. Unknown binary ids are
// never disabled: the binary gate already decided they are worth reporting.
export function resolveRuleSeverity(
  checks: Record<string, Severity>,
  ruleId: string,
): RuleSeverityResolution {
  const exact = checks[ruleId]
  // An explicit key (including a plugin-only regex id) is known by definition;
  // `KNOWN_RULE_IDS` only describes the binary contract used for the warning.
  if (exact !== undefined) return { severity: exact, known: true }

  for (const [legacy, targets] of Object.entries(LEGACY_RULE_ALIASES)) {
    if (!targets.includes(ruleId)) continue
    const aliased = checks[legacy]
    if (aliased !== undefined) return { severity: aliased, known: true }
  }

  return { severity: DEFAULT_RULE_SEVERITY, known: KNOWN_RULE_IDS.has(ruleId) }
}
