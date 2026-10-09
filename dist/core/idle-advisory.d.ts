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
export declare function createAdvisoryTool(description: string, controller: IdleAdvisoryController): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
