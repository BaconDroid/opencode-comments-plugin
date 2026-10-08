import { test, expect } from "bun:test"
import { GuardBudget } from "./budget"

test("dedups a repeated emit inside the window and allows it after", () => {
  const budget = new GuardBudget({ dedupWindowMs: 30_000 })
  const t0 = 1_000_000
  expect(budget.shouldEmit("s", "r", "f", t0)).toBe(true)
  budget.record("s", "r", "f", t0)
  expect(budget.shouldEmit("s", "r", "f", t0 + 1_000)).toBe(false)
  expect(budget.shouldEmit("s", "r", "f", t0 + 31_000)).toBe(true)
})

test("does not dedup when the window is zero", () => {
  const budget = new GuardBudget({ dedupWindowMs: 0 })
  const t0 = 1_000_000
  budget.record("s", "r", "f", t0)
  expect(budget.shouldEmit("s", "r", "f", t0)).toBe(true)
})

test("a check that is never recorded does not open the window", () => {
  const budget = new GuardBudget({ dedupWindowMs: 30_000 })
  const t0 = 1_000_000
  expect(budget.shouldEmit("s", "r", "f", t0)).toBe(true)
  expect(budget.shouldEmit("s", "r", "f", t0)).toBe(true)
})

test("caps the warnings per file", () => {
  const budget = new GuardBudget({ dedupWindowMs: 0, maxWarningsPerFile: 2 })
  const t0 = 1_000_000
  budget.record("s", "r", "f", t0)
  budget.record("s", "r", "f", t0)
  expect(budget.shouldEmit("s", "r", "f", t0)).toBe(false)
  expect(budget.shouldEmit("s", "r", "other", t0)).toBe(true)
})

test("expires the cap after the TTL, unless the session is touched", () => {
  const budget = new GuardBudget({ dedupWindowMs: 0, maxWarningsPerFile: 1, ttlMs: 60_000 })
  const t0 = 1_000_000
  budget.record("s", "r", "f", t0)
  expect(budget.shouldEmit("s", "r", "f", t0 + 70_000)).toBe(true)

  budget.record("s", "r", "f", t0)
  budget.touch("s", t0 + 50_000)
  expect(budget.shouldEmit("s", "r", "f", t0 + 70_000)).toBe(false)
})

test("scopes the dedup by session and rule", () => {
  const budget = new GuardBudget({ dedupWindowMs: 30_000 })
  const t0 = 1_000_000
  budget.record("s1", "r1", "f", t0)
  expect(budget.shouldEmit("s2", "r1", "f", t0)).toBe(true)
  expect(budget.shouldEmit("s1", "r2", "f", t0)).toBe(true)
})
