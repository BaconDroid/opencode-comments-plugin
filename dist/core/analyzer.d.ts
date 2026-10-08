import type { Bypass } from "./bypass";
import type { ExtractedChange } from "./diff";
import type { Finding } from "./feedback";
export type AnalyzerTrigger = "after" | "idle" | "on-demand";
export interface AnalyzerContext {
    tool: string;
    sessionID: string;
    callID?: string;
    change?: ExtractedChange;
    args?: Record<string, unknown>;
    directory: string;
}
export interface AnalyzerResult {
    findings?: Finding[];
    raw?: string;
    bypasses?: Bypass[];
    note?: string;
}
export interface Analyzer {
    id: string;
    trigger: AnalyzerTrigger;
    isEnabled(): boolean;
    analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> | AnalyzerResult;
}
export declare class AnalyzerRegistry {
    private readonly analyzers;
    register(analyzer: Analyzer): void;
    forTrigger(trigger: AnalyzerTrigger): Analyzer[];
    run(trigger: AnalyzerTrigger, ctx: AnalyzerContext): Promise<AnalyzerResult[]>;
}
