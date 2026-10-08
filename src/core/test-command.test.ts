import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectTestCommand } from "./test-command"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "test-command-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test("detects the package.json test script", () => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
  expect(detectTestCommand(dir)).toBe("vitest run")
})

test("falls back to pytest.ini", () => {
  writeFileSync(join(dir, "pytest.ini"), "[pytest]\n")
  expect(detectTestCommand(dir)).toBe("pytest")
})

test("detects pyproject with a pytest section", () => {
  writeFileSync(join(dir, "pyproject.toml"), "[tool.pytest.ini_options]\n")
  expect(detectTestCommand(dir)).toBe("pytest")
})

test("detects go and cargo projects", () => {
  writeFileSync(join(dir, "go.mod"), "module x\n")
  expect(detectTestCommand(dir)).toBe("go test ./...")
  rmSync(join(dir, "go.mod"))
  writeFileSync(join(dir, "Cargo.toml"), "[package]\n")
  expect(detectTestCommand(dir)).toBe("cargo test")
})

test("returns null when nothing matches", () => {
  expect(detectTestCommand(dir)).toBeNull()
})
