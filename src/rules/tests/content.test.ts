import { test, expect } from "bun:test"
import { extractChange, type ExtractedChange } from "../../core/diff"
import {
  ADVISORY_RULES,
  DETERMINISTIC_RULES,
  assertionRouletteRule,
  duplicateTestRule,
  emptyTestRule,
  expectedFromSUTRule,
  findCrossFileDuplicates,
  forcedSuccessRule,
  guttedTestRule,
  matcherLoosenedRule,
  mockOfSUTRule,
  negativeControlUnrelatedRule,
  overMockingRule,
  protectedPathsRule,
  redundantAssertionRule,
  skipFocusAddedRule,
  swallowedErrorRule,
  tautologicalAssertionRule,
  testsNotRunRule,
  unknownTestRule,
  weakenedConfigRule,
} from "./content"
import { ALL_TEST_RULES, buildRuleChecks, runTestRules } from "."
import type { RuleContext, TestRule } from "./types"

const TEST_PATTERNS = ["**/*.test.ts", "**/*_test.py", "**/test_*.py"]

function makeChange(
  filePath: string,
  oldText: string,
  newText: string,
  options: { isNew?: boolean; isDelete?: boolean } = {},
): ExtractedChange {
  return extractChange({
    filePath,
    oldText,
    newText,
    isNew: options.isNew ?? false,
    isDelete: options.isDelete ?? false,
  })
}

function makeContext(change: ExtractedChange, isTestFile = change.filePath.endsWith(".test.ts")): RuleContext {
  return {
    change,
    isTestFile,
    config: {
      enabled: true,
      testPatterns: TEST_PATTERNS,
      checks: {},
      maxWarningsPerFile: 0,
    },
  }
}

function run(rule: TestRule, change: ExtractedChange, isTestFile?: boolean) {
  return rule.run(makeContext(change, isTestFile))
}

test("protected-paths flags an edit of an existing test file", () => {
  const change = makeChange("/work/src/a.test.ts", "it('a', () => { expect(1).toBe(1) })", "it('a', () => { expect(1).toBe(2) })")
  expect(run(protectedPathsRule, change)).toHaveLength(1)
})

test("protected-paths exempts a new test file", () => {
  const change = makeChange("/work/src/a.test.ts", "", "it('a', () => {})", { isNew: true })
  expect(run(protectedPathsRule, change)).toHaveLength(0)
})

test("protected-paths ignores non-test files", () => {
  const change = makeChange("/work/src/a.ts", "const a = 1", "const a = 2")
  expect(run(protectedPathsRule, change, false)).toHaveLength(0)
})

test("skip-focus-added flags a focused test", () => {
  const change = makeChange("/work/a.test.ts", "", "it.only('a', () => { expect(1).toBe(1) })\n")
  const findings = run(skipFocusAddedRule, change)
  expect(findings).toHaveLength(1)
  expect(findings[0]!.rule).toBe("skip-focus-added")
})

test("skip-focus-added does not flag a conditional python skip", () => {
  const change = makeChange(
    "/work/test_a.py",
    "",
    "import pytest\n@pytest.mark.skipif(cond, reason='x')\ndef test_a():\n    assert 1\n",
  )
  expect(run(skipFocusAddedRule, change)).toHaveLength(0)
})

test("skip-focus-added ignores a skip that is not an added line", () => {
  const text = "it.skip('a', () => {})\n"
  const change = makeChange("/work/a.test.ts", text, text)
  expect(run(skipFocusAddedRule, change)).toHaveLength(0)
})

test("tautological-assertion flags assert True", () => {
  const change = makeChange("/work/test_a.py", "", "def test_a():\n    assert True\n")
  const findings = run(tautologicalAssertionRule, change, true)
  expect(findings).toHaveLength(1)
})

test("tautological-assertion stays silent on a real assertion", () => {
  const change = makeChange("/work/test_a.py", "", "def test_a():\n    assert compute() == 4\n")
  expect(run(tautologicalAssertionRule, change, true)).toHaveLength(0)
})

