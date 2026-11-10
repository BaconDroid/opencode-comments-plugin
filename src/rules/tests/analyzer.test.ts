import { test, expect } from "bun:test"
import { runAnalyzer } from "../../core/analyzer"
import { extractChange } from "../../core/diff"
import type { HookInput } from "../../types"
import { createRuleAnalyzer, createTestEngineAnalyzer, type RuleAnalyzerConfig } from "./analyzer"
import { isHarnessPath } from "./patterns"

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
    async () => ({ kind: "findings", findings: [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }] }),
  )

  const result = await engine.analyze(ctx(change("it('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added" && finding.severity === "warn")).toBe(true)
})

test("engine binary hides Low-confidence findings and keeps Medium/High", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => ({
      kind: "findings",
      findings: [
        { file: "/work/a.test.ts", line: 2, rule: "weakened-assertion", message: "low telemetry", confidence: "low" },
        { file: "/work/a.test.ts", line: 3, rule: "focus-added", message: "high signal", confidence: "high" },
      ],
    }),
  )

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "weakened-assertion")).toBe(false)
  expect(result.findings?.some(finding => finding.rule === "focus-added")).toBe(true)
})

test("engine binary falls back to the regex rules when the binary is unavailable", async () => {
  const engine = createTestEngineAnalyzer(() => engineConfig(), async () => ({ kind: "fallback" }))

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
  expect(result.didNotRun).toBe("test-checker output could not be parsed; used the in-process regex rules")
})

test("engine binary announces a thrown runner instead of falling back silently", async () => {
  const engine = createTestEngineAnalyzer(() => engineConfig(), async () => {
    throw new Error("spawn failed")
  })

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))

  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
  expect(result.didNotRun).toBe("test-checker could not be run; used the in-process regex rules")
})

test("engine regex never invokes the binary", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(() => engineConfig({ engine: "regex" }), async () => {
    called = true
    return { kind: "findings", findings: [] }
  })

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(called).toBe(false)
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("engine binary does not invoke the binary for a non-test change", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(() => engineConfig(), async () => {
    called = true
    return { kind: "findings", findings: [] }
  })

  const result = await engine.analyze(ctx(change("const a = 1\n", "/work/plain.ts")))
  expect(called).toBe(false)
  expect(result.findings ?? []).toEqual([])
})

// --- harness/config forwarding ---

test("isHarnessPath matches the binary's harness paths", () => {
  for (const path of [
    "pytest.ini",
    "conftest.py",
    ".github/workflows/ci.yml",
    "jest.config.js",
    "vitest.config.ts",
    "package.json",
    "Makefile",
  ]) {
    expect(isHarnessPath(path)).toBe(true)
  }
  expect(isHarnessPath("src/app.py")).toBe(false)
  expect(isHarnessPath("src/app.test.ts")).toBe(false)
})

test("the regex analyzer applies harness-wins to a path that is both", () => {
  const analyze = createRuleAnalyzer(() => ({
    enabled: true,
    testPatterns: [],
    checks: { "forced-success": "warn" },
  }))

  const harness = runAnalyzer(analyze, ctx(change("exit 0\n", "/work/tests/conftest.py")))
  const testFile = runAnalyzer(analyze, ctx(change("exit 0\n", "/work/tests/app_test.py")))

  expect(harness.findings ?? []).toEqual([])
  expect(testFile.findings?.some(finding => finding.rule === "forced-success")).toBe(true)
})

test("engine binary forwards a harness path with is_test_file false", async () => {
  let payload: HookInput | undefined
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async input => {
      payload = input
      return { kind: "findings", findings: [] }
    },
  )

  await engine.analyze(ctx(change("run: bun test\n", "/work/.github/workflows/ci.yml")))

  expect(payload?.tool_name).toBe("Write")
  expect(payload?.is_test_file).toBe(false)
  expect(payload?.tool_input.file_path).toBe("/work/.github/workflows/ci.yml")
  expect(payload?.tool_input.content).toBe("run: bun test\n")
})

test("engine binary forwards the suppression config with is_test_file false", async () => {
  let payload: HookInput | undefined
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async input => {
      payload = input
      return { kind: "findings", findings: [] }
    },
  )

  await engine.analyze(ctx(change('{"ignore": []}\n', "/work/.test-checker.json")))

  expect(payload?.is_test_file).toBe(false)
  expect(payload?.tool_input.file_path).toBe("/work/.test-checker.json")
})

test("engine binary still marks a test path as a test file", async () => {
  let payload: HookInput | undefined
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async input => {
      payload = input
      return { kind: "findings", findings: [] }
    },
  )

  await engine.analyze(ctx(change("it('a', () => {})\n")))

  expect(payload?.tool_name).toBe("Write")
  expect(payload?.is_test_file).toBe(true)
})

test("engine binary reports did-not-run and still falls back to the regex rules", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => ({ kind: "did-not-run", reason: "exited with code 1" }),
  )

  const result = await engine.analyze(ctx(change("it.only('a', () => {\n  expect(1).toBe(1)\n})\n")))
  expect(result.didNotRun).toBe("exited with code 1")
  expect(result.findings?.some(finding => finding.rule === "skip-focus-added")).toBe(true)
})

test("did-not-run suppresses the fallback protected-paths finding for the same change", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig({ checks: { "protected-paths": "warn" } }),
    async () => ({ kind: "did-not-run", reason: "binary not found" }),
  )
  const edited = extractChange({
    filePath: "/work/a.test.ts",
    oldText: "it('a', () => {\n  expect(1).toBe(1)\n})\n",
    newText: "it('a', () => {\n  expect(2).toBe(2)\n})\n",
    isNew: false,
    isDelete: false,
  })

  const result = await engine.analyze(ctx(edited))

  expect(result.didNotRun).toBe("binary not found")
  expect(result.findings?.some(finding => finding.rule === "protected-paths")).toBe(false)
})

// --- review fixes ---

test("engine binary falls back to regex for a delete without consulting the binary", async () => {
  let called = false
  const engine = createTestEngineAnalyzer(
    () => engineConfig({ checks: { "protected-paths": "warn" } }),
    async () => {
      called = true
      return { kind: "findings", findings: [] }
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
    async () => ({ kind: "findings", findings: [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }] }),
  )

  const result = await engine.analyze(ctx(change("// header\nit.only('a', () => {}) // focused\n")))
  const finding = result.findings?.find(item => item.rule === "skip-focus-added")

  expect(finding?.message).toBe("Focused test added.")
  expect(finding?.excerpt).toBe("it.only('a', () => {})")
})

test("engine binary falls back to the message when the source line is unavailable", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => ({ kind: "findings", findings: [{ file: "/work/a.test.ts", line: 99, rule: "skip-focus-added", message: "Focused test added." }] }),
  )

  const result = await engine.analyze(ctx(change("it.only('a', () => {})\n")))
  expect(result.findings?.find(item => item.rule === "skip-focus-added")?.excerpt).toBe("Focused test added.")
})

test("engine binary surfaces the file's bypass markers", async () => {
  const engine = createTestEngineAnalyzer(
    () => engineConfig(),
    async () => ({ kind: "findings", findings: [{ file: "/work/a.test.ts", line: 2, rule: "skip-focus-added", message: "Focused test added." }] }),
  )

  const result = await engine.analyze(ctx(change("// test-guard: allow intentional\nit.only('a', () => {})\n")))
  expect(result.bypasses?.some(bypass => bypass.kind === "allow")).toBe(true)
})
