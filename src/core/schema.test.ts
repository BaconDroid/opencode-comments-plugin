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

test("rejects a non-object options value", () => {
  expect(validateTupleOptions([]).valid).toBe(false)
})

test("rejects a non-boolean enabled", () => {
  expect(validateTupleOptions({ test_guard: { enabled: "yes" } }).valid).toBe(false)
})
