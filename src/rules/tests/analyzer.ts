// Adapter that exposes the deterministic test rules as an analyzer. Dispatch
// (the live hook), the audit and the CI check all evaluate a change through
// this single path instead of building a RuleContext and calling runTestRules
// themselves.

import type { Severity, TestEngine } from "../../core/config"
import type { Finding } from "../../core/feedback"
import type { Analyzer, AnalyzerContext, SyncAnalyzer, TestCheckerRunner } from "../../core/analyzer"
import { COMMENT_CHECKER_EVENT } from "../../constants"
import { createDebugLog } from "../../core/debug"
import { stripComments, type ExtractedChange } from "../../core/diff"
import type { HookInput, TestCheckerFinding, TestCheckerResult } from "../../types"
import { runTestChecker } from "../../cli"
import { isHarnessPath, isTestConfigPath, isTestFileForAnalysis, isTestPath } from "./patterns"
import { runTestRules } from "./index"
import { collectBypasses } from "./content"
import { resolveRuleSeverity } from "./rule-ids"

const debugLog = createDebugLog(
  "test-guard",
  process.env.TEST_GUARD_DEBUG === "1" || process.env.COMMENT_CHECKER_DEBUG === "1",
)

// Unknown ids are logged once per session per id, never once per finding.
const unknownRuleWarned = new Set<string>()

function severityFor(checks: Record<string, Severity>, ruleId: string, sessionID: string): Severity {
  const resolution = resolveRuleSeverity(checks, ruleId)
  if (!resolution.known) {
    const key = `${sessionID}\u0000${ruleId}`
    if (!unknownRuleWarned.has(key)) {
      unknownRuleWarned.add(key)
      debugLog(`unknown test-checker rule id "${ruleId}" — enabled at warn`)
    }
  }
  return resolution.severity
}

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
        isTestFile: config.isTestFile ?? isTestFileForAnalysis(change.filePath, config.testPatterns),
        config: {
          enabled: config.enabled,
          testPatterns: config.testPatterns,
          checks: config.checks,
          maxWarningsPerFile: 0,
        },
      })
      return {
        findings: toFindings(result.findings, change.filePath, config.checks, ctx.sessionID),
        bypasses: result.bypasses,
      }
    },
  }
}

function toFindings(
  findings: Array<{ rule: string; line: number; message: string; excerpt: string }>,
  filePath: string,
  checks: Record<string, Severity>,
  sessionID: string,
): Finding[] {
  return findings.map(finding => ({
    rule: finding.rule,
    filePath,
    line: finding.line,
    message: finding.message,
    severity: severityFor(checks, finding.rule, sessionID),
    excerpt: finding.excerpt,
  }))
}

export interface TestEngineConfig extends RuleAnalyzerConfig {
  // Detection engine: the downloaded binary (default) or the regex rules.
  engine?: TestEngine
}

// Reconstructs the hook payload the test-checker binary expects from an
// extracted change: a new file is a `Write`, anything else an `Edit`.
// `isTestFile` is the plugin's classification: harness/config paths are sent as
// non-test so the binary reaches its `harness-edited`/`gate-weakened` branch
// instead of the test-file analysis.
function buildTestCheckerInput(change: ExtractedChange, ctx: AnalyzerContext, isTestFile: boolean): HookInput {
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
    // `test_patterns` cannot cause a false negative. Harness paths are not test
    // files, and the binary only runs its harness rules when this is false.
    is_test_file: isTestFile,
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

// The test-checker's default gate is `medium`, so Low findings normally never
// reach the plugin. Filter them again here: if the gate is ever lowered (or a
// different binary emits Low), OpenCode must match Claude Code's default and
// keep Low telemetry out of the agent's context.
function isVisibleBinaryFinding(finding: TestCheckerFinding): boolean {
  return (finding.confidence ?? "").trim().toLowerCase() !== "low"
}

function binaryToFindings(
  findings: TestCheckerFinding[],
  change: ExtractedChange,
  checks: Record<string, Severity>,
  sessionID: string,
): Finding[] {
  return findings.filter(isVisibleBinaryFinding).map(finding => ({
    rule: finding.rule,
    filePath: change.filePath,
    line: finding.line,
    message: finding.message,
    severity: severityFor(checks, finding.rule, sessionID),
    excerpt: excerptFromSource(change, finding.line, finding.message),
    ...(finding.confidence ? { confidence: finding.confidence } : {}),
  }))
}

// The test guard's default engine. For a test change or a harness/config change
// it first asks the `test-checker` binary; its findings are authoritative. When
// the binary cannot run, the change still falls back to the in-process regex
// rules so detection works offline, and the result carries `didNotRun` so the
// guard can say the binary checked nothing. A `fallback` outcome (exit 2 with
// unparseable stderr) uses the regex rules silently, as before. Non-test,
// non-harness changes, deletes and empty-newText changes always use the regex
// rules (the binary would silently clear them).
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
      // Harness/config edits are not test files, but the binary has rules for
      // them that only run when it receives the change. Classification here wins
      // over `isTestFile` so a test-pattern match (e.g. `tests/conftest.py`)
      // cannot route a harness file down the test-file analysis path.
      const isHarnessFile = isHarnessPath(change.filePath)
      const isConfigFile = isTestConfigPath(change.filePath)
      const useBinary =
        (config.engine ?? "binary") === "binary" &&
        (isTestFile || isHarnessFile || isConfigFile) &&
        !change.isDelete &&
        change.newText.trim().length > 0

      if (useBinary) {
        const fallbackWithNotice = (reason: string) => {
          // The fallback still runs so detection works offline, but
          // `protected-paths` fires for every edit of an existing test file and
          // would bury the notice under a second, unrelated message. Suppress
          // it only for this change when the binary could not be used.
          const fallback = rules.analyze(ctx)
          return {
            ...fallback,
            findings: (fallback.findings ?? []).filter(finding => finding.rule !== "protected-paths"),
            didNotRun: reason,
            fallbackUsed: true,
          }
        }
        let outcome: TestCheckerResult | null = null
        try {
          outcome = await run(buildTestCheckerInput(change, ctx, isTestFile && !isHarnessFile && !isConfigFile))
        } catch {
          // Fail-open: an engine failure degrades to the regex fallback.
          outcome = null
        }
        if (outcome?.kind === "findings") {
          return {
            findings: binaryToFindings(outcome.findings, change, config.checks, ctx.sessionID),
            bypasses: collectBypasses(change),
          }
        }
        if (outcome?.kind === "did-not-run") return fallbackWithNotice(outcome.reason)
        if (outcome?.kind === "fallback") {
          return fallbackWithNotice("test-checker output could not be parsed; used the in-process regex rules")
        }
        return fallbackWithNotice("test-checker could not be run; used the in-process regex rules")
      }

      return rules.analyze(ctx)
    },
  }
}
