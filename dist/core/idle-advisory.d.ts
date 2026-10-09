import { tool } from "@opencode-ai/plugin";
import type { Analyzer } from "./analyzer";
export interface IdleAdvisoryController {
    onIdle(sessionID: string): Promise<string | null>;
    analyzeNow(): Promise<string>;
}
export declare function idleMessages(label: string, hint: string, empty: string): {
    disabledMessage: string;
    unavailableMessage: string;
    emptyMessage: string;
};
export declare function createIdleAdvisory(options: {
    isEnabled: () => boolean;
    analyze: () => Promise<string | null>;
    disabledMessage: string;
    unavailableMessage: string;
    emptyMessage: string;
    cooldownMs?: number;
}): IdleAdvisoryController;
export declare function createIdleAnalyzer(id: string, controller: IdleAdvisoryController): Analyzer;
type ToolArgs = Parameters<typeof tool>[0]["args"];
export declare function createReadonlyTool<A extends ToolArgs>(description: string, args: A, execute: (args: Parameters<ReturnType<typeof tool<A>>["execute"]>[0]) => Promise<string>): {
    description: string;
    args: A;
    execute(args: import("zod/v4/core").$InferObjectOutput<A, {}>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export declare function createAdvisoryTool(description: string, controller: IdleAdvisoryController): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export {};
