import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedTestChanges, runCommentDiffCheck, runDiffCheck } from "./ci"

let dir: string

function git(args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guard-ci-"))
  git(["init"])
  git(["config", "user.email", "test@example.com"])
  git(["config", "user.name", "test"])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test("flags a focused test introduced by the diff", () => {
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(1).toBe(1)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.test.ts"), "test.only('a', () => {\n  expect(1).toBe(1)\n})\n")

  const result = runDiffCheck({ directory: dir, base: "HEAD" })
  expect(result.findings.map(f => f.rule)).toContain("skip-focus-added")
})

test("is silent on an unrelated change", () => {
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(1).toBe(1)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "b.test.ts"), "test('b', () => {\n  expect(2).toBe(2)\n})\n")

  const result = runDiffCheck({ directory: dir, base: "HEAD" })
  expect(result.findings).toHaveLength(0)
})

test("suppresses gutted-test when the assertions move to another file", () => {
  writeFileSync(
    join(dir, "a.test.ts"),
    "test('a', () => {\n  expect(a).toBe(1)\n  expect(b).toBe(2)\n  expect(c).toBe(3)\n})\n",
  )
  writeFileSync(join(dir, "b.test.ts"), "test('b', () => {\n  expect(x).toBe(0)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])

  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(a).toBe(1)\n})\n")
  writeFileSync(join(dir, "b.test.ts"), "test('b', () => {\n  expect(x).toBe(0)\n  expect(b).toBe(2)\n  expect(c).toBe(3)\n})\n")

  const result = runDiffCheck({ directory: dir, base: "HEAD" })
  expect(result.findings.map(f => f.rule)).not.toContain("gutted-test")
})

test("selects Ruby, Java and harness paths the shared gate covers", () => {
  writeFileSync(join(dir, "base.txt"), "")
  git(["add", "."])
  git(["commit", "-m", "init"])

  mkdirSync(join(dir, "pkg"))
  writeFileSync(join(dir, "pkg/foo_spec.rb"), "it 'sums' do\nend\n")
  mkdirSync(join(dir, "src/test/java"), { recursive: true })
  writeFileSync(join(dir, "src/test/java/AppTest.java"), "class AppTest {}\n")
  writeFileSync(join(dir, "pytest.ini"), "[pytest]\n")
  writeFileSync(join(dir, "app.py"), "print(1)\n")

  const paths = changedTestChanges(dir, "HEAD", []).map(change => change.filePath)
  expect(paths.some(path => path.endsWith("foo_spec.rb"))).toBe(true)
  expect(paths.some(path => path.endsWith("AppTest.java"))).toBe(true)
  expect(paths.some(path => path.endsWith("pytest.ini"))).toBe(true)
  expect(paths.some(path => path.endsWith("app.py"))).toBe(false)
})

test("json output is parseable", () => {
  writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(1).toBe(1)\n})\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.test.ts"), "test.skip('a', () => {\n  expect(1).toBe(1)\n})\n")

  const result = runDiffCheck({ directory: dir, base: "HEAD", format: "json" })
  const parsed = JSON.parse(result.output) as { findings: unknown[] }
  expect(parsed.findings.length).toBeGreaterThan(0)
})

test("runCommentDiffCheck reports the comments the checker returns", async () => {
  writeFileSync(join(dir, "a.ts"), "const a = 1\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.ts"), "const a = 1\n// explain\n")

  const result = await runCommentDiffCheck(
    { directory: dir, base: "HEAD" },
    {
      runCheck: async change =>
        change.addedLines.some(line => line.includes("//"))
          ? { hasComments: true, message: "COMMENT DETECTED" }
          : { hasComments: false, message: "" },
    },
  )
  expect(result.count).toBe(1)
  expect(result.output).toContain("COMMENT DETECTED")
})

test("runCommentDiffCheck is silent when the checker reports nothing", async () => {
  writeFileSync(join(dir, "a.ts"), "const a = 1\n")
  git(["add", "."])
  git(["commit", "-m", "init"])
  writeFileSync(join(dir, "a.ts"), "const a = 1\n// explain\n")

  const result = await runCommentDiffCheck({ directory: dir, base: "HEAD" }, {
    runCheck: async () => ({ hasComments: false, message: "" }),
  })
  expect(result.count).toBe(0)
  expect(result.output).toContain("No findings.")
})
