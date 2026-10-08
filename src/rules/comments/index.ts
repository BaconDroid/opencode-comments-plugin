// Comment guard: the original plugin behavior, unchanged. It runs the
// comment-checker binary on added lines and appends its warning to the tool
// output. Extracted from `index.ts` so the test guard can reuse the engine.

import { existsSync, readFileSync } from "node:fs"
import { APPLY_PATCH_TOOL_NAME, COMMENT_CHECKER_EVENT } from "../../constants"
import { getCommentCheckerPath, runCommentChecker } from "../../cli"
import { detectLanguage, diffLines, isCommentLine, splitPatch, toPatchEntries } from "../../core/diff"
import type { HookInput, PendingCall } from "../../types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  process.stderr.write(msg)
}

const PENDING_CALL_TTL = 60_000

export interface ResolvedCommentConfig {
  customPrompt?: string
  appendPrompt?: string
  maxWarningsPerFile: number
  triggerTools: Set<string>
  timeoutMs: number
}

interface SessionWarnings {
  lastSeen: number
  files: Map<string, number>
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
  const warningCounts = new Map<string, SessionWarnings>()

  function cleanupStaleState(): void {
    const now = Date.now()
    for (const [callID, call] of pendingCalls) {
      if (now - call.timestamp > PENDING_CALL_TTL) pendingCalls.delete(callID)
    }
    for (const [sessionID, session] of warningCounts) {
      if (now - session.lastSeen > PENDING_CALL_TTL) warningCounts.delete(sessionID)
    }
  }

  const interval = setInterval(cleanupStaleState, 10_000)
  interval.unref?.()

  function canWarn(sessionID: string, filePath: string): boolean {
    const { maxWarningsPerFile } = getConfig()
    if (maxWarningsPerFile <= 0) return true
    const session = warningCounts.get(sessionID)
    if (!session) return true
    return (session.files.get(filePath) ?? 0) < maxWarningsPerFile
  }

  function recordWarning(sessionID: string, filePath: string): void {
    const { maxWarningsPerFile } = getConfig()
    if (maxWarningsPerFile <= 0) return
    let session = warningCounts.get(sessionID)
    if (!session) {
      session = { lastSeen: Date.now(), files: new Map() }
      warningCounts.set(sessionID, session)
    }
    session.files.set(filePath, (session.files.get(filePath) ?? 0) + 1)
  }

  function touchSession(sessionID: string): void {
    const session = warningCounts.get(sessionID)
    if (session) session.lastSeen = Date.now()
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
  ): Promise<void> {
    try {
      const { customPrompt, appendPrompt, timeoutMs } = getConfig()
      const filePath = toolInput.file_path ?? ""

      if (!canWarn(sessionID, filePath)) {
        debugLog("warning budget spent for", filePath)
        return
      }

      const cliPath = await getCommentCheckerPath()
      if (!cliPath || !existsSync(cliPath)) {
        debugLog("CLI not available, skipping comment check")
        return
      }

      const hookInput = {
        session_id: sessionID,
        tool_name: toolName,
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: COMMENT_CHECKER_EVENT,
        tool_input: toolInput,
      }

      const result = await runCommentChecker(hookInput, { prompt: customPrompt, timeoutMs })
      if (result.hasComments && result.message) {
        recordWarning(sessionID, filePath)
        const message = appendPrompt ? `${result.message}\n\n${appendPrompt}` : result.message
        output.output += `\n\n${message}`
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

    for (const file of toPatchEntries(output.metadata)) {
      if (file.type === "delete") continue

      const filePath = file.movePath ?? file.filePath
      const sides = file.patch ? splitPatch(file.patch) : undefined
      if (!filePath || !sides || sides.newText.length === 0) {
        debugLog("no file path or no added lines in patch entry for apply_patch")
        continue
      }

      await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
        file_path: filePath,
        old_string: sides.oldText,
        new_string: sides.newText,
      }, output)
    }
  }

  async function before(input: BeforeInput, output: { args: Record<string, unknown> }): Promise<void> {
    const { triggerTools } = getConfig()
    const toolLower = input.tool.toLowerCase()
    if (toolLower === APPLY_PATCH_TOOL_NAME || !triggerTools.has(toolLower)) {
      return
    }

    const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
    const content = output.args.content as string | undefined
    const oldString = (output.args.oldString ?? output.args.old_string) as string | undefined
    const newString = (output.args.newString ?? output.args.new_string) as string | undefined
    const edits = output.args.edits as Array<{ old_string: string; new_string: string }> | undefined

    if (!filePath) {
      debugLog("no filePath found for tool:", toolLower)
      return
    }

    let preimage: string | undefined
    if (typeof content === "string") {
      try {
        if (existsSync(filePath)) preimage = readFileSync(filePath, "utf8")
      } catch (err) {
        debugLog("could not read preimage:", err)
      }
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
    if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
      if (!triggerTools.has(APPLY_PATCH_TOOL_NAME)) return
      touchSession(input.sessionID)
      await checkApplyPatch(input.sessionID, output)
      return
    }

    const pendingCall = pendingCalls.get(input.callID)
    if (!pendingCall) return

    pendingCalls.delete(input.callID)
    touchSession(input.sessionID)

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
    }, output)
  }

  return { before, after }
}
