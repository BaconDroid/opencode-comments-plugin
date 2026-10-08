import { ADVISORY_RULES, DETERMINISTIC_RULES, collectBypasses, isFileDisabled, type Bypass } from "./content"
import type { RuleContext, RuleFinding, TestRule } from "./types"

export const ALL_TEST_RULES: TestRule[] = [...DETERMINISTIC_RULES, ...ADVISORY_RULES]

export interface RunResult {
  findings: RuleFinding[]
  bypassed: boolean
  bypasses: Bypass[]
}

// Fail-open: a broken rule is swallowed, never propagated.
export function runTestRules(ctx: RuleContext): RunResult {
  if (!ctx.isTestFile) return { findings: [], bypassed: false, bypasses: [] }
  if (isFileDisabled(ctx.change)) {
    return { findings: [], bypassed: true, bypasses: collectBypasses(ctx.change) }
  }

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
  return { findings, bypassed: false, bypasses: collectBypasses(ctx.change) }
}

export { isFileDisabled, collectBypasses } from "./content"
export type { Bypass } from "./content"
export type { RuleContext, RuleFinding, TestRule } from "./types"
