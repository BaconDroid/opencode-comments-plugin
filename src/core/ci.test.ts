import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runDiffCheck } from "./ci"

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

test("suppresses net-assertion-loss when the assertions move to another file", () => {
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
  expect(result.findings.map(f => f.rule)).not.toContain("net-assertion-loss")
  expect(result.findings.map(f => f.rule)).not.toContain("gutted-test")
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
