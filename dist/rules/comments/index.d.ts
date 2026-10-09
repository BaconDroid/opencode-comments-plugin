import { type Analyzer } from "../../core/analyzer";
import type { GuardBaseConfig } from "../../core/config";
import type { ToolGuard } from "../../types";
export interface ResolvedCommentConfig extends GuardBaseConfig {
    dedupWindowMs: number;
    triggerTools: Set<string>;
    paths: string[];
    timeoutMs: number;
}
export declare function createCommentBinaryAnalyzer(getConfig: () => ResolvedCommentConfig): Analyzer;
export type CommentGuard = ToolGuard;
export declare function createCommentGuard(getConfig: () => ResolvedCommentConfig): CommentGuard;
