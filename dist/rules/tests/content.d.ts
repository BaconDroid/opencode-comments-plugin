import { type ExtractedChange, type Language } from "../../core/diff";
import type { TestBlock, TestRule } from "./types";
export declare const ALLOW_MARKER: RegExp;
export declare const DISABLE_FILE_MARKER: RegExp;
export declare function isFileDisabled(change: ExtractedChange): boolean;
export interface Bypass {
    kind: "allow" | "disable-file";
    line: number;
    reason: string;
}
export declare function collectBypasses(change: ExtractedChange): Bypass[];
export declare const skipFocusAddedRule: TestRule;
export declare const tautologicalAssertionRule: TestRule;
export declare const swallowedErrorRule: TestRule;
export declare const guttedTestRule: TestRule;
export declare const matcherLoosenedRule: TestRule;
export declare function findTestBlocks(text: string, language: Language): TestBlock[];
export declare const emptyTestRule: TestRule;
export declare const unknownTestRule: TestRule;
export declare const protectedPathsRule: TestRule;
export declare const overMockingRule: TestRule;
export declare const assertionRouletteRule: TestRule;
export declare const weakenedConfigRule: TestRule;
export declare const duplicateTestRule: TestRule;
export declare const redundantAssertionRule: TestRule;
export declare const testsNotRunRule: TestRule;
export interface FileText {
    filePath: string;
    text: string;
    language: Language;
}
export interface CrossFileDuplicate {
    filePath: string;
    line: number;
    otherFilePath: string;
    otherLine: number;
    excerpt: string;
}
export declare function findCrossFileDuplicates(files: FileText[], minBodyLength?: number): CrossFileDuplicate[];
export declare const DETERMINISTIC_RULES: TestRule[];
export declare const ADVISORY_RULES: TestRule[];
