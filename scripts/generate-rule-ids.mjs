#!/usr/bin/env node
// Regenerates src/rules/tests/binary-rule-ids.json from the test-checker README.
//
// The test-checker binary is the source of truth for rule ids. Its README
// `## Rules` paragraph lists every id it can emit, one backticked token each.
// Point TC_REPO at a current checkout when ../test-checker is stale/missing:
//
//   TC_REPO=/path/to/test-checker node scripts/generate-rule-ids.mjs
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tcRepo = resolve(process.env.TC_REPO ?? join(repoRoot, "..", "test-checker"))
const readmePath = join(tcRepo, "README.md")
const outputPath = join(repoRoot, "src", "rules", "tests", "binary-rule-ids.json")

export function parseRulesParagraph(markdown) {
  const heading = /^##\s+Rules\s*$/m.exec(markdown)
  if (!heading) throw new Error("README has no `## Rules` heading")
  const afterHeading = markdown.slice(heading.index + heading[0].length)
  // The ids live in the first paragraph; stop at the first blank line so later
  // prose in the same section cannot contribute tokens.
  const paragraph = afterHeading.split(/\r?\n\s*\r?\n/).find(part => part.trim().length > 0) ?? ""
  const ids = [...paragraph.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map(match => match[1])
  if (ids.length === 0) throw new Error("`## Rules` paragraph contains no backticked ids")
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate) throw new Error(`duplicate rule id in README: ${duplicate}`)
  return ids
}

const markdown = readFileSync(readmePath, "utf8")
const rules = parseRulesParagraph(markdown)
const ref = execFileSync("git", ["-C", tcRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

writeFileSync(outputPath, `${JSON.stringify({ source: "BaconDroid/test-checker", ref, rules }, null, 2)}\n`)
console.log(`wrote ${rules.length} rule ids from ${readmePath} (${ref}) to ${outputPath}`)
