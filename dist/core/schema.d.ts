export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateTupleOptions(value: unknown): ValidationResult;
