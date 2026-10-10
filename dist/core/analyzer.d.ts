import type { Bypass } from "./bypass";
import type { ExtractedChange } from "./diff";
import type { Finding } from "./feedback";
import type { RunTestOptions } from "../cli";
import type { HookInput, TestCheckerFinding } from "../types";
export type AnalyzerTrigger = "after" | "idle" | "on-demand";
export interface AnalyzerContext {
    tool: string;
    sessionID: string;
    change?: ExtractedChange;
    args?: Record<string, unknown>;
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
export interface SyncAnalyzer {
    id: string;
    trigger: AnalyzerTrigger;
    isEnabled(): boolean;
    analyze(ctx: AnalyzerContext): AnalyzerResult;
}
export declare function runAnalyzer(analyzer: SyncAnalyzer, ctx: AnalyzerContext): AnalyzerResult;
export declare class AnalyzerRegistry {
    private readonly analyzers;
    register(analyzer: Analyzer): void;
    forTrigger(trigger: AnalyzerTrigger): Analyzer[];
    run(trigger: AnalyzerTrigger, ctx: AnalyzerContext): Promise<AnalyzerResult[]>;
}
export type TestCheckerRunner = (input: HookInput, options?: RunTestOptions) => Promise<TestCheckerFinding[] | null>;
