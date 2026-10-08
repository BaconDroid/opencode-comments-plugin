import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"
import {
  cleanupStaleCache,
  ensureCommentCheckerBinary,
  getCachedBinaryPath,
  getCommentCheckerVersion,
  getLatestCommentCheckerVersion,
  getPreferredCommentCheckerVersionSync,
} from "./downloader"
import { runProcess } from "./core/runner"
import type { CheckResult, HookInput } from "./types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  process.stderr.write(msg)
}

function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

function findCommentCheckerPathSync(): string | null {
  const binaryName = getBinaryName()

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
