// On-demand, read-only audit of EXISTING comments and tests. The agent runs it
// itself (custom tool `guard_audit`) to get a cleanup plan, then applies edits.
//
// Guardrails (plan section 8): read-only, report first, fail-open, never log
// file content.

import { tool } from "@opencode-ai/plugin"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { getCommentCheckerPath, runCommentChecker } from "./cli"
import { COMMENT_CHECKER_EVENT } from "./constants"
import { detectLanguage, extractChange, isSupportedLanguage, type Language } from "./core/diff"
import type { ResolvedTestGuard } from "./core/dispatch"
import { ALL_TEST_RULES, runTestRules } from "./rules/tests"
import { findCrossFileDuplicates } from "./rules/tests/content"
import { PLACEHOLDER_PATTERN, isTestPath } from "./rules/tests/patterns"
import type { RuleContext, RuleFinding } from "./rules/tests/types"

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".cache", "coverage"])
const SECRET_PATTERNS = [/(?:^|\/)\.env(?:\.|$)/, /\.pem$/, /\.key$/, /(?:^|\/)id_(?:rsa|ed25519)$/, /\.p12$/]
const MAX_FILES = 500

export interface AuditFile {
  filePath: string
  display: string
  language: Language
}

export interface CommentFinding {
  filePath: string
  line: number
  action: "remove" | "adjust" | "keep"
  confidence: "high" | "medium" | "low"
  text: string
}

export interface TestAuditFinding extends CommentFinding {
  rule: string
}

export interface AuditReport {
  scope: string
  comments: CommentFinding[]
  tests: TestAuditFinding[]
  skipped: string[]
  generatedAt: string
  testCommand?: string | null
}

function isSecretFile(filePath: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(filePath))
}

function walk(dir: string, out: string[], limit: number): void {
  if (out.length >= limit) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    if (entry.startsWith(".") && entry !== ".env.example") continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue
      walk(full, out, limit)
    } else if (stat.isFile()) {
      out.push(full)
    }
  }
}

export function listRepositoryFiles(directory: string, paths: string[] | undefined): string[] {
  const collected: string[] = []
  if (paths && paths.length > 0) {
    for (const entry of paths) {
      const abs = isAbsolute(entry) ? entry : join(directory, entry)
      try {
        const stat = statSync(abs)
        if (stat.isDirectory()) walk(abs, collected, MAX_FILES)
        else if (stat.isFile()) collected.push(abs)
      } catch {
        // missing path is reported as skipped by the caller
      }
    }
    return collected.slice(0, MAX_FILES)
  }

  try {
    const result = Bun.spawnSync(["git", "ls-files"], { cwd: directory, stdout: "pipe", stderr: "ignore" })
    if (result.exitCode === 0) {
      return result.stdout
        .toString()
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => join(directory, line))
        .slice(0, MAX_FILES)
    }
  } catch {
    // fall through to directory walk
  }

  walk(directory, collected, MAX_FILES)
  return collected
}

const COMMENT_LINE_NUMBER = /<comment\s+line-number="(\d+)"[^>]*>([\s\S]*?)<\/comment>/g
const COMMENT_TEXT_NUMBER = /<comment\s+[^>]*?number="(\d+)"[^>]*>([\s\S]*?)<\/comment>/g

