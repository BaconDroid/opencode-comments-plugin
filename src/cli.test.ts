import { test, expect, beforeEach, afterEach } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCommentChecker } from "./cli"
import { ensureCommentCheckerBinary, getCachedBinaryPath, getCommentCheckerVersion } from "./downloader"
import type { HookInput } from "./types"

let dir: string
let scriptPath: string
let argsPath: string
let stdinPath: string

const previousXdg = process.env.XDG_CACHE_HOME

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "comment-checker-cli-"))
  scriptPath = join(dir, "fake-comment-checker")
  argsPath = join(dir, "args.txt")
  stdinPath = join(dir, "stdin.txt")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = previousXdg
})

type FakeKind = "clean" | "comment" | "hang"

function writeFakeBinary(kind: FakeKind): string {
  const body = kind === "hang"
    ? "#!/bin/sh\nsleep 30\n"
    : [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > '${argsPath}'`,
        `cat > '${stdinPath}'`,
        ...(kind === "comment" ? ['echo "comments detected" >&2'] : []),
        `exit ${kind === "comment" ? 2 : 0}`,
        "",
      ].join("\n")
  writeFileSync(scriptPath, body)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

function hookInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "session-1",
    tool_name: "Write",
    transcript_path: "",
    cwd: "/tmp",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: "/tmp/a.ts", content: "const a = 1\n" },
    ...overrides,
  }
}

test("runs the CLI without --prompt when none is configured and reports nothing on exit 0", async () => {
  const result = await runCommentChecker(hookInput(), { cliPath: writeFakeBinary("clean") })

  expect(result).toEqual({ hasComments: false, message: "" })
  expect((await Bun.file(argsPath).text()).trim()).toBe("")
  expect(JSON.parse(await Bun.file(stdinPath).text())).toMatchObject({
    session_id: "session-1",
    tool_name: "Write",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: "/tmp/a.ts", content: "const a = 1\n" },
  })
})

test("turns exit 2 plus a stderr message into a comment warning", async () => {
  const result = await runCommentChecker(hookInput(), { cliPath: writeFakeBinary("comment") })

  expect(result.hasComments).toBe(true)
  expect(result.message).toContain("comments detected")
})

test("forwards the custom prompt to the CLI", async () => {
  const result = await runCommentChecker(hookInput(), {
    cliPath: writeFakeBinary("clean"),
    prompt: "DETECTED:\n{{comments}}\nFix it.",
  })

  expect(result.hasComments).toBe(false)
  expect(await Bun.file(argsPath).text()).toBe("--prompt\nDETECTED:\n{{comments}}\nFix it.\n")
})

test("ignores an empty prompt instead of passing a bare --prompt flag", async () => {
  await runCommentChecker(hookInput(), { cliPath: writeFakeBinary("clean"), prompt: "   " })

  expect((await Bun.file(argsPath).text()).trim()).toBe("")
})

test("ignores a CLI that never answers instead of hanging the tool call", async () => {
  const result = await runCommentChecker(hookInput(), { cliPath: writeFakeBinary("hang") })

  expect(result).toEqual({ hasComments: false, message: "" })
}, 20_000)

test("caches the binary per comment-checker version and drops the stale versions", async () => {
  process.env.XDG_CACHE_HOME = dir
  const version = getCommentCheckerVersion()
  expect(version).toBeTruthy()

  const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
  const cacheRoot = join(dir, "opencode-comments-plugin", "bin")
  const versioned = join(cacheRoot, version!, binaryName)
  mkdirSync(join(cacheRoot, version!), { recursive: true })
  writeFileSync(versioned, "binary")
  mkdirSync(join(cacheRoot, "0.0.0-stale"), { recursive: true })
  writeFileSync(join(cacheRoot, "0.0.0-stale", binaryName), "stale")

  expect(getCachedBinaryPath(version)).toBe(versioned)
  expect(getCachedBinaryPath("9.9.9-not-installed")).toBe(null)

  expect(await ensureCommentCheckerBinary()).toBe(versioned)
  expect(existsSync(join(cacheRoot, "0.0.0-stale"))).toBe(false)
})
