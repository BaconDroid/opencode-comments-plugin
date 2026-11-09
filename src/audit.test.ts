import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  auditComments,
  auditTestFile,
  classifyComment,
  listRepositoryFiles,
  parseCommentsXml,
  renderAudit,
  runAudit,
  type AuditReport,
} from "./audit"
import type { ResolvedTestGuard } from "./core/dispatch"
import { collectCleanup, parseCleanupSummary, renderCleanup } from "./cleanup"

const dir = mkdtempSync(join(tmpdir(), "guard-audit-"))
writeFileSync(join(dir, "a.test.ts"), 'test("empty", () => {\n})\n\ntest("taut", () => {\n  expect(true).toBe(true)\n})\n')
writeFileSync(join(dir, "b.ts"), "export const b = 1\n")

function config(): ResolvedTestGuard {
  return {
    enabled: true,
    testPatterns: ["**/*.test.ts"],
    checks: {},
    maxWarningsPerFile: 0,
    mutationEnabled: false,
  }
}

test("listRepositoryFiles expands an explicit path", () => {
  const files = listRepositoryFiles(dir, ["a.test.ts"])
  expect(files).toHaveLength(1)
  expect(files[0]).toContain("a.test.ts")
})

test("auditTestFile reports empty and tautological tests", () => {
  const findings = auditTestFile({ filePath: join(dir, "a.test.ts"), display: "a.test.ts", language: "ts" }, false)
  const rules = findings.map(f => f.rule)
  expect(rules).toContain("empty-test")
  expect(rules).toContain("tautological-assertion")
})

test("auditTestFile maps rules to actions and confidence", () => {
  const findings = auditTestFile({ filePath: join(dir, "a.test.ts"), display: "a.test.ts", language: "ts" }, false)
  const empty = findings.find(f => f.rule === "empty-test")!
  expect(empty.action).toBe("remove")
  expect(empty.confidence).toBe("high")
})

test("parseCommentsXml reads line-number attributes", () => {
  const xml = '<comments file="a.ts"><comment line-number="3">// changed this</comment></comments>'
  expect(parseCommentsXml(xml)).toEqual([{ line: 3, text: "// changed this" }])
})

test("parseCommentsXml reads number attributes", () => {
  const xml = '<comments file="a.py"><comment number="7"># note</comment></comments>'
  expect(parseCommentsXml(xml)).toEqual([{ line: 7, text: "# note" }])
})

test("classifyComment removes agent memos and keeps rationale", () => {
  expect(classifyComment("// changed this").action).toBe("remove")
  expect(classifyComment("// we retry because the lock is racy").action).toBe("adjust")
})

test("auditComments uses the injected checker and rejects placeholders", async () => {
  const file = join(dir, "a.test.ts")
  const findings = await auditComments(
    { filePath: file, display: "a.test.ts", language: "ts" },
    { runCheck: async () => [{ line: 1, text: "// changed" }, { line: 2, text: "TODO" }, { line: 3, text: "placeholder" }] },
  )
  expect(findings).toHaveLength(1)
  expect(findings[0]!.action).toBe("remove")
})

test("runAudit emits a markdown report", async () => {
  const out = await runAudit(
    { scope: "tests", paths: [dir], directory: dir, getConfig: config, includeAdvisory: false },
    { runCheck: async () => [] },
  )
  expect(out).toContain("# Test guard audit")
  expect(out).toContain("empty-test")
})

test("runAudit emits valid json when asked", async () => {
  const out = await runAudit(
    { scope: "tests", paths: [dir], directory: dir, getConfig: config, format: "json" },
    { runCheck: async () => [] },
  )
  const parsed = JSON.parse(out) as AuditReport
  expect(Array.isArray(parsed.tests)).toBe(true)
  expect(parsed.tests.length).toBeGreaterThan(0)
})

test("audit reports cross-file duplicate tests", async () => {
  const d = mkdtempSync(join(tmpdir(), "guard-audit-dup-"))
  const body = 'test("same", () => {\n  expect(compute(1)).toBe(42)\n})\n'
  writeFileSync(join(d, "a.test.ts"), body)
  writeFileSync(join(d, "b.test.ts"), body)
  const out = await runAudit(
    { scope: "tests", paths: [d], directory: d, format: "json", getConfig: config },
    { runCheck: async () => [] },
  )
  const parsed = JSON.parse(out) as AuditReport
  expect(parsed.tests.filter(t => t.rule === "duplicate-test").length).toBeGreaterThan(0)
})

test("renderAudit says nothing to do on an empty report", () => {
  const report: AuditReport = { scope: "both", comments: [], tests: [], skipped: [], generatedAt: "now" }
  expect(renderAudit(report)).toContain("No findings")
})

