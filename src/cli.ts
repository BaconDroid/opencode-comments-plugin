import { existsSync } from "node:fs"
import {
  cleanupStaleCache,
  cleanupTestCheckerStaleCache,
  ensureCommentCheckerBinary,
  ensureTestCheckerBinary,
  getCachedBinaryPath,
  getCachedTestCheckerPath,
  getCommentCheckerVersionFromCachePath,
  getLatestCommentCheckerVersion,
  getLatestTestCheckerVersion,
  getPreferredCommentCheckerVersionSync,
  getPreferredTestCheckerVersionSync,
  getTestCheckerVersionFromCachePath,
} from "./downloader"
import { runProcess } from "./core/runner"
import { createDebugLog } from "./core/debug"
import type { KeywordAcquit } from "./core/config"
import { COMMENT_CHECKER_EVENT } from "./constants"
import type { CheckResult, HookInput, TestCheckerFinding, TestCheckerResult } from "./types"

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
  const version = getPreferredCommentCheckerVersionSync()

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
  keywordAcquit?: KeywordAcquit
  // The version the plugin pinned for this binary. Defaults to the version
  // segment of a cache path; binaries resolved elsewhere are not checked.
  expectedVersion?: string
}

// First stderr line, for a compact "did not run" reason.
function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? ""
}

// One `--version` probe per binary path per process. The probe result never
// blocks a check on its own: an unreadable version is treated as "unknown".
const binaryVersionCache = new Map<string, string | null>()

async function readBinaryVersion(
  binaryPath: string,
  binaryName: string,
  timeoutMs?: number,
): Promise<string | null> {
  if (binaryVersionCache.has(binaryPath)) return binaryVersionCache.get(binaryPath) ?? null
  const outcome = await runProcess([binaryPath, "--version"], { timeoutMs })
  let version: string | null = null
  if (outcome !== "timeout" && outcome.exitCode === 0) {
    const match = outcome.stdout.trim().match(/^(\S+)\s+(\S+)$/)
    if (match && match[1] === binaryName) version = match[2] ?? null
  }
  binaryVersionCache.set(binaryPath, version)
  return version
}

// Returns a user-facing reason when the cached binary reports a version other
// than the one the plugin pinned, or null when it is unknown/fresh.
async function staleBinaryReason(
  binaryPath: string,
  binaryName: string,
  expectedVersion: string | null,
  timeoutMs: number | undefined,
): Promise<string | null> {
  if (!expectedVersion) return null
  const actual = await readBinaryVersion(binaryPath, binaryName, timeoutMs)
  if (!actual || actual === expectedVersion) return null
  return `cached ${binaryName} binary is ${actual} but the plugin expects ${expectedVersion}`
}

function didNotRunComment(reason: string): CheckResult {
  return { hasComments: false, message: "", didNotRun: { reason } }
}

export async function runCommentChecker(input: HookInput, options: RunOptions = {}): Promise<CheckResult> {
  const binaryPath = options.cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()

  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return didNotRunComment("binary not found")
  }

  if (!existsSync(binaryPath)) {
    debugLog("comment-checker binary does not exist:", binaryPath)
    return didNotRunComment(`binary not found at ${binaryPath}`)
  }

  const stale = await staleBinaryReason(
    binaryPath,
    "comment-checker",
    options.expectedVersion ?? getCommentCheckerVersionFromCachePath(binaryPath),
    options.timeoutMs,
  )
  if (stale) {
    debugLog(stale)
    return didNotRunComment(stale)
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  const args = [binaryPath]
  if (options.prompt && options.prompt.trim().length > 0) {
    args.push("--prompt", options.prompt)
  }

  const env = options.keywordAcquit
    ? { COMMENT_CHECKER_KEYWORD_ACQUIT: options.keywordAcquit }
    : undefined
  const outcome = await runProcess(args, { stdin: jsonInput, timeoutMs: options.timeoutMs, env })
  if (outcome === "timeout") {
    debugLog("comment-checker abandoned after timeout or stream failure")
    return didNotRunComment("timed out or could not be spawned")
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
  const detail = firstLine(stderr)
  return didNotRunComment(`exited with code ${exitCode}${detail ? `: ${detail}` : ""}`)
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
  expectedVersion?: string
}

// Decodes one numeric character reference, guarding against out-of-range code
// points: String.fromCodePoint throws a RangeError outside 0..0x10FFFF, which
// would otherwise discard the whole authoritative stderr payload and force a
// regex fallback. Malformed references degrade to U+FFFD.
function safeCodePoint(codePoint: number): string {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\u{FFFD}"
}

// XML entity decode, mirroring the comment-guard audit parser. Kept local so the
// comment path stays untouched.
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function parseXmlAttributes(attrText: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrText)) !== null) {
    attributes[match[1]!] = decodeXml(match[2]!)
  }
  return attributes
}

