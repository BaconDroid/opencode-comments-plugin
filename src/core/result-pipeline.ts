// Shared rendering for analyzer results and bypass markers.
//
// Both guards build their message here: the test guard renders structured
// findings, the comment guard renders the raw binary message. The append policy
// stays per guard — the test guard uses the idempotent marker, the comment guard
// appends raw — because that difference is part of each guard's output contract.
// The bypass footer formatting is shared so both guards produce it identically.

import type { AnalyzerResult } from "./analyzer"
import type { Bypass } from "./bypass"
import { renderFeedback, type Finding } from "./feedback"

export interface RenderOptions {
  customPrompt?: string
  appendPrompt?: string
}

export function formatBypassNote(filePath: string, bypass: Bypass): string {
  return `${filePath}:${bypass.line} ${bypass.kind}${bypass.reason ? ` (${bypass.reason})` : ""}`
}

export function renderBypassFooter(title: string, entries: string[]): string {
  return `${title}:\n${entries.map(entry => `- ${entry}`).join("\n")}`
}

// Builds the message for a set of analyzer results: structured findings use the
// shared feedback renderer, raw messages are joined as-is. Returns "" when there
// is nothing to show. Never throws (fail-open).
export function renderAnalyzerResults(results: AnalyzerResult[], options: RenderOptions = {}): string {
  try {
    const findings: Finding[] = []
    const raws: string[] = []
    for (const result of results) {
      if (result.findings) findings.push(...result.findings)
      if (result.raw) raws.push(result.raw)
    }
    if (findings.length > 0) return renderFeedback(findings, options)
    if (raws.length === 0) return ""
    const raw = raws.join("\n\n")
    return options.appendPrompt ? `${raw}\n\n${options.appendPrompt}` : raw
  } catch {
    return ""
  }
}
