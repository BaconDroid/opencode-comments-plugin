import { type ExtractedChange } from "./diff";
import { type Finding } from "./feedback";
import type { CheckResult } from "../types";
export declare function changedTestChanges(directory: string, base: string, testPatterns: string[]): ExtractedChange[];
export declare function diffChanges(directory: string, base: string): ExtractedChange[];
export interface DiffCheckOptions {
    directory: string;
    base?: string;
    testPatterns?: string[];
    includeAdvisory?: boolean;
    format?: "markdown" | "json";
}
export interface DiffCheckResult {
    output: string;
    findings: Finding[];
}
export declare function runDiffCheck(options: DiffCheckOptions): DiffCheckResult;
export interface CommentDiffDeps {
    runCheck?: (change: ExtractedChange) => Promise<CheckResult>;
}
export interface CommentDiffResult {
    output: string;
    count: number;
}
export declare function runCommentDiffCheck(options: {
    directory: string;
    base?: string;
    format?: "markdown" | "json";
}, deps?: CommentDiffDeps): Promise<CommentDiffResult>;
