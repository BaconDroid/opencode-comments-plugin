import { test, expect, beforeEach, afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCommentCheckerVersion, getLatestCommentCheckerVersion, parseLatestTag } from "./downloader"

const originalFetch = globalThis.fetch
const originalXdg = process.env.XDG_CACHE_HOME
const dir = mkdtempSync(join(tmpdir(), "comment-checker-downloader-"))

function writeLatestCache(version: string, checkedAt: number): void {
  const cacheDir = join(dir, "opencode-comments-plugin", "bin")
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
