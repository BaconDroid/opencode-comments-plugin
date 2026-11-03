import type { Severity } from "../../core/config";
export interface BinaryRuleIdTable {
    source: string;
    ref: string;
    rules: string[];
}
export declare const BINARY_RULE_ID_TABLE: BinaryRuleIdTable;
export declare const BINARY_RULE_IDS: readonly string[];
export declare const LEGACY_RULE_ALIASES: Readonly<Record<string, readonly string[]>>;
export declare const DEFAULT_RULE_SEVERITY: Severity;
export interface RuleSeverityResolution {
    severity: Severity;
    known: boolean;
}
export declare function resolveRuleSeverity(checks: Record<string, Severity>, ruleId: string): RuleSeverityResolution;
