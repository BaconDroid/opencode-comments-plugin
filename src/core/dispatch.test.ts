import { test, expect, beforeEach, afterEach, setSystemTime } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TEST_GUARD_MARKER } from "./feedback"
import { createTestGuard, type ResolvedTestGuard, type TestGuardDeps } from "./dispatch"
import { DEFAULT_TEST_PATTERNS } from "../rules/tests/patterns"
import { runTestChecker } from "../cli"
import type { Severity } from "./config"

const dir = mkdtempSync(join(tmpdir(), "test-guard-"))

function config(overrides: Partial<ResolvedTestGuard> = {}): ResolvedTestGuard {
  return {
    enabled: true,
    testPatterns: [...DEFAULT_TEST_PATTERNS],
    checks: { "skip-focus-added": "warn", "protected-paths": "warn" },
    maxWarningsPerFile: 0,
    // These tests pin the deterministic regex engine; the binary engine and its
    // fallback are covered by `rules/tests/analyzer.test.ts` and `index.test.ts`.
    engine: "regex",
    ...overrides,
  }
}

type Output = { title: string; output: string; metadata: unknown }

const INPUT = { tool: "write", sessionID: "s1", callID: "c1" }

function guarded(resolved: ResolvedTestGuard, deps: TestGuardDeps = {}) {
  return createTestGuard(() => resolved, deps)
}

let counter = 0
function freshCallID() {
  counter += 1
  return `call-${counter}`
}

beforeEach(() => {
  counter = 0
})

afterEach(() => {
  setSystemTime()
})

