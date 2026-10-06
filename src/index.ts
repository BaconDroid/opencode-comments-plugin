import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { APPLY_PATCH_TOOL_NAME, COMMENT_CHECKER_EVENT, TOOL_NAMES } from "./constants"
import { getCommentCheckerPath, runCommentChecker, startBackgroundInit } from "./cli"
import type { HookInput, PatchFileChange, PendingCall } from "./types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  process.stderr.write(msg)
}

const pendingCalls = new Map<string, PendingCall>()
const PENDING_CALL_TTL = 60_000

interface SessionWarnings {
  lastSeen: number
  files: Map<string, number>
}

const warningCounts = new Map<string, SessionWarnings>()

let customPrompt: string | undefined
let maxWarningsPerFile = 0

function cleanupStaleState(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
  for (const [sessionID, session] of warningCounts) {
    if (now - session.lastSeen > PENDING_CALL_TTL) {
      warningCounts.delete(sessionID)
    }
  }
}

function resolveCustomPrompt(config: unknown): string | undefined {
  const raw = (config as unknown as { comment_checker?: { custom_prompt?: unknown } }).comment_checker
  if (!raw || typeof raw !== "object") return undefined
  const prompt = raw.custom_prompt
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
}

function resolveMaxWarnings(config: unknown): number {
  const raw = (config as unknown as { comment_checker?: { max_warnings_per_file?: unknown } }).comment_checker
  if (!raw || typeof raw !== "object") return 0
  const value = raw.max_warnings_per_file
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// The config hook never sees unknown top-level keys: opencode validates the config
// against a fixed schema, so comment_checker is dropped before plugins are called.
function resolveMaxWarningsFromEnv(): number {
  const raw = process.env.COMMENT_CHECKER_MAX_WARNINGS_PER_FILE
  if (!raw || raw.trim().length === 0) return 0
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

setInterval(cleanupStaleState, 10_000).unref()

function canWarn(sessionID: string, filePath: string): boolean {
  if (maxWarningsPerFile <= 0) return true
  const session = warningCounts.get(sessionID)
  if (!session) return true
  return (session.files.get(filePath) ?? 0) < maxWarningsPerFile
}

function recordWarning(sessionID: string, filePath: string): void {
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
  if (session) {
    session.lastSeen = Date.now()
  }
}

async function reportComments(
  sessionID: string,
  toolName: string,
  toolInput: HookInput["tool_input"],
  output: { output: string },
): Promise<void> {
  try {
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

    const result = await runCommentChecker(hookInput, { prompt: customPrompt })
    if (result.hasComments && result.message) {
      recordWarning(sessionID, filePath)
      output.output += `\n\n${result.message}`
    }
  } catch (err) {
    debugLog("comment check failed:", err)
  }
}

function toPatchFiles(metadata: unknown): PatchFileChange[] {
  const files = (metadata as { files?: unknown } | undefined)?.files
  if (!Array.isArray(files)) return []

  const changes: PatchFileChange[] = []
  for (const file of files) {
    if (!file || typeof file !== "object") continue
    const entry = file as Record<string, unknown>
    changes.push({
      type: typeof entry.type === "string" ? entry.type : undefined,
      filePath: typeof entry.filePath === "string" ? entry.filePath : undefined,
      movePath: typeof entry.movePath === "string" ? entry.movePath : undefined,
      patch: typeof entry.patch === "string" ? entry.patch : undefined,
    })
  }
  return changes
}

// apply_patch reports one unified diff per file; the comment-checker CLI only
// needs the removed and the added lines to tell old from new.
function splitPatch(patch: string): { oldString: string; newString: string } | undefined {
  const removed: string[] = []
  const added: string[] = []

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue
    if (line.startsWith("-")) removed.push(line.slice(1))
    else if (line.startsWith("+")) added.push(line.slice(1))
  }

  if (added.length === 0) return undefined
  return { oldString: removed.join("\n"), newString: added.join("\n") }
}

async function checkApplyPatch(
  sessionID: string,
  output: { title: string; output: string; metadata: unknown },
): Promise<void> {
  if (output.output.toLowerCase().startsWith("error")) {
    debugLog("skipping due to tool failure in output")
    return
  }

  for (const file of toPatchFiles(output.metadata)) {
    if (file.type === "delete") continue

    const filePath = file.movePath ?? file.filePath
    const sides = file.patch ? splitPatch(file.patch) : undefined
    if (!filePath || !sides) {
      debugLog("no file path or no added lines in patch entry for apply_patch")
      continue
    }

    await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
      file_path: filePath,
      old_string: sides.oldString,
      new_string: sides.newString,
    }, output)
  }
}

export const CommentCheckerPlugin: Plugin = async () => {
  maxWarningsPerFile = resolveMaxWarningsFromEnv()
  startBackgroundInit()

  return {
    config: async (config: unknown) => {
      customPrompt = resolveCustomPrompt(config)
      maxWarningsPerFile = resolveMaxWarningsFromEnv() || resolveMaxWarnings(config)
    },
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const toolLower = input.tool.toLowerCase()
      if (!TOOL_NAMES.has(toolLower)) {
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

      pendingCalls.set(input.callID, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower as "write" | "edit",
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
        touchSession(input.sessionID)
        await checkApplyPatch(input.sessionID, output)
        return
      }

      const pendingCall = pendingCalls.get(input.callID)
      if (!pendingCall) {
        return
      }

      pendingCalls.delete(input.callID)
      touchSession(input.sessionID)

      const isToolFailure = output.output.toLowerCase().startsWith("error")

      if (isToolFailure) {
        debugLog("skipping due to tool failure in output")
        return
      }

      await reportComments(pendingCall.sessionID, pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1), {
        file_path: pendingCall.filePath,
        content: pendingCall.content,
        old_string: pendingCall.oldString,
        new_string: pendingCall.newString,
        edits: pendingCall.edits,
      }, output)
    },
  }
}

export default CommentCheckerPlugin
