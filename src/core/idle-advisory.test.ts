import { test, expect } from "bun:test"
import { AnalyzerRegistry, type AnalyzerContext } from "./analyzer"
import { createIdleAdvisory, createIdleAnalyzer } from "./idle-advisory"

const ctx: AnalyzerContext = { tool: "", sessionID: "s1", directory: "/work" }

const messages = {
  disabledMessage: "disabled",
  unavailableMessage: "unavailable",
  emptyMessage: "empty",
}

test("createIdleAnalyzer surfaces the controller message as a note", async () => {
  const controller = createIdleAdvisory({
    ...messages,
    isEnabled: () => true,
    analyze: async () => "finding",
  })
  await expect(createIdleAnalyzer("x", controller).analyze(ctx)).resolves.toEqual({ note: "finding" })
})

test("createIdleAnalyzer yields no note when the controller has none", async () => {
  const controller = createIdleAdvisory({
    ...messages,
    isEnabled: () => true,
    analyze: async () => null,
  })
  await expect(createIdleAnalyzer("x", controller).analyze(ctx)).resolves.toEqual({})
})

test("a disabled idle analyzer is a no-op through the registry", async () => {
  const controller = createIdleAdvisory({
    ...messages,
    isEnabled: () => false,
    analyze: async () => "should not surface",
  })
  const registry = new AnalyzerRegistry()
  registry.register(createIdleAnalyzer("x", controller))

  const results = await registry.run("idle", ctx)
  expect(results.every(result => result.note === undefined)).toBe(true)
})

test("the controller enforces the per-session cooldown", async () => {
  let calls = 0
  const controller = createIdleAdvisory({
    ...messages,
    isEnabled: () => true,
    cooldownMs: 60_000,
    analyze: async () => {
      calls += 1
      return "m"
    },
  })

  expect(await controller.onIdle("s1")).toBe("m")
  expect(await controller.onIdle("s1")).toBeNull()
  expect(calls).toBe(1)
})
