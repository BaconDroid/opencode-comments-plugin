import type { ExtractedChange } from "../../core/diff";
import type { BypassCheck } from "../../core/bypass";
import type { Severity } from "../../core/config";
export interface TestGuardConfig {
    enabled: boolean;
    testPatterns: string[];
    checks: Record<string, Severity>;
    maxWarningsPerFile: number;
    customPrompt?: string;
    appendPrompt?: string;
}
export interface TestBlock {
    startLine: number;
    endLine: number;
    lines: string[];
}
export interface RuleContext {
    change: ExtractedChange;
    isTestFile: boolean;
    config: TestGuardConfig;
    blocks?: TestBlock[];
    bypass?: BypassCheck;
}
export interface RuleFinding {
    rule: string;
    line: number;
    message: string;
    excerpt: string;
}
export interface TestRule {
    id: string;
    run(ctx: RuleContext): RuleFinding[];
}
