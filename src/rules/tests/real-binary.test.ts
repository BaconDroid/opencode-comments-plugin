// End-to-end rule-id contract against the real test-checker binary.
//
// Set TC_BINARY to a test-checker build (tc main d8d14ce):
//   TC_BINARY=/path/to/test-checker bun test src/rules/tests/real-binary.test.ts
//
// The guard is the same before/after path the plugin hook uses; only the engine
// runner is pinned to the local binary instead of the cache/download resolver.
import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { createTestGuard, type ResolvedTestGuard } from "../../core/dispatch"
import { runTestChecker } from "../../cli"
import { buildRuleChecks } from "./index"
import { DEFAULT_TEST_PATTERNS } from "./patterns"

const tcBinary = process.env.TC_BINARY
const hasBinary = typeof tcBinary === "string" && tcBinary.length > 0 && existsSync(tcBinary)
if (!hasBinary) {
  console.warn(
    "[real-binary] skipping: set TC_BINARY to a test-checker build (tc main d8d14ce), e.g. " +
      "TC_BINARY=/var/home/bacon/targets/tc-plugin/release/test-checker",
  )
}

type Case = {
  rule: string
  tool: "write" | "edit"
  filePath: string
  base: string
  args: Record<string, unknown>
}

// One payload per required rule id, adapted from the tc detector fixtures.
const CASES: Case[] = [
  {
    rule: "focus-added",
    tool: "write",
    filePath: "/work/tests/app.test.ts",
    base: "Wrote file successfully.",
    args: { content: "it.only('sums', () => {\n  expect(add(1, 2)).toBe(3);\n});\n" },
  },
  {
    rule: "skip-added",
    tool: "write",
    filePath: "/work/tests/app.test.js",
    base: "Wrote file successfully.",
    args: { content: "suite.skip('a', () => {\n  expect(add(1, 2)).toBe(3);\n});\n" },
  },
  {
    rule: "constant-assertion",
    tool: "write",
    filePath: "/work/tests/app.test.js",
    base: "Wrote file successfully.",
    args: { content: "it('x', () => {\n  expect(1).toBe(1);\n});\n" },
  },
  {
    // tc main 60e58e0 added allow-invalid; an invalid suppression marker must
    // reach the user instead of being filtered as an unknown id.
    rule: "allow-invalid",
    tool: "edit",
    filePath: "/work/tests/test_app.py",
    base: "The file has been updated.",
    args: {
      oldString:
        "def test_sums():\n    # test-checker: allow not-a-rule -- tracked upstream #12\n    assert add(1, 2) == 3\n",
      newString:
        "def test_sums():\n    # test-checker: allow not-a-rule -- tracked upstream #12\n    @pytest.mark.skip\n    assert add(1, 2) == 3\n",
    },
  },
  {
    rule: "weakened-assertion",
    tool: "edit",
    filePath: "/work/tests/app.test.js",
    base: "The file has been updated.",
    args: {
      oldString: "it('sums', () => {\n  expect(add(1, 2)).toEqual(3);\n});",
      newString: "it('sums', () => {\n  expect(add(1, 2)).toBeDefined();\n});",
    },
  },
  {
    rule: "swallowed-error",
    tool: "write",
    filePath: "/work/tests/test_app.py",
    base: "Wrote file successfully.",
    args: { content: "def test_x():\n    try:\n        run()\n    except Exception:\n        pass\n    assert add(1, 2) == 3\n" },
  },
  {
    rule: "assertion-removed",
    tool: "edit",
    filePath: "/work/tests/test_app.py",
    base: "The file has been updated.",
    args: {
      oldString: "def test_sums():\n    assert add(1, 2) == 3\n    assert add(2, 2) == 4\n",
      newString: "def test_sums():\n    assert add(1, 2) == 3\n",
    },
  },
]

function config(): ResolvedTestGuard {
  return {
    enabled: true,
    testPatterns: [...DEFAULT_TEST_PATTERNS],
    testCommand: null,
    checks: buildRuleChecks(false),
    maxWarningsPerFile: 0,
    dedupWindowMs: 0,
    triggerTools: new Set(["write", "edit"]),
    engine: "binary",
  }
}

test.skipIf(!hasBinary)("every real test-checker rule id reaches the appended hook output", async () => {
  const resolved = config()
  const guard = createTestGuard(() => resolved, {
    runTestChecker: input => runTestChecker(input, { cliPath: tcBinary! }),
  })

  for (const [index, testCase] of CASES.entries()) {
    const input = { tool: testCase.tool, sessionID: `real-${testCase.rule}`, callID: `call-${index}` }
    const output = { title: "", output: testCase.base, metadata: {} }
    guard.before(input, { args: { filePath: testCase.filePath, ...testCase.args } })
    await guard.after(input, output)

    expect(output.output.startsWith(testCase.base)).toBe(true)
    expect(output.output).toContain(testCase.rule)
    expect(output.output).toContain("(confidence: high)")
  }
})
