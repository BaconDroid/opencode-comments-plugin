import {
  countRealLines,
  isCommentLine,
  maskStrings,
  stripComments,
  stripStringLiterals,
  type ExtractedChange,
  type Language,
} from "../../core/diff"
import { applyBypass, bypassMatchers, type Bypass, type BypassCheck } from "../../core/bypass"
import {
  ASSERTION_COUNT_PATTERNS,
  MATCHER_LOOSENINGS,
  MOCK_IDENTIFIER_PATTERNS,
  SKIP_FOCUS_PATTERNS,
  SWALLOWED_ERROR_PATTERNS,
  TAUTOLOGICAL_PATTERNS,
  TEST_DECLARATION_PATTERNS,
  TESTS_NOT_RUN_PATTERNS,
  WEAKENED_CONFIG_PATTERNS,
  countAssertions,
  hasAssertion,
  isConditionalSkip,
} from "./patterns"
import type { RuleContext, RuleFinding, TestBlock, TestRule } from "./types"

export type { Bypass } from "../../core/bypass"

const MATCHERS = bypassMatchers("test-guard")

function codeText(line: string, language: Language): string {
  return stripStringLiterals(stripComments(line, language))
}

// Uses the once-per-file blocks when available, else parses on demand.
function blocksOf(ctx: RuleContext): TestBlock[] {
  return ctx.blocks ?? findTestBlocks(ctx.change.newText, ctx.change.language)
}

function countAssertionsCode(lines: string[], language: Language): number {
  return countAssertions(lines.map(line => codeText(line, language)))
}

// Normalizes an assertion so formatting-only edits and common aliases are not
// counted as different assertions (plan section 6: normalize expected values).
function normalizeAssertion(code: string): string {
  return code
    .replace(/\s+/g, "")
    .replace(/self\.(?=assert)/g, "")
    .replace(/assertEqual/gi, "assertEquals")
    .replace(/\.toBe\b/g, ".toEqual")
}

// Deduplicated set of normalized assertion lines, so repeated identical
// assertions are not mistaken for a net loss.
function uniqueAssertions(lines: string[], language: Language): string[] {
  const set = new Set<string>()
  for (const line of lines) {
    const code = codeText(line, language).trim()
    if (code.length === 0) continue
    if (!ASSERTION_COUNT_PATTERNS.some(pattern => pattern.test(code))) continue
    set.add(normalizeAssertion(code))
  }
  return [...set]
}

function multiset(lines: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1)
  return map
}

function locateLine(newText: string, needle: string): number {
  const lines = newText.split("\n")
  const exact = lines.findIndex(line => line === needle)
  if (exact >= 0) return exact + 1
  const trimmed = needle.trim()
  const loose = lines.findIndex(line => line.trim() === trimmed)
  return loose >= 0 ? loose + 1 : 0
}

function withinBypass(ctx: RuleContext, line: number): boolean {
  return ctx.bypass?.covers(line) ?? false
}

// The file's bypass markers, computed once per file by runTestRules.
export function testBypass(newText: string): BypassCheck {
  return applyBypass(newText, MATCHERS)
}

// The bypass markers surfaced for one change, matching what `runTestRules`
// returns so the binary path renders the same "bypass recorded" footer.
export function collectBypasses(change: ExtractedChange): Bypass[] {
  return testBypass(change.newText).notes
}

function addedLineFindings(
  ctx: RuleContext,
  rule: string,
  patterns: RegExp[],
  message: string,
  skip?: (line: string) => boolean,
): RuleFinding[] {
  const findings: RuleFinding[] = []
  for (const line of ctx.change.addedLines) {
    const code = codeText(line, ctx.change.language)
    const trimmed = code.trim()
    if (trimmed.length === 0) continue
    if (skip?.(line)) continue
    if (!patterns.some(pattern => pattern.test(code))) continue
    const lineNumber = locateLine(ctx.change.newText, line)
    if (withinBypass(ctx, lineNumber)) continue
    findings.push({ rule, line: lineNumber, message, excerpt: stripComments(line, ctx.change.language).trim() })
  }
  return findings
}

