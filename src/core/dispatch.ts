// Test-guard orchestration: config-driven rule dispatch shared by the
// `tool.execute.before` (block) and `tool.execute.after` (warn) hooks.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { APPLY_PATCH_TOOL_NAME, DEFAULT_TRIGGER_TOOLS } from "../constants"
import { AnalyzerRegistry, type Analyzer } from "./analyzer"
import { GuardBudget } from "./budget"
import type { Bypass } from "./bypass"
import type { Severity } from "./config"
import { extractPatchChanges, extractToolChange, firstString, readPreimage, type ExtractedChange } from "./diff"
import { appendFeedback, renderFeedback, type Finding } from "./feedback"
import { isTestPath } from "../rules/tests/patterns"
import { runTestRules } from "../rules/tests"

const DEBUG = process.env.TEST_GUARD_DEBUG === "1" || process.env.COMMENT_CHECKER_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [test-guard] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  process.stderr.write(msg)
}

export interface ResolvedTestGuard {
  enabled: boolean
  testPatterns: string[]
  testCommand?: string | null
  checks: Record<string, Severity>
  maxWarningsPerFile: number
  dedupWindowMs?: number
  customPrompt?: string
  appendPrompt?: string
  triggerTools?: Set<string>
}

// Mirrors `comment_checker.tools`: which tools may produce test-guard findings.
// Omitted, the guard reacts to every supported tool (legacy behavior).
const DEFAULT_TEST_TRIGGER_TOOLS = new Set(DEFAULT_TRIGGER_TOOLS)

interface BeforeInput {
  tool: string
  sessionID: string
  callID: string
}

interface AfterOutput {
  title: string
  output: string
  metadata: unknown
}

interface PendingGuardCall {
  args: Record<string, unknown>
  preimage?: string
  timestamp: number
}

// Parity with the comment guard: an abandoned `before` (no matching `after`)
// must not leak forever.
const PENDING_CALL_TTL = 60_000

const DEFAULT_TEST_GUARD: ResolvedTestGuard = {
  enabled: true,
  testPatterns: [],
  checks: {},
  maxWarningsPerFile: 0,
}

// Minimal shape of the `permission.ask` hook payload we consume.
export interface PermissionLike {
  type: string
  pattern?: string | string[]
}

export interface PermissionDecision {
  status: "ask" | "deny" | "allow"
}

export interface TestGuard {
  before(input: BeforeInput, output: { args: Record<string, unknown> }): void
  after(input: BeforeInput, output: AfterOutput): Promise<void>
  permission(input: PermissionLike, output: PermissionDecision): void
  queueNote(message: string): void
}

const PATCH_ENTRY = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/gm

export function extractPatchEntries(patchText: string): Array<{ kind: string; path: string }> {
  const entries: Array<{ kind: string; path: string }> = []
  let match: RegExpExecArray | null
  const regex = new RegExp(PATCH_ENTRY.source, "gm")
  while ((match = regex.exec(patchText)) !== null) {
    entries.push({ kind: match[1]!, path: match[2]! })
  }
  return entries
}

// Wraps the deterministic test rules as an analyzer. Dispatch keeps ownership
// of the budget, the severity resolution, the grouping and the `BLOCK BYPASSED`
// marker; the analyzer only produces findings and bypasses for one change.
function createRuleAnalyzer(getResolved: () => ResolvedTestGuard): Analyzer {
  return {
    id: "test-rules",
    trigger: "after",
    isEnabled: () => getResolved().enabled,
    analyze: ctx => {
      const change = ctx.change
      if (!change) return {}
      const resolved = getResolved()
      const result = runTestRules({
        change,
        isTestFile: isTestPath(change.filePath, resolved.testPatterns),
        config: { ...resolved, testCommand: resolved.testCommand ?? null },
      })
      const findings: Finding[] = result.findings.map(finding => ({
        rule: finding.rule,
        filePath: change.filePath,
        line: finding.line,
        message: finding.message,
        severity: resolved.checks[finding.rule] ?? "off",
        excerpt: finding.excerpt,
      }))
      return { findings, bypasses: result.bypasses }
    },
  }
}

