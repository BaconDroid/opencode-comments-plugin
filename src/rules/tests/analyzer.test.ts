import { test, expect } from "bun:test"
import { runAnalyzer } from "../../core/analyzer"
import { extractChange } from "../../core/diff"
import { createRuleAnalyzer, type RuleAnalyzerConfig } from "./analyzer"

const CHECKS = { "skip-focus-added": "warn" as const, "empty-test": "warn" as const }

function change(content: string, filePath = "/work/a.test.ts") {
  return extractChange({ filePath, oldText: "", newText: content, isNew: true, isDelete: false })
}

function analyzer(config: Partial<RuleAnalyzerConfig> = {}) {
  return createRuleAnalyzer(() => ({
    enabled: true,
    testPatterns: ["**/*.test.ts"],
    checks: CHECKS,
    testCommand: null,
    ...config,
  }))
}

const ctx = (c: ReturnType<typeof change>) => ({ tool: "write", sessionID: "s", change: c, directory: "/work" })

test("produces findings with their configured severity", () => {
  const result = runAnalyzer(analyzer(), ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added" && finding.severity === "warn")).toBe(true)
})

test("honors the isTestFile override", () => {
  const result = runAnalyzer(analyzer({ isTestFile: false }), ctx(change("it.only('a', () => {})\n")))
  expect(result.findings ?? []).toEqual([])
})

test("a disabled analyzer yields an empty result", () => {
  expect(runAnalyzer(analyzer({ enabled: false }), ctx(change("it.only('a', () => {})\n")))).toEqual({})
})

test("is fail-open when there is no change", () => {
  expect(runAnalyzer(analyzer(), { tool: "write", sessionID: "s", directory: "/work" })).toEqual({})
})
