export declare class AdvisoryQueue {
    private readonly notes;
    queue(message: string): void;
    consume(): string[];
}
export declare function appendAdvisories(output: {
    output: string;
}, notes: string[]): void;