export function createTestGuard(getResolved: () => ResolvedTestGuard): TestGuard {
  const budget = new GuardBudget()
  const pending = new Map<string, PendingGuardCall>()
  const pendingNotes: string[] = []
  const registry = new AnalyzerRegistry()
  registry.register(createRuleAnalyzer(getResolved))
  function queueNote(message: string): void {
    if (message.length > 0) pendingNotes.push(message)
  }

  function prunePending(now = Date.now()): void {
    for (const [callID, call] of pending) {
      if (now - call.timestamp > PENDING_CALL_TTL) pending.delete(callID)
    }
  }

  function consumeNotes(): string[] {
    return pendingNotes.splice(0, pendingNotes.length)
  }

  function resolve(): ResolvedTestGuard {
    try {
      return getResolved()
    } catch {
      return DEFAULT_TEST_GUARD
    }
  }

  function isBlocking(): boolean {
    return (resolve().checks["protected-paths"] ?? "warn") === "block"
  }

  function isProtectedPath(filePath: string, patterns: string[]): boolean {
    return isTestPath(filePath, patterns)
  }

  function triggersTool(resolved: ResolvedTestGuard, toolLower: string): boolean {
    return (resolved.triggerTools ?? DEFAULT_TEST_TRIGGER_TOOLS).has(toolLower)
  }

  function pathExists(filePath: string): boolean {
    try {
      return existsSync(filePath) || existsSync(join(process.cwd(), filePath))
    } catch {
      return false
    }
  }

  // Defense in depth for #5894: `tool.execute.before` can be bypassed by
  // sub-agents, but `permission.ask` still runs. When protected-paths is set to
  // block, deny the permission for an existing test file.
  function permission(input: PermissionLike, output: PermissionDecision): void {
    try {
      const resolved = resolve()
      if (!resolved.enabled) return
      if (!isBlocking()) return
      if (input.type !== "edit" && input.type !== "write") return

      const patterns = resolved.testPatterns
      const candidates = Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : []
      for (const candidate of candidates) {
        if (!isProtectedPath(candidate, patterns)) continue
        if (!pathExists(candidate)) continue
        output.status = "deny"
        debugLog("permission denied for protected test path", candidate)
        return
      }
    } catch (err) {
      debugLog("permission failed (fail-open):", err)
    }
  }

  function before(input: BeforeInput, output: { args: Record<string, unknown> }): void {
    try {
      const resolved = resolve()
      if (!resolved.enabled) return

      const toolLower = input.tool.toLowerCase()
      const args = output.args ?? {}
      const patterns = resolved.testPatterns.length > 0 ? resolved.testPatterns : []

      if (!triggersTool(resolved, toolLower)) return

      prunePending()
      if (isBlocking()) {
        if (toolLower === APPLY_PATCH_TOOL_NAME) {
          const patchText = firstString(args, "patchText", "patch", "patch_text") ?? ""
          for (const entry of extractPatchEntries(patchText)) {
            if (entry.kind !== "Delete" && entry.kind !== "Update") continue
            if (!isProtectedPath(entry.path, patterns)) continue
            // Deletes are always blocked; updates only touch an existing file.
            if (entry.kind === "Delete" || pathExists(entry.path)) {
              throw new Error(
                `[test-guard] protected-paths is set to block: refusing to modify test file ${entry.path}. Set "checks": { "protected-paths": "warn" } or add a bypass.`,
              )
            }
          }
        } else {
          const filePath = firstString(args, "filePath", "file_path", "path")
          if (filePath && isProtectedPath(filePath, patterns) && pathExists(filePath)) {
            throw new Error(
              `[test-guard] protected-paths is set to block: refusing to edit existing test file ${filePath}. Set "checks": { "protected-paths": "warn" } or add a bypass.`,
            )
          }
        }
      }

      let preimage: string | undefined
      const filePath = firstString(args, "filePath", "file_path", "path")
      if (toolLower !== APPLY_PATCH_TOOL_NAME && filePath && typeof args.content === "string") {
        preimage = readPreimage(filePath)
      }
      pending.set(input.callID, { args, preimage, timestamp: Date.now() })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[test-guard]")) throw err
      debugLog("before failed (fail-open):", err)
    }
  }

  async function after(input: BeforeInput, output: AfterOutput): Promise<void> {
    try {
      const resolved = resolve()
      if (!resolved.enabled) return

      const notes = consumeNotes()
      const toolLower = input.tool.toLowerCase()
      let changes: ExtractedChange[] = []
      const failed = output.output.toLowerCase().startsWith("error")

      if (toolLower === APPLY_PATCH_TOOL_NAME) {
        if (triggersTool(resolved, APPLY_PATCH_TOOL_NAME) && !failed) changes = extractPatchChanges(output.metadata)
      } else if (triggersTool(resolved, toolLower)) {
        const call = pending.get(input.callID)
        pending.delete(input.callID)
        if (call && !failed) {
          const change = extractToolChange(toolLower, call.args, call.preimage)
          if (change) changes.push(change)
        }
      } else {
        pending.delete(input.callID)
      }

      const parts: string[] = []
      if (changes.length > 0) {
        budget.setMaxWarningsPerFile(resolved.maxWarningsPerFile)
        budget.setDedupWindowMs(resolved.dedupWindowMs ?? 30_000)

        const findings: Finding[] = []
        const bypassNotes: string[] = []
        for (const change of changes) {
          const results = await registry.run("after", {
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID,
            change,
            directory: process.cwd(),
          })

          const changeFindings: Finding[] = []
          const changeBypasses: Bypass[] = []
          for (const result of results) {
            if (result.findings) changeFindings.push(...result.findings)
            if (result.bypasses) changeBypasses.push(...result.bypasses)
          }

          for (const bypass of changeBypasses) {
            debugLog("bypass", change.filePath, bypass)
            bypassNotes.push(`${change.filePath}:${bypass.line} ${bypass.kind}${bypass.reason ? ` (${bypass.reason})` : ""}`)
          }

          const grouped = new Map<string, Finding[]>()
          for (const finding of changeFindings) {
            const list = grouped.get(finding.rule) ?? []
            list.push(finding)
            grouped.set(finding.rule, list)
          }

          for (const [rule, ruleFindings] of grouped) {
            const level = resolved.checks[rule] ?? "off"
            if (level === "off") continue
            if (!budget.shouldEmit(input.sessionID, rule, change.filePath)) continue
            budget.record(input.sessionID, rule, change.filePath)
            for (const finding of ruleFindings) findings.push(finding)
          }
        }

        let message = findings.length > 0
          ? renderFeedback(findings, { customPrompt: resolved.customPrompt, appendPrompt: resolved.appendPrompt })
          : ""
        // A block-configured rule reached the after hook: `before` did not stop
        // this change (e.g. a sub-agent bypassed it, #5894).
        if (findings.some(finding => finding.severity === "block")) {
          message = `BLOCK BYPASSED — a rule configured as "block" reached the after hook; the change was not stopped.\n\n${message}`
        }
        if (bypassNotes.length > 0) {
          const footer = `Test guard bypass recorded:\n${bypassNotes.map(note => `- ${note}`).join("\n")}`
          message = message.length > 0 ? `${message}\n\n${footer}` : footer
        }
        if (message.length > 0) parts.push(message)
      }

      for (const note of notes) parts.push(note)
      if (parts.length === 0) return
      appendFeedback(output, parts.join("\n\n"))
    } catch (err) {
      debugLog("after failed (fail-open):", err)
    }
  }

  return { before, after, permission, queueNote }
}
