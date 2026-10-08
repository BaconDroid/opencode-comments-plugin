import { type Bypass } from "./content";
import type { RuleContext, RuleFinding, TestRule } from "./types";
export declare const ALL_TEST_RULES: TestRule[];
export interface RunResult {
    findings: RuleFinding[];
    bypassed: boolean;
    bypasses: Bypass[];
}
export declare function runTestRules(ctx: RuleContext): RunResult;
export { isFileDisabled, collectBypasses } from "./content";
export type { Bypass } from "./content";
export type { RuleContext, RuleFinding, TestRule } from "./types";