// Parses the `test-checker` findings XML from stderr:
//   <findings file="a.ts">
//     <finding line-number="2" rule="R" confidence="C">message</finding>
//   </findings>
// One block per file, possibly several. Returns null when nothing parses, so the
// caller falls back to the regex rules (fail-open).
export function parseTestCheckerFindings(stderr: string, fallbackFile?: string): TestCheckerFinding[] | null {
  const findings: TestCheckerFinding[] = []
  const blockRegex = /<findings\b([^>]*)>([\s\S]*?)<\/findings>/g
  let block: RegExpExecArray | null
  while ((block = blockRegex.exec(stderr)) !== null) {
    const blockAttributes = parseXmlAttributes(block[1]!)
    const file = blockAttributes.file && blockAttributes.file.length > 0 ? blockAttributes.file : fallbackFile ?? ""
    const body = block[2]!
    const findingRegex = /<finding\b([^>]*?)\/>|<finding\b([^>]*)>([\s\S]*?)<\/finding>/g
    let finding: RegExpExecArray | null
    while ((finding = findingRegex.exec(body)) !== null) {
      const attributes = parseXmlAttributes(finding[1] ?? finding[2] ?? "")
      const rule = attributes.rule
      if (!rule || rule.length === 0) continue
      const lineValue = Number(attributes["line-number"])
      const message = finding[3] !== undefined ? decodeXml(finding[3]).trim() : ""
      const confidence = attributes.confidence
      findings.push({
        file,
        line: Number.isFinite(lineValue) ? lineValue : 0,
        rule,
        message,
        ...(confidence ? { confidence } : {}),
      })
    }
  }
  return findings.length > 0 ? findings : null
}

// Runs the test-checker binary on a hook payload.
//
//   exit 0 -> findings []  (clean)
//   exit 2 -> findings     (the `<findings>` XML on stderr, mapped to the
//                           test-guard shape); if nothing parses, `fallback`
//                           so the caller uses the regex rules
//   spawn/ENOENT/timeout/other exit -> `did-not-run`, so the caller can say so
//                           instead of reporting a silent "no findings"
export async function runTestChecker(input: HookInput, options: RunTestOptions = {}): Promise<TestCheckerResult> {
  const binaryPath = options.cliPath ?? resolvedTestCliPath ?? getTestCheckerPathSync()

  if (!binaryPath) {
    debugLog("test-checker binary not found")
    return { kind: "did-not-run", reason: "binary not found" }
  }

  if (!existsSync(binaryPath)) {
    debugLog("test-checker binary does not exist:", binaryPath)
    return { kind: "did-not-run", reason: `binary not found at ${binaryPath}` }
  }

  const stale = await staleBinaryReason(
    binaryPath,
    "test-checker",
    options.expectedVersion ?? getTestCheckerVersionFromCachePath(binaryPath),
    options.timeoutMs,
  )
  if (stale) {
    debugLog(stale)
    return { kind: "did-not-run", reason: stale }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running test-checker with input:", jsonInput.substring(0, 200))

  const outcome = await runProcess([binaryPath], { stdin: jsonInput, timeoutMs: options.timeoutMs })
  if (outcome === "timeout") {
    debugLog("test-checker abandoned after timeout or stream failure")
    return { kind: "did-not-run", reason: "timed out or could not be spawned" }
  }

  const { stdout, stderr, exitCode } = outcome
  debugLog("test-checker exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

  if (exitCode === 0) return { kind: "findings", findings: [] }
  if (exitCode !== 2) {
    debugLog("unexpected test-checker exit code:", exitCode, "stderr:", stderr)
    const detail = firstLine(stderr)
    return { kind: "did-not-run", reason: `exited with code ${exitCode}${detail ? `: ${detail}` : ""}` }
  }

  const findings = parseTestCheckerFindings(stderr, input.tool_input.file_path)
  if (findings === null) {
    debugLog("no parseable <finding> in test-checker stderr; falling back")
    return { kind: "fallback" }
  }
  return { kind: "findings", findings }
}
