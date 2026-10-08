import type { AnalyzerResult } from "./analyzer";
import type { Bypass } from "./bypass";
export interface RenderOptions {
    customPrompt?: string;
    appendPrompt?: string;
}
export declare function formatBypassNote(filePath: string, bypass: Bypass): string;
export declare function renderBypassFooter(title: string, entries: string[]): string;
export declare function renderAnalyzerResults(results: AnalyzerResult[], options?: RenderOptions): string;
