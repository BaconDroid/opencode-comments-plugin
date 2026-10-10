import type { Severity, TestEngine } from "../../core/config";
import type { Analyzer, SyncAnalyzer, TestCheckerRunner } from "../../core/analyzer";
export interface RuleAnalyzerConfig {
    enabled: boolean;
    testPatterns: string[];
    checks: Record<string, Severity>;
    isTestFile?: boolean;
}
export declare function createRuleAnalyzer(getConfig: () => RuleAnalyzerConfig): SyncAnalyzer;
export interface TestEngineConfig extends RuleAnalyzerConfig {
    engine?: TestEngine;
}
export declare function createTestEngineAnalyzer(getConfig: () => TestEngineConfig, run?: TestCheckerRunner): Analyzer;