export const skipFocusAddedRule: TestRule = {
  id: "skip-focus-added",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const patterns = SKIP_FOCUS_PATTERNS[ctx.change.language]
    if (!patterns || patterns.length === 0) return []
    return addedLineFindings(
      ctx,
      "skip-focus-added",
      patterns,
      "A test was disabled or focused (.skip/.only/.todo, xit/xdescribe, skip marker, #[ignore], t.Skip).",
      isConditionalSkip,
    )
  },
}

export const tautologicalAssertionRule: TestRule = {
  id: "tautological-assertion",
  run(ctx) {
    return addedLineFindings(
      ctx,
      "tautological-assertion",
      TAUTOLOGICAL_PATTERNS,
      "Assertion is tautological (always true).",
    )
  },
}

export const swallowedErrorRule: TestRule = {
  id: "swallowed-error",
  run(ctx) {
    const patterns = SWALLOWED_ERROR_PATTERNS[ctx.change.language]
    if (!patterns || patterns.length === 0) return []
    // Join the added lines so multi-line `except Exception:\n pass` is caught.
    const joined = ctx.change.addedLines.map(line => codeText(line, ctx.change.language)).join("\n")
    const findings: RuleFinding[] = []
    for (const pattern of patterns) {
      if (!pattern.test(joined)) continue
      const sample = ctx.change.addedLines.find(line => pattern.test(codeText(line, ctx.change.language))) ?? ctx.change.addedLines[0] ?? ""
      const lineNumber = locateLine(ctx.change.newText, sample)
      if (withinBypass(ctx, lineNumber)) continue
      findings.push({
        rule: "swallowed-error",
        line: lineNumber,
        message: "Errors are swallowed (empty catch / except pass / Err(_) => {}).",
        excerpt: sample.trim(),
      })
      break
    }
    return findings
  },
}

export const guttedTestRule: TestRule = {
  id: "gutted-test",
  run(ctx) {
    const removed = uniqueAssertions(ctx.change.removedLines, ctx.change.language).length
    const added = uniqueAssertions(ctx.change.addedLines, ctx.change.language).length
    if (removed <= 0 || added !== 0) return []

    const declarations = TEST_DECLARATION_PATTERNS[ctx.change.language]
    if (declarations) {
      const before = ctx.change.removedLines.filter(line => declarations.test(codeText(line, ctx.change.language))).length
      const after = ctx.change.addedLines.filter(line => declarations.test(codeText(line, ctx.change.language))).length
      if (before !== after) return []
    }

    const sample = ctx.change.removedLines.find(line =>
      ASSERTION_COUNT_PATTERNS.some(p => p.test(codeText(line, ctx.change.language))),
    ) ?? ""
    return [{
      rule: "gutted-test",
      line: locateLine(ctx.change.oldText, sample),
      message: "All assertions were removed and nothing replaced them.",
      excerpt: sample.trim(),
    }]
  },
}

export const matcherLoosenedRule: TestRule = {
  id: "matcher-loosened",
  run(ctx) {
    if (ctx.change.addedLines.length === 0 || ctx.change.removedLines.length === 0) return []
    const findings: RuleFinding[] = []
    for (const loosening of MATCHER_LOOSENINGS) {
      const removedHit = ctx.change.removedLines.find(line => {
        const code = codeText(line, ctx.change.language)
        return loosening.before.test(code) && !loosening.after.test(code)
      })
      if (!removedHit) continue
      const addedHit = ctx.change.addedLines.find(line => loosening.after.test(codeText(line, ctx.change.language)))
      if (!addedHit) continue
      const lineNumber = locateLine(ctx.change.newText, addedHit)
      if (withinBypass(ctx, lineNumber)) continue
      findings.push({
        rule: "matcher-loosened",
        line: lineNumber,
        message: loosening.message,
        excerpt: addedHit.trim(),
      })
    }
    return findings
  },
}

