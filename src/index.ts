import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { APPLY_PATCH_TOOL_NAME, COMMENT_CHECKER_EVENT, DEFAULT_CLI_TIMEOUT_MS, DEFAULT_TRIGGER_TOOLS } from "./constants"
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

let pluginOptions: unknown
let customPrompt: string | undefined
let maxWarningsPerFile = 0
let triggerTools = new Set(DEFAULT_TRIGGER_TOOLS)
let cliTimeoutMs = DEFAULT_CLI_TIMEOUT_MS

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

// opencode validates its config against a fixed schema and drops unknown
// top-level keys, so `comment_checker` never reaches the config hook. Plugin
// options are therefore passed as the second element of the plugin tuple:
// "plugin": [["opencode-comments-plugin", { "comment_checker": { ... } }]]
function optionContainer(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const nested = object.comment_checker
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return object
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function asCount(value: unknown, minimum: number): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : undefined
}

function asTools(value: unknown): string[] | undefined {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined
  if (!entries) return undefined
  const tools = entries
    .filter((entry): entry is string => typeof entry === "string")
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
  return tools.length > 0 ? tools : undefined
}

function resolveConfiguration(config?: unknown): void {
  const fromOptions = optionContainer(pluginOptions)
  const fromConfig = optionContainer(config)

  customPrompt =
    asString(process.env.COMMENT_CHECKER_CUSTOM_PROMPT) ??
    asString(fromOptions?.custom_prompt) ??
    asString(fromConfig?.custom_prompt)

  maxWarningsPerFile =
    asCount(process.env.COMMENT_CHECKER_MAX_WARNINGS_PER_FILE, 1) ??
    asCount(fromOptions?.max_warnings_per_file, 1) ??
    asCount(fromConfig?.max_warnings_per_file, 1) ??
    0

  const tools =
    asTools(process.env.COMMENT_CHECKER_TOOLS) ??
    asTools(fromOptions?.tools) ??
    asTools(fromConfig?.tools)
  triggerTools = new Set(tools ?? DEFAULT_TRIGGER_TOOLS)

  cliTimeoutMs =
    asCount(process.env.COMMENT_CHECKER_TIMEOUT_MS, 1) ??
    asCount(fromOptions?.timeout_ms, 1) ??
    asCount(fromConfig?.timeout_ms, 1) ??
    DEFAULT_CLI_TIMEOUT_MS
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

    const result = await runCommentChecker(hookInput, { prompt: customPrompt, timeoutMs: cliTimeoutMs })
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

export const CommentCheckerPlugin: Plugin = async (_input, options?: unknown) => {
  pluginOptions = options
  resolveConfiguration()
  startBackgroundInit()

  return {
    config: async (config: unknown) => {
      resolveConfiguration(config)
    },
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
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

      pendingCalls.set(input.callID, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower,
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
        if (!triggerTools.has(APPLY_PATCH_TOOL_NAME)) {
          return
        }
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
