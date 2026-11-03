import { type RunOptions } from "../../cli";
import { type Analyzer } from "../../core/analyzer";
import type { GuardBaseConfig } from "../../core/config";
import type { CheckResult, HookInput, ToolGuard } from "../../types";
export interface ResolvedCommentConfig extends GuardBaseConfig {
    dedupWindowMs: number;
    triggerTools: Set<string>;
    paths: string[];
    timeoutMs: number;
}
export type CommentCheckRunner = (input: HookInput, options?: RunOptions) => Promise<CheckResult>;
export type CommentCheckerPathResolver = () => Promise<string | null>;
export declare function createCommentBinaryAnalyzer(getConfig: () => ResolvedCommentConfig, run?: CommentCheckRunner, resolvePath?: CommentCheckerPathResolver): Analyzer;
export type CommentGuard = ToolGuard;
export interface CommentGuardDeps {
    runCheck?: CommentCheckRunner;
    resolvePath?: CommentCheckerPathResolver;
}
export declare function createCommentGuard(getConfig: () => ResolvedCommentConfig, deps?: CommentGuardDeps): CommentGuard;