export function parseCommentsXml(xml: string): Array<{ line: number; text: string }> {
  const comments: Array<{ line: number; text: string }> = []
  for (const regex of [COMMENT_LINE_NUMBER, COMMENT_TEXT_NUMBER]) {
    let match: RegExpExecArray | null
    const re = new RegExp(regex.source, "g")
    while ((match = re.exec(xml)) !== null) {
      comments.push({ line: Number(match[1]), text: decodeXml(match[2]!).trim() })
    }
    if (comments.length > 0) break
  }
  return comments
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

const REMOVE_COMMENT_PATTERNS: RegExp[] = [
  /^\s*(?:\/\/|#|\*|--)\s*[a-z_$][\w$]*\s*\(/i,
  /\b(?:changed|updated|added|removed|refactored|now|temporarily|for now)\b/i,
  /^(?:note|todo|fixme|hack|xxx)\b/i,
  /^(?:increment|initialize|set|get|declare|loop|call|check|create)\b/i,
]

const WHY_COMMENT_PATTERNS: RegExp[] = [
  /\b(?:because|why|workaround|bug|security|performance|regex|math|business|legacy|backward|compat|intentional|race|lock|retry)\b/i,
]

export function classifyComment(text: string): { action: CommentFinding["action"]; confidence: CommentFinding["confidence"] } {
  if (text.trim().length === 0) return { action: "remove", confidence: "high" }
  if (REMOVE_COMMENT_PATTERNS.some(pattern => pattern.test(text))) return { action: "remove", confidence: "high" }
  if (WHY_COMMENT_PATTERNS.some(pattern => pattern.test(text))) return { action: "adjust", confidence: "medium" }
  return { action: "remove", confidence: "low" }
}

const TEST_ACTION: Record<string, CommentFinding["action"]> = {
  "empty-test": "remove",
  "unknown-test": "remove",
  "tautological-assertion": "remove",
  "duplicate-test": "remove",
  "skip-focus-added": "remove",
  "matcher-loosened": "adjust",
  "net-assertion-loss": "adjust",
  "gutted-test": "adjust",
  "swallowed-error": "adjust",
  "over-mocking": "adjust",
  "assertion-roulette": "adjust",
  "weakened-config": "adjust",
}

const TEST_CONFIDENCE: Record<string, CommentFinding["confidence"]> = {
  "empty-test": "high",
  "unknown-test": "high",
  "tautological-assertion": "high",
  "duplicate-test": "high",
  "skip-focus-added": "high",
  "over-mocking": "low",
  "assertion-roulette": "low",
}

function validExcerpt(text: string): boolean {
  return text.trim().length > 0 && !PLACEHOLDER_PATTERN.test(text.trim())
}

export function auditTestFile(file: AuditFile, includeAdvisory: boolean): TestAuditFinding[] {
  const content = readText(file.filePath)
  if (content === undefined) return []
  const change = extractChange({
    filePath: file.filePath,
    oldText: "",
    newText: content,
    isNew: true,
    isDelete: false,
  })

  const checks: Record<string, "warn" | "off"> = {}
  for (const rule of ALL_TEST_RULES) {
    const advisory =
      rule.id === "over-mocking" ||
      rule.id === "assertion-roulette" ||
      rule.id === "weakened-config" ||
      rule.id === "redundant-assertion" ||
      rule.id === "tests-not-run"
    checks[rule.id] = advisory && !includeAdvisory ? "off" : "warn"
  }

  const ctx: RuleContext = {
    change,
    isTestFile: true,
    config: { enabled: true, testPatterns: [], testCommand: null, checks, maxWarningsPerFile: 0 },
  }

  const result = runTestRules(ctx)
  const findings: TestAuditFinding[] = []
  for (const finding of result.findings) {
    if (!validExcerpt(finding.excerpt)) continue
    findings.push({
      filePath: file.filePath,
      line: finding.line,
      rule: finding.rule,
      action: TEST_ACTION[finding.rule] ?? "keep",
      confidence: TEST_CONFIDENCE[finding.rule] ?? "medium",
      text: finding.excerpt,
    })
  }
  return findings
}

function readText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return undefined
  }
}

export interface CommentAuditDeps {
  runCheck?: (filePath: string, content: string) => Promise<Array<{ line: number; text: string }>>
}

async function defaultRunCheck(filePath: string, content: string): Promise<Array<{ line: number; text: string }>> {
  const cliPath = await getCommentCheckerPath()
  if (!cliPath) return []
  const result = await runCommentChecker({
    session_id: "guard-audit",
    tool_name: "Write",
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: COMMENT_CHECKER_EVENT,
    tool_input: { file_path: filePath, content },
  })
  if (!result.hasComments) return []
  return parseCommentsXml(result.message)
}

export async function auditComments(file: AuditFile, deps: CommentAuditDeps = {}): Promise<CommentFinding[]> {
  const content = readText(file.filePath)
  if (content === undefined) return []
  const runCheck = deps.runCheck ?? defaultRunCheck
  let raw: Array<{ line: number; text: string }> = []
  try {
    raw = await runCheck(file.filePath, content)
  } catch {
    return []
  }
  const findings: CommentFinding[] = []
  for (const comment of raw) {
    if (!validExcerpt(comment.text)) continue
    const { action, confidence } = classifyComment(comment.text)
    findings.push({ filePath: file.filePath, line: comment.line, action, confidence, text: comment.text })
  }
  return findings
}

