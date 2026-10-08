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

const dir = mkdtempSync(join(tmpdir(), "guard-audit-"))
writeFileSync(join(dir, "a.test.ts"), 'test("empty", () => {\n})\n\ntest("taut", () => {\n  expect(true).toBe(true)\n})\n')
writeFileSync(join(dir, "b.ts"), "export const b = 1\n")

function config(): ResolvedTestGuard {
  return {
    enabled: true,
    testPatterns: ["**/*.test.ts"],
    checks: {},
    maxWarningsPerFile: 0,
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
