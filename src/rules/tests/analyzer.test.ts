import { test, expect } from "bun:test"
import { runAnalyzer } from "../../core/analyzer"
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
    async () => [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }],
  )

  const result = await engine.analyze(ctx(change("it('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added" && finding.severity === "warn")).toBe(true)
})

test("engine binary falls back to the regex rules when the binary is unavailable", async () => {
  const engine = createTestEngineAnalyzer(() => engineConfig(), async () => null)

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("engine regex never invokes the binary", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(() => engineConfig({ engine: "regex" }), async () => {
    called = true
    return []
  })

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(called).toBe(false)
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("engine binary does not invoke the binary for a non-test change", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(() => engineConfig(), async () => {
    called = true
    return []
  })

  const result = await engine.analyze(ctx(change("const a = 1\n", "/work/plain.ts")))
  expect(called).toBe(false)
  expect(result.findings ?? []).toEqual([])
})

// --- review fixes ---

test("engine binary falls back to regex for a delete without consulting the binary", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(
    () => engineConfig({ checks: { "protected-paths": "warn" } }),
    async () => {
      called = true
      return []
    },
  )

  const deleted = extractChange({
    filePath: "/work/a.test.ts",
    oldText: "it('a', () => {})\n",
    newText: "",
    isNew: false,
    isDelete: true,
  })
  const result = await engine.analyze(ctx(deleted))

  expect(called).toBe(false)
  expect(result.findings?.some(finding => finding.rule === "protected-paths")).toBe(true)
})

test("engine binary derives the excerpt from the source line, not the message", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }],
  )

  const result = await engine.analyze(ctx(change("// header\nit.only('a', () => {}) // focused\n")))
  const finding = result.findings?.find(item => item.rule === "skip-focus-added")

  expect(finding?.message).toBe("Focused test added.")
  expect(finding?.excerpt).toBe("it.only('a', () => {})")
})

test("engine binary falls back to the message when the source line is unavailable", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => [{ file: "/work/a.test.ts", line: 99, rule: "skip-focus-added", message: "Focused test added." }],
  )

  const result = await engine.analyze(ctx(change("it.only('a', () => {})\n")))
  expect(result.findings?.find(item => item.rule === "skip-focus-added")?.excerpt).toBe("Focused test added.")
})

test("engine binary surfaces the file's bypass markers", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }],
  )

  const result = await engine.analyze(ctx(change("// test-guard: allow intentional\nit.only('a', () => {})\n")))
  expect(result.bypasses?.some(bypass => bypass.kind === "allow")).toBe(true)
})
