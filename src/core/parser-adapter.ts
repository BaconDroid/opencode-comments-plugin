// Opt-in external parser adapter (AST-grade analysis without bundling a
// parser). The configured command receives the test diff as JSON on stdin and
// returns findings as JSON on stdout. Advisory, fail-open, disabled by default.

import { changedTestChanges } from "./ci"
import type { CommandAdapterConfig } from "./config"
import type { ExtractedChange } from "./diff"
import { parseAdvisoryFindings } from "./advisory-findings"
import { createAdvisoryTool, createIdleAdvisory, idleMessages, type IdleAdvisoryController } from "./idle-advisory"
import { parseJsonSlice, sliceBetween, tryParseJson } from "./json"
import { runShellCommand } from "./runner"

export type ParserAdapterConfig = CommandAdapterConfig

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
  const objectSlice = sliceBetween(raw, "{", "}")
  let parsed: unknown
  if (objectSlice !== undefined) {
    parsed = tryParseJson(objectSlice)
    if (parsed === undefined) return []
  } else {
    parsed = parseJsonSlice(raw, "[", "]")
    if (parsed === undefined) return []
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)
      ? ((parsed as { findings: unknown[] }).findings)
      : []

  return parseAdvisoryFindings(items, "message").map(finding => ({
    file: finding.file,
    line: finding.line,
    rule: typeof finding.record.rule === "string" ? finding.record.rule : "external-parser",
    message: finding.text,
    confidence: finding.confidence,
  }))
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
    ...idleMessages("External parser", "set test_guard.parser.enabled", "no findings"),
    isEnabled: () => options.getConfig().enabled,
    cooldownMs: options.cooldownMs,
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
