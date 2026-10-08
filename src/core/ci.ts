// CI parity: run the same test-guard engine over a git diff, for pre-merge use
// (`opencode-comments-plugin guard check --diff`).

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { extractChange, isSupportedLanguage, stripComments, type ExtractedChange, type Language } from "./diff"
import { formatFindings, type Finding } from "./feedback"
import { ASSERTION_COUNT_PATTERNS, DEFAULT_TEST_PATTERNS, isTestPath } from "../rules/tests/patterns"
import { buildRuleChecks, runTestRules } from "../rules/tests"
import type { RuleContext } from "../rules/tests/types"

function run(args: string[], cwd: string): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "ignore" })
  return { stdout: result.stdout.toString(), exitCode: result.exitCode }
}

function changedFiles(directory: string, base: string): string[] {
  const files = new Set<string>()
  const diff = run(["git", "diff", "--name-only", base], directory)
  if (diff.exitCode === 0) {
    for (const line of diff.stdout.split("\n")) if (line.trim()) files.add(line.trim())
  }
  const untracked = run(["git", "ls-files", "--others", "--exclude-standard"], directory)
  if (untracked.exitCode === 0) {
    for (const line of untracked.stdout.split("\n")) if (line.trim()) files.add(line.trim())
  }
  return [...files]
}

function readOldRevision(directory: string, base: string, relativePath: string): string {
  const result = run(["git", "show", `${base}:${relativePath}`], directory)
  return result.exitCode === 0 ? result.stdout : ""
}

function readWorktree(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : ""
  } catch {
    return undefined
  }
}

// Changed files that are test files in a supported language.
export function changedTestChanges(directory: string, base: string, testPatterns: string[]): ExtractedChange[] {
  return diffChanges(directory, base).filter(
    change => isSupportedLanguage(change.language) && isTestPath(change.filePath, testPatterns),
  )
}

export function diffChanges(directory: string, base: string): ExtractedChange[] {
  const changes: ExtractedChange[] = []
  for (const relativePath of changedFiles(directory, base)) {
    const absolute = isAbsolute(relativePath) ? relativePath : join(directory, relativePath)
    const newText = readWorktree(absolute)
    if (newText === undefined) continue
    const oldText = readOldRevision(directory, base, relativePath)
    if (oldText.length === 0 && newText.length === 0) continue
    changes.push(
      extractChange({
        filePath: absolute,
        oldText,
        newText,
        isNew: oldText.length === 0,
        isDelete: newText.length === 0,
      }),
    )
  }
  return changes
}

function assertionLines(lines: string[], language: Language): Set<string> {
  const set = new Set<string>()
  for (const line of lines) {
    const code = stripComments(line, language).trim()
    if (code.length > 0 && ASSERTION_COUNT_PATTERNS.some(pattern => pattern.test(code))) set.add(code)
  }
  return set
}

// Anti-FP (plan section 6): a test moved across files must not count as a
// deleted/gutted test. If every removed assertion reappears in another changed
// file, the finding is suppressed.
function isMovedTest(change: ExtractedChange, addedByFile: Map<string, Set<string>>): boolean {
  const removed = assertionLines(change.removedLines, change.language)
  if (removed.size === 0) return false
  const others = new Set<string>()
  for (const [path, added] of addedByFile) {
    if (path === change.filePath) continue
    for (const line of added) others.add(line)
  }
  for (const line of removed) if (!others.has(line)) return false
  return true
}

export interface DiffCheckOptions {
  directory: string
  base?: string
  testPatterns?: string[]
  includeAdvisory?: boolean
  format?: "markdown" | "json"
}

export interface DiffCheckResult {
  output: string
  findings: Finding[]
}

export function runDiffCheck(options: DiffCheckOptions): DiffCheckResult {
  const directory = options.directory
  const base = options.base ?? "HEAD"
  const testPatterns = options.testPatterns && options.testPatterns.length > 0 ? options.testPatterns : [...DEFAULT_TEST_PATTERNS]
  const checks = buildRuleChecks(options.includeAdvisory ?? false)

  const changes = changedTestChanges(directory, base, testPatterns)

  const addedByFile = new Map<string, Set<string>>()
  for (const change of changes) addedByFile.set(change.filePath, assertionLines(change.addedLines, change.language))

  const findings: Finding[] = []
  for (const change of changes) {
    const ctx: RuleContext = {
      change,
      isTestFile: true,
      config: { enabled: true, testPatterns, testCommand: null, checks, maxWarningsPerFile: 0 },
    }
    const result = runTestRules(ctx)
    for (const finding of result.findings) {
      if (finding.rule === "gutted-test" && isMovedTest(change, addedByFile)) {
        continue
      }
      findings.push({
        rule: finding.rule,
        filePath: relative(directory, change.filePath) || change.filePath,
        line: finding.line,
        message: finding.message,
        severity: checks[finding.rule] ?? "warn",
        excerpt: finding.excerpt,
      })
    }
  }

  if (options.format === "json") {
    return { findings, output: JSON.stringify({ findings }, null, 2) }
  }

  const header = `# Test guard check (${base})`
  const body = findings.length > 0 ? formatFindings(findings) : "No findings."
  return { findings, output: `${header}\n\n${body}` }
}
