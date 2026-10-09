export declare const MAX_ADVISORY_FINDINGS = 20;
export interface RawAdvisoryFinding {
    file: string;
    line: number;
    text: string;
    confidence: string;
    record: Record<string, unknown>;
}
export declare function parseAdvisoryFindings(items: unknown[], textKey: string): RawAdvisoryFinding[];
