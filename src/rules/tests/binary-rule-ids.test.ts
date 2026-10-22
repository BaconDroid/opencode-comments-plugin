import { test, expect } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import binaryRuleIds from "./binary-rule-ids.json"
import { buildRuleChecks } from "./index"
import { LEGACY_RULE_ALIASES, resolveRuleSeverity } from "./rule-ids"
import { resolveRuleConfig } from "../../core/config"

// Independent oracle: the test-checker README `## Rules` paragraph at main
// d8d14ce. Kept as a literal so this test still fails if the generated JSON
// loses an id while the tc checkout is unavailable (e.g. in CI).
const AUTHORITATIVE_RULE_IDS = [
  "skip-added",
  "focus-added",
  "assertion-removed",
  "test-removed",
  "gutted-test",
  "no-assertion",
  "tautological-assertion",
  "constant-assertion",
  "weakened-assertion",
  "swallowed-error",
  "incomplete-assertion",
  "unawaited-assertion",
  "broad-exception",
  "mock-of-sut",
  "over-mocking",
  "duplicate-test",
  "expected-copied-from-actual",
  "snapshot-regenerated",
  "tolerance-broadened",
  "conditional-assertion",
  "retry-added",
  "agent-memo-test",
  "allow-added",
  "gate-weakened",
  "commented-out-test",
  "source-grep-test",
  "test-volume",
  "harness-edited",
  "near-duplicate-test",
  "echo-test",
  "mirror-implementation-test",
] as const

const EXPECTED_REF = "d8d14ce208e02cb95e38366d4710bf8e35e6e085"

function parseRulesParagraph(markdown: string): string[] {
  const heading = /^##\s+Rules\s*$/m.exec(markdown)
  if (!heading) throw new Error("README has no `## Rules` heading")
  const afterHeading = markdown.slice(heading.index + heading[0].length)
  const paragraph = afterHeading.split(/\r?\n\s*\r?\n/).find(part => part.trim().length > 0) ?? ""
  return [...paragraph.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map(match => match[1]!)
}

const tcRepo = process.env.TC_REPO ?? resolve(import.meta.dir, "../../../..", "test-checker")
const readmePath = join(tcRepo, "README.md")
const hasReadme = existsSync(readmePath)
if (!hasReadme) console.warn(`[binary-rule-ids] skipping README comparison: ${readmePath} not found (set TC_REPO to a test-checker checkout)`)

test("the contract JSON is well formed, unique and points at tc main d8d14ce", () => {
  expect(binaryRuleIds.source).toBe("BaconDroid/test-checker")
  expect(binaryRuleIds.ref).toBe(EXPECTED_REF)
  expect(Array.isArray(binaryRuleIds.rules)).toBe(true)
  expect(binaryRuleIds.rules.length).toBe(AUTHORITATIVE_RULE_IDS.length)
  expect(new Set(binaryRuleIds.rules).size).toBe(binaryRuleIds.rules.length)
  for (const id of binaryRuleIds.rules) {
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  }
})

test("the contract contains every authoritative tc rule id", () => {
  expect([...binaryRuleIds.rules].sort()).toEqual([...AUTHORITATIVE_RULE_IDS].sort())
})

test("buildRuleChecks enables every binary id at warn (advisory off or on)", () => {
  for (const includeAdvisory of [false, true]) {
    const checks = buildRuleChecks(includeAdvisory)
    for (const id of AUTHORITATIVE_RULE_IDS) {
      expect(checks[id]).toBe("warn")
    }
  }
})

test.skipIf(!hasReadme)("the generated JSON matches the tc README `## Rules` paragraph", () => {
  const readmeIds = parseRulesParagraph(readFileSync(readmePath, "utf8"))
  expect([...readmeIds].sort()).toEqual([...binaryRuleIds.rules].sort())
})

test("plugin-only advisory ids stay off; binary ids never do", () => {
  const checks = buildRuleChecks(false)
  for (const pluginOnly of [
    "assertion-roulette",
    "redundant-assertion",
    "tests-not-run",
    "negative-control-unrelated",
  ]) {
    expect(checks[pluginOnly]).toBe("off")
  }
  for (const binaryId of binaryRuleIds.rules) {
    expect(checks[binaryId]).toBe("warn")
  }
})

test("severity resolution prefers exact, then a legacy alias, then warn", () => {
  expect(resolveRuleSeverity({ "focus-added": "off" }, "focus-added")).toEqual({ severity: "off", known: true })
  expect(resolveRuleSeverity({ "skip-focus-added": "off" }, "skip-added")).toEqual({ severity: "off", known: true })
  expect(resolveRuleSeverity({ "tautological-assertion": "off" }, "constant-assertion")).toEqual({
    severity: "off",
    known: true,
  })
  expect(resolveRuleSeverity({}, "future-binary-id")).toEqual({ severity: "warn", known: false })
})

test("a legacy config override propagates to the current binary ids", () => {
  const schema = buildRuleChecks(false)
  const checks = resolveRuleConfig(schema, {
    envPrefix: "TEST_GUARD_",
    options: { checks: { "skip-focus-added": "off" } },
    aliases: LEGACY_RULE_ALIASES,
  })
  expect(checks["skip-added"]).toBe("off")
  expect(checks["focus-added"]).toBe("off")

  // An explicit current-id setting wins over the legacy alias.
  const explicit = resolveRuleConfig(schema, {
    envPrefix: "TEST_GUARD_",
    options: { checks: { "skip-focus-added": "off", "focus-added": "warn" } },
    aliases: LEGACY_RULE_ALIASES,
  })
  expect(explicit["skip-added"]).toBe("off")
  expect(explicit["focus-added"]).toBe("warn")
})
