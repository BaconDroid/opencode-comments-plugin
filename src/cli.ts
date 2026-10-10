import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"
import {
  cleanupStaleCache,
  cleanupTestCheckerStaleCache,
  ensureCommentCheckerBinary,
  ensureTestCheckerBinary,
  getCachedBinaryPath,
  getCachedTestCheckerPath,
  getCommentCheckerVersion,
  getLatestCommentCheckerVersion,
  getLatestTestCheckerVersion,
  getPreferredCommentCheckerVersionSync,
  getPreferredTestCheckerVersionSync,
} from "./downloader"
import { runProcess } from "./core/runner"
import { createDebugLog } from "./core/debug"
import { COMMENT_CHECKER_BINARY_NAME, COMMENT_CHECKER_EVENT } from "./constants"
import type { CheckResult, HookInput, TestCheckerFinding } from "./types"

const debugLog = createDebugLog("comment-checker:cli", process.env.COMMENT_CHECKER_DEBUG === "1")

// Builds the comment-checker hook payload. Shared by the live hook, the audit
// and the CI check so the event name and shape stay in one place.
export function commentHookInput(options: {
  sessionID: string
  toolName: string
  cwd: string
  toolInput: HookInput["tool_input"]
}): HookInput {
  return {
    session_id: options.sessionID,
    tool_name: options.toolName,
    transcript_path: "",
    cwd: options.cwd,
    hook_event_name: COMMENT_CHECKER_EVENT,
    tool_input: options.toolInput,
  }
}

function findCommentCheckerPathSync(): string | null {
  const binaryName = COMMENT_CHECKER_BINARY_NAME

  const version = getPreferredCommentCheckerVersionSync()
  if (!version) {
    debugLog("cannot resolve comment-checker version; comment checking disabled")
    return null
  }

  if (getCommentCheckerVersion() === version) {
    try {
      const require = createRequire(import.meta.url)
      const cliPkgPath = require.resolve("@code-yeongyu/comment-checker/package.json")
      const cliDir = dirname(cliPkgPath)
      const binaryPath = join(cliDir, "bin", binaryName)

      if (existsSync(binaryPath)) {
        debugLog("found binary in main package:", binaryPath)
        return binaryPath
      }
    } catch {
      debugLog("main package not installed")
    }
  }

  const cachedPath = getCachedBinaryPath(version)
  if (cachedPath) {
    debugLog("found binary in cache:", cachedPath)
    cleanupStaleCache(version)
    return cachedPath
  }

  debugLog("no binary found in known locations")
  return null
}

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getCommentCheckerPath(): Promise<string | null> {
  if (resolvedCliPath !== null) {
    return resolvedCliPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const version = await getLatestCommentCheckerVersion()
    if (!version) {
      debugLog("cannot resolve a comment-checker version; comment checking disabled")
      return null
    }

    const syncPath = findCommentCheckerPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      debugLog("using sync-resolved path:", syncPath)
      return syncPath
    }

    debugLog("triggering lazy download...")
    const downloadedPath = await ensureCommentCheckerBinary(version)
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      debugLog("using downloaded path:", downloadedPath)
      return downloadedPath
    }

    debugLog("no binary available")
    return null
  })()

  return initPromise
}

export function getCommentCheckerPathSync(): string | null {
  return resolvedCliPath ?? findCommentCheckerPathSync()
}

export function startBackgroundInit(): void {
  if (initPromise) return
  initPromise = getCommentCheckerPath()
  initPromise.then(path => {
    debugLog("background init complete:", path || "no binary")
  }).catch(err => {
    debugLog("background init error:", err)
  })
}

export interface RunOptions {
  cliPath?: string
  prompt?: string
  timeoutMs?: number
}

