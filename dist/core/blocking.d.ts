import type { PermissionDecision, PermissionLike } from "../types";
export interface BlockingPolicy {
    isBlocking(): boolean;
    isProtectedPath(filePath: string): boolean;
    message(filePath: string, viaPatch: boolean): string;
}
export declare function extractPatchEntries(patchText: string): Array<{
    kind: string;
    path: string;
}>;
export declare function pathExists(filePath: string): boolean;
export declare function checkBlockingBefore(toolLower: string, args: Record<string, unknown>, policy: BlockingPolicy): void;
export declare function checkPermission(input: PermissionLike, output: PermissionDecision, policy: BlockingPolicy): string | undefined;
