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
}
