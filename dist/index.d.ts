import { tool } from "@opencode-ai/plugin";
import { Plugin } from "@opencode/plugin";
import type { ToolExecuteInput, ToolExecuteOutput } from "./types";
/** Arguments the factory needs from the host: the project directory and, for the
 * opt-in judge, a client that can run one model prompt. */
export interface PluginHooksInput {
    directory?: string;
    client?: unknown;
}
/** One custom tool as `tool({ description, args, execute })` builds it. */
export interface GuardTool {
    description: string;
    args: Parameters<typeof tool.schema.object>[0];
    execute: (args: any, context?: any) => Promise<string>;
}
/** The hook surface both guards are written against; unchanged from V1. */
export interface CommentCheckerHooks {
    tool?: Record<string, GuardTool>;
    event?: (input: {
        event: {
            type: string;
            properties?: {
                sessionID?: string;
            };
        };
    }) => Promise<void>;
    "tool.execute.before"?: (input: ToolExecuteInput, output: {
        args: Record<string, unknown>;
    }) => Promise<void>;
    "tool.execute.after"?: (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>;
}
export declare function createHooks(input: PluginHooksInput, options?: unknown): Promise<CommentCheckerHooks>;
export declare const CommentCheckerPlugin: Plugin.Plugin;
export default CommentCheckerPlugin;
