import { test, expect } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const binPath = join(process.cwd(), "src", "bin.ts")

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", binPath, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode }
}

function writeCleanupStub(dir: string, body: string): string {
  const path = join(dir, "fake-cleanup-checker")
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
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

test("guard cleanup forwards only test files to --strip and renders removed and kept items", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-cleanup-"))
  try {
    const testFile = join(dir, "a.test.ts")
    const sourceFile = join(dir, "b.ts")
    const testContent = "test('same', () => {\n  expect(1).toBe(1)\n})\n"
    writeFileSync(testFile, testContent)
    writeFileSync(sourceFile, "export const b = 1\n")

    const argsPath = join(dir, "args.txt")
    const stdinPath = join(dir, "stdin.txt")
    const callsPath = join(dir, "calls.txt")
    const binary = writeCleanupStub(
      dir,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > '${argsPath}'`,
        `printf 'run\\n' >> '${callsPath}'`,
        `cat > '${stdinPath}'`,
        "printf '%s\\n' 'TEST QUALITY DETECTED' '[test-checker] cleanup pass: 1 removed, 1 kept awaiting approval.' '  removed: same [duplicate-test]' '  kept awaiting approval: taut [tautological-assertion]' '  approve a removal with a \"remove\" entry ({\"glob\",\"rules\",\"reason\"}) in .test-checker.json' >&2",
        "exit 2",
        "",
      ].join("\n"),
    )

    const result = runCli(["guard", "cleanup"], dir, { TC_BINARY: binary })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("# Test guard cleanup")
    expect(result.stdout).toContain("same")
    expect(result.stdout).toContain("duplicate-test")
    expect(result.stdout).toContain("taut")
    expect(result.stdout).toContain("tautological-assertion")
    expect(result.stdout).toContain(".test-checker.json")
    expect(await Bun.file(argsPath).text()).toBe("--strip\n--min-confidence\nlow\n")
    expect((await Bun.file(callsPath).text()).trim().split("\n")).toHaveLength(1)

    const payload = JSON.parse(await Bun.file(stdinPath).text())
    expect(payload).toMatchObject({
      tool_name: "Write",
      is_test_file: true,
      cwd: dir,
      tool_input: { file_path: testFile, content: testContent },
    })
    expect(await Bun.file(testFile).text()).toBe(testContent)
    expect(await Bun.file(sourceFile).text()).toBe("export const b = 1\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("guard cleanup reports a pre-strip binary as nothing to do and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-bin-cleanup-old-"))
  try {
    writeFileSync(join(dir, "a.test.ts"), "test('a', () => {\n  expect(1).toBe(1)\n})\n")
    const binary = writeCleanupStub(dir, "#!/bin/sh\ncat > /dev/null\nexit 0\n")

    const result = runCli(["guard", "cleanup"], dir, { TC_BINARY: binary })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("predate `--strip`")
    expect(result.stdout).toContain("nothing was rewritten")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
