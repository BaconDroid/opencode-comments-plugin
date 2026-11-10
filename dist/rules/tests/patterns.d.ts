import type { Language } from "../../core/diff";
export interface TestPathTable {
    readonly directorySegments: readonly string[];
    readonly filenamePrefixes: readonly string[];
    readonly filenameInfixes: readonly string[];
}
export declare const TEST_PATH_TABLE: TestPathTable;
export declare const DEFAULT_TEST_PATTERNS: string[];
export interface HarnessPathTable {
    readonly pathSubstrings: readonly string[];
    readonly filenames: readonly string[];
    readonly filenamePrefixes: readonly string[];
}
export declare const HARNESS_PATH_TABLE: HarnessPathTable;
export declare const TEST_CONFIG_BASENAMES: readonly string[];
export declare const SENSITIVE_HARNESS_PATH_TABLE: HarnessPathTable;
export declare function matchesTestPathTable(filePath: string, table?: TestPathTable): boolean;
export declare function isTestPath(filePath: string, patterns: string[]): boolean;
export declare function isHarnessPath(filePath: string): boolean;
export declare function isSensitiveHarnessPath(filePath: string): boolean;
export declare function isTestConfigPath(filePath: string): boolean;
export declare function isSelectedTestPath(filePath: string, patterns: string[]): boolean;
export declare function isTestFileForAnalysis(filePath: string, patterns: string[]): boolean;
export declare const SKIP_FOCUS_PATTERNS: Partial<Record<Language, RegExp[]>>;
export declare const CONDITIONAL_SKIP_PATTERNS: RegExp[];
export declare const TAUTOLOGICAL_PATTERNS: RegExp[];
export declare const ASSERTION_PATTERNS: RegExp[];
export declare const ASSERTION_COUNT_PATTERNS: RegExp[];
export interface MatcherLoosening {
    before: RegExp;
    after: RegExp;
    message: string;
}
export declare const MATCHER_LOOSENINGS: MatcherLoosening[];
export declare const SWALLOWED_ERROR_PATTERNS: Partial<Record<Language, RegExp[]>>;
export declare const MOCK_IDENTIFIER_PATTERNS: RegExp[];
export declare const WEAKENED_CONFIG_PATTERNS: RegExp[];
export declare const FORCED_SUCCESS_PATTERNS: RegExp[];
export declare const NEGATIVE_CONTROL_PATTERNS: Partial<Record<Language, RegExp[]>>;
export declare const EXPECTED_ASSERTION_GATE: RegExp[];
export declare const CALL_IDENTIFIER_PATTERN: RegExp;
export declare const JS_MOCK_CALL_PATTERN: RegExp;
export declare const JS_SPY_ON_CALL_PATTERN: RegExp;
export declare const JS_IMPORT_FROM_PATTERN: RegExp;
export declare const JS_REQUIRE_PATTERN: RegExp;
export declare const PY_PATCH_PATTERN: RegExp;
export declare const TESTS_NOT_RUN_PATTERNS: RegExp[];
export declare const TEST_DECLARATION_PATTERNS: Partial<Record<Language, RegExp>>;
export declare const PLACEHOLDER_PATTERN: RegExp;
export declare function hasAssertion(text: string): boolean;
export declare function countAssertions(lines: string[]): number;
export declare function isConditionalSkip(line: string): boolean;
