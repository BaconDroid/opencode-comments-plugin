import type { Severity, TestEngine } from "../../core/config";
import { type Analyzer, type SyncAnalyzer, type TestBinaryAnalyzer } from "../../core/analyzer";
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
export declare function createTestEngineAnalyzer(getConfig: () => TestEngineConfig, binary?: TestBinaryAnalyzer): Analyzer;
