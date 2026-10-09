// Comment guard: runs the comment-checker binary on added lines and appends
// its warning to the tool output, with opt-in bypass markers. Extracted from
// `index.ts` so the test guard can reuse the engine.

import { existsSync } from "node:fs"
import { APPLY_PATCH_TOOL_NAME } from "../../constants"
import { commentHookInput, getCommentCheckerPath, runCommentChecker } from "../../cli"
import { AnalyzerRegistry, type Analyzer } from "../../core/analyzer"
import { GuardBudget } from "../../core/budget"
import { applyBypass, bypassMatchers, type Bypass } from "../../core/bypass"
import type { GuardBaseConfig } from "../../core/config"
import { createDebugLog } from "../../core/debug"
import { detectLanguage, diffLines, extractPatchChanges, extractToolChange, firstString, isCommentLine, readFileIfExists, readString } from "../../core/diff"
import { appendGuardMessage } from "../../core/feedback"
import { matchPathFilter } from "../../core/glob"
import { PendingCallStore, type PendingToolCall } from "../../core/pending"
import { formatBypassNote, renderAnalyzerResults, renderBypassFooter } from "../../core/result-pipeline"
import { isTriggeredTool } from "../../core/triggers"
import type { HookInput, ToolExecuteInput, ToolExecuteOutput, ToolGuard } from "../../types"

const debugLog = createDebugLog("comment-guard", process.env.COMMENT_CHECKER_DEBUG === "1")

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
  const bypass = applyBypass(newText, MATCHERS)

  const { added } = diffLines(oldText, newText)
  const addedComments = added.filter(line => isCommentLine(line, language))
  const lines = newText.split("\n")
  const used = new Set<number>()
  const lineNumbers: number[] = []
  for (const comment of addedComments) {
    const index = lines.findIndex((line, i) => !used.has(i) && line === comment)
    if (index >= 0) used.add(index)
    lineNumbers.push(index >= 0 ? index + 1 : 0)
  }

  // Comment policy: a disable-file marker, or every added comment covered.
  const suppress = bypass.fileDisabled || (lineNumbers.length > 0 && lineNumbers.every(line => bypass.covers(line)))
  return { suppress, notes: bypass.notes }
}

function commentBypassFooter(filePath: string, notes: Bypass[]): string {
  return renderBypassFooter("Comment guard bypass recorded", notes.map(note => formatBypassNote(filePath, note)))
}

export interface ResolvedCommentConfig extends GuardBaseConfig {
  dedupWindowMs: number
  triggerTools: Set<string>
  paths: string[]
  timeoutMs: number
}

const COMMENT_RULE = "comment"

// An empty list means every file; otherwise the file must match one glob.
function isCheckedPath(filePath: string, paths: string[]): boolean {
  return matchPathFilter(paths, filePath)
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

      const hookInput = commentHookInput({
        sessionID: ctx.sessionID,
        toolName: ctx.tool,
        cwd: process.cwd(),
        toolInput: (ctx.args ?? {}) as HookInput["tool_input"],
      })

      const result = await runCommentChecker(hookInput, { prompt: config.customPrompt, timeoutMs: config.timeoutMs })
      return result.hasComments && result.message ? { raw: result.message } : {}
    },
  }
}

export type CommentGuard = ToolGuard

export function createCommentGuard(getConfig: () => ResolvedCommentConfig): CommentGuard {
  const pendingCalls = new PendingCallStore<PendingToolCall>()
  const budget = new GuardBudget()
  const registry = new AnalyzerRegistry()
  registry.register(createCommentBinaryAnalyzer(getConfig))

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
        if (bypass.notes.length > 0) appendGuardMessage(output, commentBypassFooter(filePath, bypass.notes))
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
      })
      const message = renderAnalyzerResults(results, { appendPrompt })
      if (message.length > 0) {
        budget.record(sessionID, COMMENT_RULE, filePath)
        appendGuardMessage(output, message)
        if (bypass.notes.length > 0) appendGuardMessage(output, commentBypassFooter(filePath, bypass.notes))
      }
    } catch (err) {
      debugLog("comment check failed:", err)
    }
  }

  async function checkApplyPatch(sessionID: string, output: ToolExecuteOutput): Promise<void> {
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

  async function before(input: ToolExecuteInput, output: { args: Record<string, unknown> }): Promise<void> {
    try {
      const { triggerTools } = getConfig()
      if (!getConfig().enabled) return
      const toolLower = input.tool.toLowerCase()
      if (toolLower === APPLY_PATCH_TOOL_NAME || !isTriggeredTool(triggerTools, toolLower)) {
        return
      }

      pendingCalls.prune()
      const filePath = firstString(output.args, "filePath", "file_path", "path")

      if (!filePath) {
        debugLog("no filePath found for tool:", toolLower)
        return
      }

      if (!isCheckedPath(filePath, getConfig().paths)) {
        debugLog("path not in comment_checker.paths; skipping:", filePath)
        return
      }

      let preimage: string | undefined
      if (typeof output.args.content === "string") {
        preimage = readFileIfExists(filePath)
      }

      pendingCalls.set(input.callID, { args: output.args, preimage })
    } catch (err) {
      debugLog("before failed (fail-open):", err)
    }
  }

  async function after(input: ToolExecuteInput, output: ToolExecuteOutput): Promise<void> {
    try {
      const { triggerTools } = getConfig()
      if (!getConfig().enabled) return
      const toolLower = input.tool.toLowerCase()
      if (toolLower === APPLY_PATCH_TOOL_NAME) {
        if (!isTriggeredTool(triggerTools, APPLY_PATCH_TOOL_NAME)) return
        budget.touch(input.sessionID)
        await checkApplyPatch(input.sessionID, output)
        return
      }

      const pendingCall = pendingCalls.take(input.callID)
      if (!pendingCall) return

      budget.touch(input.sessionID)

      const isToolFailure = output.output.toLowerCase().startsWith("error")
      if (isToolFailure) {
        debugLog("skipping due to tool failure in output")
        return
      }

      const change = extractToolChange(toolLower, pendingCall.args, pendingCall.preimage)
      if (!change) return

      const filePath = firstString(pendingCall.args, "filePath", "file_path", "path") ?? ""
      if (
        toolLower === "write" &&
        pendingCall.preimage !== undefined &&
        !hasNewCommentLines(change.oldText, change.newText, filePath)
      ) {
        debugLog("no new comment lines in write; skipping")
        return
      }

      await reportComments(input.sessionID, toolLower.charAt(0).toUpperCase() + toolLower.slice(1), {
        file_path: filePath,
        content: readString(pendingCall.args, "content"),
        old_string: readString(pendingCall.args, "oldString", "old_string"),
        new_string: readString(pendingCall.args, "newString", "new_string"),
        edits: pendingCall.args.edits as Array<{ old_string: string; new_string: string }> | undefined,
      }, output, { oldText: change.oldText, newText: change.newText })
    } catch (err) {
      debugLog("after failed (fail-open):", err)
    }
  }

  return { before, after }
}
