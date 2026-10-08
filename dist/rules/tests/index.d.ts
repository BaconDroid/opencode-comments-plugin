import type { Severity } from "../../core/config";
import { type Bypass } from "./content";
import type { RuleContext, RuleFinding, TestRule } from "./types";
export declare const ALL_TEST_RULES: TestRule[];
export declare function buildRuleChecks(includeAdvisory: boolean): Record<string, Severity>;
export interface RunResult {
    findings: RuleFinding[];
    bypassed: boolean;
    bypasses: Bypass[];
}
export declare function runTestRules(ctx: RuleContext): RunResult;