test("warns and appends once for a focused test added by write", async () => {
  const guard = guarded(config())
  const callID = freshCallID()
  const args = { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" }
  guard.before({ ...INPUT, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID }, output)

  expect(output.output).toContain(TEST_GUARD_MARKER)
  expect(output.output).toContain("skip-focus-added")
  expect(output.output.startsWith("Wrote file successfully.")).toBe(true)
})

test("does not duplicate the marker when after runs twice", async () => {
  const guard = guarded(config())
  const callID = freshCallID()
  const args = { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" }
  guard.before({ ...INPUT, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID }, output)
  const once = output.output
  await guard.after({ ...INPUT, callID }, output)
  expect(output.output).toBe(once)
})

test("leaves output untouched when no rule fires", async () => {
  const guard = guarded(config())
  const callID = freshCallID()
  const args = { filePath: "/work/a.test.ts", content: "it('a', () => {\n  expect(1).toBe(1)\n})\n" }
  guard.before({ ...INPUT, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID }, output)
  expect(output.output).toBe("Wrote file successfully.")
})

test("never throws in after", async () => {
  const guard = createTestGuard(() => {
    throw new Error("config exploded")
  })
  const output: Output = { title: "", output: "ok", metadata: {} }
  await expect(guard.after({ ...INPUT, callID: "x" }, output)).resolves.toBeUndefined()
  expect(output.output).toBe("ok")
})

test("warn mode never throws on an existing test file", () => {
  const filePath = join(dir, "existing2.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config())
  expect(() => guard.before({ ...INPUT, callID: freshCallID() }, { args: { filePath, content: "it('b', () => {})\n" } })).not.toThrow()
})

test("checks an apply_patch update through the tool metadata", async () => {
  const guard = guarded(config())
  const output: Output = {
    title: "",
    output: "Success. Updated the following files:",
    metadata: {
      files: [
        { type: "update", filePath: "/work/src/a.test.ts", patch: "@@ -1 +1 @@\n-// old\n+it.only('x', () => {})\n" },
      ],
    },
  }
  await guard.after({ tool: "apply_patch", sessionID: "s", callID: freshCallID() }, output)
  expect(output.output).toContain("skip-focus-added")
})

test("respects off severity", async () => {
  const checks: Record<string, Severity> = { "skip-focus-added": "off" }
  const guard = guarded(config({ checks }))
  const callID = freshCallID()
  const args = { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" }
  guard.before({ ...INPUT, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID }, output)
  expect(output.output).toBe("Wrote file successfully.")
})

test("records a bypass even when no rule fires", async () => {
  const guard = guarded(config())
  const callID = freshCallID()
  const args = {
    filePath: "/work/a.test.ts",
    content: "// test-guard: allow intentional\ntest.only('a', () => {\n  expect(1).toBe(1)\n})\n",
  }
  guard.before({ ...INPUT, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID }, output)
  expect(output.output).toContain("Test guard bypass recorded")
  expect(output.output).toContain("allow")
})

test("coexists with another plugin without clobbering or duplicating output", async () => {
  const guard = guarded(config())
  const callID = freshCallID()
  const args = { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" }
  guard.before({ ...INPUT, callID }, { args })

  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  const slimMessage = "\n\n[oh-my-opencode-slim] hint"

  // slim-style plugin appends first
  output.output += slimMessage
  await guard.after({ ...INPUT, callID }, output)

  expect(output.output).toContain(slimMessage.trim())
  expect(output.output).toContain("skip-focus-added")
  expect(output.output.split(TEST_GUARD_MARKER).length - 1).toBe(1)
})

test("restricts the checked tools with the tools option", async () => {
  const guard = guarded(config({ triggerTools: new Set(["write"]) }))
  const editCall = freshCallID()
  guard.before({ tool: "edit", sessionID: "s1", callID: editCall }, { args: { filePath: "/work/a.test.ts", oldString: "a", newString: "it.only('a', () => {})" } })
  const editOutput: Output = { title: "", output: "The file has been updated.", metadata: {} }
  await guard.after({ tool: "edit", sessionID: "s1", callID: editCall }, editOutput)
  expect(editOutput.output).toBe("The file has been updated.")

  const writeCall = freshCallID()
  guard.before({ ...INPUT, callID: writeCall }, { args: { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" } })
  const writeOutput: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID: writeCall }, writeOutput)
  expect(writeOutput.output).toContain("skip-focus-added")
})

test("restricts apply_patch when apply_patch is not in the tools option", async () => {
  const guard = guarded(config({ triggerTools: new Set(["write"]) }))
  const output: Output = {
    title: "",
    output: "Success. Updated the following files:",
    metadata: { files: [{ type: "update", filePath: "/work/src/a.test.ts", patch: "@@ -1 +1 @@\n-// old\n+it.only('x', () => {})\n" }] },
  }
  await guard.after({ tool: "apply_patch", sessionID: "s", callID: freshCallID() }, output)
  expect(output.output).toBe("Success. Updated the following files:")
})

test("dedups repeated findings within the window unless the window is zero", async () => {
  const args = { filePath: "/work/dedup.test.ts", content: "it.only('a', () => {})\n" }

  const deduped = guarded(config())
  const firstCall = freshCallID()
  deduped.before({ ...INPUT, callID: firstCall }, { args })
  const first: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await deduped.after({ ...INPUT, callID: firstCall }, first)
  expect(first.output).toContain("skip-focus-added")

  const secondCall = freshCallID()
  deduped.before({ ...INPUT, callID: secondCall }, { args })
  const second: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await deduped.after({ ...INPUT, callID: secondCall }, second)
  expect(second.output).toBe("Wrote file successfully.")

  const noDedup = guarded(config({ dedupWindowMs: 0 }))
  for (let i = 0; i < 2; i++) {
    const callID = freshCallID()
    noDedup.before({ ...INPUT, callID }, { args })
    const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
    await noDedup.after({ ...INPUT, callID }, output)
    expect(output.output).toContain("skip-focus-added")
  }
})

test("does not process a pending call older than the TTL", async () => {
  const guard = guarded(config())
  const stale = freshCallID()
  guard.before({ ...INPUT, callID: stale }, { args: { filePath: "/work/a.test.ts", content: "it.only('a', () => {})\n" } })

  setSystemTime(new Date(Date.now() + 120_000))
  guard.before({ ...INPUT, callID: freshCallID() }, { args: { filePath: "/work/b.test.ts", content: "const x = 1\n" } })

  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ ...INPUT, callID: stale }, output)
  expect(output.output).toBe("Wrote file successfully.")
})

// --- test-checker "did not run" ---

function fakeTestChecker(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

function guardWithChecker(cliPath: string) {
  return guarded(config({ engine: "binary" }), {
    runTestChecker: input => runTestChecker(input, { cliPath, timeoutMs: 200 }),
  })
}

async function writeTestFile(guard: ReturnType<typeof guarded>, sessionID: string, callID: string): Promise<Output> {
  const args = {
    filePath: "/work/clean.test.ts",
    content: "it('a', () => {\n  expect(1).toBe(1)\n})\n",
  }
  guard.before({ tool: "write", sessionID, callID }, { args })
  const output: Output = { title: "", output: "Wrote file successfully.", metadata: {} }
  await guard.after({ tool: "write", sessionID, callID }, output)
  return output
}

const DID_NOT_RUN_CASES = [
  { label: "exit 1", body: "#!/bin/sh\ncat > /dev/null\nexit 1\n", reason: "exited with code 1" },
  { label: "exit 127", body: "#!/bin/sh\ncat > /dev/null\nexit 127\n", reason: "exited with code 127" },
  { label: "ENOENT", body: null, reason: "binary not found" },
  { label: "timeout", body: "#!/bin/sh\nsleep 30\n", reason: "timed out or could not be spawned" },
] as const

for (const scenario of DID_NOT_RUN_CASES) {
  test(`test guard warns once per session and does not block when the checker did not run (${scenario.label})`, async () => {
    const cliPath = scenario.body === null
      ? join(dir, "missing-test-checker")
      : fakeTestChecker(`fake-test-checker-${scenario.label}`, scenario.body)
    const guard = guardWithChecker(cliPath)
    const session = `test-did-not-run-${scenario.label}`

    const first = await writeTestFile(guard, session, `first-${scenario.label}`)
    expect(first.output).toContain("test-checker did not run — nothing checked this write.")
    expect(first.output).toContain(scenario.reason)
    expect(first.output.startsWith("Wrote file successfully.")).toBe(true)

    const second = await writeTestFile(guard, session, `second-${scenario.label}`)
    expect(second.output).toBe("Wrote file successfully.")
    expect(second.output).not.toContain("did not run")
  }, 20_000)
}
