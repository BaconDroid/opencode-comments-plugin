export declare const TUPLE_OPTIONS_SCHEMA: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly title: "opencode-comments-plugin options";
    readonly type: "object";
    readonly properties: {
        readonly comment_checker: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly custom_prompt: {
                    readonly type: "string";
                };
                readonly append_prompt: {
                    readonly type: "string";
                };
                readonly max_warnings_per_file: {
                    readonly type: "integer";
                    readonly minimum: 0;
                };
                readonly tools: {
                    readonly oneOf: readonly [{
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    }, {
                        readonly type: "string";
                    }];
                };
                readonly timeout_ms: {
                    readonly type: "integer";
                    readonly minimum: 1;
                };
            };
        };
        readonly test_guard: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly enabled: {
                    readonly type: "boolean";
                };
                readonly test_patterns: {
                    readonly oneOf: readonly [{
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    }, {
                        readonly type: "string";
                    }];
                };
                readonly test_command: {
                    readonly type: readonly ["string", "null"];
                };
                readonly checks: {
                    readonly type: "object";
                    readonly additionalProperties: {
                        readonly type: "string";
                        readonly enum: string[];
                    };
                };
                readonly max_warnings_per_file: {
                    readonly type: "integer";
                    readonly minimum: 0;
                };
                readonly custom_prompt: {
                    readonly type: "string";
                };
                readonly append_prompt: {
                    readonly type: "string";
                };
                readonly mutation: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly enabled: {
                            readonly type: "boolean";
                        };
                    };
                };
            };
        };
    };
};
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateTupleOptions(value: unknown): ValidationResult;
