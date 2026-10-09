export type DebugLog = (...args: unknown[]) => void;
export declare function createDebugLog(prefix: string, enabled: boolean): DebugLog;
