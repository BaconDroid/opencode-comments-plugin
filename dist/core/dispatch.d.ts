import type { Severity } from "./config";
export interface ResolvedTestGuard {
    enabled: boolean;
    testPatterns: string[];
    testCommand?: string | null;
    checks: Record<string, Severity>;
    maxWarningsPerFile: number;
    customPrompt?: string;
    appendPrompt?: string;
    triggerTools?: Set<string>;
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
export interface PermissionLike {
    type: string;
    pattern?: string | string[];
}
export interface PermissionDecision {
    status: "ask" | "deny" | "allow";
}
export interface TestGuard {
    before(input: BeforeInput, output: {
        args: Record<string, unknown>;
    }): void;
    after(input: BeforeInput, output: AfterOutput): Promise<void>;
    permission(input: PermissionLike, output: PermissionDecision): void;
    queueNote(message: string): void;
}
export declare function extractPatchEntries(patchText: string): Array<{
    kind: string;
    path: string;
}>;
export declare function createTestGuard(getResolved: () => ResolvedTestGuard): TestGuard;
export {};
