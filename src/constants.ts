export const COMMENT_CHECKER_EVENT = "PostToolUse"

export const APPLY_PATCH_TOOL_NAME = "apply_patch"

export const DEFAULT_TRIGGER_TOOLS = ["write", "edit", "apply_patch"]

export const DEFAULT_CLI_TIMEOUT_MS = 5_000

// Shared dedup window for both guards: a repeat warning about the same
// file/rule within this window is suppressed.
export const DEFAULT_DEDUP_WINDOW_MS = 30_000
