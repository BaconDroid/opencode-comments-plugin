import { test, expect } from "bun:test"
import { appendFeedback, appendGuardMessage, TEST_GUARD_MARKER } from "./feedback"

test("appendGuardMessage without a marker appends raw", () => {
  const output = { output: "ok" }
  appendGuardMessage(output, "msg")
  expect(output.output).toBe("ok\n\nmsg")
})

test("appendGuardMessage with a marker opens an idempotent block", () => {
  const output = { output: "ok" }
  appendGuardMessage(output, "msg", TEST_GUARD_MARKER)
  appendGuardMessage(output, "msg2", TEST_GUARD_MARKER)
  expect(output.output).toBe(`ok\n\n${TEST_GUARD_MARKER}\nmsg`)
})

test("appendGuardMessage ignores an empty message", () => {
  const output = { output: "ok" }
  appendGuardMessage(output, "")
  expect(output.output).toBe("ok")
})

test("appendFeedback is appendGuardMessage with the test marker", () => {
  const viaFeedback = { output: "ok" }
  const viaHelper = { output: "ok" }
  appendFeedback(viaFeedback, "x")
  appendGuardMessage(viaHelper, "x", TEST_GUARD_MARKER)
  expect(viaFeedback.output).toBe(viaHelper.output)
})
