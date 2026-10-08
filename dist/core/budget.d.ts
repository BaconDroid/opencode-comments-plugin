export interface BudgetOptions {
    dedupWindowMs?: number;
    ttlMs?: number;
    maxWarningsPerFile?: number;
}
export declare class GuardBudget {
    private dedupWindowMs;
    private readonly ttlMs;
    private maxWarningsPerFile;
    private readonly seen;
    private readonly perFile;
    constructor(options?: BudgetOptions);
    setMaxWarningsPerFile(value: number): void;
    setDedupWindowMs(value: number): void;
    private key;
    private fileKey;
    cleanup(now?: number): void;
    shouldEmit(sessionID: string, ruleID: string, filePath: string, now?: number): boolean;
    record(sessionID: string, ruleID: string, filePath: string, now?: number): void;
    touch(sessionID: string, now?: number): void;
}
