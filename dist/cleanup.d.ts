import type { ResolvedTestGuard } from "./core/dispatch";
import type { HookInput } from "./types";
export interface CleanupItem {
    name: string;
    rule: string;
}
export interface CleanupStderrSummary {
    removed: CleanupItem[];
    kept: CleanupItem[];
    note?: string;
    summary: boolean;
}
export interface CleanupFileReport {
    filePath: string;
    display: string;
    removed: CleanupItem[];
    kept: CleanupItem[];
    summary: boolean;
    note?: string;
    error?: string;
}
export interface CleanupReport {
    directory: string;
    files: CleanupFileReport[];
    skipped: string[];
    binaryAvailable: boolean;
    unsupported: boolean;
    generatedAt: string;
}
export type CleanupRun = {
    kind: "output";
    stderr: string;
    exitCode: number;
} | {
    kind: "did-not-run";
    reason: string;
};
export interface CleanupDeps {
    run?: (input: HookInput, binaryPath: string, timeoutMs: number) => Promise<CleanupRun>;
}
export interface CleanupOptions {
    directory: string;
    testPatterns?: string[];
    paths?: string[];
    cliPath?: string;
    timeoutMs?: number;
}
export declare function parseCleanupSummary(stderr: string): CleanupStderrSummary;
export declare function collectCleanup(options: CleanupOptions, deps?: CleanupDeps): Promise<CleanupReport>;
export declare function renderCleanup(report: CleanupReport): string;
export declare function runCleanup(options: CleanupOptions, deps?: CleanupDeps): Promise<string>;
export declare function createGuardCleanupTool(options: {
    directory: string;
    getConfig: () => ResolvedTestGuard;
    deps?: CleanupDeps;
}): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export declare const GUARD_CLEANUP_COMMAND: {
    template: string;
    description: string;
};
