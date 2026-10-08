// Per-session guard budget: dedup window, max warnings per file, single-flight,
// and TTL-based cleanup. Adapted from the oh-my-opencode comment-checker lock
// (`withCommentCheckerLock`, `DEDUP_WINDOW_MS = 30_000`) and pending-calls TTL
// (`PENDING_CALL_TTL = 60_000`). Reimplemented, zero dependency.

export interface BudgetOptions {
  dedupWindowMs?: number
  ttlMs?: number
  maxWarningsPerFile?: number
}

interface Counter {
  count: number
  lastSeen: number
}

export class GuardBudget {
  private readonly dedupWindowMs: number
  private readonly ttlMs: number
  private maxWarningsPerFile: number
  private readonly seen = new Map<string, number>()
  private readonly perFile = new Map<string, Counter>()
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(options: BudgetOptions = {}) {
    this.dedupWindowMs = options.dedupWindowMs ?? 30_000
    this.ttlMs = options.ttlMs ?? 60_000
    this.maxWarningsPerFile = options.maxWarningsPerFile ?? 0
  }

  setMaxWarningsPerFile(value: number): void {
    this.maxWarningsPerFile = value
  }

  private key(sessionID: string, ruleID: string, filePath: string): string {
    return `${sessionID}\u0000${ruleID}\u0000${filePath}`
  }

  private fileKey(sessionID: string, filePath: string): string {
    return `${sessionID}\u0000${filePath}`
  }

  cleanup(now = Date.now()): void {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs) this.seen.delete(key)
    }
    for (const [key, counter] of this.perFile) {
      if (now - counter.lastSeen > this.ttlMs) this.perFile.delete(key)
    }
  }

  shouldEmit(sessionID: string, ruleID: string, filePath: string, now = Date.now()): boolean {
    this.cleanup(now)
    const key = this.key(sessionID, ruleID, filePath)
    const last = this.seen.get(key)
    if (last !== undefined && now - last < this.dedupWindowMs) return false

    if (this.maxWarningsPerFile > 0) {
      const counter = this.perFile.get(this.fileKey(sessionID, filePath))
      if (counter && counter.count >= this.maxWarningsPerFile) return false
    }

    this.seen.set(key, now)
    return true
  }

  record(sessionID: string, filePath: string): void {
    if (this.maxWarningsPerFile <= 0) return
    const key = this.fileKey(sessionID, filePath)
    const existing = this.perFile.get(key)
    if (existing) {
      existing.count += 1
      existing.lastSeen = Date.now()
    } else {
      this.perFile.set(key, { count: 1, lastSeen: Date.now() })
    }
  }

  // Single-flight: concurrent calls for the same key share one promise.
  async singleFlight<T>(sessionID: string, ruleID: string, filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = this.key(sessionID, ruleID, filePath)
    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>
    const promise = fn().finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }
}
