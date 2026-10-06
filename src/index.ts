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

let customPrompt: string | undefined

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
}

function resolveCustomPrompt(config: unknown): string | undefined {
  const raw = (config as unknown as { comment_checker?: { custom_prompt?: unknown } }).comment_checker
  if (!raw || typeof raw !== "object") return undefined
  const prompt = raw.custom_prompt
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
}

setInterval(cleanupOldPendingCalls, 10_000).unref()

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

// apply_patch reports one unified diff per file; the CLI needs the removed and
// the added lines to tell what changed.
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
      debugLog("no file path or no added lines in apply_patch entry")
      continue
    }

    try {
      const cliPath = await getCommentCheckerPath()
      if (!cliPath || !existsSync(cliPath)) {
        debugLog("CLI not available, skipping comment check")
        return
      }

      const hookInput = {
        session_id: sessionID,
        tool_name: APPLY_PATCH_TOOL_NAME,
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: COMMENT_CHECKER_EVENT,
        tool_input: {
          file_path: filePath,
          old_string: sides.oldString,
          new_string: sides.newString,
        },
      }

      const result = await runCommentChecker(hookInput, { prompt: customPrompt })
      if (result.hasComments && result.message) {
        output.output += `\n\n${result.message}`
      }
    } catch (err) {
      debugLog("apply_patch check failed:", err)
    }
  }
}

export const CommentCheckerPlugin: Plugin = async () => {
  startBackgroundInit()

  return {
    config: async (config: unknown) => {
      customPrompt = resolveCustomPrompt(config)
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
        await checkApplyPatch(input.sessionID, output)
        return
      }

      const pendingCall = pendingCalls.get(input.callID)
      if (!pendingCall) {
        return
      }

      pendingCalls.delete(input.callID)

      const isToolFailure = output.output.toLowerCase().startsWith("error")

      if (isToolFailure) {
        debugLog("skipping due to tool failure in output")
        return
      }

      try {
        const cliPath = await getCommentCheckerPath()
        if (!cliPath || !existsSync(cliPath)) {
          debugLog("CLI not available, skipping comment check")
          return
        }

        const hookInput = {
          session_id: pendingCall.sessionID,
          tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1),
          transcript_path: "",
          cwd: process.cwd(),
          hook_event_name: COMMENT_CHECKER_EVENT,
          tool_input: {
            file_path: pendingCall.filePath,
            content: pendingCall.content,
            old_string: pendingCall.oldString,
            new_string: pendingCall.newString,
            edits: pendingCall.edits,
          },
        }

        const result = await runCommentChecker(hookInput, { prompt: customPrompt })
        if (result.hasComments && result.message) {
          output.output += `\n\n${result.message}`
        }
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}

export default CommentCheckerPlugin
