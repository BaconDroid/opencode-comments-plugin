import { test, expect } from "bun:test"
import { renderFeedback, type Finding } from "./feedback"
import { formatBypassNote, renderAnalyzerResults, renderBypassFooter } from "./result-pipeline"

const finding: Finding = {
  rule: "skip-focus-added",
  filePath: "/work/a.test.ts",
  line: 1,
  message: "focused test",
  severity: "warn",
  excerpt: "it.only('a', () => {})",
}

test("formatBypassNote renders kind and optional reason", () => {
  expect(formatBypassNote("/a.test.ts", { kind: "allow", line: 3, reason: "legacy" })).toBe("/a.test.ts:3 allow (legacy)")
  expect(formatBypassNote("/a.test.ts", { kind: "disable-file", line: 5, reason: "" })).toBe("/a.test.ts:5 disable-file")
})

test("renderBypassFooter prefixes each entry", () => {
  expect(renderBypassFooter("Test guard bypass recorded", ["a:1 allow", "b:2 disable-file"])).toBe(
    "Test guard bypass recorded:\n- a:1 allow\n- b:2 disable-file",
  )
})

test("renderAnalyzerResults renders structured findings like renderFeedback", () => {
  const options = { customPrompt: "F:\n{{findings}}", appendPrompt: "be concise" }
  expect(renderAnalyzerResults([{ findings: [finding] }], options)).toBe(renderFeedback([finding], options))
})

test("renderAnalyzerResults appends a raw message with the append prompt", () => {
  expect(renderAnalyzerResults([{ raw: "COMMENT DETECTED" }], { appendPrompt: "fix it" })).toBe("COMMENT DETECTED\n\nfix it")
  expect(renderAnalyzerResults([{ raw: "COMMENT DETECTED" }])).toBe("COMMENT DETECTED")
})

test("renderAnalyzerResults returns an empty string when there is nothing to show", () => {
  expect(renderAnalyzerResults([])).toBe("")
  expect(renderAnalyzerResults([{}])).toBe("")
})

test("renderAnalyzerResults is fail-open", () => {
  expect(renderAnalyzerResults(null as unknown as never)).toBe("")
})
