export interface PendingCall {
    filePath: string;
    args: Record<string, unknown>;
    tool: string;
    sessionID: string;
    preimage?: string;
}
export interface PatchFileChange {
    type?: string;
    filePath?: string;
    movePath?: string;
    patch?: string;
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