// Extracts whole test bodies so empty/unknown rules can look inside them.
export function findTestBlocks(text: string, language: Language): TestBlock[] {
  const declaration = TEST_DECLARATION_PATTERNS[language]
  if (!declaration) return []
  const stripped = stripComments(text, language)
  // Strings are masked (same length) so fixtures like `'test("x", () => {'`
  // are not mistaken for real test declarations, while the extracted bodies
  // keep their string content for duplicate comparison.
  const searchable = maskStrings(stripped)

  if (language === "python") return findPythonBlocks(stripped.split("\n"), searchable.split("\n"), declaration)
  return findBraceBlocks(searchable, stripped, declaration)
}

function findPythonBlocks(lines: string[], searchableLines: string[], declaration: RegExp): TestBlock[] {
  const blocks: TestBlock[] = []
  for (let i = 0; i < searchableLines.length; i++) {
    const searchable = searchableLines[i]!
    if (!declaration.test(searchable)) continue
    const indent = searchable.length - searchable.trimStart().length
    let end = i + 1
    while (end < searchableLines.length) {
      const candidate = searchableLines[end]!
      if (candidate.trim().length === 0) {
        end += 1
        continue
      }
      const candidateIndent = candidate.length - candidate.trimStart().length
      if (candidateIndent <= indent) break
      end += 1
    }
    blocks.push({ startLine: i + 1, endLine: end, lines: lines.slice(i + 1, end) })
    i = end - 1
  }
  return blocks
}

function findBraceBlocks(searchable: string, content: string, declaration: RegExp): TestBlock[] {
  const blocks: TestBlock[] = []
  const global = new RegExp(declaration.source, "gm")
  let match: RegExpExecArray | null
  while ((match = global.exec(searchable)) !== null) {
    const openIndex = searchable.indexOf("{", match.index)
    if (openIndex < 0) continue
    const closeIndex = matchBrace(searchable, openIndex)
    if (closeIndex === undefined) continue
    const startLine = searchable.slice(0, openIndex).split("\n").length
    const endLine = searchable.slice(0, closeIndex).split("\n").length
    blocks.push({ startLine, endLine, lines: content.slice(openIndex + 1, closeIndex).split("\n") })
    global.lastIndex = closeIndex + 1
  }
  return blocks
}

function matchBrace(text: string, openIndex: number): number | undefined {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i]
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return undefined
}

function blockIsAdded(ctx: RuleContext, block: TestBlock): boolean {
  if (ctx.change.isNew) return true
  const added = multiset(ctx.change.addedLines.map(line => stripComments(line, ctx.change.language).trim()))
  let codeLines = 0
  for (const raw of block.lines) {
    const line = raw.trim()
    if (line.length === 0 || isCommentLine(raw, ctx.change.language)) continue
    codeLines += 1
    const count = added.get(line) ?? 0
    if (count <= 0) return false
    added.set(line, count - 1)
  }
  return codeLines > 0
}

export const emptyTestRule: TestRule = {
  id: "empty-test",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const findings: RuleFinding[] = []
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block)) continue
      const body = block.lines.join("\n")
      const executable = countRealLines(body, ctx.change.language)
      const trivial = /^\s*(?:pass|\.\.\.)?\s*$/.test(body.trim())
      if (executable > 0 && !trivial) continue
      findings.push({
        rule: "empty-test",
        line: block.startLine,
        message: "Test body has no executable statement.",
        excerpt: (ctx.change.newText.split("\n")[block.startLine - 1] ?? "").trim(),
      })
    }
    return findings
  },
}

export const unknownTestRule: TestRule = {
  id: "unknown-test",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const findings: RuleFinding[] = []
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block)) continue
      const body = block.lines.join("\n")
      if (countRealLines(body, ctx.change.language) === 0) continue
      if (hasAssertion(body)) continue
      findings.push({
        rule: "unknown-test",
        line: block.startLine,
        message: "Test has no assertion, expect, fail, or expected exception.",
        excerpt: (ctx.change.newText.split("\n")[block.startLine - 1] ?? "").trim(),
      })
    }
    return findings
  },
}

