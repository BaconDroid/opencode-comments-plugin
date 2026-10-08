import { test, expect } from "bun:test"
import { bypassMatchers, collectBypasses, isFileDisabled, withinAllowWindow } from "./bypass"

const testGuard = bypassMatchers("test-guard")
const commentGuard = bypassMatchers("comment-guard")

test("collects allow and disable-file markers with their reason", () => {
  const text = "// test-guard: allow legacy\nconst a = 1\n// test-guard-disable-file\n"
  expect(collectBypasses(text, testGuard)).toEqual([
    { kind: "allow", line: 1, reason: "legacy" },
    { kind: "disable-file", line: 3, reason: "" },
  ])
})

test("scopes the markers by prefix", () => {
  const text = "// comment-guard: allow legacy\n"
  expect(collectBypasses(text, testGuard)).toEqual([])
  expect(collectBypasses(text, commentGuard)).toEqual([{ kind: "allow", line: 1, reason: "legacy" }])
})

test("detects a file-level disable marker", () => {
  expect(isFileDisabled("// comment-guard-disable-file\n", commentGuard)).toBe(true)
  expect(isFileDisabled("const a = 1\n", commentGuard)).toBe(false)
})

test("finds an allow marker within the window only", () => {
  const within = "// comment-guard: allow x\nconst a = 1\n// explain\n"
  expect(withinAllowWindow(within, 3, commentGuard)).toBe(true)

  const outside = "// explain\nconst a = 1\nconst b = 2\nconst c = 3\n// comment-guard: allow x\n"
  expect(withinAllowWindow(outside, 1, commentGuard)).toBe(false)
  expect(withinAllowWindow(outside, 0, commentGuard)).toBe(false)
})
