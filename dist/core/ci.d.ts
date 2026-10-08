import { type ExtractedChange } from "./diff";
import { type Finding } from "./feedback";
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