export async function runCommentChecker(input: HookInput, options: RunOptions = {}): Promise<CheckResult> {
  const binaryPath = options.cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()

  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  if (!existsSync(binaryPath)) {
    debugLog("comment-checker binary does not exist:", binaryPath)
    return { hasComments: false, message: "" }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  const args = [binaryPath]
  if (options.prompt && options.prompt.trim().length > 0) {
    args.push("--prompt", options.prompt)
  }

  const outcome = await runProcess(args, { stdin: jsonInput, timeoutMs: options.timeoutMs })
  if (outcome === "timeout") {
    debugLog("comment-checker abandoned after timeout or stream failure")
    return { hasComments: false, message: "" }
  }

  const { stdout, stderr, exitCode } = outcome
  debugLog("exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

  if (exitCode === 0) {
    return { hasComments: false, message: "" }
  }

  if (exitCode === 2) {
    return { hasComments: true, message: stderr }
  }

  debugLog("unexpected exit code:", exitCode, "stderr:", stderr)
  return { hasComments: false, message: "" }
}

// --- test-checker ---
//
// The test guard's binary engine. Unlike the comment-checker there is no npm
// package to source a version from: the latest-release redirect and the
// TEST_CHECKER_VERSION env override are the only sources.

function findTestCheckerPathSync(): string | null {
  const version = getPreferredTestCheckerVersionSync()
  if (!version) {
    debugLog("cannot resolve a test-checker version; binary engine unavailable")
    return null
  }

  const cachedPath = getCachedTestCheckerPath(version)
  if (cachedPath) {
    debugLog("found test-checker in cache:", cachedPath)
    cleanupTestCheckerStaleCache(version)
    return cachedPath
  }

  debugLog("no test-checker binary found in known locations")
  return null
}

let resolvedTestCliPath: string | null = null
let testInitPromise: Promise<string | null> | null = null

export async function getTestCheckerPath(): Promise<string | null> {
  if (resolvedTestCliPath !== null) {
    return resolvedTestCliPath
  }

  if (testInitPromise) {
    return testInitPromise
  }

  testInitPromise = (async () => {
    const version = await getLatestTestCheckerVersion()
    if (!version) {
      debugLog("cannot resolve a test-checker version; binary engine unavailable")
      return null
    }

    const syncPath = findTestCheckerPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedTestCliPath = syncPath
      debugLog("using sync-resolved test-checker path:", syncPath)
      return syncPath
    }

    debugLog("triggering lazy test-checker download...")
    const downloadedPath = await ensureTestCheckerBinary(version)
    if (downloadedPath) {
      resolvedTestCliPath = downloadedPath
      debugLog("using downloaded test-checker path:", downloadedPath)
      return downloadedPath
    }

    debugLog("no test-checker binary available")
    return null
  })()

  return testInitPromise
}

export function getTestCheckerPathSync(): string | null {
  return resolvedTestCliPath ?? findTestCheckerPathSync()
}

export function startTestCheckerBackgroundInit(): void {
  if (testInitPromise) return
  testInitPromise = getTestCheckerPath()
  testInitPromise.then(path => {
    debugLog("test-checker background init complete:", path || "no binary")
  }).catch(err => {
    debugLog("test-checker background init error:", err)
  })
}

export interface RunTestOptions {
  cliPath?: string
  timeoutMs?: number
}

// Runs the test-checker binary on a hook payload.
//
//   exit 0 -> []           (clean, or any degraded/unsupported path)
//   exit 2 -> findings[]   (stdout JSON mapped to the test-guard shape)
//   timeout / other exit / unparseable -> null (caller falls back to regex)
export async function runTestChecker(input: HookInput, options: RunTestOptions = {}): Promise<TestCheckerFinding[] | null> {
  const binaryPath = options.cliPath ?? resolvedTestCliPath ?? getTestCheckerPathSync()

  if (!binaryPath || !existsSync(binaryPath)) {
    debugLog("test-checker binary not found")
    return null
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running test-checker with input:", jsonInput.substring(0, 200))

  const outcome = await runProcess([binaryPath], { stdin: jsonInput, timeoutMs: options.timeoutMs })
  if (outcome === "timeout") {
    debugLog("test-checker abandoned after timeout or stream failure")
    return null
  }

  const { stdout, stderr, exitCode } = outcome
  debugLog("test-checker exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

  if (exitCode === 0) return []
  if (exitCode !== 2) {
    debugLog("unexpected test-checker exit code:", exitCode, "stderr:", stderr)
    return null
  }

  try {
    const parsed = JSON.parse(stdout) as { findings?: unknown }
    if (!Array.isArray(parsed.findings)) return null
    const findings: TestCheckerFinding[] = []
    for (const entry of parsed.findings) {
      if (!entry || typeof entry !== "object") continue
      const record = entry as Record<string, unknown>
      const rule = typeof record.rule === "string" && record.rule.length > 0 ? record.rule : undefined
      if (!rule) continue
      const lineValue = typeof record.line === "number" ? record.line : Number(record.line)
      const message = typeof record.message === "string" ? record.message : ""
      const file = typeof record.file === "string" && record.file.length > 0 ? record.file : input.tool_input.file_path
      findings.push({
        rule,
        filePath: file,
        line: Number.isFinite(lineValue) ? lineValue : 0,
        message,
        excerpt: message,
      })
    }
    return findings
  } catch (err) {
    debugLog("failed to parse test-checker output:", err)
    return null
  }
}
