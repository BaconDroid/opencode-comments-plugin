import { test, expect } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import binaryRuleIds from "./binary-rule-ids.json"
import { buildRuleChecks } from "./index"
import { LEGACY_RULE_ALIASES, resolveRuleSeverity } from "./rule-ids"
import { resolveRuleConfig } from "../../core/config"

// Independent oracle: the test-checker README `## Rules` paragraph at main
// 60e58e0. Kept as a literal so this test still fails if the generated JSON
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
  "allow-invalid",
  "config-edited",
  "gate-weakened",
  "commented-out-test",
  "source-grep-test",
  "test-volume",
  "harness-edited",
  "near-duplicate-test",
  "echo-test",
  "mirror-implementation-test",
] as const

const EXPECTED_REF = "60e58e0bee091490ef194a5995d1964938839ab8"

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

test("the contract JSON is well formed, unique and points at tc main 60e58e0", () => {
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

test("every alias target is a real id in the generated tc contract", () => {
  for (const targets of Object.values(LEGACY_RULE_ALIASES)) {
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(binaryRuleIds.rules).toContain(target)
    }
  }
})

test("every legacy config override reaches every alias target for off, warn and invalid error", () => {
  const schema = buildRuleChecks(false)
  for (const [legacy, targets] of Object.entries(LEGACY_RULE_ALIASES)) {
    for (const level of ["off", "warn"] as const) {
      const checks = resolveRuleConfig(schema, {
        envPrefix: "TEST_GUARD_",
        options: { checks: { [legacy]: level } },
        aliases: LEGACY_RULE_ALIASES,
      })
      for (const target of targets) expect(checks[target], `${legacy} -> ${target} (${level})`).toBe(level)
      // No over-propagation: an id that is not an alias target keeps its default.
      expect(checks["snapshot-regenerated"]).toBe("warn")
    }

    // `error` is not a valid Severity; the override is ignored and the binary
    // default (warn) wins for every target.
    const invalid = resolveRuleConfig(schema, {
      envPrefix: "TEST_GUARD_",
      options: { checks: { [legacy]: "error" } },
      aliases: LEGACY_RULE_ALIASES,
    })
    for (const target of targets) expect(invalid[target], `${legacy} -> ${target} (error)`).toBe("warn")
  }
})

test("the corrected empty-test and weakened-config mappings hit only their real signals", () => {
  const schema = buildRuleChecks(false)

  const empty = resolveRuleConfig(schema, {
    envPrefix: "TEST_GUARD_",
    options: { checks: { "empty-test": "off" } },
    aliases: LEGACY_RULE_ALIASES,
  })
  expect(empty["gutted-test"]).toBe("off")
  // empty-test never covered executable bodies that merely lack an assertion.
  expect(empty["no-assertion"]).toBe("warn")

  const weakened = resolveRuleConfig(schema, {
    envPrefix: "TEST_GUARD_",
    options: { checks: { "weakened-config": "off" } },
    aliases: LEGACY_RULE_ALIASES,
  })
  expect(weakened["gate-weakened"]).toBe("off")
  expect(weakened["harness-edited"]).toBe("off")
  // No numeric tolerance or retry signal in the old regex rule.
  expect(weakened["tolerance-broadened"]).toBe("warn")
  expect(weakened["retry-added"]).toBe("warn")
})

test("an explicit current-id setting wins over a legacy alias", () => {
  const schema = buildRuleChecks(false)
  const explicit = resolveRuleConfig(schema, {
    envPrefix: "TEST_GUARD_",
    options: { checks: { "skip-focus-added": "off", "focus-added": "warn" } },
    aliases: LEGACY_RULE_ALIASES,
  })
  expect(explicit["skip-added"]).toBe("off")
  expect(explicit["focus-added"]).toBe("warn")
})
