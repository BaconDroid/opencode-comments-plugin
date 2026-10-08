// Generic child-process runner with timeout, generalizing the comment-checker
// spawn logic in `cli.ts`.

import { spawn } from "bun"
import { DEFAULT_CLI_TIMEOUT_MS } from "../constants"

export type RunOutcome =
  | { stdout: string; stderr: string; exitCode: number }
  | "timeout"

export interface RunnerOptions {
  timeoutMs?: number
  stdin?: string
}

export async function runProcess(args: string[], options: RunnerOptions = {}): Promise<RunOutcome> {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_CLI_TIMEOUT_MS

  try {
    const proc = spawn(args, { stdin: options.stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" })

    if (options.stdin !== undefined && proc.stdin) {
      proc.stdin.write(options.stdin)
      proc.stdin.end()
    }

    const outcome = await new Promise<RunOutcome>(resolve => {
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // already exited
        }
        proc.stdout.cancel().catch(() => {})
        proc.stderr.cancel().catch(() => {})
        resolve("timeout")
      }, timeoutMs)

      void (async () => {
        try {
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          const exitCode = await proc.exited
          clearTimeout(timer)
          resolve({ stdout, stderr, exitCode })
        } catch {
          clearTimeout(timer)
          resolve("timeout")
        }
      })()
    })

    return outcome
  } catch {
    return "timeout"
  }
}
