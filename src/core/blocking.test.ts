import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkBlockingBefore, checkPermission, extractPatchEntries, pathExists, type BlockingPolicy } from "./blocking"

const dir = mkdtempSync(join(tmpdir(), "blocking-"))
const existing = join(dir, "a.test.ts")
writeFileSync(existing, "it('a', () => {})\n")

function policy(overrides: Partial<BlockingPolicy> = {}): BlockingPolicy {
  return {
    isBlocking: () => true,
    isProtectedPath: () => true,
    message: (filePath, viaPatch) => `${viaPatch ? "patch" : "edit"}:${filePath}`,
    ...overrides,
  }
}

test("extractPatchEntries parses add/update/delete entries", () => {
  const text = "*** Add File: a\n*** Update File: b\n*** Delete File: c\n"
  expect(extractPatchEntries(text)).toEqual([
    { kind: "Add", path: "a" },
    { kind: "Update", path: "b" },
    { kind: "Delete", path: "c" },
  ])
})

test("pathExists resolves an absolute path", () => {
  expect(pathExists(existing)).toBe(true)
  expect(pathExists(join(dir, "missing.test.ts"))).toBe(false)
})

test("checkBlockingBefore throws for an edit of an existing protected file", () => {
  expect(() => checkBlockingBefore("edit", { filePath: existing }, policy())).toThrow(`edit:${existing}`)
})

test("checkBlockingBefore does not throw when blocking is off", () => {
  expect(() => checkBlockingBefore("edit", { filePath: existing }, policy({ isBlocking: () => false }))).not.toThrow()
})

test("checkBlockingBefore does not throw for a non-protected path", () => {
  expect(() => checkBlockingBefore("edit", { filePath: existing }, policy({ isProtectedPath: () => false }))).not.toThrow()
})

test("checkBlockingBefore throws for a delete entry in an apply_patch", () => {
  const patch = `*** Delete File: ${join(dir, "gone.test.ts")}\n`
  expect(() => checkBlockingBefore("apply_patch", { patchText: patch }, policy())).toThrow()
})

test("checkBlockingBefore does not throw for an update of a missing file", () => {
  const patch = `*** Update File: ${join(dir, "missing.test.ts")}\n`
  expect(() => checkBlockingBefore("apply_patch", { patchText: patch }, policy())).not.toThrow()
})

test("checkPermission denies an existing protected path", () => {
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  const denied = checkPermission({ type: "edit", pattern: existing }, output, policy())
  expect(denied).toBe(existing)
  expect(output.status).toBe("deny")
})

test("checkPermission ignores non-edit/write and is fail-open", () => {
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  expect(checkPermission({ type: "bash", pattern: existing }, output, policy())).toBeUndefined()
  expect(checkPermission({ type: "edit", pattern: undefined }, output, policy())).toBeUndefined()
  expect(output.status).toBe("ask")
})

test("checkPermission does not deny when blocking is off", () => {
  const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
  expect(checkPermission({ type: "edit", pattern: existing }, output, policy({ isBlocking: () => false }))).toBeUndefined()
  expect(output.status).toBe("ask")
})
