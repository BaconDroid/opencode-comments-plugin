import type { CheckResult, HookInput } from "./types";
export declare function getCommentCheckerPath(): Promise<string | null>;
export declare function getCommentCheckerPathSync(): string | null;
export declare function startBackgroundInit(): void;
export interface RunOptions {
    cliPath?: string;
    prompt?: string;
    timeoutMs?: number;
}
export declare function runCommentChecker(input: HookInput, options?: RunOptions): Promise<CheckResult>;
