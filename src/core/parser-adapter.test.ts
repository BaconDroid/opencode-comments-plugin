import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractChange } from "./diff"
import {
  buildParserPayload,
  createParserAdapter,
  formatParserFindings,
  parseParserFindings,
  runParserAdapter,
  type ParserFinding,
} from "./parser-adapter"

function change(filePath: string, oldText: string, newText: string) {
  return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false })
}

test("builds a JSON payload from the diff", () => {
  const payload = JSON.parse(buildParserPayload([change("/work/a.test.ts", "expect(a).toBe(1)\n", "expect(a).toBeTruthy()\n")]))
  expect(payload.files).toHaveLength(1)
  expect(payload.files[0].path).toBe("/work/a.test.ts")
  expect(payload.files[0].removed).toEqual(["expect(a).toBe(1)"])
  expect(payload.files[0].added).toEqual(["expect(a).toBeTruthy()"])
})

test("parses findings from a wrapped object", () => {
  const raw = '{"findings":[{"file":"a.ts","line":3,"rule":"ast/no-assert","message":"no assertion","confidence":"high"}]}'
  expect(parseParserFindings(raw)).toEqual([
    { file: "a.ts", line: 3, rule: "ast/no-assert", message: "no assertion", confidence: "high" },
  ])
})

test("parses findings from a bare array and rejects placeholders", () => {
  const raw = '[{"file":"a.ts","message":"placeholder"}]'
  expect(parseParserFindings(raw)).toEqual([])
})

test("runParserAdapter is disabled by default and without a command", async () => {
  const changes = [change("/a.test.ts", "x\n", "y\n")]
  expect(await runParserAdapter(changes, { enabled: false, command: "x" })).toEqual([])
  expect(await runParserAdapter(changes, { enabled: true })).toEqual([])
})

test("runParserAdapter passes the payload to the command and parses output", async () => {
  let received = ""
  const run = async (_command: string, payload: string) => {
    received = payload
    return '{"findings":[{"file":"a.ts","line":1,"message":"weakened"}]}'
  }
  const findings = await runParserAdapter([change("/a.test.ts", "x\n", "y\n")], { enabled: true, command: "ast" }, run)
  expect(findings).toHaveLength(1)
  expect(JSON.parse(received).files).toHaveLength(1)
})

test("runParserAdapter is fail-open on a command error", async () => {
  const run = async () => {
    throw new Error("boom")
  }
  expect(await runParserAdapter([change("/a.test.ts", "x\n", "y\n")], { enabled: true, command: "ast" }, run)).toEqual([])
})

test("formats parser findings", () => {
  const findings: ParserFinding[] = [{ file: "a.ts", line: 2, rule: "ast/x", message: "loosened", confidence: "high" }]
  expect(formatParserFindings(findings)).toContain("External parser (advisory")
  expect(formatParserFindings(findings)).toContain("a.ts:2 [ast/x] loosened (high)")
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guard-parser-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function git(args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
}

test("parser controller runs on idle with cooldown and on demand", async () => {
  git(["init"])
  git(["config", "user.email", "test@example.com"])
  git(["config", "user.name", "test"])
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(a).toBe(1)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(a).toBeTruthy()\n})\n")

  const run = async () => '{"findings":[{"file":"a.test.ts","line":2,"message":"loosened matcher"}]}'
  const parser = createParserAdapter({
    directory: dir,
    getConfig: () => ({ enabled: true, command: "ast" }),
    getTestPatterns: () => ["**/*.test.ts"],
    run,
  })

  const first = await parser.onIdle("s1")
  expect(first).toContain("loosened matcher")
  expect(await parser.onIdle("s1")).toBeNull()
  expect(await parser.analyzeNow()).toContain("loosened matcher")
})

test("parser controller reports disabled on demand", async () => {
  const parser = createParserAdapter({
    directory: dir,
    getConfig: () => ({ enabled: false }),
    getTestPatterns: () => ["**/*.test.ts"],
  })
  expect(await parser.analyzeNow()).toContain("disabled")
})