export const protectedPathsRule: TestRule = {
  id: "protected-paths",
  run(ctx) {
    if (!ctx.isTestFile) return []
    if (ctx.change.isNew) return []
    return [{
      rule: "protected-paths",
      line: 0,
      message: ctx.change.isDelete
        ? "Deletion of an existing test file."
        : "Edit of an existing test file.",
      excerpt: ctx.change.filePath,
    }]
  },
}

export const overMockingRule: TestRule = {
  id: "over-mocking",
  run(ctx) {
    const added = ctx.change.addedLines
    const removed = ctx.change.removedLines
    let addedMocks = 0
    let removedMocks = 0
    for (const line of added) if (MOCK_IDENTIFIER_PATTERNS.some(p => p.test(codeText(line, ctx.change.language)))) addedMocks += 1
    for (const line of removed) if (MOCK_IDENTIFIER_PATTERNS.some(p => p.test(codeText(line, ctx.change.language)))) removedMocks += 1
    if (addedMocks - removedMocks < 1) return []
    const sample = added.find(line => MOCK_IDENTIFIER_PATTERNS.some(p => p.test(codeText(line, ctx.change.language)))) ?? ""
    return [{
      rule: "over-mocking",
      line: locateLine(ctx.change.newText, sample),
      message: `New mock identifiers added (net +${addedMocks - removedMocks}).`,
      excerpt: sample.trim(),
    }]
  },
}

export const assertionRouletteRule: TestRule = {
  id: "assertion-roulette",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const findings: RuleFinding[] = []
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block)) continue
      const body = block.lines.join("\n")
      const assertions = countAssertionsCode(block.lines, ctx.change.language)
      if (assertions <= 1) continue
      const hasMessage = /assert\w*\([^)]*,\s*["'`]/.test(body) || /expect\([^)]*,\s*["'`]/.test(body)
      if (hasMessage) continue
      findings.push({
        rule: "assertion-roulette",
        line: block.startLine,
        message: `${assertions} assertions with no message; failures are indistinguishable.`,
        excerpt: (ctx.change.newText.split("\n")[block.startLine - 1] ?? "").trim(),
      })
    }
    return findings
  },
}

const THRESHOLD_PATTERN = /(fail_under|cov-fail-under)\s*[=:]\s*(\d+(?:\.\d+)?)/

function parseThresholds(lines: string[]): number[] {
  const values: number[] = []
  for (const line of lines) {
    const match = line.match(THRESHOLD_PATTERN)
    if (match) values.push(Number(match[2]))
  }
  return values
}

export const weakenedConfigRule: TestRule = {
  id: "weakened-config",
  run(ctx) {
    const findings = addedLineFindings(
      ctx,
      "weakened-config",
      WEAKENED_CONFIG_PATTERNS,
      "Configuration weakens test enforcement.",
    )

    // A relative threshold drop (fail_under / --cov-fail-under) is only visible
    // as a delta between the removed and the added lines.
    const removed = parseThresholds(ctx.change.removedLines)
    const added = parseThresholds(ctx.change.addedLines)
    if (removed.length > 0 && added.length > 0) {
      const previous = Math.max(...removed)
      const next = Math.min(...added)
      if (next < previous) {
        const sample = ctx.change.addedLines.find(line => THRESHOLD_PATTERN.test(line)) ?? ""
        const lineNumber = locateLine(ctx.change.newText, sample)
        if (!withinBypass(ctx, lineNumber)) {
          findings.push({
            rule: "weakened-config",
            line: lineNumber,
            message: `Coverage/test threshold lowered from ${previous} to ${next}.`,
            excerpt: sample.trim(),
          })
        }
      }
    }

    return findings
  },
}

function normalizeBody(lines: string[], language: Language): string {
  return lines
    .map(line => stripComments(line, language).trim())
    .filter(line => line.length > 0)
    .join("\n")
}

