// Shared inline/file bypass markers for both guards. A prefix ("test-guard" or
// "comment-guard") selects the marker names; what a bypass suppresses stays in
// each guard's policy.

export const BYPASS_WINDOW = 2

export interface Bypass {
  kind: "allow" | "disable-file"
  line: number
  reason: string
}

export interface BypassMatchers {
  allow: RegExp
  allowReason: RegExp
  disableFile: RegExp
}

export function bypassMatchers(prefix: string): BypassMatchers {
  return {
    allow: new RegExp(`${prefix}:\\s*allow\\b`, "i"),
    allowReason: new RegExp(`${prefix}:\\s*allow\\s*(.*)$`, "i"),
    disableFile: new RegExp(`${prefix}-disable-file\\b`, "i"),
  }
}

// Lists every bypass marker in the text so it can be surfaced in a summary.
export function collectBypasses(text: string, matchers: BypassMatchers): Bypass[] {
  const bypasses: Bypass[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const allow = line.match(matchers.allowReason)
    if (allow) bypasses.push({ kind: "allow", line: i + 1, reason: allow[1]!.trim() })
    if (matchers.disableFile.test(line)) bypasses.push({ kind: "disable-file", line: i + 1, reason: "" })
  }
  return bypasses
}

export function isFileDisabled(text: string, matchers: BypassMatchers): boolean {
  return matchers.disableFile.test(text)
}

// The two bypass tests both guards share: a file-level disable marker, and a
// per-line allow marker within its window. `notes` lists every marker. What a
// bypass suppresses (whole file vs per finding) stays in each guard's policy.
export interface BypassCheck {
  notes: Bypass[]
  fileDisabled: boolean
  covers(line: number): boolean
}

export function applyBypass(newText: string, matchers: BypassMatchers): BypassCheck {
  const notes = collectBypasses(newText, matchers)
  return {
    notes,
    fileDisabled: isFileDisabled(newText, matchers),
    covers: line => withinAllowWindow(newText, line, matchers),
  }
}

// True when an allow marker sits within +/-window lines of the given 1-based
// line.
export function withinAllowWindow(
  text: string,
  line: number,
  matchers: BypassMatchers,
  window = BYPASS_WINDOW,
): boolean {
  if (line <= 0) return false
  const lines = text.split("\n")
  const from = Math.max(0, line - 1 - window)
  const to = Math.min(lines.length, line + window)
  for (let i = from; i < to; i++) if (matchers.allow.test(lines[i] ?? "")) return true
  return false
}
