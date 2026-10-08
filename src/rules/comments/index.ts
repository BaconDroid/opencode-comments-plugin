// Comment guard: runs the comment-checker binary on added lines and appends
// its warning to the tool output, with opt-in bypass markers. Extracted from
// `index.ts` so the test guard can reuse the engine.

import { existsSync } from "node:fs"
import { APPLY_PATCH_TOOL_NAME, COMMENT_CHECKER_EVENT } from "../../constants"
import { getCommentCheckerPath, runCommentChecker } from "../../cli"
import { AnalyzerRegistry, type Analyzer } from "../../core/analyzer"
import { GuardBudget } from "../../core/budget"
import { bypassMatchers, collectBypasses, withinAllowWindow, type Bypass } from "../../core/bypass"
import { detectLanguage, diffLines, extractPatchChanges, isCommentLine, readPreimage } from "../../core/diff"
import { matchesAnyGlob } from "../../core/glob"
import { formatBypassNote, renderAnalyzerResults, renderBypassFooter } from "../../core/result-pipeline"
import type { HookInput, PendingCall } from "../../types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  process.stderr.write(msg)
}

const PENDING_CALL_TTL = 60_000

// Inline/file bypass, mirroring the test guard's `test-guard: allow` /
// `test-guard-disable-file`. A comment whose added lines are all within
// +/-2 lines of an allow marker suppresses the file's warning; a file-level
// disable marker suppresses it outright.
const MATCHERS = bypassMatchers("comment-guard")

function bypassState(
  newText: string,
  oldText: string,
  language: ReturnType<typeof detectLanguage>,
): { suppress: boolean; notes: Bypass[] } {
  const notes = collectBypasses(newText, MATCHERS)
  if (notes.some(note => note.kind === "disable-file")) return { suppress: true, notes }

  const { added } = diffLines(oldText, newText)
  const addedComments = added.filter(line => isCommentLine(line, language))
  if (addedComments.length === 0) return { suppress: false, notes }

  const lines = newText.split("\n")
  const used = new Set<number>()
  for (const comment of addedComments) {
    const index = lines.findIndex((line, i) => !used.has(i) && line === comment)
    if (index < 0 || !withinAllowWindow(newText, index + 1, MATCHERS)) return { suppress: false, notes }
    used.add(index)
  }
  return { suppress: true, notes }
}

function commentBypassFooter(filePath: string, notes: Bypass[]): string {
  return renderBypassFooter("Comment guard bypass recorded", notes.map(note => formatBypassNote(filePath, note)))
}

// The old/new text a pending call represents, for the bypass check.
function changeOf(call: PendingCall): { oldText: string; newText: string } {
  if (typeof call.content === "string") return { oldText: call.preimage ?? "", newText: call.content }
  if (Array.isArray(call.edits) && call.edits.length > 0) {
    return {
      oldText: call.edits.map(edit => edit.old_string ?? "").join("\n"),
      newText: call.edits.map(edit => edit.new_string ?? "").join("\n"),
    }
  }
  return { oldText: call.oldString ?? "", newText: call.newString ?? "" }
}

export interface ResolvedCommentConfig {
  enabled: boolean
  customPrompt?: string
  appendPrompt?: string
  maxWarningsPerFile: number
  dedupWindowMs: number
  triggerTools: Set<string>
  paths: string[]
  timeoutMs: number
}

const COMMENT_RULE = "comment"

// An empty list means every file; otherwise the file must match one glob.
function isCheckedPath(filePath: string, paths: string[]): boolean {
  return paths.length === 0 || matchesAnyGlob(paths, filePath)
}

// Wraps the comment-checker binary as an analyzer. It only produces the raw CLI
// message; the guard keeps its budget, bypass handling and raw append.
export function createCommentBinaryAnalyzer(getConfig: () => ResolvedCommentConfig): Analyzer {
  return {
    id: "comment-binary",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: async ctx => {
      const config = getConfig()
      const cliPath = await getCommentCheckerPath()
      if (!cliPath || !existsSync(cliPath)) {
        debugLog("CLI not available, skipping comment check")
        return {}
      }

      const hookInput: HookInput = {
        session_id: ctx.sessionID,
        tool_name: ctx.tool,
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: COMMENT_CHECKER_EVENT,
        tool_input: (ctx.args ?? {}) as HookInput["tool_input"],
      }

      const result = await runCommentChecker(hookInput, { prompt: config.customPrompt, timeoutMs: config.timeoutMs })
      return result.hasComments && result.message ? { raw: result.message } : {}
    },
  }
}

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

export interface CommentGuard {
  before(input: BeforeInput, output: { args: Record<string, unknown> }): Promise<void>
  after(input: BeforeInput, output: AfterOutput): Promise<void>
}

