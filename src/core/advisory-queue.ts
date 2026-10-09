// Advisory notes produced by the idle analyzers (mutation, judges, parser).
// The queue is owned by the plugin, not by a guard, so a note surfaces on the
// next tool call regardless of which guard is enabled.

import { TEST_GUARD_MARKER } from "./feedback"

export class AdvisoryQueue {
  private readonly notes: string[] = []

  queue(message: string): void {
    if (message.length > 0) this.notes.push(message)
  }

  consume(): string[] {
    return this.notes.splice(0, this.notes.length)
  }
}

// Appends advisory notes to the tool output. When the test guard already opened
// the marker block, the notes join it; otherwise they open it themselves. This
// reproduces the output the test guard used to produce when it rendered notes.
export function appendAdvisories(output: { output: string }, notes: string[]): void {
  if (notes.length === 0) return
  const body = notes.join("\n\n")
  if (output.output.includes(TEST_GUARD_MARKER)) {
    output.output += `\n\n${body}`
  } else {
    output.output += `\n\n${TEST_GUARD_MARKER}\n${body}`
  }
}
