import type { Severity } from "./config";
export declare const TEST_GUARD_MARKER = "<!-- opencode-test-guard -->";
export interface Finding {
    rule: string;
    filePath: string;
    line: number;
    message: string;
    severity: Severity;
    excerpt: string;
}
export interface FeedbackOptions {
    customPrompt?: string;
    appendPrompt?: string;
    maxExcerpt?: number;
}
export declare const DEFAULT_CUSTOM_PROMPT = "TEST QUALITY DETECTED:\n{{findings}}\n\nFix the cause, do not weaken the test.";
export declare function formatFindings(findings: Finding[], maxExcerpt?: number): string;
export declare function renderFeedback(findings: Finding[], options?: FeedbackOptions): string;
export declare function appendFeedback(output: {
    output: string;
}, message: string): void;
