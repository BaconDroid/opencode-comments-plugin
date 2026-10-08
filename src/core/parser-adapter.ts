// Opt-in external parser adapter (AST-grade analysis without bundling a
// parser). The configured command receives the test diff as JSON on stdin and
// returns findings as JSON on stdout. Advisory, fail-open, disabled by default.

import { changedTestChanges } from "./ci"
import type { ExtractedChange } from "./diff"
import { createAdvisoryTool, createIdleAdvisory, type IdleAdvisoryController } from "./idle-advisory"
import { PLACEHOLDER_PATTERN } from "../rules/tests/patterns"
import { runShellCommand } from "./runner"

export interface ParserAdapterConfig {
  enabled: boolean
  command?: string
  timeoutMs?: number
}

export interface ParserPayloadFile {
  path: string
  language: string
  added: string[]
  removed: string[]
}

export interface ParserFinding {
  file: string
  line: number
  rule: string
  message: string
  confidence: string
}

export type ParserRun = (command: string, payload: string, timeoutMs: number) => Promise<string>

const MAX_FINDINGS = 20

export function buildParserPayload(changes: ExtractedChange[]): string {
  const files: ParserPayloadFile[] = []
  for (const change of changes) {
    if (change.addedLines.length === 0 && change.removedLines.length === 0) continue
    files.push({
      path: change.filePath,
      language: change.language,
      added: change.addedLines,
      removed: change.removedLines,
    })
  }
  return JSON.stringify({ files })
}

export function parseParserFindings(raw: string): ParserFinding[] {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  let parsed: unknown
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return []
    }
  } else {
    const arrayStart = raw.indexOf("[")
    const arrayEnd = raw.lastIndexOf("]")
    if (arrayStart < 0 || arrayEnd <= arrayStart) return []
    try {
      parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1))
    } catch {
      return []
    }
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)
      ? ((parsed as { findings: unknown[] }).findings)
      : []

  const findings: ParserFinding[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const file = typeof record.file === "string" ? record.file : ""
    const message = typeof record.message === "string" ? record.message.trim() : ""
    if (!file || !message) continue
    if (PLACEHOLDER_PATTERN.test(message)) continue
    findings.push({
      file,
      line: typeof record.line === "number" && Number.isFinite(record.line) ? record.line : 0,
      rule: typeof record.rule === "string" ? record.rule : "external-parser",
      message,
      confidence: typeof record.confidence === "string" ? record.confidence : "medium",
    })
    if (findings.length >= MAX_FINDINGS) break
  }
  return findings
}

export function formatParserFindings(findings: ParserFinding[]): string {
  const lines = findings.map(finding => `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.message} (${finding.confidence})`)
  return `External parser (advisory, opt-in):\n${lines.join("\n")}`
}

async function defaultRun(command: string, payload: string, timeoutMs: number): Promise<string> {
  const outcome = await runShellCommand(command, { stdin: payload, timeoutMs })
  return outcome === "timeout" ? "" : outcome.stdout
}

export async function runParserAdapter(
  changes: ExtractedChange[],
  config: ParserAdapterConfig,
  run: ParserRun = defaultRun,
): Promise<ParserFinding[]> {
  if (!config.enabled || !config.command) return []
  const payload = buildParserPayload(changes)
  if (payload === JSON.stringify({ files: [] })) return []

  try {
    const raw = await run(config.command, payload, config.timeoutMs ?? 30_000)
    return parseParserFindings(raw)
  } catch {
    return []
  }
}

export type ParserAdapterController = IdleAdvisoryController

export function createParserAdapter(options: {
  directory: string
  getConfig: () => ParserAdapterConfig
  getTestPatterns: () => string[]
  run?: ParserRun
  cooldownMs?: number
}): ParserAdapterController {
  return createIdleAdvisory({
    isEnabled: () => options.getConfig().enabled,
    cooldownMs: options.cooldownMs,
    disabledMessage: "External parser: disabled (set test_guard.parser.enabled).",
    unavailableMessage: "External parser: unavailable.",
    emptyMessage: "External parser: no findings.",
    analyze: async () => {
      const changes = changedTestChanges(options.directory, "HEAD", options.getTestPatterns())
      const findings = await runParserAdapter(changes, options.getConfig(), options.run)
      return findings.length > 0 ? formatParserFindings(findings) : null
    },
  })
}

export function createGuardParseTool(controller: ParserAdapterController) {
  return createAdvisoryTool(
    "Run the opt-in external parser adapter over the current test diff. Read-only and advisory; requires test_guard.parser.enabled.",
    controller,
  )
}
