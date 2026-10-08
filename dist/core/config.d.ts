export type Severity = "off" | "warn" | "block";
export declare function optionContainer(value: unknown, key: string): Record<string, unknown> | undefined;
export declare function asString(value: unknown): string | undefined;
export declare function asCount(value: unknown, minimum: number): number | undefined;
export declare function asTools(value: unknown): string[] | undefined;
export declare function asPatterns(value: unknown): string[] | undefined;
export declare function asBoolean(value: unknown, fallback: boolean): boolean;
export declare function asLevel(value: unknown): Severity | undefined;
export interface ResolveInputs {
    options?: Record<string, unknown>;
    config?: Record<string, unknown>;
}
export declare function resolveOption<T>(coerce: (value: unknown) => T | undefined, envKey: string, key: string, inputs: ResolveInputs): T | undefined;
export interface RuleConfigSources {
    envPrefix: string;
    options?: Record<string, unknown>;
    config?: Record<string, unknown>;
}
export declare function resolveRuleConfig(schema: Record<string, Severity>, sources: RuleConfigSources): Record<string, Severity>;
export declare function asRecord(value: unknown): Record<string, unknown> | undefined;
