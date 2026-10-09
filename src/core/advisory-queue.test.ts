import { test, expect } from "bun:test"
import { AdvisoryQueue, appendAdvisories } from "./advisory-queue"
import { appendFeedback, TEST_GUARD_MARKER } from "./feedback"

test("queues non-empty messages and consumes them once", () => {
  const queue = new AdvisoryQueue()
  queue.queue("")
  queue.queue("one")
  queue.queue("two")
  expect(queue.consume()).toEqual(["one", "two"])
  expect(queue.consume()).toEqual([])
})

test("appends nothing when there are no notes", () => {
  const output = { output: "ok" }
  appendAdvisories(output, [])
  expect(output.output).toBe("ok")
})

test("opens the marker block when the test guard appended nothing", () => {
  const output = { output: "ok" }
  appendAdvisories(output, ["note"])
  expect(output.output).toBe(`ok\n\n${TEST_GUARD_MARKER}\nnote`)
})

test("joins the existing marker block when the test guard already appended", () => {
  const output = { output: "ok" }
  appendFeedback(output, "FINDINGS")
  appendAdvisories(output, ["note1", "note2"])
  expect(output.output).toBe(`ok\n\n${TEST_GUARD_MARKER}\nFINDINGS\n\nnote1\n\nnote2`)
})

test("reproduces the previous findings-plus-notes output exactly", () => {
  const withNotes = { output: "ok" }
  appendFeedback(withNotes, "FINDINGS")
  appendAdvisories(withNotes, ["note"])

  const previous = `ok\n\n${TEST_GUARD_MARKER}\nFINDINGS\n\nnote`
  expect(withNotes.output).toBe(previous)
})
