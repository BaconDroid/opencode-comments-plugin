import { type CommandAdapterConfig } from "./config";
import { type IdleAdvisoryController } from "./idle-advisory";
export type MutationConfig = CommandAdapterConfig;
export interface MutationSurvivor {
    file?: string;
    line?: number;
    mutator?: string;
    status?: string;
}
export interface MutationRun {
    ran: boolean;
    survivors: MutationSurvivor[];
    error?: string;
}
export declare function parseMutationReport(raw: string): MutationSurvivor[];
export declare function runMutationCheck(command: string, options?: {
    timeoutMs?: number;
}): Promise<MutationRun>;
export declare function formatSurvivors(survivors: MutationSurvivor[], max?: number): string;
export declare function createMutationAdapter(options: {
    getConfig: () => MutationConfig;
    cooldownMs?: number;
}): IdleAdvisoryController;
