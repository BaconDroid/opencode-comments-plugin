export type Language = "js" | "ts" | "python" | "go" | "rust" | "unknown";
export declare function detectLanguage(filePath: string): Language;
export declare function isSupportedLanguage(language: Language): boolean;
export interface ExtractedChange {
    filePath: string;
    oldText: string;
    newText: string;
    addedLines: string[];
    removedLines: string[];
    isNew: boolean;
    isDelete: boolean;
    language: Language;
}
export interface RawChange {
    filePath: string;
    oldText: string;
    newText: string;
    isNew: boolean;
    isDelete: boolean;
}
export declare function diffLines(oldText: string, newText: string): {
    added: string[];
    removed: string[];
};
export declare function extractChange(raw: RawChange): ExtractedChange;
export declare function stripComments(text: string, language: Language): string;
export declare function maskStrings(text: string): string;
export declare function stripStringLiterals(text: string): string;
export declare function isCommentLine(line: string, language: Language): boolean;
export declare function countRealLines(text: string, language: Language): number;
export declare function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined;
export declare function firstString(record: Record<string, unknown>, ...keys: string[]): string | undefined;
export declare function readFileIfExists(filePath: string): string | undefined;
export declare function changeTextsFromTool(tool: string, args: Record<string, unknown>, preimage: string | undefined): {
    oldText: string;
    newText: string;
} | undefined;
export declare function extractToolChange(tool: string, args: Record<string, unknown>, preimage: string | undefined): ExtractedChange | undefined;
export declare function splitPatch(patch: string): {
    oldText: string;
    newText: string;
};
interface PatchEntry {
    type?: string;
    filePath?: string;
    movePath?: string;
    patch?: string;
}
export declare function toPatchEntries(metadata: unknown): PatchEntry[];
export declare function extractPatchChanges(metadata: unknown): ExtractedChange[];
export {};