test("audit never mutates files", async () => {
  const before = await Bun.file(join(dir, "a.test.ts")).text()
  await runAudit({ scope: "both", paths: [dir], directory: dir, getConfig: config }, { runCheck: async () => [] })
  const after = await Bun.file(join(dir, "a.test.ts")).text()
  expect(after).toBe(before)
})

test("parseCleanupSummary reads removed, kept and note lines", () => {
  const summary = parseCleanupSummary(
    [
      "[test-checker] cleanup pass: 1 removed, 1 kept awaiting approval.",
      "  removed: same block [duplicate-test]",
      "  kept awaiting approval: taut assertion [tautological-assertion]",
      "  note: the target file is not on disk; nothing was rewritten",
      '  approve a removal with a "remove" entry ({"glob","rules","reason"}) in .test-checker.json',
    ].join("\n"),
  )

  expect(summary.summary).toBe(true)
  expect(summary.removed).toEqual([{ name: "same block", rule: "duplicate-test" }])
  expect(summary.kept).toEqual([{ name: "taut assertion", rule: "tautological-assertion" }])
  expect(summary.note).toContain("not on disk")
})

test("parseCleanupSummary marks stderr without the cleanup summary", () => {
  expect(parseCleanupSummary("TEST QUALITY DETECTED\n<findings file=\"a.test.ts\"></findings>").summary).toBe(false)
})

test("cleanup forwards test files and drops non-test files", async () => {
  const calls: string[] = []
  const report = await collectCleanup(
    { directory: dir, paths: [dir], testPatterns: ["**/*.test.ts"], cliPath: "/fake/test-checker" },
    {
      run: async input => {
        calls.push(input.tool_input.file_path!)
        return {
          kind: "output",
          exitCode: 2,
          stderr: "[test-checker] cleanup pass: 0 removed, 1 kept awaiting approval.\n  kept awaiting approval: x [gutted-test]",
        }
      },
    },
  )

  expect(calls).toHaveLength(1)
  expect(calls[0]).toBe(join(dir, "a.test.ts"))
  expect(report.files.map(file => file.display)).toEqual(["a.test.ts"])
})

test("cleanup renders removed and kept items with the approval pointer", async () => {
  const report = await collectCleanup(
    { directory: dir, paths: [dir], testPatterns: ["**/*.test.ts"], cliPath: "/fake/test-checker" },
    {
      run: async () => ({
        kind: "output",
        exitCode: 2,
        stderr: [
          "[test-checker] cleanup pass: 1 removed, 1 kept awaiting approval.",
          "  removed: same block [duplicate-test]",
          "  kept awaiting approval: taut assertion [tautological-assertion]",
        ].join("\n"),
      }),
    },
  )

  const output = renderCleanup(report)
  expect(output).toContain("Removed 1 test block(s); 1 kept awaiting approval")
  expect(output).toContain("same block")
  expect(output).toContain("taut assertion")
  expect(output).toContain(".test-checker.json")
  expect(output).toContain('"remove" entry')
})

test("cleanup leaves unapproved files untouched when the binary only reports them", async () => {
  const testFile = join(dir, "a.test.ts")
  const before = await Bun.file(testFile).text()
  const report = await collectCleanup(
    { directory: dir, paths: [dir], testPatterns: ["**/*.test.ts"], cliPath: "/fake/test-checker" },
    {
      run: async () => ({
        kind: "output",
        exitCode: 2,
        stderr: "[test-checker] cleanup pass: 0 removed, 1 kept awaiting approval.\n  kept awaiting approval: x [tautological-assertion]",
      }),
    },
  )

  expect(report.files[0]!.kept).toHaveLength(1)
  expect(await Bun.file(testFile).text()).toBe(before)
})

test("cleanup reports a pre-strip binary without failing", async () => {
  const report = await collectCleanup(
    { directory: dir, paths: [dir], testPatterns: ["**/*.test.ts"], cliPath: "/fake/test-checker" },
    { run: async () => ({ kind: "output", exitCode: 0, stderr: "TEST QUALITY DETECTED: no weakened tests.\n" }) },
  )

  expect(report.unsupported).toBe(true)
  expect(renderCleanup(report)).toContain("predate `--strip`")
})

test("directory walk skips node_modules and hidden directories", () => {
  const walkDir = mkdtempSync(join(tmpdir(), "guard-audit-walk-"))
  mkdirSync(join(walkDir, "node_modules"))
  writeFileSync(join(walkDir, "node_modules", "x.test.ts"), "test('x', () => {})\n")
  mkdirSync(join(walkDir, ".git"))
  writeFileSync(join(walkDir, ".git", "config"), "")
  writeFileSync(join(walkDir, "real.test.ts"), "test('x', () => {})\n")
  const files = listRepositoryFiles(walkDir, ["."])
  expect(files.some(f => f.includes("real.test.ts"))).toBe(true)
  expect(files.some(f => f.includes("node_modules"))).toBe(false)
})
