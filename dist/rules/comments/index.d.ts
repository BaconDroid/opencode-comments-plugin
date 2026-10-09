import { type Analyzer } from "../../core/analyzer";
import type { GuardBaseConfig } from "../../core/config";
import type { ToolExecuteInput, ToolExecuteOutput } from "../../types";
export interface ResolvedCommentConfig extends GuardBaseConfig {
    dedupWindowMs: number;
    triggerTools: Set<string>;
    paths: string[];
    timeoutMs: number;
}
export declare function createCommentBinaryAnalyzer(getConfig: () => ResolvedCommentConfig): Analyzer;
export interface CommentGuard {
    before(input: ToolExecuteInput, output: {
        args: Record<string, unknown>;
    }): Promise<void>;
    after(input: ToolExecuteInput, output: ToolExecuteOutput): Promise<void>;
}
export declare function createCommentGuard(getConfig: () => ResolvedCommentConfig): CommentGuard;
