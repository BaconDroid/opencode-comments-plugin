// Opt-in LLM judge (plan phase 2B). It consumes the model already configured
// in opencode (no provider/auth handling here) through a sandboxed session.
// Advisory only, fail-open, never blocks.

import { tool } from "@opencode-ai/plugin"
import { diffChanges } from "./ci"
import { isSupportedLanguage, type ExtractedChange } from "./diff"
import { PLACEHOLDER_PATTERN, isTestPath } from "../rules/tests/patterns"

export interface JudgeConfig {
  enabled: boolean
  model?: string
  timeoutMs?: number
}

export interface JudgeFinding {
  file: string
  line: number
  reason: string
  confidence: string
}

export type JudgeRunner = (prompt: string, model?: string) => Promise<string>

const JUDGE_SYSTEM =
  "You are a read-only test-quality reviewer. Do not call any tool. Reply with JSON only."

const MAX_FINDINGS = 20

export function buildJudgePrompt(changes: ExtractedChange[]): string {
  const sections: string[] = []
  for (const change of changes) {
    if (change.addedLines.length === 0 && change.removedLines.length === 0) continue
    const removed = change.removedLines.map(line => `- ${line}`).join("\n")
    const added = change.addedLines.map(line => `+ ${line}`).join("\n")
    sections.push(`--- ${change.filePath}\n${removed}\n${added}`)
  }
  if (sections.length === 0) return ""

  return [
    "Review the following test changes and decide whether any of them weakens the tests",
    "(removed assertions, loosened matchers, skipped/focused tests, tautological assertions,",
    "swallowed errors, or tests that no longer validate behavior).",
    "Reply with ONLY a JSON array. Each item:",
    '{"file": "<path>", "line": <number>, "reason": "<short>", "confidence": "high|medium|low"}.',
    "If nothing weakens the tests, reply with [].",
    "",
    sections.join("\n\n"),
  ].join("\n")
}

export function parseJudgeResponse(raw: string): JudgeFinding[] {
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start < 0 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const findings: JudgeFinding[] = []
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const file = typeof record.file === "string" ? record.file : ""
    const reason = typeof record.reason === "string" ? record.reason.trim() : ""
    if (!file || !reason) continue
    if (PLACEHOLDER_PATTERN.test(reason)) continue
    findings.push({
      file,
      line: typeof record.line === "number" && Number.isFinite(record.line) ? record.line : 0,
      reason,
      confidence: typeof record.confidence === "string" ? record.confidence : "medium",
    })
    if (findings.length >= MAX_FINDINGS) break
  }
  return findings
}

export function formatJudgeFindings(findings: JudgeFinding[]): string {
  const lines = findings.map(finding => `- ${finding.file}:${finding.line} ${finding.reason} (${finding.confidence})`)
  return `LLM judge (advisory, opt-in):\n${lines.join("\n")}`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("judge timeout")), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function runJudge(changes: ExtractedChange[], config: JudgeConfig, runner: JudgeRunner): Promise<JudgeFinding[]> {
  if (!config.enabled) return []
  const prompt = buildJudgePrompt(changes)
  if (prompt.length === 0) return []

  try {
    const raw = await withTimeout(runner(prompt, config.model), config.timeoutMs ?? 30_000)
    return parseJudgeResponse(raw)
  } catch {
    return []
  }
}

function parseModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) return undefined
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}

interface SessionLike {
  create?: (options: unknown) => Promise<{ data?: { id?: string } }>
  prompt?: (options: unknown) => Promise<{ data?: { parts?: Array<{ type?: string; text?: string }> } }>
  delete?: (options: unknown) => Promise<unknown>
}

// Builds a JudgeRunner backed by the opencode SDK client. The client is typed
// loosely and every step is fail-open: any missing method or error yields "".
export function createModelJudgeRunner(client: unknown, directory: string): JudgeRunner {
  const session = (client as { session?: SessionLike } | undefined)?.session

  return async (prompt, model) => {
    if (!session?.create || !session?.prompt) return ""
    const modelRef = parseModel(model)

    try {
      const created = await session.create({ body: { title: "test-guard judge" }, query: { directory } })
      const id = created?.data?.id
      if (!id) return ""
      try {
        const result = await session.prompt({
          path: { id },
          query: { directory },
          body: {
            system: JUDGE_SYSTEM,
            tools: { bash: false, edit: false, write: false, read: false, webfetch: false, patch: false, task: false },
            ...(modelRef ? { model: modelRef } : {}),
            parts: [{ type: "text", text: prompt }],
          },
        })
        const parts = result?.data?.parts ?? []
        return parts
          .filter(part => part.type === "text" && typeof part.text === "string")
          .map(part => part.text!)
          .join("\n")
      } finally {
        try {
          await session.delete?.({ path: { id }, query: { directory } })
        } catch {
          // deleting the sandbox session is best-effort
        }
      }
    } catch {
      return ""
    }
  }
}

export interface JudgeController {
  onIdle(sessionID: string): Promise<string | null>
  judgeNow(): Promise<string>
}

export function createJudge(options: {
  directory: string
  getConfig: () => JudgeConfig
  getTestPatterns: () => string[]
  runner: JudgeRunner
  cooldownMs?: number
}): JudgeController {
  const cooldownMs = options.cooldownMs ?? 60_000
  const lastRun = new Map<string, number>()

  function collectTestChanges(): ExtractedChange[] {
    const patterns = options.getTestPatterns()
    return diffChanges(options.directory, "HEAD").filter(
      change => isSupportedLanguage(change.language) && isTestPath(change.filePath, patterns),
    )
  }

  async function judge(): Promise<string | null> {
    const findings = await runJudge(collectTestChanges(), options.getConfig(), options.runner)
    return findings.length > 0 ? formatJudgeFindings(findings) : null
  }

  return {
    async onIdle(sessionID) {
      try {
        if (!options.getConfig().enabled) return null
        const now = Date.now()
        if (now - (lastRun.get(sessionID) ?? 0) < cooldownMs) return null
        lastRun.set(sessionID, now)
        return await judge()
      } catch {
        return null
      }
    },
    async judgeNow() {
      try {
        if (!options.getConfig().enabled) return "LLM judge: disabled (set test_guard.judge.enabled)."
        return (await judge()) ?? "LLM judge: no findings."
      } catch {
        return "LLM judge: unavailable."
      }
    },
  }
}

export function createGuardJudgeTool(judge: JudgeController) {
  return tool({
    description:
      "Run the opt-in LLM judge over the current test diff. Read-only and advisory; requires test_guard.judge.enabled.",
    args: {},
    async execute() {
      return judge.judgeNow()
    },
  })
}
