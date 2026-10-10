import { spawn } from "bun"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { createDebugLog } from "./core/debug"
import { COMMENT_CHECKER_BINARY_NAME } from "./constants"

const debugLog = createDebugLog("comment-checker:downloader", process.env.COMMENT_CHECKER_DEBUG === "1")

const REPO = "code-yeongyu/go-claude-code-comment-checker"
const LATEST_URL = `https://github.com/${REPO}/releases/latest`
const LATEST_TTL_MS = 24 * 60 * 60 * 1000
const LATEST_CACHE_FILE = "latest.json"

interface PlatformInfo {
  os: string
  arch: string
  ext: "tar.gz" | "zip"
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "amd64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "tar.gz" },
  "linux-x64": { os: "linux", arch: "amd64", ext: "tar.gz" },
  "win32-x64": { os: "windows", arch: "amd64", ext: "zip" },
}

export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "opencode-comments-plugin", "bin")
}

export function getCachedBinaryPath(version?: string | null): string | null {
  if (!version) return null
  const binaryPath = join(getCacheDir(), version, COMMENT_CHECKER_BINARY_NAME)
  return existsSync(binaryPath) ? binaryPath : null
}

export function getCommentCheckerVersion(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("@code-yeongyu/comment-checker/package.json")
    const version = pkg?.version
    return typeof version === "string" && version.length > 0 ? version : null
  } catch {
    return null
  }
}

export function parseLatestTag(location: string | null): string | null {
  if (!location) return null
  const match = location.match(/\/tag\/v?(\d+\.\d+\.\d+)$/)
  return match ? match[1] : null
}

interface LatestCache {
  version: string
  checkedAt: number
}

function getLatestCachePath(): string {
  return join(getCacheDir(), LATEST_CACHE_FILE)
}

function readLatestCache(): LatestCache | null {
  try {
    const parsed = JSON.parse(readFileSync(getLatestCachePath(), "utf8")) as Partial<LatestCache>
    if (typeof parsed.version === "string" && parsed.version.length > 0 && typeof parsed.checkedAt === "number") {
      return { version: parsed.version, checkedAt: parsed.checkedAt }
    }
  } catch {
    debugLog("no latest-version cache")
  }
  return null
}

function writeLatestCache(version: string): void {
  try {
    const dir = getCacheDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getLatestCachePath(), JSON.stringify({ version, checkedAt: Date.now() }))
  } catch (err) {
    debugLog("failed to cache latest version:", err)
  }
}

export function getPreferredCommentCheckerVersionSync(): string | null {
  return readLatestCache()?.version ?? getCommentCheckerVersion()
}

export async function getLatestCommentCheckerVersion(): Promise<string | null> {
  const cached = readLatestCache()
  if (cached && Date.now() - cached.checkedAt < LATEST_TTL_MS) {
    return cached.version
  }

  try {
    const response = await fetch(LATEST_URL, { redirect: "manual" })
    const version = parseLatestTag(response.headers.get("location"))
    if (version) {
      debugLog("resolved latest comment-checker release:", version)
      writeLatestCache(version)
      return version
    }
    debugLog("could not parse latest release location:", response.headers.get("location"))
  } catch (err) {
    debugLog("failed to resolve latest release:", err)
  }

  if (cached) return cached.version
  return getCommentCheckerVersion()
}

export function cleanupStaleCache(version: string): void {
  let entries: string[]
  try {
    entries = readdirSync(getCacheDir())
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === version || entry === LATEST_CACHE_FILE) continue
    try {
      rmSync(join(getCacheDir(), entry), { recursive: true, force: true })
    } catch (err) {
      debugLog("Failed to remove stale cache entry:", entry, err)
    }
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting tar.gz:", archivePath, "to", destDir)

  const proc = spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting zip:", archivePath, "to", destDir)

  const proc = process.platform === "win32"
    ? spawn(["powershell", "-command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
        stdout: "pipe",
        stderr: "pipe",
      })
    : spawn(["unzip", "-o", archivePath, "-d", destDir], {
        stdout: "pipe",
        stderr: "pipe",
      })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

export async function downloadCommentChecker(versionOverride?: string): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]

  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey)
    return null
  }

  const version = versionOverride ?? getCommentCheckerVersion()
  if (!version) {
    debugLog("Cannot resolve a comment-checker version; refusing to download a stale binary")
    return null
  }

  const cacheDir = join(getCacheDir(), version)
  const binaryName = COMMENT_CHECKER_BINARY_NAME
  const binaryPath = join(cacheDir, binaryName)

  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath)
    return binaryPath
  }

  const { os, arch, ext } = platformInfo
  const assetName = `comment-checker_v${version}_${os}_${arch}.${ext}`
  const downloadUrl = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`

  debugLog("Downloading from:", downloadUrl)
  console.log("[opencode-comments-plugin] Downloading comment-checker binary...")

  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }

    const response = await fetch(downloadUrl, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const archivePath = join(cacheDir, assetName)
    const arrayBuffer = await response.arrayBuffer()
    await Bun.write(archivePath, arrayBuffer)

    debugLog("Downloaded archive to:", archivePath)

    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZip(archivePath, cacheDir)
    }

    if (existsSync(archivePath)) {
      unlinkSync(archivePath)
    }

    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755)
    }

    debugLog("Successfully downloaded binary to:", binaryPath)
    console.log("[opencode-comments-plugin] comment-checker binary ready.")

    cleanupStaleCache(version)

    return binaryPath
  } catch (err) {
    debugLog("Failed to download:", err)
    console.error(`[opencode-comments-plugin] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`)
    console.error("[opencode-comments-plugin] Comment checking disabled.")
    return null
  }
}

export async function ensureCommentCheckerBinary(versionOverride?: string): Promise<string | null> {
  const version = versionOverride ?? (await getLatestCommentCheckerVersion())
  if (!version) return null

  const cachedPath = getCachedBinaryPath(version)
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath)
    cleanupStaleCache(version)
    return cachedPath
  }

  return downloadCommentChecker(version)
}

// --- test-checker ---
//
// The test guard's default engine is the downloaded `test-checker` binary. It
// has no npm package (env `TEST_CHECKER_VERSION` is the only sync source) and
// caches under a SEPARATE subdirectory so the comment guard's `cleanupStaleCache`
// (which only walks `bin/`) can never remove it.

const TEST_REPO = "BaconDroid/go-claude-code-test-checker"
const TEST_LATEST_URL = `https://github.com/${TEST_REPO}/releases/latest`

