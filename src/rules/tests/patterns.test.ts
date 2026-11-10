import { test, expect } from "bun:test"
import {
  HARNESS_PATH_TABLE,
  SENSITIVE_HARNESS_PATH_TABLE,
  TEST_PATH_TABLE,
  isHarnessPath,
  isSelectedTestPath,
  isSensitiveHarnessPath,
  isTestFileForAnalysis,
  isTestPath,
  matchesTestPathTable,
} from "./patterns"

test("isTestPath matches the binary's directory segments", () => {
  for (const path of [
    "src/tests/module.rs",
    "app/__tests__/widget.js",
    "spec/foo.py",
    "specs/x.ts",
    "src/test/java/AppTest.java",
    "src/test/kotlin/AppTest.kt",
    "test/app_test.rb",
  ]) {
    expect(isTestPath(path, [])).toBe(true)
  }
})

test("isTestPath matches the binary's filename prefixes and infixes", () => {
  for (const path of [
    "pkg/test_parser.py",
    "src/test-utils.ts",
    "src/widget.test.ts",
    "src/widget.spec.tsx",
    "pkg/foo_spec.rb",
    "pkg/parser_test.go",
  ]) {
    expect(isTestPath(path, [])).toBe(true)
  }
})

test("isTestPath is case-insensitive and accepts Windows separators", () => {
  expect(isTestPath("SPEC/Foo.PY", [])).toBe(true)
  expect(isTestPath("src\\test\\java\\AppTest.java", [])).toBe(true)
  expect(isTestPath("Pkg\\Foo_Spec.rb", [])).toBe(true)
})

test("isTestPath keeps the binary's broad test- and test_ prefixes", () => {
  expect(isTestPath("src/core/test-command.ts", [])).toBe(true)
  expect(isTestPath("docs/test-signal-research.md", [])).toBe(true)
})

test("isTestPath rejects production names that only resemble tests", () => {
  for (const path of [
    "src/app.py",
    "src/testing_utils.rs",
    "src/contest.py",
    "src/protest.ts",
    "src/attestation.ts",
    "src/latest-command.ts",
    "src/foo_specification.rb",
  ]) {
    expect(isTestPath(path, [])).toBe(false)
  }
})

test("test_patterns override the built-in table", () => {
  expect(isTestPath("spec/foo.py", ["**/*.test.ts"])).toBe(false)
  expect(isTestPath("src/a.test.ts", ["**/*.test.ts"])).toBe(true)
})

test("isHarnessPath matches the binary's harness paths", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".gitlab-ci.yml",
    "pytest.ini",
    "tox.ini",
    "conftest.py",
    "setup.cfg",
    "pyproject.toml",
    "package.json",
    "Makefile",
    "codecov.yml",
    "jest.config.js",
    "vitest.config.ts",
    "karma.conf.js",
    ".nycrc",
    ".nycrc.json",
  ]) {
    expect(isHarnessPath(path)).toBe(true)
  }
})

test("isHarnessPath includes the suppression config the binary gates first", () => {
  expect(isHarnessPath(".test-checker.json")).toBe(true)
})

test("isHarnessPath rejects production paths and test files", () => {
  for (const path of ["src/app.py", "src/app.test.ts", "docs/package.json.md", "src/makefile.py"]) {
    expect(isHarnessPath(path)).toBe(false)
  }
})

test("isSensitiveHarnessPath narrows to CI and runner configuration", () => {
  for (const path of [
    "pytest.ini",
    "tox.ini",
    "conftest.py",
    ".github/workflows/ci.yml",
    ".gitlab-ci.yml",
    "jest.config.js",
    "vitest.config.ts",
  ]) {
    expect(isSensitiveHarnessPath(path)).toBe(true)
  }
  for (const path of ["package.json", "codecov.yml", "pyproject.toml", "src/app.py"]) {
    expect(isSensitiveHarnessPath(path)).toBe(false)
  }
})

test("the exported tables are the predicate's source of truth", () => {
  expect(TEST_PATH_TABLE.directorySegments).toContain("specs")
  expect(TEST_PATH_TABLE.filenamePrefixes).toContain("test-")
  expect(TEST_PATH_TABLE.filenameInfixes).toContain("_spec.")
  expect(matchesTestPathTable("specs/x.ts", TEST_PATH_TABLE)).toBe(true)
  expect(HARNESS_PATH_TABLE.filenamePrefixes).toContain("vitest.config")
  expect(SENSITIVE_HARNESS_PATH_TABLE.filenames).toContain("conftest.py")
})

test("harness wins over a test path in the shared gate", () => {
  expect(isSelectedTestPath("tests/conftest.py", [])).toBe(true)
  expect(isTestFileForAnalysis("tests/conftest.py", [])).toBe(false)
  expect(isTestFileForAnalysis("spec/foo.py", [])).toBe(true)
  expect(isSelectedTestPath("package.json", [])).toBe(true)
  expect(isSelectedTestPath("src/app.py", [])).toBe(false)
})
