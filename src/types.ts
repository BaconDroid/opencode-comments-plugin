// Payload of the `tool.execute.before` / `tool.execute.after` hooks, shared by
// both guards.
export interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

export interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

// The hook surface shared by both guards.
export interface ToolGuard {
  before(input: ToolExecuteInput, output: { args: Record<string, unknown> }): void | Promise<void>
  after(input: ToolExecuteInput, output: ToolExecuteOutput): Promise<void>
}

export interface HookInput {
  session_id: string
  tool_name: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  // Set by the test guard so the binary honors the plugin's own test-file
  // classification (custom `test_patterns`). The comment path never sets it.
  is_test_file?: boolean
  tool_input: {
    file_path?: string
    content?: string
    old_string?: string
    new_string?: string
    edits?: Array<{ old_string: string; new_string: string }>
  }
  tool_response?: unknown
}

export interface CheckResult {
  hasComments: boolean
  message: string
  // Set when the checker could not run at all (missing or non-executable
  // binary, spawn failure, timeout, or an exit code other than 0/2). When
  // present, no check happened: `hasComments` is false and `message` is empty.
  didNotRun?: { reason: string }
}

// One finding as reported by the `test-checker` binary (exit 2, `<findings>`
// XML on stderr), normalized for the test guard. Severity is resolved later from
// the configured rule checks; the analyzer derives the rendered excerpt from the
// source line.
export interface TestCheckerFinding {
  file: string
  line: number
  rule: string
  message: string
  // The binary's own confidence (high/medium/low), preserved so the plugin does
  // not silently downgrade a finding it chose to report.
  confidence?: string
}

// Result of one `test-checker` invocation.
//   findings    -> the binary ran; an empty list means it found nothing
//   fallback    -> the binary ran (exit 2) but its stderr carried no parseable
//                  findings, so the caller uses the in-process regex rules
//   did-not-run -> no check happened (missing/non-executable binary, spawn
//                  failure, timeout, or an exit code other than 0/2)
export type TestCheckerResult =
  | { kind: "findings"; findings: TestCheckerFinding[] }
  | { kind: "fallback" }
  | { kind: "did-not-run"; reason: string }
