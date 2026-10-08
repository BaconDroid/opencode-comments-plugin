import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractChange } from "./diff"
import {
  buildJudgePrompt,
  createJudge,
  createModelJudgeRunner,
  formatJudgeFindings,
  parseJudgeResponse,
  runJudge,
  type JudgeFinding,
} from "./judge"

function change(filePath: string, oldText: string, newText: string) {
  return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false })
}

test("builds a prompt from added and removed lines", () => {
  const prompt = buildJudgePrompt([change("/work/a.test.ts", "expect(a).toBe(1)\n", "expect(a).toBeTruthy()\n")])
  expect(prompt).toContain("--- /work/a.test.ts")
  expect(prompt).toContain("- expect(a).toBe(1)")
  expect(prompt).toContain("+ expect(a).toBeTruthy()")
  expect(prompt).toContain("JSON array")
})

test("returns an empty prompt when there are no changes", () => {
  expect(buildJudgePrompt([change("/work/a.test.ts", "same\n", "same\n")])).toBe("")
})

test("parses a fenced JSON array", () => {
  const raw = '```json\n[{"file":"a.ts","line":3,"reason":"removed assertion","confidence":"high"}]\n```'
  const findings = parseJudgeResponse(raw)
  expect(findings).toEqual([{ file: "a.ts", line: 3, reason: "removed assertion", confidence: "high" }])
})

test("rejects placeholder reasons and malformed output", () => {
  expect(parseJudgeResponse('[{"file":"a.ts","reason":"placeholder"}]')).toEqual([])
  expect(parseJudgeResponse("no json here")).toEqual([])
  expect(parseJudgeResponse('{"not":"an array"}')).toEqual([])
})

test("runJudge is disabled by default", async () => {
  const findings = await runJudge([change("/a.test.ts", "x\n", "y\n")], { enabled: false }, async () => "[]")
  expect(findings).toEqual([])
})

test("runJudge parses the runner output", async () => {
  const runner = async () => '[{"file":"a.ts","line":1,"reason":"skipped test","confidence":"high"}]'
  const findings = await runJudge([change("/a.test.ts", "x\n", "y\n")], { enabled: true }, runner)
  expect(findings).toHaveLength(1)
})

test("runJudge is fail-open on a runner error", async () => {
  const runner = async () => {
    throw new Error("boom")
  }
  expect(await runJudge([change("/a.test.ts", "x\n", "y\n")], { enabled: true }, runner)).toEqual([])
})

test("formats findings for feedback", () => {
  const findings: JudgeFinding[] = [{ file: "a.ts", line: 2, reason: "loosened matcher", confidence: "medium" }]
  expect(formatJudgeFindings(findings)).toContain("LLM judge (advisory")
  expect(formatJudgeFindings(findings)).toContain("a.ts:2 loosened matcher (medium)")
})

test("model runner uses the configured model and deletes the sandbox session", async () => {
  let captured: unknown
  let deleted = false
  const client = {
    session: {
      create: async () => ({ data: { id: "s1" } }),
      prompt: async (options: unknown) => {
        captured = options
        return { data: { parts: [{ type: "text", text: "[]" }] } }
      },
      delete: async () => {
        deleted = true
        return {}
      },
    },
  }
  const runner = createModelJudgeRunner(client, "/work")
  await runner("prompt", "anthropic/claude-3")
  expect((captured as { body: { model: unknown } }).body.model).toEqual({ providerID: "anthropic", modelID: "claude-3" })
  expect(deleted).toBe(true)
})

test("model runner is a no-op without a client", async () => {
  const runner = createModelJudgeRunner(undefined, "/work")
  expect(await runner("prompt")).toBe("")
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guard-judge-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function git(args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
}

test("judge controller runs on idle with cooldown and on demand", async () => {
  git(["init"])
  git(["config", "user.email", "test@example.com"])
  git(["config", "user.name", "test"])
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(a).toBe(1)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(a).toBeTruthy()\n})\n")

  const runner = async () => '[{"file":"a.test.ts","line":2,"reason":"loosened matcher","confidence":"high"}]'
  const judge = createJudge({
    directory: dir,
    getConfig: () => ({ enabled: true }),
    getTestPatterns: () => ["**/*.test.ts"],
    runner,
  })

  const first = await judge.onIdle("s1")
  expect(first).toContain("loosened matcher")
  expect(await judge.onIdle("s1")).toBeNull()
  expect(await judge.judgeNow()).toContain("loosened matcher")
})

test("judge controller does nothing when disabled", async () => {
  const judge = createJudge({
    directory: dir,
    getConfig: () => ({ enabled: false }),
    getTestPatterns: () => ["**/*.test.ts"],
    runner: async () => "[]",
  })
  expect(await judge.onIdle("s1")).toBeNull()
})
