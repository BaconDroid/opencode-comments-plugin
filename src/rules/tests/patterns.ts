// Per-language regex patterns and test-path helpers.
//
// Regex origins, per the project rule to cite every ported pattern:
// - tamperguard (MIT): delta rules, real-line assertion census.
// - tampercheck (Apache-2.0): per-language regex table, inline allow marker.
// - pr-test-guard (MIT): PTG001-010 test-tampering patterns.
// - veredicto, tag v0.3.3 only (MIT): deleted-tests, gutted-tests,
//   weakened-assertions, circular-mocks. `main` is source-available and must
//   not be used.
// - Linter rule ids reused: jest/no-disabled-tests, jest/expect-expect,
//   ruff/flake8-pytest-style PT015/PT018/B011, SonarJS S1607, SonarQube S2699.

import type { Language } from "../../core/diff"
import { matchPathFilter } from "../../core/glob"

export const DEFAULT_TEST_PATTERNS = [
  "**/*.test.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.spec.*",
]

export function isTestPath(filePath: string, patterns: string[]): boolean {
  return matchPathFilter(patterns, filePath, DEFAULT_TEST_PATTERNS)
}

// jest/no-disabled-tests + ruff PT015 + go t.Skip + rust #[ignore].
export const SKIP_FOCUS_PATTERNS: Partial<Record<Language, RegExp[]>> = {
  js: [/\.(?:skip|only|todo)\s*\(/, /\b(?:xit|xdescribe|xtest)\s*\(/],
  ts: [/\.(?:skip|only|todo)\s*\(/, /\b(?:xit|xdescribe|xtest)\s*\(/],
  python: [
    /@pytest\.mark\.skip(?!if)/,
    /@pytest\.mark\.(?:xfail)/,
    /@unittest\.skip(?!If|Unless)/,
    /\.skipIf\s*\(/,
  ],
  go: [/\bt\.Skip(?:f|Now)?\s*\(/],
  rust: [/#\[ignore\]/],
}

// Conditional skips that must NOT be flagged: skipif / skipIf / skipIfUnless,
// or skip calls carrying a condition argument.
export const CONDITIONAL_SKIP_PATTERNS: RegExp[] = [
  /skipif/i,
  /skipIf(?:Unless)?\s*\(/,
  /@unittest\.skipIf/,
  /@unittest\.skipUnless/,
  /\bif\s+.*\bskip/i,
]

// Ruff PT018 / SonarJS S1607 / SonarQube S2699: tautological assertions.
export const TAUTOLOGICAL_PATTERNS: RegExp[] = [
  /\bassert\s+True\b/,
  /\bassertTrue\s*\(\s*True\s*\)/,
  /\bexpect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
  /\bassert\.ok\s*\(\s*true\s*\)/,
  /\bassertEquals\s*\(\s*(\w+)\s*,\s*\1\s*\)/,
  /\bassert\s+(\w+)\s*==\s*\1\b/,
]

// jest/expect-expect + SonarJS S2699: a test must contain an assertion.
export const ASSERTION_PATTERNS: RegExp[] = [
  /\bassert\b/,
  /\bexpect\s*\(/,
  /\bfail\s*\(/,
  /\bverify\s*\(/,
  /\bshould\b/,
  /\braises\b/,
  /\bthrows\b/,
  /\bassertRaises\b/,
  /\bt\.(?:Error|Fatal)\b/,
  /\bpanic!\s*\(/,
  /\brequire\./,
]

export const ASSERTION_COUNT_PATTERNS: RegExp[] = [
  /\bassert\w*\s*\(/,
  /\bassert\s+/,
  /\bexpect\s*\(/,
  /\bassertEqual\b/,
  /\bassertRaises\b/,
  /\bverify\b/,
  /\bassertThat\b/,
  /\bself\.assert\w+/,
]

// Veredicto v0.3.3 weakened-assertions + tampercheck.
export interface MatcherLoosening {
  before: RegExp
  after: RegExp
  message: string
}

export const MATCHER_LOOSENINGS: MatcherLoosening[] = [
  { before: /assertEqual\s*\(/, after: /assertTrue\s*\(/, message: "assertEqual loosened to assertTrue" },
  { before: /\.toBe\s*\(/, after: /\.toBeTruthy\s*\(/, message: "toBe loosened to toBeTruthy" },
  { before: /\.toBe\s*\(/, after: /\.toBeDefined\s*\(/, message: "toBe loosened to toBeDefined" },
  {
    before: /assertRaises\s*\(\s*\w+/,
    after: /assertRaises\s*\(\s*Exception\s*\)/,
    message: "assertRaises narrowed to Exception",
  },
  { before: /\.toThrow\s*\(/, after: /\.not\.toThrow\s*\(/, message: "toThrow inverted to not.toThrow" },
]

export const SWALLOWED_ERROR_PATTERNS: Partial<Record<Language, RegExp[]>> = {
  js: [/catch\s*(?:\([^)]*\))?\s*\{\s*\}/],
  ts: [/catch\s*(?:\([^)]*\))?\s*\{\s*\}/],
  python: [/except\s+(?:Exception|BaseException)?\s*:\s*pass\b/],
  rust: [/Err\(_\)\s*=>\s*(?:\{\s*\}|\(\))/],
}

export const MOCK_IDENTIFIER_PATTERNS: RegExp[] = [
  /\b(?:dummy|stub|mock|spy|fake)[A-Za-z0-9_]*\b/i,
  /\bmonkeypatch\b/,
  /\bpatch\s*\(/,
]

export const WEAKENED_CONFIG_PATTERNS: RegExp[] = [
  /\|\|\s*true\b/,
  /--passWithNoTests\b/,
  /\bcontinue-on-error\s*:\s*true\b/,
  /@ts-nocheck\b/,
  /#\s*ruff:\s*noqa/,
  /\bexit\s+0\b/,
  /\bfail_under\s*=\s*0\b/,
]

export const TESTS_NOT_RUN_PATTERNS: RegExp[] = [
  /--ignore(?:=|\s)/,
  /--exclude\b/,
  /--deselect\b/,
  /-k\s+['"]?not\b/,
  /--testPathIgnorePatterns/,
  /--passWithNoTests\b/,
]

export const TEST_DECLARATION_PATTERNS: Partial<Record<Language, RegExp>> = {
  js: /(?:^|[^\w.])(?:it|test|describe)(?:\.(?:skip|only|todo|each|concurrent))?\s*\(/,
  ts: /(?:^|[^\w.])(?:it|test|describe)(?:\.(?:skip|only|todo|each|concurrent))?\s*\(/,
  python: /^\s*(?:async\s+)?def\s+test_\w*\s*\(/,
  go: /^\s*func\s+Test\w*\s*\(/,
  rust: /#\[test\]/,
}

export const PLACEHOLDER_PATTERN = /^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i

export function hasAssertion(text: string): boolean {
  return ASSERTION_PATTERNS.some(pattern => pattern.test(text))
}

export function countAssertions(lines: string[]): number {
  let count = 0
  for (const line of lines) {
    if (ASSERTION_COUNT_PATTERNS.some(pattern => pattern.test(line))) count += 1
  }
  return count
}

export function isConditionalSkip(line: string): boolean {
  return CONDITIONAL_SKIP_PATTERNS.some(pattern => pattern.test(line))
}
