// Renders guard findings into the tool output.
//
// The message is always appended (never replacing existing content) behind an
// idempotent marker so coexistence with other plugins cannot duplicate it.

import type { Severity } from "./config"

export const TEST_GUARD_MARKER = "<!-- opencode-test-guard -->"

export interface Finding {
  rule: string
  filePath: string
  line: number
  message: string
  severity: Severity
  excerpt: string
  // Present for findings reported by the binary engine. The binary's own
  // confidence gate already ran, so this is carried through for the reader
  // instead of being folded into the plugin's warn/off severity.
  confidence?: string
}

export interface FeedbackOptions {
  customPrompt?: string
  appendPrompt?: string
  maxExcerpt?: number
}

export const DEFAULT_CUSTOM_PROMPT =
  "TEST QUALITY DETECTED:\n{{findings}}\n\nFix the cause, do not weaken the test."

function truncateExcerpt(excerpt: string, max: number): string {
  const oneLine = excerpt.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(0, max - 1))}…` : oneLine
}

export function formatFindings(findings: Finding[], maxExcerpt = 80): string {
  return findings
    .map(finding => {
      const location = `${finding.filePath}:${finding.line}`
      const confidence = finding.confidence ? ` (confidence: ${finding.confidence})` : ""
      return `- [${finding.severity}] ${finding.rule} (${location}): ${finding.message}${confidence}\n  > ${truncateExcerpt(finding.excerpt, maxExcerpt)}`
    })
    .join("\n")
}

export function renderFeedback(findings: Finding[], options: FeedbackOptions = {}): string {
  if (findings.length === 0) return ""
  const body = formatFindings(findings, options.maxExcerpt)
  const template = options.customPrompt?.includes("{{findings}}")
    ? options.customPrompt
    : DEFAULT_CUSTOM_PROMPT
  const rendered = template.replace(/\{\{findings\}\}/g, body)
  return options.appendPrompt ? `${rendered}\n\n${options.appendPrompt}` : rendered
}

// Appends a guard message to the tool output, behind an optional idempotent
// marker. The test guard passes its marker; the comment guard appends raw (no
// marker). Idempotent only when a marker is given.
export function appendGuardMessage(output: { output: string }, message: string, marker?: string): void {
  if (message.length === 0) return
  if (marker && output.output.includes(marker)) return
  output.output += marker ? `\n\n${marker}\n${message}` : `\n\n${message}`
}

// The user-facing warning for a binary engine that could not run. Both guards
// share it so the wording (and the reason on the next line) stays identical.
export function didNotRunMessage(tool: string, reason: string): string {
  return `${tool} did not run — nothing checked this write.\n${reason}`
}

// Appends feedback to the tool output. Idempotent: a second call with the same
// marker does not duplicate the message.
export function appendFeedback(output: { output: string }, message: string): void {
  appendGuardMessage(output, message, TEST_GUARD_MARKER)
}
