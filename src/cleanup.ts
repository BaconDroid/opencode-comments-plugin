// On-demand cleanup pass over EXISTING test files. This module classifies the
// files, feeds the real `test-checker --strip` run a whole-file payload, and
// renders what the binary reports. The approval gate lives in the binary: only
// candidates covered by a committed `.test-checker.json` `remove` entry are
// rewritten. The plugin never edits a file itself and never relaxes the gate.
//
// Fail-open: a missing, stale or pre-`--strip` binary reports why nothing was
// rewritten instead of failing the command or throwing into the host.

import { tool } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { relative } from "node:path"
import { isSecretFile, listRepositoryFiles } from "./audit"
import { getTestCheckerPath } from "./cli"
import { COMMENT_CHECKER_EVENT } from "./constants"
import { detectLanguage, isSupportedLanguage } from "./core/diff"
import type { ResolvedTestGuard } from "./core/dispatch"
import { runProcess } from "./core/runner"
import { isTestPath } from "./rules/tests/patterns"
import type { HookInput } from "./types"

const CLEANUP_TIMEOUT_MS = 30_000

// The binary appends this summary to stderr for every `--strip` run. Its
// absence is how an older binary (unknown `--strip`) is detected.
const SUMMARY_MARKER = "[test-checker] cleanup pass:"
const REMOVED_LINE = /^\s+removed: (.+) \[([^\]]+)\]\s*$/
const KEPT_LINE = /^\s+kept awaiting approval: (.+) \[([^\]]+)\]\s*$/
const NOTE_LINE = /^\s+note: (.+)\s*$/
const APPROVAL_HINT = 'a "remove" entry'

export interface CleanupItem {
  name: string
  rule: string
}

export interface CleanupStderrSummary {
  removed: CleanupItem[]
  kept: CleanupItem[]
  note?: string
  // False when stderr carried no `[test-checker] cleanup pass:` summary, which
  // is the expected output of a binary that predates `--strip`.
  summary: boolean
}

export interface CleanupFileReport {
  filePath: string
  display: string
  removed: CleanupItem[]
  kept: CleanupItem[]
  summary: boolean
  note?: string
  error?: string
}

export interface CleanupReport {
  directory: string
  files: CleanupFileReport[]
  skipped: string[]
  binaryAvailable: boolean
  unsupported: boolean
  generatedAt: string
}

export type CleanupRun =
  | { kind: "output"; stderr: string; exitCode: number }
  | { kind: "did-not-run"; reason: string }

export interface CleanupDeps {
  run?: (input: HookInput, binaryPath: string, timeoutMs: number) => Promise<CleanupRun>
}

export interface CleanupOptions {
  directory: string
  // Empty means `DEFAULT_TEST_PATTERNS`; a resolved test guard passes its
  // configured `test_patterns` instead.
  testPatterns?: string[]
  paths?: string[]
  cliPath?: string
  timeoutMs?: number
}

export function parseCleanupSummary(stderr: string): CleanupStderrSummary {
  const removed: CleanupItem[] = []
  const kept: CleanupItem[] = []
  let note: string | undefined
  let summary = false

  for (const line of stderr.split("\n")) {
    if (line.includes(SUMMARY_MARKER)) {
      summary = true
      continue
    }
    const removedMatch = REMOVED_LINE.exec(line)
    if (removedMatch) {
      removed.push({ name: removedMatch[1]!.trim(), rule: removedMatch[2]!.trim() })
      continue
    }
    const keptMatch = KEPT_LINE.exec(line)
    if (keptMatch) {
      kept.push({ name: keptMatch[1]!.trim(), rule: keptMatch[2]!.trim() })
      continue
    }
    if (note === undefined) {
      const noteMatch = NOTE_LINE.exec(line)
      if (noteMatch) note = noteMatch[1]!.trim()
    }
  }

  return { removed, kept, ...(note ? { note } : {}), summary }
}

// Same payload shape as the live analyzer's `buildTestCheckerInput`: a whole
// file Write. The binary reads the file on disk as the source of truth.
function cleanupPayload(filePath: string, cwd: string, content: string): HookInput {
  return {
    session_id: "guard-cleanup",
    tool_name: "Write",
    transcript_path: "",
    cwd,
    hook_event_name: COMMENT_CHECKER_EVENT,
    is_test_file: true,
    tool_input: { file_path: filePath, content },
  }
}

