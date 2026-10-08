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
      return `- [${finding.severity}] ${finding.rule} (${location}): ${finding.message}\n  > ${truncateExcerpt(finding.excerpt, maxExcerpt)}`
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

// Appends feedback to the tool output. Idempotent: a second call with the same
// marker does not duplicate the message.
export function appendFeedback(output: { output: string }, message: string): void {
  if (message.length === 0) return
  if (output.output.includes(TEST_GUARD_MARKER)) return
  output.output += `\n\n${TEST_GUARD_MARKER}\n${message}`
}
