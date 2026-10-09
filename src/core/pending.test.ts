import { test, expect } from "bun:test"
import { PendingCallStore } from "./pending"

test("set/get/delete round-trip", () => {
  const store = new PendingCallStore<number>()
  store.set("a", 1)
  expect(store.get("a")).toBe(1)
  store.delete("a")
  expect(store.get("a")).toBeUndefined()
})

test("take returns and removes the entry", () => {
  const store = new PendingCallStore<string>()
  store.set("a", "x")
  expect(store.take("a")).toBe("x")
  expect(store.get("a")).toBeUndefined()
  expect(store.take("missing")).toBeUndefined()
})

test("prune drops entries older than the TTL and keeps the recent ones", () => {
  const store = new PendingCallStore<number>({ ttlMs: 1000 })
  store.set("old", 1, 0)
  store.set("new", 2, 1500)
  store.prune(2000)
  expect(store.get("old")).toBeUndefined()
  expect(store.get("new")).toBe(2)
})

test("prune keeps an entry within the TTL", () => {
  const store = new PendingCallStore<number>({ ttlMs: 1000 })
  store.set("a", 1, 1000)
  store.prune(1500)
  expect(store.get("a")).toBe(1)
})
