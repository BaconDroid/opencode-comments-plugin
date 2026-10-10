import { test, expect, beforeEach, afterEach } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCommentChecker, runTestChecker, parseTestCheckerFindings } from "./cli"
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

test("honours the timeout option so a hung CLI cannot block the tool call", async () => {
  const started = Date.now()
  const result = await runCommentChecker(hookInput(), { cliPath: writeFakeBinary("hang"), timeoutMs: 200 })

  expect(result).toEqual({ hasComments: false, message: "" })
  expect(Date.now() - started).toBeLessThan(5_000)
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
  writeFileSync(join(cacheRoot, "latest.json"), JSON.stringify({ version, checkedAt: Date.now() }))
  mkdirSync(join(cacheRoot, "0.0.0-stale"), { recursive: true })
  writeFileSync(join(cacheRoot, "0.0.0-stale", binaryName), "stale")

  expect(getCachedBinaryPath(version)).toBe(versioned)
  expect(getCachedBinaryPath("9.9.9-not-installed")).toBe(null)

  expect(await ensureCommentCheckerBinary()).toBe(versioned)
  expect(existsSync(join(cacheRoot, "0.0.0-stale"))).toBe(false)
  expect(existsSync(join(cacheRoot, "latest.json"))).toBe(true)
})

// --- test-checker (stderr `<findings>` XML contract) ---

type FakeTestKind = "findings" | "no-xml" | "clean"

function writeFakeTestChecker(kind: FakeTestKind): string {
  const scriptPath = join(dir, "fake-test-checker")
  const body = kind === "clean"
    ? "#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' 'TEST QUALITY DETECTED: no weakened tests.' >&2\nexit 0\n"
    : kind === "no-xml"
      ? "#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' 'TEST QUALITY DETECTED (but no xml)' >&2\nexit 2\n"
      : "#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' 'TEST QUALITY DETECTED' '<findings file=\"/work/a.test.ts\"><finding line-number=\"2\" rule=\"skip-focus-added\" confidence=\"high\">Focused test added.</finding></findings>' '<findings file=\"/work/b.test.ts\"><finding line-number=\"5\" rule=\"empty-test\" confidence=\"medium\">Test body has no executable statement.</finding></findings>' >&2\nexit 2\n"
  writeFileSync(scriptPath, body)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

function testHookInput(): HookInput {
  return {
    session_id: "session-1",
    tool_name: "Write",
    transcript_path: "",
    cwd: "/tmp",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: "/work/a.test.ts", content: "it.only('a', () => {})\n" },
  }
}

test("runTestChecker parses the exit-2 stderr findings XML for every file", async () => {
  const findings = await runTestChecker(testHookInput(), { cliPath: writeFakeTestChecker("findings") })

  expect(findings).toEqual([
    { file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." },
    { file: "/work/b.test.ts", line: 5, rule: "empty-test", message: "Test body has no executable statement." },
  ])
})

test("runTestChecker returns null when exit 2 carries no parseable finding", async () => {
  expect(await runTestChecker(testHookInput(), { cliPath: writeFakeTestChecker("no-xml") })).toBe(null)
})

test("runTestChecker returns [] on exit 0 regardless of the stderr message", async () => {
  expect(await runTestChecker(testHookInput(), { cliPath: writeFakeTestChecker("clean") })).toEqual([])
})

test("parseTestCheckerFindings decodes XML entities and supports self-closing findings", () => {
  const xml =
    '<findings file="a &amp; b.ts"><finding line-number="3" rule="tautological-assertion" confidence="high">assert &lt;x&gt; &amp; true</finding><finding line-number="7" rule="empty-test"/></findings>'
  expect(parseTestCheckerFindings(xml)).toEqual([
    { file: "a & b.ts", line: 3, rule: "tautological-assertion", message: "assert <x> & true" },
    { file: "a & b.ts", line: 7, rule: "empty-test", message: "" },
  ])
})

test("parseTestCheckerFindings falls back to the payload file and returns null without XML", () => {
  expect(parseTestCheckerFindings("just a message")).toBe(null)
  expect(parseTestCheckerFindings('<findings><finding line-number="1" rule="x">m</finding></findings>', "/fallback.ts")).toEqual([
    { file: "/fallback.ts", line: 1, rule: "x", message: "m" },
  ])
})
