export declare const PENDING_CALL_TTL = 60000;
export interface PendingToolCall {
    args: Record<string, unknown>;
    preimage?: string;
}
export declare class PendingCallStore<T> {
    private readonly entries;
    private readonly ttlMs;
    constructor(options?: {
        ttlMs?: number;
    });
    set(callID: string, value: T, now?: number): void;
    get(callID: string): T | undefined;
    take(callID: string): T | undefined;
    delete(callID: string): void;
    prune(now?: number): void;
}
