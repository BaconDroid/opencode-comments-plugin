import { test, expect } from "bun:test"
import { createDebugLog } from "./debug"

test("a disabled logger is a no-op", () => {
  const log = createDebugLog("x", false)
  expect(() => log("a", { b: 1 })).not.toThrow()
})

test("an enabled logger writes the prefix and formatted args to stderr", () => {
  const original = process.stderr.write
  const written: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    createDebugLog("test-prefix", true)("hello", { a: 1 })
  } finally {
    process.stderr.write = original
  }
  const output = written.join("")
  expect(output).toContain("[test-prefix] hello")
  expect(output).toContain('"a": 1')
})
