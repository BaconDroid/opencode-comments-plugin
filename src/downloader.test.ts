import { test, expect, beforeEach, afterAll } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cleanupStaleCache,
  downloadTestChecker,
  getCachedTestCheckerPath,
  getCommentCheckerVersion,
  getLatestCommentCheckerVersion,
  getLatestTestCheckerVersion,
  getTestCheckerCacheDir,
  getTestCheckerVersion,
  parseLatestTag,
} from "./downloader"

const originalFetch = globalThis.fetch
const originalXdg = process.env.XDG_CACHE_HOME
const dir = mkdtempSync(join(tmpdir(), "comment-checker-downloader-"))

function writeLatestCache(version: string, checkedAt: number): void {
  const cacheDir = join(dir, "opencode-comments-plugin", "bin")
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, "latest.json"), JSON.stringify({ version, checkedAt }))
}

function writeTestLatestCache(version: string, checkedAt: number): void {
  const cacheDir = getTestCheckerCacheDir()
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, "latest.json"), JSON.stringify({ version, checkedAt }))
}

beforeEach(() => {
  process.env.XDG_CACHE_HOME = dir
  rmSync(join(dir, "opencode-comments-plugin"), { recursive: true, force: true })
  globalThis.fetch = originalFetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
  rmSync(dir, { recursive: true, force: true })
  if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalXdg
})

test("parses the version out of a release redirect", () => {
  expect(parseLatestTag("https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/tag/v0.8.2")).toBe("0.8.2")
  expect(parseLatestTag("https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/tag/v1.2.3")).toBe("1.2.3")
  expect(parseLatestTag(null)).toBe(null)
  expect(parseLatestTag("https://example.com/not-a-release")).toBe(null)
})

test("returns the cached latest version without hitting the network", async () => {
  writeLatestCache("9.9.9", Date.now())
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 500 })
  }) as unknown as typeof fetch

  expect(await getLatestCommentCheckerVersion()).toBe("9.9.9")
  expect(called).toBe(false)
})

test("resolves and caches the latest release from the redirect", async () => {
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: {
        location: "https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/tag/v7.7.7",
      },
    })) as unknown as typeof fetch

  expect(await getLatestCommentCheckerVersion()).toBe("7.7.7")

  const cached = JSON.parse(readFileSync(join(dir, "opencode-comments-plugin", "bin", "latest.json"), "utf8"))
  expect(cached.version).toBe("7.7.7")
})

test("falls back to the installed version when the network fails and nothing is cached", async () => {
  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch

  expect(await getLatestCommentCheckerVersion()).toBe(getCommentCheckerVersion())
})

// --- test-checker resolution ---

const TEST_ASSET: Record<string, [string, string]> = {
  "darwin-arm64": ["darwin", "arm64"],
  "darwin-x64": ["darwin", "amd64"],
  "linux-arm64": ["linux", "arm64"],
  "linux-x64": ["linux", "amd64"],
  "win32-x64": ["windows", "amd64"],
}

test("keeps the test-checker cache outside the comment bin root", () => {
  process.env.XDG_CACHE_HOME = dir
  expect(getTestCheckerCacheDir()).toBe(join(dir, "opencode-comments-plugin", "test-checker"))
})

test("resolves the test-checker version from TEST_CHECKER_VERSION only", () => {
  delete process.env.TEST_CHECKER_VERSION
  expect(getTestCheckerVersion()).toBe(null)
  process.env.TEST_CHECKER_VERSION = "1.2.3"
  expect(getTestCheckerVersion()).toBe("1.2.3")
  process.env.TEST_CHECKER_VERSION = "   "
  expect(getTestCheckerVersion()).toBe(null)
  delete process.env.TEST_CHECKER_VERSION
})

test("requests the versioned test-checker asset for this platform", async () => {
  process.env.XDG_CACHE_HOME = dir
  const platform = TEST_ASSET[`${process.platform}-${process.arch}`]
  if (!platform) return
  const ext = process.platform === "win32" ? "zip" : "tar.gz"
  process.env.TEST_CHECKER_VERSION = "9.9.9"

  let requested = ""
  globalThis.fetch = (async (input: unknown) => {
    requested = String(input)
    throw new Error("offline")
  }) as unknown as typeof fetch

  expect(await downloadTestChecker()).toBe(null)
  expect(requested).toBe(
    `https://github.com/BaconDroid/go-claude-code-test-checker/releases/download/v9.9.9/test-checker_v9.9.9_${platform[0]}_${platform[1]}.${ext}`,
  )
  delete process.env.TEST_CHECKER_VERSION
})

test("returns null when the platform has no released test-checker asset", async () => {
  process.env.XDG_CACHE_HOME = dir
  const originalPlatform = process.platform
  const originalArch = process.arch
  Object.defineProperty(process, "platform", { value: "sunos", configurable: true })
  Object.defineProperty(process, "arch", { value: "sparc", configurable: true })
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch
  try {
    expect(await downloadTestChecker("1.0.0")).toBe(null)
    expect(called).toBe(false)
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true })
  }
})

test("returns the cached test-checker latest version without hitting the network", async () => {
  process.env.XDG_CACHE_HOME = dir
  writeTestLatestCache("3.2.1", Date.now())
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 500 })
  }) as unknown as typeof fetch

  expect(await getLatestTestCheckerVersion()).toBe("3.2.1")
  expect(called).toBe(false)
})

test("resolves and caches the latest test-checker release from the redirect", async () => {
  process.env.XDG_CACHE_HOME = dir
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: {
        location: "https://github.com/BaconDroid/go-claude-code-test-checker/releases/tag/v4.5.6",
      },
    })) as unknown as typeof fetch

  expect(await getLatestTestCheckerVersion()).toBe("4.5.6")

  const cached = JSON.parse(readFileSync(join(getTestCheckerCacheDir(), "latest.json"), "utf8"))
  expect(cached.version).toBe("4.5.6")
})

test("the comment cache cleanup never removes the test-checker cache", () => {
  process.env.XDG_CACHE_HOME = dir
  const testVersion = "0.1.0"
  const binaryName = process.platform === "win32" ? "test-checker.exe" : "test-checker"
  const testBinary = join(getTestCheckerCacheDir(), testVersion, binaryName)
  mkdirSync(join(getTestCheckerCacheDir(), testVersion), { recursive: true })
  writeFileSync(testBinary, "binary")

  expect(getCachedTestCheckerPath(testVersion)).toBe(testBinary)
  cleanupStaleCache("0.8.2")
  expect(existsSync(testBinary)).toBe(true)
})
