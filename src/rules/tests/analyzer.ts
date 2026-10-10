// Adapter that exposes the deterministic test rules as an analyzer. Dispatch
// (the live hook), the audit and the CI check all evaluate a change through
// this single path instead of building a RuleContext and calling runTestRules
// themselves.

import type { Severity, TestEngine } from "../../core/config"
import type { Finding } from "../../core/feedback"
import type { Analyzer, AnalyzerContext, SyncAnalyzer, TestCheckerRunner } from "../../core/analyzer"
import { COMMENT_CHECKER_EVENT } from "../../constants"
import { stripComments, type ExtractedChange } from "../../core/diff"
import type { HookInput, TestCheckerFinding } from "../../types"
import { runTestChecker } from "../../cli"
import { isTestPath } from "./patterns"
import { runTestRules } from "./index"
import { collectBypasses } from "./content"

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
    // The plugin already classified the path; the binary honors this so custom
    // `test_patterns` cannot cause a false negative.
    is_test_file: true,
    tool_input: toolInput,
  }
}

// The excerpt shown to the user: the offending source line (comment-stripped,
// whitespace-collapsed), not the binary's human message. Falls back to the
// message when the line is 0, out of range or blank.
function excerptFromSource(change: ExtractedChange, line: number, fallback: string): string {
  if (line <= 0) return fallback
  const lines = change.newText.split("\n")
  if (line > lines.length) return fallback
  const stripped = stripComments(lines[line - 1] ?? "", change.language).replace(/\s+/g, " ").trim()
  return stripped.length > 0 ? stripped : fallback
}

function binaryToFindings(
  findings: TestCheckerFinding[],
  change: ExtractedChange,
  checks: Record<string, Severity>,
): Finding[] {
  return findings.map(finding => ({
    rule: finding.rule,
    filePath: change.filePath,
    line: finding.line,
    message: finding.message,
    severity: checks[finding.rule] ?? "off",
    excerpt: excerptFromSource(change, finding.line, finding.message),
  }))
}

// The test guard's default engine. For a test change it first asks the
// `test-checker` binary; a non-null result is authoritative. When the binary is
// unavailable or fails (`null`), it falls back to the in-process regex rules so
// detection still works offline. Non-test changes, deletes and empty-newText
// changes always use the regex rules (the binary would silently clear them).
export function createTestEngineAnalyzer(
  getConfig: () => TestEngineConfig,
  run: TestCheckerRunner = runTestChecker,
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
      const useBinary =
        (config.engine ?? "binary") === "binary" &&
        isTestFile &&
        !change.isDelete &&
        change.newText.trim().length > 0

      if (useBinary) {
        let binaryFindings: TestCheckerFinding[] | null = null
        try {
          binaryFindings = await run(buildTestCheckerInput(change, ctx))
        } catch {
          // Fail-open: an engine failure degrades to the regex fallback.
          binaryFindings = null
        }
        if (binaryFindings !== null) {
          return {
            findings: binaryToFindings(binaryFindings, change, config.checks),
            bypasses: collectBypasses(change),
          }
        }
      }

      return rules.analyze(ctx)
    },
  }
}
