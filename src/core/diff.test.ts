import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { diffLines, readPreimage } from "./diff"

test("readPreimage returns the file content", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-preimage-"))
  const filePath = join(dir, "a.ts")
  writeFileSync(filePath, "const a = 1\n")
  expect(readPreimage(filePath)).toBe("const a = 1\n")
})

test("readPreimage returns undefined for a missing file", () => {
  expect(readPreimage(join(tmpdir(), "does-not-exist-guard-xyz.ts"))).toBeUndefined()
})

test("diffLines reports only net-new and net-removed lines", () => {
  const { added, removed } = diffLines("a\nb\nc\n", "a\nb\nc\nd\n")
  expect(added).toEqual(["d"])
  expect(removed).toEqual([])
})
