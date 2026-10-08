export interface ResolvedCommentConfig {
    enabled: boolean;
    customPrompt?: string;
    appendPrompt?: string;
    maxWarningsPerFile: number;
    dedupWindowMs: number;
    triggerTools: Set<string>;
    timeoutMs: number;
}
interface BeforeInput {
    tool: string;
    sessionID: string;
    callID: string;
}
interface AfterOutput {
    title: string;
    output: string;
    metadata: unknown;
}
export interface CommentGuard {
    before(input: BeforeInput, output: {
        args: Record<string, unknown>;
    }): Promise<void>;
    after(input: BeforeInput, output: AfterOutput): Promise<void>;
}
export declare function createCommentGuard(getConfig: () => ResolvedCommentConfig): CommentGuard;
export {};
