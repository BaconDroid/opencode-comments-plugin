export declare function getCacheDir(): string;
export declare function getBinaryName(): string;
export declare function getCachedBinaryPath(version?: string | null): string | null;
export declare function getCommentCheckerVersion(): string | null;
export declare function cleanupStaleCache(version: string): void;
export declare function downloadCommentChecker(): Promise<string | null>;
export declare function ensureCommentCheckerBinary(): Promise<string | null>;
