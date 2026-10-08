import { type Language } from "./core/diff";
import type { ResolvedTestGuard } from "./core/dispatch";
export interface AuditFile {
    filePath: string;
    display: string;
    language: Language;
}
export interface CommentFinding {
    filePath: string;
    line: number;
    action: "remove" | "adjust" | "keep";
    confidence: "high" | "medium" | "low";
    text: string;
}
export interface TestAuditFinding extends CommentFinding {
    rule: string;
}
export interface AuditReport {
    scope: string;
    comments: CommentFinding[];
    tests: TestAuditFinding[];
    skipped: string[];
    generatedAt: string;
    testCommand?: string | null;
}
export declare function listRepositoryFiles(directory: string, paths: string[] | undefined): string[];
export declare function parseCommentsXml(xml: string): Array<{
    line: number;
    text: string;
}>;
export declare function classifyComment(text: string): {
    action: CommentFinding["action"];
    confidence: CommentFinding["confidence"];
};
export declare function auditTestFile(file: AuditFile, includeAdvisory: boolean): TestAuditFinding[];
export interface CommentAuditDeps {
    runCheck?: (filePath: string, content: string) => Promise<Array<{
        line: number;
        text: string;
    }>>;
}
export declare function auditComments(file: AuditFile, deps?: CommentAuditDeps): Promise<CommentFinding[]>;
export declare function renderAudit(report: AuditReport, format?: "markdown" | "json"): string;
export interface AuditRunOptions {
    scope: "comments" | "tests" | "both";
    paths?: string[];
    format?: "markdown" | "json";
    includeAdvisory?: boolean;
    directory: string;
    getConfig: () => ResolvedTestGuard;
}
export declare function runAudit(options: AuditRunOptions, deps?: CommentAuditDeps): Promise<string>;
export declare function createGuardAuditTool(options: {
    directory: string;
    getConfig: () => ResolvedTestGuard;
    deps?: CommentAuditDeps;
}): {
    description: string;
    args: {
        scope: import("zod").ZodOptional<import("zod").ZodEnum<{
            comments: "comments";
            tests: "tests";
            both: "both";
        }>>;
        paths: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
        format: import("zod").ZodOptional<import("zod").ZodEnum<{
            markdown: "markdown";
            json: "json";
        }>>;
        include_advisory: import("zod").ZodOptional<import("zod").ZodBoolean>;
    };
    execute(args: {
        scope?: "comments" | "tests" | "both" | undefined;
        paths?: string[] | undefined;
        format?: "markdown" | "json" | undefined;
        include_advisory?: boolean | undefined;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export declare const GUARD_AUDIT_COMMAND: {
    template: string;
    description: string;
};
