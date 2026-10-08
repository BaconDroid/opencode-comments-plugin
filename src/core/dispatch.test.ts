import { test, expect, beforeEach } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TEST_GUARD_MARKER } from "./feedback"
import { createTestGuard, extractPatchEntries, type ResolvedTestGuard } from "./dispatch"
import { DEFAULT_TEST_PATTERNS } from "../rules/tests/patterns"
import type { Severity } from "./config"

const dir = mkdtempSync(join(tmpdir(), "test-guard-"))

function config(overrides: Partial<ResolvedTestGuard> = {}): ResolvedTestGuard {
  return {
    enabled: true,
    testPatterns: [...DEFAULT_TEST_PATTERNS],
    checks: { "skip-focus-added": "warn", "protected-paths": "warn" },
    maxWarningsPerFile: 0,
    netAssertionLossThreshold: 2,
    ...overrides,
  }
}

type Output = { title: string; output: string; metadata: unknown }

const INPUT = { tool: "write", sessionID: "s1", callID: "c1" }

function guarded(resolved: ResolvedTestGuard) {
  return createTestGuard(() => resolved)
}

let counter = 0
function freshCallID() {
  counter += 1
  return `call-${counter}`
}

beforeEach(() => {
  counter = 0
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

test("block mode refuses to edit an existing test file", () => {
  const filePath = join(dir, "existing.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  expect(() => guard.before({ ...INPUT, callID: freshCallID() }, { args: { filePath, content: "it('b', () => {})\n" } })).toThrow(
    /protected-paths/,
  )
})

test("block mode exempts a new test file", () => {
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const filePath = join(dir, "brand-new.test.ts")
  expect(() => guard.before({ ...INPUT, callID: freshCallID() }, { args: { filePath, content: "it('a', () => {})\n" } })).not.toThrow()
})

test("warn mode never throws on an existing test file", () => {
  const filePath = join(dir, "existing2.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config())
  expect(() => guard.before({ ...INPUT, callID: freshCallID() }, { args: { filePath, content: "it('b', () => {})\n" } })).not.toThrow()
})

test("block mode refuses an apply_patch deletion of a test file", () => {
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const args = { patchText: "*** Begin Patch\n*** Delete File: src/a.test.ts\n*** End Patch" }
  expect(() => guard.before({ tool: "apply_patch", sessionID: "s", callID: freshCallID() }, { args })).toThrow(/protected-paths/)
})

test("extractPatchEntries parses add/update/delete entries", () => {
  const entries = extractPatchEntries(
    "*** Add File: src/a.ts\n*** Update File: src/b.ts\n*** Delete File: src/c.ts\n",
  )
  expect(entries).toEqual([
    { kind: "Add", path: "src/a.ts" },
    { kind: "Update", path: "src/b.ts" },
    { kind: "Delete", path: "src/c.ts" },
  ])
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

test("permission denies editing an existing test file when block is set", () => {
  const filePath = join(dir, "perm.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  guard.permission({ type: "edit", pattern: filePath }, output)
  expect(output.status).toBe("deny")
})

test("permission exempts a new test file", () => {
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  guard.permission({ type: "write", pattern: join(dir, "new-perm.test.ts") }, output)
  expect(output.status).toBe("ask")
})

test("permission does not deny when protected-paths is warn", () => {
  const filePath = join(dir, "perm2.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config())
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  guard.permission({ type: "edit", pattern: filePath }, output)
  expect(output.status).toBe("ask")
})

test("permission ignores non-edit/write permissions", () => {
  const filePath = join(dir, "perm3.test.ts")
  writeFileSync(filePath, "it('a', () => {})\n")
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  guard.permission({ type: "bash", pattern: filePath }, output)
  expect(output.status).toBe("ask")
})

test("permission never throws on a malformed payload", () => {
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  expect(() => guard.permission({ type: "edit", pattern: undefined }, output)).not.toThrow()
})

test("after alerts when a block rule was bypassed", async () => {
  const guard = guarded(config({ checks: { "protected-paths": "block" } }))
  const output: Output = {
    title: "",
    output: "Success. Updated the following files:",
    metadata: {
      files: [{ type: "update", filePath: "/work/src/a.test.ts", patch: "@@ -1 +1 @@\n-it('a', () => {})\n+it('a', () => {})\n" }],
    },
  }
  await guard.after({ tool: "apply_patch", sessionID: "s", callID: freshCallID() }, output)
  expect(output.output).toContain("BLOCK BYPASSED")
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