export function createCommentGuard(getConfig: () => ResolvedCommentConfig): CommentGuard {
  const pendingCalls = new Map<string, PendingCall>()
  const budget = new GuardBudget({ dedupWindowMs: 0 })
  const registry = new AnalyzerRegistry()
  registry.register(createCommentBinaryAnalyzer(getConfig))

  function prunePending(now = Date.now()): void {
    for (const [callID, call] of pendingCalls) {
      if (now - call.timestamp > PENDING_CALL_TTL) pendingCalls.delete(callID)
    }
  }

  // Only new comment-like lines are worth checking on `write` when the previous
  // content is known: this avoids re-reporting pre-existing comments.
  function hasNewCommentLines(preimage: string, content: string, filePath: string): boolean {
    const language = detectLanguage(filePath)
    const { added } = diffLines(preimage, content)
    return added.some(line => isCommentLine(line, language))
  }

  async function reportComments(
    sessionID: string,
    toolName: string,
    toolInput: HookInput["tool_input"],
    output: { output: string },
    change: { oldText: string; newText: string },
  ): Promise<void> {
    try {
      const { appendPrompt, maxWarningsPerFile, dedupWindowMs } = getConfig()
      const filePath = toolInput.file_path ?? ""

      const bypass = bypassState(change.newText, change.oldText, detectLanguage(filePath))
      if (bypass.suppress) {
        debugLog("comment guard bypassed for", filePath)
        if (bypass.notes.length > 0) output.output += `\n\n${commentBypassFooter(filePath, bypass.notes)}`
        return
      }

      budget.setMaxWarningsPerFile(maxWarningsPerFile)
      budget.setDedupWindowMs(dedupWindowMs)
      if (!budget.shouldEmit(sessionID, COMMENT_RULE, filePath)) {
        debugLog("warning budget spent for", filePath)
        return
      }

      const results = await registry.run("after", {
        tool: toolName,
        sessionID,
        args: toolInput as Record<string, unknown>,
        directory: process.cwd(),
      })
      const message = renderAnalyzerResults(results, { appendPrompt })
      if (message.length > 0) {
        budget.record(sessionID, COMMENT_RULE, filePath)
        output.output += `\n\n${message}`
        if (bypass.notes.length > 0) output.output += `\n\n${commentBypassFooter(filePath, bypass.notes)}`
      }
    } catch (err) {
      debugLog("comment check failed:", err)
    }
  }

  async function checkApplyPatch(sessionID: string, output: AfterOutput): Promise<void> {
    if (output.output.toLowerCase().startsWith("error")) {
      debugLog("skipping due to tool failure in output")
      return
    }

    for (const change of extractPatchChanges(output.metadata)) {
      if (change.isDelete || change.newText.length === 0) {
        debugLog("no file path or no added lines in patch entry for apply_patch")
        continue
      }
      if (!isCheckedPath(change.filePath, getConfig().paths)) continue

      await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
        file_path: change.filePath,
        old_string: change.oldText,
        new_string: change.newText,
      }, output, { oldText: change.oldText, newText: change.newText })
    }
  }

  async function before(input: BeforeInput, output: { args: Record<string, unknown> }): Promise<void> {
    const { triggerTools } = getConfig()
    if (!getConfig().enabled) return
    const toolLower = input.tool.toLowerCase()
    if (toolLower === APPLY_PATCH_TOOL_NAME || !triggerTools.has(toolLower)) {
      return
    }

    prunePending()
    const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
    const content = output.args.content as string | undefined
    const oldString = (output.args.oldString ?? output.args.old_string) as string | undefined
    const newString = (output.args.newString ?? output.args.new_string) as string | undefined
    const edits = output.args.edits as Array<{ old_string: string; new_string: string }> | undefined

    if (!filePath) {
      debugLog("no filePath found for tool:", toolLower)
      return
    }

    if (!isCheckedPath(filePath, getConfig().paths)) {
      debugLog("path not in comment_checker.paths; skipping:", filePath)
      return
    }

    let preimage: string | undefined
    if (typeof content === "string") {
      preimage = readPreimage(filePath)
    }

    pendingCalls.set(input.callID, {
      filePath,
      content,
      oldString,
      newString,
      edits,
      tool: toolLower,
      sessionID: input.sessionID,
      timestamp: Date.now(),
      preimage,
    })
  }

  async function after(input: BeforeInput, output: AfterOutput): Promise<void> {
    const { triggerTools } = getConfig()
    if (!getConfig().enabled) return
    if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
      if (!triggerTools.has(APPLY_PATCH_TOOL_NAME)) return
      budget.touch(input.sessionID)
      await checkApplyPatch(input.sessionID, output)
      return
    }

    const pendingCall = pendingCalls.get(input.callID)
    if (!pendingCall) return

    pendingCalls.delete(input.callID)
    budget.touch(input.sessionID)

    const isToolFailure = output.output.toLowerCase().startsWith("error")
    if (isToolFailure) {
      debugLog("skipping due to tool failure in output")
      return
    }

    if (
      pendingCall.tool === "write" &&
      pendingCall.preimage !== undefined &&
      typeof pendingCall.content === "string" &&
      !hasNewCommentLines(pendingCall.preimage, pendingCall.content, pendingCall.filePath)
    ) {
      debugLog("no new comment lines in write; skipping")
      return
    }

    await reportComments(pendingCall.sessionID, pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1), {
      file_path: pendingCall.filePath,
      content: pendingCall.content,
      old_string: pendingCall.oldString,
      new_string: pendingCall.newString,
      edits: pendingCall.edits,
    }, output, changeOf(pendingCall))
  }

  return { before, after }
}
