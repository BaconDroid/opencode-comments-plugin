// Adapter that exposes the deterministic test rules as an analyzer. Dispatch
// (the live hook), the audit and the CI check all evaluate a change through
// this single path instead of building a RuleContext and calling runTestRules
// themselves.

import type { Severity } from "../../core/config"
import type { Finding } from "../../core/feedback"
import type { SyncAnalyzer } from "../../core/analyzer"
import { isTestPath } from "./patterns"
import { runTestRules } from "./index"

export interface RuleAnalyzerConfig {
  enabled: boolean
  testPatterns: string[]
  checks: Record<string, Severity>
  testCommand?: string | null
  // Audit and CI already selected test files, so they force `isTestFile` true.
  // When unset, the path is matched against `testPatterns`.
  isTestFile?: boolean
}

// Produces the findings (with their configured severity) and bypasses for one
// change. Consumers keep ownership of the budget, severity overrides, grouping
// and rendering.
export function createRuleAnalyzer(getConfig: () => RuleAnalyzerConfig): SyncAnalyzer {
  return {
    id: "test-rules",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: ctx => {
      const change = ctx.change
      if (!change) return {}
      const config = getConfig()
      const result = runTestRules({
        change,
        isTestFile: config.isTestFile ?? isTestPath(change.filePath, config.testPatterns),
        config: {
          enabled: config.enabled,
          testPatterns: config.testPatterns,
          testCommand: config.testCommand ?? null,
          checks: config.checks,
          maxWarningsPerFile: 0,
        },
      })
      return { findings: toFindings(result.findings, change.filePath, config.checks), bypasses: result.bypasses }
    },
  }
}

function toFindings(
  findings: Array<{ rule: string; line: number; message: string; excerpt: string }>,
  filePath: string,
  checks: Record<string, Severity>,
): Finding[] {
  return findings.map(finding => ({
    rule: finding.rule,
    filePath,
    line: finding.line,
    message: finding.message,
    severity: checks[finding.rule] ?? "off",
    excerpt: finding.excerpt,
  }))
}
