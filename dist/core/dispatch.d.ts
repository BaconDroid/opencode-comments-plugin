import type { GuardBaseConfig, Severity } from "./config";
import type { ToolGuard } from "../types";
export interface ResolvedTestGuard extends GuardBaseConfig {
    testPatterns: string[];
    testCommand?: string | null;
    checks: Record<string, Severity>;
}
export type TestGuard = ToolGuard;
export declare function createTestGuard(getResolved: () => ResolvedTestGuard): TestGuard;
