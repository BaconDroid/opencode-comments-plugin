import type { Severity } from "../../core/config";
import type { SyncAnalyzer } from "../../core/analyzer";
export interface RuleAnalyzerConfig {
    enabled: boolean;
    testPatterns: string[];
    checks: Record<string, Severity>;
    isTestFile?: boolean;
}
export declare function createRuleAnalyzer(getConfig: () => RuleAnalyzerConfig): SyncAnalyzer;
