import type { Severity } from "../../core/config"
import { ADVISORY_RULES, DETERMINISTIC_RULES, findTestBlocks, testBypass, type Bypass } from "./content"
import { BINARY_RULE_IDS } from "./rule-ids"
import type { RuleContext, RuleFinding, TestRule } from "./types"

export const ALL_TEST_RULES: TestRule[] = [...DETERMINISTIC_RULES, ...ADVISORY_RULES]

// Severity map used by the audit and CI paths: deterministic rules warn,
// advisory rules are off unless explicitly requested.
//
// The test-checker binary is the source of truth for the ids it can emit, so
// every id from its generated contract is enabled at `warn`. The binary applies
// its own confidence gate before emitting a finding; filtering by an id the
// plugin did not know about would silently drop real findings. Overlaying the
// binary ids also makes shared rules that are advisory in the regex engine
// (e.g. `over-mocking`) warn, matching the binary's default behavior.
export function buildRuleChecks(includeAdvisory: boolean): Record<string, Severity> {
  const checks: Record<string, Severity> = {}
  for (const rule of DETERMINISTIC_RULES) checks[rule.id] = "warn"
  for (const rule of ADVISORY_RULES) checks[rule.id] = includeAdvisory ? "warn" : "off"
  for (const id of BINARY_RULE_IDS) checks[id] = "warn"
  return checks
}

export interface RunResult {
  findings: RuleFinding[]
  bypassed: boolean
  bypasses: Bypass[]
}

// Fail-open: a broken rule is swallowed, never propagated.
export function runTestRules(ctx: RuleContext): RunResult {
  if (!ctx.isTestFile) return { findings: [], bypassed: false, bypasses: [] }
  const bypass = testBypass(ctx.change.newText)
  if (bypass.fileDisabled) {
    return { findings: [], bypassed: true, bypasses: bypass.notes }
  }
  ctx.bypass = bypass

  // Parse the whole-file test bodies once instead of once per body rule.
  if (!ctx.blocks) ctx.blocks = findTestBlocks(ctx.change.newText, ctx.change.language)

  const findings: RuleFinding[] = []
  for (const rule of ALL_TEST_RULES) {
    const level = ctx.config.checks[rule.id] ?? "off"
    if (level === "off") continue
    try {
      findings.push(...rule.run(ctx))
    } catch {
      // Fail-open on purpose: a rule error must never block the agent.
    }
  }
  return { findings, bypassed: false, bypasses: bypass.notes }
}