async function defaultRun(input: HookInput, binaryPath: string, timeoutMs: number): Promise<CleanupRun> {
  if (!existsSync(binaryPath)) {
    return { kind: "did-not-run", reason: `binary not found at ${binaryPath}` }
  }

  const outcome = await runProcess([binaryPath, "--strip", "--min-confidence", "low"], {
    stdin: JSON.stringify(input),
    timeoutMs,
  })
  if (outcome === "timeout") {
    return { kind: "did-not-run", reason: "timed out or could not be spawned" }
  }
  if (outcome.exitCode !== 0 && outcome.exitCode !== 2) {
    const detail = outcome.stderr.trim().split("\n")[0]?.trim() ?? ""
    return { kind: "did-not-run", reason: `exited with code ${outcome.exitCode}${detail ? `: ${detail}` : ""}` }
  }
  return { kind: "output", stderr: outcome.stderr, exitCode: outcome.exitCode }
}

async function resolveBinary(cliPath: string | undefined): Promise<string | null> {
  if (cliPath) return cliPath
  const override = process.env.TC_BINARY?.trim()
  if (override) return override
  try {
    return await getTestCheckerPath()
  } catch {
    return null
  }
}

function display(filePath: string, directory: string): string {
  return relative(directory, filePath) || filePath
}

export async function collectCleanup(options: CleanupOptions, deps: CleanupDeps = {}): Promise<CleanupReport> {
  const directory = options.directory
  const testPatterns = options.testPatterns ?? []
  const run = deps.run ?? defaultRun

  const skipped: string[] = []
  const testFiles: string[] = []
  for (const filePath of listRepositoryFiles(directory, options.paths)) {
    if (isSecretFile(filePath)) {
      skipped.push(`${display(filePath, directory)} (secret file pattern)`)
      continue
    }
    const language = detectLanguage(filePath)
    if (!isSupportedLanguage(language)) continue
    if (!isTestPath(filePath, testPatterns)) continue
    testFiles.push(filePath)
  }

  const binaryPath = await resolveBinary(options.cliPath)
  if (!binaryPath) {
    return {
      directory,
      files: [],
      skipped,
      binaryAvailable: false,
      unsupported: false,
      generatedAt: new Date().toISOString(),
    }
  }

  const files: CleanupFileReport[] = []
  for (const filePath of testFiles) {
    let content: string
    try {
      content = readFileSync(filePath, "utf8")
    } catch {
      skipped.push(`${display(filePath, directory)} (unreadable)`)
      continue
    }

    const file: CleanupFileReport = {
      filePath,
      display: display(filePath, directory),
      removed: [],
      kept: [],
      summary: false,
    }
    const outcome = await run(
      cleanupPayload(filePath, directory, content),
      binaryPath,
      options.timeoutMs ?? CLEANUP_TIMEOUT_MS,
    )
    if (outcome.kind === "did-not-run") {
      file.error = outcome.reason
      files.push(file)
      continue
    }

    const parsed = parseCleanupSummary(outcome.stderr)
    file.removed = parsed.removed
    file.kept = parsed.kept
    file.summary = parsed.summary
    if (parsed.note) file.note = parsed.note
    files.push(file)
  }

  return {
    directory,
    files,
    skipped,
    binaryAvailable: true,
    unsupported: files.length > 0 && files.every(file => !file.summary && !file.error),
    generatedAt: new Date().toISOString(),
  }
}

