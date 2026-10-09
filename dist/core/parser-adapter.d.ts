import type { CommandAdapterConfig } from "./config";
import type { ExtractedChange } from "./diff";
import { type IdleAdvisoryController } from "./idle-advisory";
export type ParserAdapterConfig = CommandAdapterConfig;
export interface ParserPayloadFile {
    path: string;
    language: string;
    added: string[];
    removed: string[];
}
export interface ParserFinding {
    file: string;
    line: number;
    rule: string;
    message: string;
    confidence: string;
}
export type ParserRun = (command: string, payload: string, timeoutMs: number) => Promise<string>;
export declare function buildParserPayload(changes: ExtractedChange[]): string;
export declare function parseParserFindings(raw: string): ParserFinding[];
export declare function formatParserFindings(findings: ParserFinding[]): string;
export declare function runParserAdapter(changes: ExtractedChange[], config: ParserAdapterConfig, run?: ParserRun): Promise<ParserFinding[]>;
export type ParserAdapterController = IdleAdvisoryController;
export declare function createParserAdapter(options: {
    directory: string;
    getConfig: () => ParserAdapterConfig;
    getTestPatterns: () => string[];
    run?: ParserRun;
    cooldownMs?: number;
}): ParserAdapterController;
export declare function createGuardParseTool(controller: ParserAdapterController): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
