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
import { matchesAnyGlob } from "../../core/glob"

// Test-path truth, matching test-checker's `is_test_path`: a directory segment,
// a filename prefix, or a filename infix decides. The table is data so a
// generated table can replace it without touching call sites.
export interface TestPathTable {
  readonly directorySegments: readonly string[]
  readonly filenamePrefixes: readonly string[]
  readonly filenameInfixes: readonly string[]
}

export const TEST_PATH_TABLE: TestPathTable = {
  directorySegments: ["tests", "test", "__tests__", "spec", "specs"],
  filenamePrefixes: ["test_", "test-"],
  filenameInfixes: ["_test.", ".test.", ".spec.", "_spec."],
}

// `test_patterns` is an override; an empty list selects the built-in table.
// Keeping the constant keeps the resolved-config shape stable while the table
// remains the single source of the default selection.
export const DEFAULT_TEST_PATTERNS: string[] = []

// Paths that carry a test gate but are not test files. Mirrors test-checker's
// `is_harness_path` so the live hook forwards the same paths the binary
// classifies independently of language.
export interface HarnessPathTable {
  readonly pathSubstrings: readonly string[]
  readonly filenames: readonly string[]
  readonly filenamePrefixes: readonly string[]
}

export const HARNESS_PATH_TABLE: HarnessPathTable = {
  pathSubstrings: [".github/workflows/", ".gitlab-ci"],
  filenames: [
    "pytest.ini",
    "tox.ini",
    "conftest.py",
    "setup.cfg",
    "pyproject.toml",
    "package.json",
    "makefile",
    "codecov.yml",
  ],
  filenamePrefixes: ["jest.config", "vitest.config", "karma.conf", ".nycrc"],
}

// The binary recognises its own suppression config before either the config
// or harness branch runs, and reports `config-edited` for it. The plugin
// forwards it as a non-test path for the same reason.
export const TEST_CONFIG_BASENAMES: readonly string[] = [".test-checker.json"]

// The harness paths whose edit directly decides what CI runs. The binary
// resolves a finding on these above the Medium gate; every other harness file
// stays Low telemetry.
export const SENSITIVE_HARNESS_PATH_TABLE: HarnessPathTable = {
  pathSubstrings: [".github/workflows/", ".gitlab-ci"],
  filenames: ["pytest.ini", "tox.ini", "conftest.py"],
  filenamePrefixes: ["jest.config", "vitest.config"],
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase()
}

export function matchesTestPathTable(filePath: string, table: TestPathTable = TEST_PATH_TABLE): boolean {
  const normalized = normalizePath(filePath)
  const file = normalized.split("/").pop() ?? ""
  return (
    normalized.split("/").some(segment => table.directorySegments.includes(segment)) ||
    table.filenamePrefixes.some(prefix => file.startsWith(prefix)) ||
    table.filenameInfixes.some(infix => file.includes(infix))
  )
}

function matchesHarnessPathTable(filePath: string, table: HarnessPathTable): boolean {
  const normalized = normalizePath(filePath)
  const file = normalized.split("/").pop() ?? ""
  return (
    table.pathSubstrings.some(substring => normalized.includes(substring)) ||
    table.filenames.includes(file) ||
    table.filenamePrefixes.some(prefix => file.startsWith(prefix))
  )
}

export function isTestPath(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return matchesTestPathTable(filePath)
  return matchesAnyGlob(patterns, filePath.replace(/\\/g, "/"))
}

export function isHarnessPath(filePath: string): boolean {
  return matchesHarnessPathTable(filePath, HARNESS_PATH_TABLE)
}

export function isSensitiveHarnessPath(filePath: string): boolean {
  return isHarnessPath(filePath) && matchesHarnessPathTable(filePath, SENSITIVE_HARNESS_PATH_TABLE)
}

export function isTestConfigPath(filePath: string): boolean {
  const file = normalizePath(filePath).split("/").pop() ?? ""
  return TEST_CONFIG_BASENAMES.includes(file)
}

