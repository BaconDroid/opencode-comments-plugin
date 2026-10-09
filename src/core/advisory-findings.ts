// Shared parsing of advisory analyzer output: a list of JSON objects with
// file/line/text/confidence, filtered against the placeholder pattern.

import { PLACEHOLDER_PATTERN } from "../rules/tests/patterns"

export const MAX_ADVISORY_FINDINGS = 20

export interface RawAdvisoryFinding {
  file: string
  line: number
  text: string
  confidence: string
  record: Record<string, unknown>
}

// Extracts the valid findings from `items`, reading the text from `textKey`.
export function parseAdvisoryFindings(items: unknown[], textKey: string): RawAdvisoryFinding[] {
  const findings: RawAdvisoryFinding[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const file = typeof record.file === "string" ? record.file : ""
    const text = typeof record[textKey] === "string" ? (record[textKey] as string).trim() : ""
    if (!file || !text) continue
    if (PLACEHOLDER_PATTERN.test(text)) continue
    findings.push({
      file,
      line: typeof record.line === "number" && Number.isFinite(record.line) ? record.line : 0,
      text,
      confidence: typeof record.confidence === "string" ? record.confidence : "medium",
      record,
    })
    if (findings.length >= MAX_ADVISORY_FINDINGS) break
  }
  return findings
}
