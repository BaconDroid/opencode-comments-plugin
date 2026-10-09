import { test, expect } from "bun:test"
import { DEFAULT_TRIGGER_TOOLS } from "../constants"
import { isTriggeredTool } from "./triggers"

test("uses the provided set when present", () => {
  expect(isTriggeredTool(new Set(["write"]), "write")).toBe(true)
  expect(isTriggeredTool(new Set(["write"]), "edit")).toBe(false)
})

test("falls back to the default tools when unset", () => {
  expect(isTriggeredTool(undefined, "edit")).toBe(true)
  expect(isTriggeredTool(undefined, "bash")).toBe(false)
  expect(DEFAULT_TRIGGER_TOOLS.includes("apply_patch")).toBe(true)
})

test("honors a custom fallback", () => {
  expect(isTriggeredTool(undefined, "bash", ["bash"])).toBe(true)
  expect(isTriggeredTool(undefined, "edit", ["bash"])).toBe(false)
})
