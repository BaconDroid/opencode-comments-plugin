// Shared blocking mechanism for guards that can refuse a tool call. A guard
// supplies the policy (whether blocking is on, which paths are protected, and
// the refusal message); this module owns the `tool.execute.before` throw and
// the `permission.ask` deny (defense in depth for opencode issue #5894:
// sub-agents can bypass `tool.execute.before`, but `permission.ask` still runs).

import { existsSync } from "node:fs"
import { join } from "node:path"
import { APPLY_PATCH_TOOL_NAME } from "../constants"
import { firstString } from "./diff"
import type { PermissionDecision, PermissionLike } from "../types"

export interface BlockingPolicy {
  isBlocking(): boolean
  isProtectedPath(filePath: string): boolean
  // Refusal message; `viaPatch` is true for an apply_patch Delete/Update.
  message(filePath: string, viaPatch: boolean): string
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

export function pathExists(filePath: string): boolean {
  try {
    return existsSync(filePath) || existsSync(join(process.cwd(), filePath))
  } catch {
    return false
  }
}

// Throws when the call would modify a protected path and blocking is on.
export function checkBlockingBefore(
  toolLower: string,
  args: Record<string, unknown>,
  policy: BlockingPolicy,
): void {
  if (!policy.isBlocking()) return

  if (toolLower === APPLY_PATCH_TOOL_NAME) {
    const patchText = firstString(args, "patchText", "patch", "patch_text") ?? ""
    for (const entry of extractPatchEntries(patchText)) {
      if (entry.kind !== "Delete" && entry.kind !== "Update") continue
      if (!policy.isProtectedPath(entry.path)) continue
      // Deletes are always blocked; updates only touch an existing file.
      if (entry.kind === "Delete" || pathExists(entry.path)) {
        throw new Error(policy.message(entry.path, true))
      }
    }
    return
  }

  const filePath = firstString(args, "filePath", "file_path", "path")
  if (filePath && policy.isProtectedPath(filePath) && pathExists(filePath)) {
    throw new Error(policy.message(filePath, false))
  }
}

// Denies the permission for a protected path when blocking is on. Returns the
// denied path, or undefined. Fail-open: a malformed payload never throws.
export function checkPermission(
  input: PermissionLike,
  output: PermissionDecision,
  policy: BlockingPolicy,
): string | undefined {
  try {
    if (!policy.isBlocking()) return undefined
    if (input.type !== "edit" && input.type !== "write") return undefined

    const candidates = Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : []
    for (const candidate of candidates) {
      if (!policy.isProtectedPath(candidate)) continue
      if (!pathExists(candidate)) continue
      output.status = "deny"
      return candidate
    }
  } catch {
    // fail-open on purpose
  }
  return undefined
}