// joeyism/opencode-anti-loop (duplicate tests), adapted to an in-file check.
// Cross-file detection needs the audit command (slice 7).
export const duplicateTestRule: TestRule = {
  id: "duplicate-test",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const findings: RuleFinding[] = []
    const seen = new Map<string, number>()
    for (const block of blocksOf(ctx)) {
      const normalized = normalizeBody(block.lines, ctx.change.language)
      if (normalized.length === 0) continue
      const first = seen.get(normalized)
      if (first === undefined) {
        seen.set(normalized, block.startLine)
        continue
      }
      if (!blockIsAdded(ctx, block) && !ctx.change.isNew) continue
      findings.push({
        rule: "duplicate-test",
        line: block.startLine,
        message: `Duplicate test body (identical to the test at line ${first}).`,
        excerpt: (ctx.change.newText.split("\n")[block.startLine - 1] ?? "").trim(),
      })
    }
    return findings
  },
}

// Peruma et al., TsDetect (FSE 2020): Redundant Assertion smell.
export const redundantAssertionRule: TestRule = {
  id: "redundant-assertion",
  run(ctx) {
    if (!ctx.isTestFile) return []
    const findings: RuleFinding[] = []
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block)) continue
      const seen = new Set<string>()
      for (const raw of block.lines) {
        const code = codeText(raw, ctx.change.language).trim()
        if (code.length === 0) continue
        if (!ASSERTION_COUNT_PATTERNS.some(pattern => pattern.test(code))) continue
        if (seen.has(code)) {
          findings.push({
            rule: "redundant-assertion",
            line: locateLine(ctx.change.newText, raw),
            message: "The same assertion is repeated in one test.",
            excerpt: raw.trim(),
          })
          break
        }
        seen.add(code)
      }
    }
    return findings
  },
}

export const testsNotRunRule: TestRule = {
  id: "tests-not-run",
  run(ctx) {
    return addedLineFindings(
      ctx,
      "tests-not-run",
      TESTS_NOT_RUN_PATTERNS,
      "A test command excludes or skips tests.",
    )
  },
}

export interface FileText {
  filePath: string
  text: string
  language: Language
}

export interface CrossFileDuplicate {
  filePath: string
  line: number
  otherFilePath: string
  otherLine: number
  excerpt: string
}

// Cross-file duplicate detection (plan section 5: "whole file(s)"). The live
// hook only sees one file, so this runs in the audit and CI paths that already
// enumerate the suite.
export function findCrossFileDuplicates(files: FileText[], minBodyLength = 20): CrossFileDuplicate[] {
  const first = new Map<string, { filePath: string; line: number }>()
  const out: CrossFileDuplicate[] = []
  for (const file of files) {
    for (const block of findTestBlocks(file.text, file.language)) {
      const normalized = normalizeBody(block.lines, file.language)
      if (normalized.length < minBodyLength) continue
      const existing = first.get(normalized)
      if (!existing) {
        first.set(normalized, { filePath: file.filePath, line: block.startLine })
        continue
      }
      if (existing.filePath === file.filePath) continue
      out.push({
        filePath: file.filePath,
        line: block.startLine,
        otherFilePath: existing.filePath,
        otherLine: existing.line,
        excerpt: (file.text.split("\n")[block.startLine - 1] ?? "").trim(),
      })
    }
  }
  return out.slice(0, 50)
}

export const DETERMINISTIC_RULES: TestRule[] = [
  protectedPathsRule,
  skipFocusAddedRule,
  tautologicalAssertionRule,
  emptyTestRule,
  unknownTestRule,
  guttedTestRule,
  matcherLoosenedRule,
  swallowedErrorRule,
  duplicateTestRule,
]

export const ADVISORY_RULES: TestRule[] = [
  overMockingRule,
  assertionRouletteRule,
  weakenedConfigRule,
  redundantAssertionRule,
  testsNotRunRule,
]