export function renderAudit(report: AuditReport, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2)

  const lines: string[] = []
  lines.push("# Test guard audit")
  lines.push("")
  lines.push(`Scope: ${report.scope} — generated ${report.generatedAt}`)
  if (report.testCommand) lines.push(`Test command: \`${report.testCommand}\``)
  lines.push("")

  if (report.comments.length > 0) {
    lines.push(`## Comments (${report.comments.length})`)
    lines.push("")
    lines.push("| file:line | action | confidence | excerpt |")
    lines.push("|---|---|---|---|")
    for (const finding of report.comments) {
      lines.push(`| ${display(finding.filePath)}:${finding.line} | ${finding.action} | ${finding.confidence} | ${escapeCell(finding.text)} |`)
    }
    lines.push("")
  }

  if (report.tests.length > 0) {
    lines.push(`## Tests (${report.tests.length})`)
    lines.push("")
    lines.push("| file:line | rule | action | confidence | excerpt |")
    lines.push("|---|---|---|---|---|")
    for (const finding of report.tests) {
      lines.push(
        `| ${display(finding.filePath)}:${finding.line} | ${finding.rule} | ${finding.action} | ${finding.confidence} | ${escapeCell(finding.text)} |`,
      )
    }
    lines.push("")
  }

  if (report.skipped.length > 0) {
    lines.push("## Skipped")
    lines.push("")
    for (const skipped of report.skipped) lines.push(`- ${skipped}`)
    lines.push("")
  }

  if (report.comments.length === 0 && report.tests.length === 0) {
    lines.push("No findings. Nothing to clean up.")
  }

  return lines.join("\n")
}

function display(filePath: string): string {
  return relative(process.cwd(), filePath) || filePath
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120)
}

export interface AuditRunOptions {
  scope: "comments" | "tests" | "both"
  paths?: string[]
  format?: "markdown" | "json"
  includeAdvisory?: boolean
  directory: string
  getConfig: () => ResolvedTestGuard
}

export async function runAudit(options: AuditRunOptions, deps: CommentAuditDeps = {}): Promise<string> {
  const scope = options.scope ?? "both"
  const format = options.format ?? "markdown"
  const includeAdvisory = options.includeAdvisory ?? false
  const config = (() => {
    try {
      return options.getConfig()
    } catch {
      return undefined
    }
  })()

  const testPatterns = config?.testPatterns ?? []
  const skipped: string[] = []
  const files = listRepositoryFiles(options.directory, options.paths)

  const audited: AuditFile[] = []
  for (const filePath of files) {
    if (isSecretFile(filePath)) {
      skipped.push(`${display(filePath)} (secret file pattern)`)
      continue
    }
    const language = detectLanguage(filePath)
    if (!isSupportedLanguage(language)) continue
    if (scope !== "comments" && !isTestPath(filePath, testPatterns)) continue
    audited.push({ filePath, display: display(filePath), language })
  }

  const comments: CommentFinding[] = []
  const tests: TestAuditFinding[] = []

  for (const file of audited) {
    try {
      if (scope === "comments" || scope === "both") {
        comments.push(...(await auditComments(file, deps)))
      }
      if (scope === "tests" || scope === "both") {
        tests.push(...auditTestFile(file, includeAdvisory))
      }
    } catch {
      skipped.push(`${file.display} (unparsable)`)
    }
  }

  // Cross-file duplicates need the whole file set, so they are added after the
  // per-file pass (the live hook cannot see other files).
  if (scope === "tests" || scope === "both") {
    const fileTexts = audited
      .filter(file => isTestPath(file.filePath, testPatterns))
      .map(file => ({ filePath: file.filePath, text: readText(file.filePath) ?? "", language: file.language }))
      .filter(entry => entry.text.length > 0)
    for (const duplicate of findCrossFileDuplicates(fileTexts)) {
      if (!validExcerpt(duplicate.excerpt)) continue
      tests.push({
        filePath: duplicate.filePath,
        line: duplicate.line,
        rule: "duplicate-test",
        action: "remove",
        confidence: "high",
        text: `${duplicate.excerpt} (duplicate of ${display(duplicate.otherFilePath)}:${duplicate.otherLine})`,
      })
    }
  }

  return renderAudit(
    { scope, comments, tests, skipped, generatedAt: new Date().toISOString(), testCommand: config?.testCommand ?? null },
    format,
  )
}

// The tool closes over the plugin directory and resolved config.
export function createGuardAuditTool(options: {
  directory: string
  getConfig: () => ResolvedTestGuard
  deps?: CommentAuditDeps
}) {
  return tool({
    description:
      "Read-only audit of existing comments and tests. Produces a cleanup plan (markdown or json) that the agent applies afterwards. Never modifies files.",
    args: {
      scope: tool.schema.enum(["comments", "tests", "both"]).optional(),
      paths: tool.schema.array(tool.schema.string()).optional(),
      format: tool.schema.enum(["markdown", "json"]).optional(),
      include_advisory: tool.schema.boolean().optional(),
    },
    async execute(args) {
      return runAudit(
        {
          scope: args.scope ?? "both",
          paths: args.paths,
          format: args.format,
          includeAdvisory: args.include_advisory,
          directory: options.directory,
          getConfig: options.getConfig,
        },
        options.deps,
      )
    },
  })
}

export const GUARD_AUDIT_COMMAND = {
  template:
    "Use the guard_audit tool to audit the current repository's existing comments and tests, then apply the cleanup plan it returns. Report what you changed.",
  description: "Audit existing comments and tests and produce a cleanup plan",
}