test("tautological-assertion does not flag a comment", () => {
  const change = makeChange("/work/test_a.py", "", "# assert True is meaningless\ndef test_a():\n    assert x\n")
  expect(run(tautologicalAssertionRule, change, true)).toHaveLength(0)
})

test("swallowed-error flags except Exception: pass", () => {
  const change = makeChange("/work/test_a.py", "", "def test_a():\n    try:\n        run()\n    except Exception:\n        pass\n")
  expect(run(swallowedErrorRule, change, true)).toHaveLength(1)
})

test("swallowed-error ignores a re-raise", () => {
  const change = makeChange(
    "/work/test_a.py",
    "",
    "def test_a():\n    try:\n        run()\n    except Exception:\n        raise\n",
  )
  expect(run(swallowedErrorRule, change, true)).toHaveLength(0)
})

test("swallowed-error does not flag a removed swallowed error", () => {
  const oldText = "def test_a():\n    try:\n        run()\n    except Exception:\n        pass\n"
  const newText = "def test_a():\n    run()\n"
  const change = makeChange("/work/test_a.py", oldText, newText)
  expect(run(swallowedErrorRule, change, true)).toHaveLength(0)
})

test("gutted-test flags removing every assertion", () => {
  const oldText = "def test_x():\n    assert a == 1\n"
  const newText = "def test_x():\n    pass\n"
  expect(run(guttedTestRule, makeChange("/work/test_x.py", oldText, newText), true)).toHaveLength(1)
})

test("matcher-loosened flags assertEqual -> assertTrue", () => {
  const oldText = "assertEqual(result, 3)\n"
  const newText = "assertTrue(result)\n"
  const findings = run(matcherLoosenedRule, makeChange("/work/test_x.py", oldText, newText), true)
  expect(findings).toHaveLength(1)
})

test("matcher-loosened stays silent without a matching loosening", () => {
  const oldText = "expect(a).toBe(1)\n"
  const newText = "expect(a).toBe(2)\n"
  expect(run(matcherLoosenedRule, makeChange("/work/a.test.ts", oldText, newText))).toHaveLength(0)
})

test("empty-test flags a test with no executable body", () => {
  const change = makeChange("/work/a.test.ts", "", 'test("a", () => {\n})\n', { isNew: true })
  expect(run(emptyTestRule, change)).toHaveLength(1)
})

test("empty-test ignores a test with a body", () => {
  const change = makeChange("/work/a.test.ts", "", 'test("a", () => {\n  expect(1).toBe(1)\n})\n', { isNew: true })
  expect(run(emptyTestRule, change)).toHaveLength(0)
})

test("empty-test does not flag an untouched existing test", () => {
  const text = 'test("a", () => {\n})\n'
  const change = makeChange("/work/a.test.ts", text, text)
  expect(run(emptyTestRule, change)).toHaveLength(0)
})

test("unknown-test flags a test without an assertion", () => {
  const change = makeChange("/work/a.test.ts", "", 'test("a", () => {\n  doSomething()\n})\n', { isNew: true })
  expect(run(unknownTestRule, change)).toHaveLength(1)
})

test("unknown-test ignores a test with an assertion", () => {
  const change = makeChange("/work/a.test.ts", "", 'test("a", () => {\n  expect(1).toBe(1)\n})\n', { isNew: true })
  expect(run(unknownTestRule, change)).toHaveLength(0)
})

test("runTestRules skips rules configured as off", () => {
  const change = makeChange("/work/a.test.ts", "", "it.only('a', () => {})\n", { isNew: true })
  const ctx = makeContext(change)
  ctx.config.checks = { "skip-focus-added": "off" }
  expect(runTestRules(ctx).findings).toHaveLength(0)
})

test("runTestRules honours a file-level bypass", () => {
  const change = makeChange(
    "/work/a.test.ts",
    "",
    "// test-guard-disable-file\ntest('a', () => {\n})\n",
    { isNew: true },
  )
  const result = runTestRules(makeContext(change))
  expect(result.findings).toHaveLength(0)
  expect(result.bypassed).toBe(true)
})

