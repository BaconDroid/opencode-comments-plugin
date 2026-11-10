#!/usr/bin/env node
// Regenerates src/rules/tests/path-predicates.json from the test-checker contract.
//
// The test-checker binary is the source of truth for the test/harness path
// predicates. Its committed `eval/path-predicates.json` is generated from the
// Rust tables in `src/language.rs`, so this script copies that contract and
// records the checkout it came from. Point TC_REPO at a current checkout when
// ../test-checker is stale/missing:
//
//   TC_REPO=/path/to/test-checker node scripts/generate-path-predicates.mjs
//   TC_REPO=/path/to/test-checker node scripts/generate-path-predicates.mjs --check
//
// `--check` regenerates in memory and exits 1 on a diff without writing.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tcRepo = resolve(process.env.TC_REPO ?? join(repoRoot, "..", "test-checker"))
const contractPath = join(tcRepo, "eval", "path-predicates.json")
const outputPath = join(repoRoot, "src", "rules", "tests", "path-predicates.json")

const ARRAY_FIELDS = [
  "test_path_segments",
  "test_filename_prefixes",
  "test_filename_infixes",
  "extension_test_name_rules",
  "harness_path_substrings",
  "harness_basenames",
  "harness_filename_prefixes",
  "sensitive_harness_path_substrings",
  "sensitive_harness_basenames",
  "sensitive_harness_filename_prefixes",
]

export function parsePathPredicateContract(text) {
  const contract = JSON.parse(text)
  if (contract.generated_from !== "src/language.rs") {
    throw new Error(`unexpected contract origin: ${JSON.stringify(contract.generated_from)}`)
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(contract[field])) throw new Error(`contract field \`${field}\` is not an array`)
  }
  for (const [index, rule] of contract.extension_test_name_rules.entries()) {
    for (const field of ["extensions", "filename_prefixes", "filename_suffixes"]) {
      if (!Array.isArray(rule[field])) {
        throw new Error(`extension_test_name_rules[${index}].${field} is not an array`)
      }
    }
  }
  return contract
}

const contract = parsePathPredicateContract(readFileSync(contractPath, "utf8"))
const ref = execFileSync("git", ["-C", tcRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const generated = `${JSON.stringify({ source: "BaconDroid/test-checker", ref, ...contract }, null, 2)}\n`

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8")
  if (current !== generated) {
    console.error(
      `path-predicate contract is stale: ${outputPath} does not match ${contractPath} (${ref}). ` +
        "Run `npm run rules:path-predicates` and commit the result.",
    )
    process.exit(1)
  }
  console.log(`path-predicate contract is up to date (${ref})`)
} else {
  writeFileSync(outputPath, generated)
  console.log(`wrote path predicates from ${contractPath} (${ref}) to ${outputPath}`)
}