export function getTestCheckerCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "opencode-comments-plugin", "test-checker")
}

export function getTestCheckerBinaryName(): string {
  return process.platform === "win32" ? "test-checker.exe" : "test-checker"
}

export function getCachedTestCheckerPath(version?: string | null): string | null {
  if (!version) return null
  const binaryPath = join(getTestCheckerCacheDir(), version, getTestCheckerBinaryName())
  return existsSync(binaryPath) ? binaryPath : null
}

export function getTestCheckerVersion(): string | null {
  const version = process.env.TEST_CHECKER_VERSION
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : null
}

function getTestLatestCachePath(): string {
  return join(getTestCheckerCacheDir(), LATEST_CACHE_FILE)
}

function readTestLatestCache(): LatestCache | null {
  try {
    const parsed = JSON.parse(readFileSync(getTestLatestCachePath(), "utf8")) as Partial<LatestCache>
    if (typeof parsed.version === "string" && parsed.version.length > 0 && typeof parsed.checkedAt === "number") {
      return { version: parsed.version, checkedAt: parsed.checkedAt }
    }
  } catch {
    debugLog("no test-checker latest-version cache")
  }
  return null
}

function writeTestLatestCache(version: string): void {
  try {
    const dir = getTestCheckerCacheDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getTestLatestCachePath(), JSON.stringify({ version, checkedAt: Date.now() }))
  } catch (err) {
    debugLog("failed to cache test-checker latest version:", err)
  }
}

export function getPreferredTestCheckerVersionSync(): string | null {
  return readTestLatestCache()?.version ?? getTestCheckerVersion()
}

export async function getLatestTestCheckerVersion(): Promise<string | null> {
  const cached = readTestLatestCache()
  if (cached && Date.now() - cached.checkedAt < LATEST_TTL_MS) {
    return cached.version
  }

  try {
    const response = await fetch(TEST_LATEST_URL, { redirect: "manual" })
    const version = parseLatestTag(response.headers.get("location"))
    if (version) {
      debugLog("resolved latest test-checker release:", version)
      writeTestLatestCache(version)
      return version
    }
    debugLog("could not parse latest test-checker release location:", response.headers.get("location"))
  } catch (err) {
    debugLog("failed to resolve latest test-checker release:", err)
  }

  if (cached) return cached.version
  return getTestCheckerVersion()
}

export function cleanupTestCheckerStaleCache(version: string): void {
  let entries: string[]
  try {
    entries = readdirSync(getTestCheckerCacheDir())
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === version || entry === LATEST_CACHE_FILE) continue
    try {
      rmSync(join(getTestCheckerCacheDir(), entry), { recursive: true, force: true })
    } catch (err) {
      debugLog("Failed to remove stale test-checker cache entry:", entry, err)
    }
  }
}

export async function downloadTestChecker(versionOverride?: string): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]

  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey)
    return null
  }

  const version = versionOverride ?? getTestCheckerVersion()
  if (!version) {
    debugLog("Cannot resolve a test-checker version; refusing to download a stale binary")
    return null
  }

  const cacheDir = join(getTestCheckerCacheDir(), version)
  const binaryName = getTestCheckerBinaryName()
  const binaryPath = join(cacheDir, binaryName)

  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath)
    return binaryPath
  }

  const { os, arch, ext } = platformInfo
  const assetName = `test-checker_v${version}_${os}_${arch}.${ext}`
  const downloadUrl = `https://github.com/${TEST_REPO}/releases/download/v${version}/${assetName}`

  debugLog("Downloading from:", downloadUrl)
  console.log("[opencode-comments-plugin] Downloading test-checker binary...")

  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }

    const response = await fetch(downloadUrl, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const archivePath = join(cacheDir, assetName)
    const arrayBuffer = await response.arrayBuffer()
    await Bun.write(archivePath, arrayBuffer)

    debugLog("Downloaded archive to:", archivePath)

    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZip(archivePath, cacheDir)
    }

    if (existsSync(archivePath)) {
      unlinkSync(archivePath)
    }

    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755)
    }

    debugLog("Successfully downloaded binary to:", binaryPath)
    console.log("[opencode-comments-plugin] test-checker binary ready.")

    cleanupTestCheckerStaleCache(version)

    return binaryPath
  } catch (err) {
    debugLog("Failed to download test-checker:", err)
    console.error(`[opencode-comments-plugin] Failed to download test-checker: ${err instanceof Error ? err.message : err}`)
    console.error("[opencode-comments-plugin] Test checking disabled.")
    return null
  }
}

export async function ensureTestCheckerBinary(versionOverride?: string): Promise<string | null> {
  const version = versionOverride ?? (await getLatestTestCheckerVersion())
  if (!version) return null

  const cachedPath = getCachedTestCheckerPath(version)
  if (cachedPath) {
    debugLog("Using cached test-checker binary:", cachedPath)
    cleanupTestCheckerStaleCache(version)
    return cachedPath
  }

  return downloadTestChecker(version)
}
