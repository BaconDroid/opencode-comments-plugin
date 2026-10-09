export interface ToolExecuteInput {
    tool: string;
    sessionID: string;
    callID: string;
}
export interface ToolExecuteOutput {
    title: string;
    output: string;
    metadata: unknown;
}
export interface PermissionLike {
    type: string;
    pattern?: string | string[];
}
export interface PermissionDecision {
    status: "ask" | "deny" | "allow";
}
export interface HookInput {
    session_id: string;
    tool_name: string;
    transcript_path: string;
    cwd: string;
    hook_event_name: string;
    tool_input: {
        file_path?: string;
        content?: string;
        old_string?: string;
        new_string?: string;
        edits?: Array<{
            old_string: string;
            new_string: string;
        }>;
    };
    tool_response?: unknown;
}
export interface CheckResult {
    hasComments: boolean;
    message: string;
}
