import { test, expect } from "bun:test"
import { validateTupleOptions } from "./schema"

test("accepts a valid tuple", () => {
  const result = validateTupleOptions({
    comment_checker: { custom_prompt: "x", max_warnings_per_file: 2 },
    test_guard: { enabled: true, checks: { "skip-focus-added": "block" } },
  })
  expect(result).toEqual({ valid: true, errors: [] })
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

test("rejects a non-object options value", () => {
  expect(validateTupleOptions([]).valid).toBe(false)
})

test("rejects a non-boolean enabled", () => {
  expect(validateTupleOptions({ test_guard: { enabled: "yes" } }).valid).toBe(false)
})
