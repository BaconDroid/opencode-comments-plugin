import { test, expect } from "bun:test"
import { createTestBinaryAnalyzer, runAnalyzer } from "../../core/analyzer"
import { extractChange } from "../../core/diff"
import { createRuleAnalyzer, createTestEngineAnalyzer, type RuleAnalyzerConfig } from "./analyzer"

const CHECKS = { "skip-focus-added": "warn" as const, "empty-test": "warn" as const }

function change(content: string, filePath = "/work/a.test.ts") {
  return extractChange({ filePath, oldText: "", newText: content, isNew: true, isDelete: false })
}

function analyzer(config: Partial<RuleAnalyzerConfig> = {}) {
  return createRuleAnalyzer(() => ({
    enabled: true,
    testPatterns: ["**/*.test.ts"],
    checks: CHECKS,
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

// --- binary engine (default) with regex fallback ---

function engineConfig(overrides: Partial<RuleAnalyzerConfig & { engine: "binary" | "regex" }> = {}) {
  return {
    enabled: true,
    testPatterns: ["**/*.test.ts"],
    checks: CHECKS,
    engine: "binary" as const,
    ...overrides,
  }
}

test("engine binary uses the binary findings when it succeeds", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    createTestBinaryAnalyzer(async () => [
      { rule: "skip-focus-added", line: 2, message: "Focused test added.", excerpt: "Focused test added." },
    ]),
  )

  const result = await engine.analyze(ctx(change("it('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added" && finding.severity === "warn")).toBe(true)
})

test("engine binary falls back to the regex rules when the binary is unavailable", async () => {
  const engine = createTestEngineAnalyzer(() => engineConfig(), createTestBinaryAnalyzer(async () => null))

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("engine regex never invokes the binary", async () => {
  let called = false
  const binary = createTestBinaryAnalyzer(async () => {
    called = true
    return []
  })
  const engine = createTestEngineAnalyzer(() => engineConfig({ engine: "regex" }), binary)

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(called).toBe(false)
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("engine binary does not invoke the binary for a non-test change", async () => {
  let called = false
  const binary = createTestBinaryAnalyzer(async () => {
    called = true
    return []
  })
  const engine = createTestEngineAnalyzer(() => engineConfig(), binary)

  const result = await engine.analyze(ctx(change("const a = 1\n", "/work/plain.ts")))
  expect(called).toBe(false)
  expect(result.findings ?? []).toEqual([])
})
