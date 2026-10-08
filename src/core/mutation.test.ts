import { test, expect } from "bun:test"
import { formatSurvivors, parseMutationReport, runMutationCheck } from "./mutation"

test("parses the Stryker JSON reporter", () => {
  const raw = JSON.stringify({
    files: {
      "src/a.ts": {
        mutants: [
          { status: "Killed", mutatorName: "ArithmeticOperator", location: { start: { line: 2 } } },
          { status: "Survived", mutatorName: "ConditionalExpression", location: { start: { line: 5 } } },
          { status: "NoCoverage", mutatorName: "StringLiteral", location: { start: { line: 9 } } },
        ],
      },
    },
  })
  const survivors = parseMutationReport(raw)
  expect(survivors).toHaveLength(2)
  expect(survivors[0]).toMatchObject({ file: "src/a.ts", line: 5, mutator: "ConditionalExpression" })
})

test("parses a generic survivors array", () => {
  const survivors = parseMutationReport(JSON.stringify({ survivors: [{ file: "b.ts", line: 1, mutator: "M" }] }))
  expect(survivors).toEqual([{ file: "b.ts", line: 1, mutator: "M", status: "survived" }])
})

test("returns nothing on invalid JSON", () => {
  expect(parseMutationReport("not json")).toEqual([])
})

test("runs a configured command and parses its report", async () => {
  const run = await runMutationCheck(`printf '%s' '{"survivors":[{"file":"a.ts","line":3,"mutator":"X"}]}'`)
  expect(run.ran).toBe(true)
  expect(run.survivors).toHaveLength(1)
})

test("does nothing for an empty command", async () => {
  expect(await runMutationCheck("   ")).toEqual({ ran: false, survivors: [] })
})

test("formats survivors for feedback", () => {
  const message = formatSurvivors([{ file: "a.ts", line: 3, mutator: "X" }])
  expect(message).toContain("Mutation survivors detected (1)")
  expect(message).toContain("a.ts:3")
})