export function renderCleanup(report: CleanupReport): string {
  const lines: string[] = []
  lines.push("# Test guard cleanup")
  lines.push("")
  lines.push(`Generated ${report.generatedAt}`)
  lines.push("")

  const removed = report.files.reduce((count, file) => count + file.removed.length, 0)
  const kept = report.files.reduce((count, file) => count + file.kept.length, 0)

  if (!report.binaryAvailable) {
    lines.push("No test-checker binary available; nothing was checked or rewritten.")
    appendSkipped(lines, report.skipped)
    return lines.join("\n")
  }

  if (report.files.length === 0) {
    lines.push("No test files found. Nothing to clean up.")
    appendSkipped(lines, report.skipped)
    return lines.join("\n")
  }

  if (report.unsupported) {
    lines.push(
      "test-checker did not report a cleanup pass for any test file. The binary may predate `--strip`; nothing was rewritten.",
    )
    lines.push("Upgrade test-checker to the version that added `--strip` and run the cleanup again.")
    appendSkipped(lines, report.skipped)
    return lines.join("\n")
  }

  lines.push(
    `Removed ${removed} test block(s); ${kept} kept awaiting approval across ${report.files.length} test file(s).`,
  )
  lines.push("")

  if (removed > 0) {
    lines.push(`## Removed (${removed})`)
    lines.push("")
    lines.push("| file | test | rule |")
    lines.push("|---|---|---|")
    for (const file of report.files) {
      for (const item of file.removed) {
        lines.push(`| ${escapeCell(file.display)} | ${escapeCell(item.name)} | ${item.rule} |`)
      }
    }
    lines.push("")
  }

  if (kept > 0) {
    lines.push(`## Kept awaiting approval (${kept})`)
    lines.push("")
    lines.push("| file | test | rule |")
    lines.push("|---|---|---|")
    for (const file of report.files) {
      for (const item of file.kept) {
        lines.push(`| ${escapeCell(file.display)} | ${escapeCell(item.name)} | ${item.rule} |`)
      }
    }
    lines.push("")
    lines.push(
      'Approve a removal with a "remove" entry (`{"glob","rules","reason"}`, reason at least 12 characters) in the git root\'s `.test-checker.json`, then run the cleanup again. The test-checker binary enforces the approval; the plugin never rewrites an unapproved candidate.',
    )
    lines.push("")
  }

  const notes = report.files.filter(file => file.note)
  if (notes.length > 0) {
    lines.push("## Notes")
    lines.push("")
    for (const file of notes) lines.push(`- \`${file.display}\`: ${file.note}`)
    lines.push("")
  }

  const errors = report.files.filter(file => file.error)
  if (errors.length > 0) {
    lines.push("## Files that could not be cleaned")
    lines.push("")
    for (const file of errors) lines.push(`- \`${file.display}\`: ${file.error}`)
    lines.push("")
  }

  const noSummary = report.files.filter(file => !file.summary && !file.error)
  if (noSummary.length > 0) {
    lines.push("## No cleanup summary")
    lines.push("")
    lines.push(
      "These files got no cleanup summary from the binary, which happens when it predates `--strip`. Nothing was rewritten.",
    )
    for (const file of noSummary) lines.push(`- \`${file.display}\``)
    lines.push("")
  }

  if (removed === 0 && kept === 0 && errors.length === 0 && noSummary.length === 0) {
    lines.push("No cleanup candidates. Nothing to clean up.")
  }

  appendSkipped(lines, report.skipped)
  return lines.join("\n")
}

function appendSkipped(lines: string[], skipped: string[]): void {
  if (skipped.length === 0) return
  lines.push("")
  lines.push("## Skipped")
  lines.push("")
  for (const entry of skipped) lines.push(`- ${entry}`)
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120)
}

export async function runCleanup(options: CleanupOptions, deps: CleanupDeps = {}): Promise<string> {
  return renderCleanup(await collectCleanup(options, deps))
}

export function createGuardCleanupTool(options: {
  directory: string
  getConfig: () => ResolvedTestGuard
  deps?: CleanupDeps
}) {
  return tool({
    description:
      "Run the test-checker cleanup pass over the repository's test files. Removes only candidates approved by a `remove` entry in `.test-checker.json` and reports the kept candidates awaiting approval. The binary owns the approval gate; the plugin never relaxes it.",
    args: {},
    execute: async () => {
      try {
        const config = (() => {
          try {
            return options.getConfig()
          } catch {
            return undefined
          }
        })()
        return await runCleanup(
          { directory: options.directory, testPatterns: config?.testPatterns ?? [] },
          options.deps,
        )
      } catch (err) {
        return `cleanup failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}

export const GUARD_CLEANUP_COMMAND = {
  template:
    "Use the guard_cleanup tool to run the test-checker cleanup pass. It removes only the candidates a human approved with a `remove` entry in .test-checker.json and reports the rest as kept awaiting approval. Report the removed and kept items.",
  description: "Remove test-checker cleanup candidates approved in .test-checker.json",
}
