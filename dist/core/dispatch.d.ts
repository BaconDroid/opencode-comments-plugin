import type { GuardBaseConfig, Severity } from "./config";
import type { PermissionDecision, PermissionLike, ToolExecuteInput, ToolExecuteOutput } from "../types";
export interface ResolvedTestGuard extends GuardBaseConfig {
    testPatterns: string[];
    testCommand?: string | null;
    checks: Record<string, Severity>;
}
export interface TestGuard {
    before(input: ToolExecuteInput, output: {
        args: Record<string, unknown>;
    }): void;
    after(input: ToolExecuteInput, output: ToolExecuteOutput): Promise<void>;
    permission(input: PermissionLike, output: PermissionDecision): void;
}
export declare function extractPatchEntries(patchText: string): Array<{
    kind: string;
    path: string;
}>;
export declare function createTestGuard(getResolved: () => ResolvedTestGuard): TestGuard;
