import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { LANGUAGE_BY_EXTENSION } from "../../core/diff"
import pathPredicateData from "./path-predicates.json"
import {
  HARNESS_PATH_TABLE,
  PATH_PREDICATE_CONTRACT,
  SENSITIVE_HARNESS_PATH_TABLE,
  TEST_PATH_TABLE,
} from "./patterns"

const repoRoot = resolve(import.meta.dir, "../../..")
const scriptPath = join(repoRoot, "scripts", "generate-path-predicates.mjs")

test("the generated contract records its test-checker provenance", () => {
  expect(pathPredicateData.source).toBe("BaconDroid/test-checker")
  expect(pathPredicateData.ref).toMatch(/^[0-9a-f]{40}$/)
  expect(pathPredicateData.generated_from).toBe("src/language.rs")
  expect(PATH_PREDICATE_CONTRACT.source).toBe(pathPredicateData.source)
  expect(PATH_PREDICATE_CONTRACT.ref).toBe(pathPredicateData.ref)
})

test("the exported tables are read from the generated contract", () => {
  expect(TEST_PATH_TABLE.directorySegments).toEqual(pathPredicateData.test_path_segments)
  expect(TEST_PATH_TABLE.filenamePrefixes).toEqual(pathPredicateData.test_filename_prefixes)
  expect(TEST_PATH_TABLE.filenameInfixes).toEqual(pathPredicateData.test_filename_infixes)
  expect(HARNESS_PATH_TABLE.pathSubstrings).toEqual(pathPredicateData.harness_path_substrings)
  expect(HARNESS_PATH_TABLE.filenames).toEqual(pathPredicateData.harness_basenames)
  expect(HARNESS_PATH_TABLE.filenamePrefixes).toEqual(pathPredicateData.harness_filename_prefixes)
  expect(SENSITIVE_HARNESS_PATH_TABLE.pathSubstrings).toEqual(
    pathPredicateData.sensitive_harness_path_substrings,
  )
  expect(SENSITIVE_HARNESS_PATH_TABLE.filenames).toEqual(pathPredicateData.sensitive_harness_basenames)
  expect(SENSITIVE_HARNESS_PATH_TABLE.filenamePrefixes).toEqual(
    pathPredicateData.sensitive_harness_filename_prefixes,
  )
})

test("every extension-scoped test-name rule has a language mapping", () => {
  const extensions = pathPredicateData.extension_test_name_rules.flatMap(rule => rule.extensions)
  expect(extensions.length).toBeGreaterThan(0)
  for (const extension of extensions) {
    expect(LANGUAGE_BY_EXTENSION[`.${extension}`]).toBeDefined()
  }
})

test("the generator --check detects a contract copied with a changed predicate", () => {
  const dir = mkdtempSync(join(tmpdir(), "path-predicates-check-"))
  try {
    mkdirSync(join(dir, "eval"), { recursive: true })
    const altered = { ...pathPredicateData, test_path_segments: [...pathPredicateData.test_path_segments, "e2e"] }
    delete (altered as { source?: string }).source
    delete (altered as { ref?: string }).ref
    writeFileSync(join(dir, "eval", "path-predicates.json"), `${JSON.stringify(altered, null, 2)}\n`)

    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    expect(git(["init", "-q"]).status).toBe(0)
    expect(git(["add", "."]).status).toBe(0)
    expect(
      git(["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "fixture"]).status,
    ).toBe(0)

    const result = spawnSync("node", [scriptPath, "--check"], {
      cwd: repoRoot,
      env: { ...process.env, TC_REPO: dir },
      encoding: "utf8",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("path-predicate contract is stale")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
