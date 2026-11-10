import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changeTextsFromTool, detectLanguage, diffLines, extractToolChange, readFileIfExists, type Language } from "./diff"

test("readFileIfExists returns the file content", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-preimage-"))
  const filePath = join(dir, "a.ts")
  writeFileSync(filePath, "const a = 1\n")
  expect(readFileIfExists(filePath)).toBe("const a = 1\n")
})

test("readFileIfExists returns undefined for a missing file", () => {
  expect(readFileIfExists(join(tmpdir(), "does-not-exist-guard-xyz.ts"))).toBeUndefined()
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

test("detectLanguage covers the extension set the binary parses", () => {
  const cases: Array<[string, Language]> = [
    ["a.js", "js"],
    ["a.jsx", "js"],
    ["a.mjs", "js"],
    ["a.cjs", "js"],
    ["a.ts", "ts"],
    ["a.tsx", "ts"],
    ["a.mts", "ts"],
    ["a.cts", "ts"],
    ["a.py", "python"],
    ["a.pyi", "python"],
    ["a.pyw", "python"],
    ["a.go", "go"],
    ["a.rs", "rust"],
    ["a.rb", "ruby"],
    ["a.java", "java"],
    ["a.php", "php"],
    ["a.cs", "csharp"],
    ["a.kt", "kotlin"],
    ["a.kts", "kotlin"],
    ["a.swift", "swift"],
    ["a.scala", "scala"],
    ["a.ex", "elixir"],
    ["a.exs", "elixir"],
    ["a.lua", "lua"],
    ["a.c", "c"],
    ["a.h", "c"],
    ["a.cpp", "cpp"],
    ["a.cxx", "cpp"],
    ["a.cc", "cpp"],
    ["a.hpp", "cpp"],
    ["a.hxx", "cpp"],
    ["a.groovy", "groovy"],
    ["a.gradle", "groovy"],
    ["a.ml", "ocaml"],
    ["a.elm", "elm"],
    ["a.sh", "bash"],
    ["a.bash", "bash"],
    ["a.bats", "bash"],
    ["a.css", "css"],
    ["a.cue", "cue"],
    ["a.dart", "dart"],
    ["a.dockerfile", "dockerfile"],
    ["a.hs", "haskell"],
    ["a.hcl", "hcl"],
    ["a.html", "html"],
    ["a.htm", "html"],
    ["a.proto", "proto"],
    ["a.r", "r"],
    ["a.sql", "sql"],
    ["a.svelte", "svelte"],
    ["a.toml", "toml"],
    ["a.yaml", "yaml"],
    ["a.yml", "yaml"],
    ["a.zig", "zig"],
  ]
  for (const [path, language] of cases) expect(detectLanguage(path)).toBe(language)
})

test("detectLanguage handles case, paths and extensionless Dockerfiles", () => {
  expect(detectLanguage("src/App.RB")).toBe("ruby")
  expect(detectLanguage("src\\test\\App.java")).toBe("java")
  expect(detectLanguage("Dockerfile")).toBe("dockerfile")
})

test("detectLanguage leaves non-code files unknown", () => {
  for (const path of ["README.md", "package.json", "notes.txt", "Makefile", "src/app"]) {
    expect(detectLanguage(path)).toBe("unknown")
  }
})

test("extractToolChange and changeTextsFromTool share the same derivation", () => {
  const args = { filePath: "/work/a.ts", edits: [{ old_string: "a", new_string: "b" }] }
  const change = extractToolChange("edit", args, undefined)
  const texts = changeTextsFromTool("edit", args, undefined)
  expect(change?.oldText).toBe(texts?.oldText)
  expect(change?.newText).toBe(texts?.newText)
})