test("runTestRules honours an inline allow marker within two lines", () => {
  const change = makeChange(
    "/work/a.test.ts",
    "",
    "// test-guard: allow intentional focus\ntest.only('a', () => {\n  expect(1).toBe(1)\n})\n",
    { isNew: true },
  )
  const ctx = makeContext(change)
  ctx.config.checks = { "skip-focus-added": "warn" }
  expect(runTestRules(ctx).findings).toHaveLength(0)
})

test("duplicate-test flags two identical added test bodies", () => {
  const text = [
    'test("a", () => {',
    "  expect(1).toBe(1)",
    "})",
    'test("b", () => {',
    "  expect(1).toBe(1)",
    "})",
    "",
  ].join("\n")
  expect(run(duplicateTestRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(1)
})

test("duplicate-test stays silent when bodies differ", () => {
  const text = [
    'test("a", () => {',
    "  expect(1).toBe(1)",
    "})",
    'test("b", () => {',
    "  expect(2).toBe(2)",
    "})",
    "",
  ].join("\n")
  expect(run(duplicateTestRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(0)
})

test("over-mocking flags a newly added mock", () => {
  const change = makeChange("/work/a.test.ts", "", "const mockUser = createUser()\n")
  expect(run(overMockingRule, change)).toHaveLength(1)
})

test("over-mocking stays silent without new mocks", () => {
  const change = makeChange("/work/a.test.ts", "", "const user = createUser()\n")
  expect(run(overMockingRule, change)).toHaveLength(0)
})

test("assertion-roulette flags many assertions without messages", () => {
  const text = ["test('a', () => {", "  expect(a).toBe(1)", "  expect(b).toBe(2)", "})", ""].join("\n")
  expect(run(assertionRouletteRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(1)
})

test("assertion-roulette stays silent when assertions carry messages", () => {
  const text = [
    "test('a', () => {",
    "  expect(a, 'a must be 1').toBe(1)",
    "  expect(b, 'b must be 2').toBe(2)",
    "})",
    "",
  ].join("\n")
  expect(run(assertionRouletteRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(0)
})

test("weakened-config no longer flags || true or --passWithNoTests (moved to forced-success)", () => {
  expect(run(weakenedConfigRule, makeChange("/work/a.test.ts", "run()\n", "run() || true\n"))).toHaveLength(0)
  expect(run(weakenedConfigRule, makeChange("/work/a.test.ts", "", "bun test --passWithNoTests\n"))).toHaveLength(0)
})

test("weakened-config still flags --no-verify and fail_under = 0", () => {
  expect(run(weakenedConfigRule, makeChange("/work/a.test.ts", "", "git commit --no-verify\n"))).toHaveLength(1)
  expect(run(weakenedConfigRule, makeChange("/work/setup.cfg", "", "fail_under = 0\n"))).toHaveLength(1)
})

test("redundant-assertion flags the same assertion twice in one test", () => {
  const text = ["test('a', () => {", "  expect(a).toBe(1)", "  expect(a).toBe(1)", "})", ""].join("\n")
  expect(run(redundantAssertionRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(1)
})

test("redundant-assertion ignores distinct assertions", () => {
  const text = ["test('a', () => {", "  expect(a).toBe(1)", "  expect(b).toBe(2)", "})", ""].join("\n")
  expect(run(redundantAssertionRule, makeChange("/work/a.test.ts", "", text, { isNew: true }))).toHaveLength(0)
})

test("tests-not-run flags an exclude flag", () => {
  const change = makeChange("/work/a.test.ts", "", "bun test --exclude '**/flaky/**'\n")
  expect(run(testsNotRunRule, change)).toHaveLength(1)
})

test("tests-not-run no longer flags --passWithNoTests (owned by forced-success)", () => {
  const change = makeChange("/work/a.test.ts", "", "bun test --passWithNoTests\n")
  expect(run(testsNotRunRule, change)).toHaveLength(0)
})

test("findCrossFileDuplicates flags identical bodies across files", () => {
  const body = ["test('a', () => {", "  expect(compute(1)).toBe(42)", "})", ""].join("\n")
  const dups = findCrossFileDuplicates([
    { filePath: "/a.test.ts", text: body, language: "ts" },
    { filePath: "/b.test.ts", text: body, language: "ts" },
  ])
  expect(dups).toHaveLength(1)
  expect(dups[0]!.otherFilePath).toBe("/a.test.ts")
})

test("findCrossFileDuplicates ignores different bodies", () => {
  const dups = findCrossFileDuplicates([
    { filePath: "/a.test.ts", text: "test('a', () => {\n  expect(compute(1)).toBe(42)\n})\n", language: "ts" },
    { filePath: "/b.test.ts", text: "test('b', () => {\n  expect(compute(2)).toBe(43)\n})\n", language: "ts" },
  ])
  expect(dups).toHaveLength(0)
})

test("weakened-config flags a lowered coverage threshold", () => {
  const findings = run(weakenedConfigRule, makeChange("/work/setup.cfg", "fail_under = 80\n", "fail_under = 50\n"), true)
  expect(findings.some(f => /lowered/.test(f.message))).toBe(true)
})

test("every deterministic rule has a stable id", () => {
  for (const rule of DETERMINISTIC_RULES) expect(rule.id.length).toBeGreaterThan(0)
})

// --- the four new rules ---

test("forced-success flags forced-success constructs and not tautologies", () => {
  const positives: Array<[string, string, string]> = [
    ["shell || true", "/work/a.test.ts", "run() || true\n"],
    ["shell || :", "/work/a.test.ts", "run() || :\n"],
    ["--passWithNoTests", "/work/a.test.ts", "bun test --passWithNoTests\n"],
    ["exit 0", "/work/a.test.ts", "exit 0\n"],
    ["process.exit(0)", "/work/a.test.ts", "process.exit(0)\n"],
    ["continue-on-error", "/work/ci.yml", "continue-on-error: true\n"],
    ["sys.exit(0)", "/work/test_a.py", "def test_a():\n    sys.exit(0)\n"],
  ]
  for (const [name, file, text] of positives) {
    expect(run(forcedSuccessRule, makeChange(file, "", text), true), name).toHaveLength(1)
  }

  const negatives: Array<[string, string, string]> = [
    ["tautological assert", "/work/test_a.py", "def test_a():\n    assert True\n"],
    ["assertTrue(True)", "/work/test_a.py", "def test_a():\n    assertTrue(True)\n"],
    ["plain call", "/work/a.test.ts", "run()\n"],
    ["exit 1", "/work/a.test.ts", "exit 1\n"],
    ["comment only", "/work/a.test.ts", "// run() || true\n"],
  ]
  for (const [name, file, text] of negatives) {
    expect(run(forcedSuccessRule, makeChange(file, "", text), true), name).toHaveLength(0)
  }
})

test("mock-of-sut flags circular mocks and ignores unrelated ones", () => {
  const positives: Array<[string, string, string]> = [
    ["js vi.mock of the SUT", "/work/foo.test.ts", "import { run } from './foo'\nvi.mock('./foo')\n"],
    ["ts jest.mock of the SUT", "/work/foo.test.ts", "import { run } from '../lib/foo'\njest.mock('../lib/foo')\n"],
    ["js spyOn of an import from the SUT", "/work/foo.test.ts", "import * as foo from './foo'\njest.spyOn(foo, 'run')\n"],
    ["python patch of the SUT", "/work/test_foo.py", "from unittest.mock import patch\npatch('foo.bar')\n"],
    ["python mocker.patch of the SUT", "/work/foo_test.py", "mocker.patch('foo.bar')\n"],
  ]
  for (const [name, file, text] of positives) {
    expect(run(mockOfSUTRule, makeChange(file, "", text), true), name).toHaveLength(1)
  }

  const negatives: Array<[string, string, string]> = [
    ["js mock of another module", "/work/foo.test.ts", "vi.mock('./bar')\n"],
    ["js mock of a library", "/work/foo.test.ts", "jest.mock('some-library')\n"],
    ["python patch of another module", "/work/test_foo.py", "patch('bar.baz')\n"],
    ["go has no idiom", "/work/foo_test.go", "func TestX(t *testing.T) {\n\tpatch(\"foo\")\n}\n"],
    ["rust has no idiom", "/work/foo_test.rs", "#[test]\nfn foo_test() {\n    patch(\"foo\");\n}\n"],
    ["non-test file", "/work/foo.ts", "vi.mock('./foo')\n"],
  ]
  for (const [name, file, text] of negatives) {
    const isTest = name !== "non-test file"
    expect(run(mockOfSUTRule, makeChange(file, "", text), isTest), name).toHaveLength(0)
  }
})

test("expected-from-sut flags self-referential assertions and not distinct ones", () => {
  const positives: Array<[string, string, string]> = [
    ["python assertEqual", "/work/test_a.py", "assertEqual(f(x), f(y))\n"],
    ["python assert ==", "/work/test_a.py", "assert f(x) == f(y)\n"],
    ["js expect/toBe", "/work/a.test.ts", "expect(f(x)).toBe(f(y))\n"],
  ]
  for (const [name, file, text] of positives) {
    expect(run(expectedFromSUTRule, makeChange(file, "", text), true), name).toHaveLength(1)
  }

  const negatives: Array<[string, string, string]> = [
    ["distinct calls", "/work/test_a.py", "assertEqual(f(x), g(y))\n"],
    ["literal expected", "/work/a.test.ts", "expect(f(x)).toBe(3)\n"],
    ["no call", "/work/test_a.py", "assert x == 5\n"],
    ["not an assertion", "/work/a.test.ts", "const y = f(x)\n"],
  ]
  for (const [name, file, text] of negatives) {
    expect(run(expectedFromSUTRule, makeChange(file, "", text), true), name).toHaveLength(0)
  }
})

test("negative-control-unrelated flags broad negative controls and not typed ones", () => {
  const positives: Array<[string, string, string]> = [
    ["pytest.raises(Exception)", "/work/test_a.py", "with pytest.raises(Exception):\n    run()\n"],
    ["assertRaises(Exception)", "/work/test_a.py", "self.assertRaises(Exception)\n"],
    ["toThrow()", "/work/a.test.ts", "expect(fn).toThrow()\n"],
    ["toThrow(Error)", "/work/a.test.ts", "expect(fn).toThrow(Error)\n"],
    ["not.toThrow()", "/work/a.test.ts", "expect(fn).not.toThrow()\n"],
  ]
  for (const [name, file, text] of positives) {
    expect(run(negativeControlUnrelatedRule, makeChange(file, "", text), true), name).toHaveLength(1)
  }

  const negatives: Array<[string, string, string]> = [
    ["typed python exception", "/work/test_a.py", "with pytest.raises(ValueError):\n    run()\n"],
    ["toThrow with a message", "/work/a.test.ts", "expect(fn).toThrow('boom')\n"],
    ["rust has no pattern", "/work/a_test.rs", "assert!(result.is_err());\n"],
  ]
  for (const [name, file, text] of negatives) {
    expect(run(negativeControlUnrelatedRule, makeChange(file, "", text), true), name).toHaveLength(0)
  }
})

test("the rule catalog exposes 18 ids in order with the documented defaults", () => {
  const ids = ALL_TEST_RULES.map(rule => rule.id)
  expect(ids).toEqual([
    "protected-paths",
    "skip-focus-added",
    "tautological-assertion",
    "empty-test",
    "unknown-test",
    "gutted-test",
    "matcher-loosened",
    "swallowed-error",
    "duplicate-test",
    "forced-success",
    "mock-of-sut",
    "over-mocking",
    "assertion-roulette",
    "weakened-config",
    "redundant-assertion",
    "tests-not-run",
    "expected-from-sut",
    "negative-control-unrelated",
  ])
  expect(ids).toHaveLength(18)
  expect(DETERMINISTIC_RULES).toHaveLength(11)
  expect(ADVISORY_RULES).toHaveLength(7)

  const checks = buildRuleChecks(false)
  expect(Object.keys(checks)).toHaveLength(18)
  expect(checks["forced-success"]).toBe("warn")
  expect(checks["mock-of-sut"]).toBe("warn")
  expect(checks["expected-from-sut"]).toBe("off")
  expect(checks["negative-control-unrelated"]).toBe("off")
})
