import { test, expect } from "bun:test"
import { validateTupleOptions } from "./schema"

test("accepts a valid tuple", () => {
  const result = validateTupleOptions({
    comment_checker: { custom_prompt: "x", max_warnings_per_file: 2 },
    test_guard: { enabled: true, checks: { "skip-focus-added": "warn" }, tools: ["write", "edit"] },
  })
  expect(result).toEqual({ valid: true, errors: [] })
})

test("rejects a bad test_guard.tools value", () => {
  const result = validateTupleOptions({ test_guard: { tools: 3 } })
  expect(result.valid).toBe(false)
  expect(result.errors.join()).toContain("tools")
})

test("accepts dedup_window_ms on both guards and rejects a negative one", () => {
  expect(validateTupleOptions({ comment_checker: { dedup_window_ms: 0 } }).valid).toBe(true)
  expect(validateTupleOptions({ test_guard: { dedup_window_ms: 30_000 } }).valid).toBe(true)
  const result = validateTupleOptions({ test_guard: { dedup_window_ms: -1 } })
  expect(result.valid).toBe(false)
  expect(result.errors.join()).toContain("dedup_window_ms")
})

test("accepts comment_checker.enabled and rejects a non-boolean", () => {
  expect(validateTupleOptions({ comment_checker: { enabled: false } }).valid).toBe(true)
  expect(validateTupleOptions({ comment_checker: { enabled: "no" } }).valid).toBe(false)
})

test("accepts comment_checker.paths and rejects a bad value", () => {
  expect(validateTupleOptions({ comment_checker: { paths: ["**/*.ts"] } }).valid).toBe(true)
  expect(validateTupleOptions({ comment_checker: { paths: 3 } }).valid).toBe(false)
})

test("accepts a valid comment_checker judge block", () => {
  expect(
    validateTupleOptions({ comment_checker: { judge: { enabled: true, model: "anthropic/claude-3", timeout_ms: 30000 } } }).valid,
  ).toBe(true)
})

test("rejects an unknown comment_checker judge key", () => {
  expect(validateTupleOptions({ comment_checker: { judge: { nope: 1 } } }).valid).toBe(false)
})

test("accepts a null test_command", () => {
  expect(validateTupleOptions({ test_guard: { test_command: null } }).valid).toBe(true)
})

test("rejects a bad severity", () => {
  const result = validateTupleOptions({ test_guard: { checks: { "skip-focus-added": "loud" } } })
  expect(result.valid).toBe(false)
  expect(result.errors[0]).toContain("skip-focus-added")
})

test("rejects an unknown test_guard key", () => {
  const result = validateTupleOptions({ test_guard: { nope: 1 } })
  expect(result.valid).toBe(false)
  expect(result.errors.join()).toContain("nope")
})

test("accepts the test_guard.engine values and rejects an unknown one", () => {
  expect(validateTupleOptions({ test_guard: { engine: "binary" } }).valid).toBe(true)
  expect(validateTupleOptions({ test_guard: { engine: "regex" } }).valid).toBe(true)
  expect(validateTupleOptions({ test_guard: { engine: "BINARY" } }).valid).toBe(true)
  expect(validateTupleOptions({ test_guard: { engine: "ast" } }).valid).toBe(false)
  expect(validateTupleOptions({ test_guard: { engine: 3 } }).valid).toBe(false)
})

test("accepts a valid mutation block", () => {
  expect(
    validateTupleOptions({ test_guard: { mutation: { enabled: true, command: "npx stryker run", timeout_ms: 60000 } } }).valid,
  ).toBe(true)
})

test("rejects an unknown mutation key", () => {
  expect(validateTupleOptions({ test_guard: { mutation: { nope: 1 } } }).valid).toBe(false)
})

test("accepts a valid judge block", () => {
  expect(
    validateTupleOptions({ test_guard: { judge: { enabled: true, model: "anthropic/claude-3", timeout_ms: 30000 } } }).valid,
  ).toBe(true)
})

test("rejects an unknown judge key", () => {
  expect(validateTupleOptions({ test_guard: { judge: { nope: 1 } } }).valid).toBe(false)
})

test("accepts a valid parser block", () => {
  expect(
    validateTupleOptions({ test_guard: { parser: { enabled: true, command: "my-ast --json", timeout_ms: 30000 } } }).valid,
  ).toBe(true)
})

test("rejects an unknown parser key", () => {
  expect(validateTupleOptions({ test_guard: { parser: { nope: 1 } } }).valid).toBe(false)
})

test("rejects a non-object options value", () => {
  expect(validateTupleOptions([]).valid).toBe(false)
})

test("rejects a non-boolean enabled", () => {
  expect(validateTupleOptions({ test_guard: { enabled: "yes" } }).valid).toBe(false)
})
