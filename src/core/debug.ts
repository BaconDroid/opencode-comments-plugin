// Shared stderr debug logger. Each module passes its own prefix and env flag so
// the formatting and the enable check live in one place. The flag is read once
// at module load, matching the previous per-module `DEBUG` constants.

export type DebugLog = (...args: unknown[]) => void

export function createDebugLog(prefix: string, enabled: boolean): DebugLog {
  if (!enabled) return () => {}
  return (...args: unknown[]) => {
    const message = args
      .map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(" ")
    process.stderr.write(`[${new Date().toISOString()}] [${prefix}] ${message}\n`)
  }
}
