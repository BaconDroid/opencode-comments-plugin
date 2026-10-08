import { test, expect } from "bun:test"
import { AnalyzerRegistry, type Analyzer, type AnalyzerContext } from "./analyzer"

const ctx: AnalyzerContext = { tool: "write", sessionID: "s", directory: "/work" }

function analyzer(id: string, options: Partial<Analyzer> = {}): Analyzer {
  return {
    id,
    trigger: "idle",
    isEnabled: () => true,
    analyze: () => ({ note: id }),
    ...options,
  }
}

test("returns registered analyzers for a trigger in registration order", () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("a"))
  registry.register(analyzer("b", { trigger: "after" }))
  registry.register(analyzer("c"))

  expect(registry.forTrigger("idle").map(item => item.id)).toEqual(["a", "c"])
  expect(registry.forTrigger("after").map(item => item.id)).toEqual(["b"])
  expect(registry.forTrigger("on-demand")).toEqual([])
})

test("run collects results in registration order", async () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("a"))
  registry.register(analyzer("b"))

  const results = await registry.run("idle", ctx)
  expect(results.map(result => result.note)).toEqual(["a", "b"])
})

test("skips a disabled analyzer", async () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("off", { isEnabled: () => false }))
  registry.register(analyzer("on"))

  const results = await registry.run("idle", ctx)
  expect(results.map(result => result.note)).toEqual(["on"])
})

test("swallows an analyzer error and keeps running the rest (fail-open)", async () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("boom", { analyze: () => { throw new Error("boom") } }))
  registry.register(analyzer("ok"))

  await expect(registry.run("idle", ctx)).resolves.toEqual([{ note: "ok" }])
})

test("swallows an isEnabled error (fail-open)", async () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("boom", { isEnabled: () => { throw new Error("boom") } }))
  registry.register(analyzer("ok"))

  await expect(registry.run("idle", ctx)).resolves.toEqual([{ note: "ok" }])
})

test("never throws when every analyzer fails", async () => {
  const registry = new AnalyzerRegistry()
  registry.register(analyzer("a", { analyze: () => { throw new Error("a") } }))
  registry.register(analyzer("b", { analyze: () => Promise.reject(new Error("b")) }))

  await expect(registry.run("idle", ctx)).resolves.toEqual([])
})
