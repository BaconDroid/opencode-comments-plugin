import { test, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const binPath = join(process.cwd(), "src", "bin.ts")

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", binPath, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode }
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
}

test("validate-config accepts a valid file", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-"))
  try {
    const file = join(dir, "config.json")
    writeFileSync(file, JSON.stringify({ test_guard: { checks: { "skip-focus-added": "warn" } } }))
    const result = runCli(["guard", "validate-config", file], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("config is valid")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("validate-config rejects an invalid severity", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-"))
  try {
    const file = join(dir, "config.json")
    writeFileSync(file, JSON.stringify({ test_guard: { checks: { "skip-focus-added": "loud" } } }))
    const result = runCli(["guard", "validate-config", file], dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("skip-focus-added")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("guard check rejects an unknown scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-scope-"))
  try {
    const result = runCli(["guard", "check", "--scope", "nope"], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("--scope")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("guard check --diff exits non-zero when the diff weakens a test", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-git-"))
  try {
    git(dir, ["init"])
    git(dir, ["config", "user.email", "test@example.com"])
    git(dir, ["config", "user.name", "test"])
    writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(1).toBe(1)\n})\n")
    git(dir, ["add", "."])
    git(dir, ["commit", "-m", "init"])
    writeFileSync(join(dir, "a.test.ts"), "test.only('a', () => {\n  expect(1).toBe(1)\n})\n")

    const result = runCli(["guard", "check", "--diff"], dir)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("skip-focus-added")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