// One gate for the live hook, audit, CI and cleanup. A path is selected when it
// is a test file, a harness/config file, or the suppression config. Harness
// wins when a path is both (for example `tests/conftest.py`): the binary
// handles the harness branch before the test branch, so the in-process rules
// must not treat it as a test.
export function isSelectedTestPath(filePath: string, patterns: string[]): boolean {
  return isHarnessPath(filePath) || isTestConfigPath(filePath) || isTestPath(filePath, patterns)
}

export function isTestFileForAnalysis(filePath: string, patterns: string[]): boolean {
  return isTestPath(filePath, patterns) && !isHarnessPath(filePath) && !isTestConfigPath(filePath)
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

// `|| true`, `exit 0`, `continue-on-error` and `--passWithNoTests` moved to
// FORCED_SUCCESS_PATTERNS; only the config-weakening patterns remain.
export const WEAKENED_CONFIG_PATTERNS: RegExp[] = [
  /@ts-nocheck\b/,
  /--no-verify\b/,
  /#\s*ruff:\s*noqa/,
  /\bfail_under\s*=\s*0\b/,
]

// forced-success: added code that forces a test/command to succeed regardless
// of the real outcome.
export const FORCED_SUCCESS_PATTERNS: RegExp[] = [
  /\|\|\s*(?:true|:)\s*$/,
  /(?:^|[^\w])exit\s+0\b/,
  /\bsys\.exit\(\s*0\s*\)/,
  /\bprocess\.exit\(\s*0\s*\)/,
  /\bcontinue-on-error:\s*true\b/,
  /--passWithNoTests\b/,
]

// negative-control-unrelated: broad negative patterns that can pass for an
// unrelated reason. Strings are kept (only comments are stripped) so
// `.toThrow('message')` is not mistaken for the empty `.toThrow()`.
export const NEGATIVE_CONTROL_PATTERNS: Partial<Record<Language, RegExp[]>> = {
  python: [
    /pytest\.raises\(\s*(?:Exception|BaseException)\s*\)/,
    /assertRaises\(\s*(?:Exception|BaseException)\s*\)/,
    /assertRaisesRegex\(\s*(?:Exception|BaseException)/,
  ],
  js: [/\.toThrow\s*\(\s*(?:Error\s*)?\)/, /expect\([^)]*\)\.not\.toThrow\(\s*\)/],
  ts: [/\.toThrow\s*\(\s*(?:Error\s*)?\)/, /expect\([^)]*\)\.not\.toThrow\(\s*\)/],
}

// expected-from-sut: an added assertion whose expected value is produced by the
// code under test (the same call identifier appears at least twice on the line).
export const EXPECTED_ASSERTION_GATE: RegExp[] = [
  /\bassert/,
  /\bexpect\s*\(/,
  /\brequire\./,
  /\bshould\b/,
]

export const CALL_IDENTIFIER_PATTERN = /\b([A-Za-z_]\w*)\s*\(/g

// mock-of-sut: only JS/TS and Python expose a reliable circular-mock idiom. The
// module path is the signal, so these run on comment-stripped text with string
// literals intact.
export const JS_MOCK_CALL_PATTERN = /(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/
export const JS_SPY_ON_CALL_PATTERN = /(?:vi|jest)\.spyOn\(\s*(\w+)/
export const JS_IMPORT_FROM_PATTERN = /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/
export const JS_REQUIRE_PATTERN = /(?:const|let|var)\s+(.+?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/
export const PY_PATCH_PATTERN = /(?:mocker\.)?patch\(\s*['"]([^'"]+)['"]/

export const TESTS_NOT_RUN_PATTERNS: RegExp[] = [
  /--ignore(?:=|\s)/,
  /--exclude\b/,
  /--deselect\b/,
  /-k\s+['"]?not\b/,
  /--testPathIgnorePatterns/,
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
