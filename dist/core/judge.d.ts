import { type ExtractedChange } from "./diff";
export interface JudgeConfig {
    enabled: boolean;
    model?: string;
    timeoutMs?: number;
}
export interface JudgeFinding {
    file: string;
    line: number;
    reason: string;
    confidence: string;
}
export type JudgeRunner = (prompt: string, model?: string) => Promise<string>;
export declare function buildJudgePrompt(changes: ExtractedChange[]): string;
export declare function parseJudgeResponse(raw: string): JudgeFinding[];
export declare function formatJudgeFindings(findings: JudgeFinding[]): string;
export declare function runJudge(changes: ExtractedChange[], config: JudgeConfig, runner: JudgeRunner): Promise<JudgeFinding[]>;
export declare function createModelJudgeRunner(client: unknown, directory: string): JudgeRunner;
export interface JudgeController {
    onIdle(sessionID: string): Promise<string | null>;
    judgeNow(): Promise<string>;
}
export declare function createJudge(options: {
    directory: string;
    getConfig: () => JudgeConfig;
    getTestPatterns: () => string[];
    runner: JudgeRunner;
    cooldownMs?: number;
}): JudgeController;
export declare function createGuardJudgeTool(judge: JudgeController): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
