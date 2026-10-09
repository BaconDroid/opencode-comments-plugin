import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changeTextsFromTool, diffLines, extractToolChange, readPreimage } from "./diff"

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

test("changeTextsFromTool derives write texts from content and preimage", () => {
  expect(changeTextsFromTool("write", { content: "new" }, "old")).toEqual({ oldText: "old", newText: "new" })
  expect(changeTextsFromTool("write", { content: "new" }, undefined)).toEqual({ oldText: "", newText: "new" })
})

test("changeTextsFromTool derives edit texts from old/new strings", () => {
  expect(changeTextsFromTool("edit", { oldString: "a", newString: "b" }, undefined)).toEqual({ oldText: "a", newText: "b" })
  expect(changeTextsFromTool("edit", { old_string: "a", new_string: "b" }, undefined)).toEqual({ oldText: "a", newText: "b" })
})

test("changeTextsFromTool joins multiple edits", () => {
  const texts = changeTextsFromTool("edit", { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }, undefined)
  expect(texts?.oldText).toBe("a\nc\n")
  expect(texts?.newText).toBe("b\nd\n")
})

test("changeTextsFromTool returns undefined for an unsupported tool", () => {
  expect(changeTextsFromTool("bash", { content: "x" }, undefined)).toBeUndefined()
})

test("extractToolChange and changeTextsFromTool share the same derivation", () => {
  const args = { filePath: "/work/a.ts", edits: [{ old_string: "a", new_string: "b" }] }
  const change = extractToolChange("edit", args, undefined)
  const texts = changeTextsFromTool("edit", args, undefined)
  expect(change?.oldText).toBe(texts?.oldText)
  expect(change?.newText).toBe(texts?.newText)
})

