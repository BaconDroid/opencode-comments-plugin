// Adapter that exposes the deterministic test rules as an analyzer. Dispatch
// (the live hook), the audit and the CI check all evaluate a change through
// this single path instead of building a RuleContext and calling runTestRules
// themselves.

import type { Severity, TestEngine } from "../../core/config"
import type { Finding } from "../../core/feedback"
import { createTestBinaryAnalyzer, type Analyzer, type AnalyzerContext, type SyncAnalyzer, type TestBinaryAnalyzer } from "../../core/analyzer"
import { COMMENT_CHECKER_EVENT } from "../../constants"
import type { ExtractedChange } from "../../core/diff"
import type { HookInput } from "../../types"
import { isTestPath } from "./patterns"
import { runTestRules } from "./index"

export interface RuleAnalyzerConfig {
  enabled: boolean
  testPatterns: string[]
  checks: Record<string, Severity>
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

export interface TestEngineConfig extends RuleAnalyzerConfig {
  // Detection engine: the downloaded binary (default) or the regex rules.
  engine?: TestEngine
}

// Reconstructs the hook payload the test-checker binary expects from an
// extracted change: a new file is a `Write`, anything else an `Edit`.
function buildTestCheckerInput(change: ExtractedChange, ctx: AnalyzerContext): HookInput {
  const toolInput: HookInput["tool_input"] = { file_path: change.filePath }
  let toolName: string
  if (change.isNew) {
    toolName = "Write"
    toolInput.content = change.newText
  } else {
    toolName = "Edit"
    toolInput.old_string = change.oldText
    toolInput.new_string = change.newText
  }
  return {
    session_id: ctx.sessionID,
    tool_name: toolName,
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: COMMENT_CHECKER_EVENT,
    tool_input: toolInput,
  }
}

// The test guard's default engine. For a test change it first asks the
// `test-checker` binary; a non-null result is authoritative. When the binary is
// unavailable or fails (`null`), it falls back to the in-process regex rules so
// detection still works offline. Non-test changes always use the regex rules.
export function createTestEngineAnalyzer(
  getConfig: () => TestEngineConfig,
  binary: TestBinaryAnalyzer = createTestBinaryAnalyzer(),
): Analyzer {
  const rules = createRuleAnalyzer(getConfig)
  return {
    id: "test-engine",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: async ctx => {
      const change = ctx.change
      if (!change) return {}
      const config = getConfig()
      const isTestFile = config.isTestFile ?? isTestPath(change.filePath, config.testPatterns)

      if ((config.engine ?? "binary") === "binary" && isTestFile) {
        const binaryFindings = await binary.analyze(buildTestCheckerInput(change, ctx))
        if (binaryFindings !== null) {
          return { findings: toFindings(binaryFindings, change.filePath, config.checks) }
        }
      }

      return rules.analyze(ctx)
    },
  }
}
