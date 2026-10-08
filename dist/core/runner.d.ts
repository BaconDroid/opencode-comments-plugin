export type RunOutcome = {
    stdout: string;
    stderr: string;
    exitCode: number;
} | "timeout";
export interface RunnerOptions {
    timeoutMs?: number;
    stdin?: string;
}
export declare function runShellCommand(command: string, options?: RunnerOptions): Promise<RunOutcome>;
export declare function runProcess(args: string[], options?: RunnerOptions): Promise<RunOutcome>;
