// Per-session guard budget: dedup window, max warnings per file, and TTL-based
// cleanup, shared by the comment guard and the test guard. Adapted from the
// oh-my-opencode comment-checker lock (`withCommentCheckerLock`,
// `DEDUP_WINDOW_MS = 30_000`) and pending-calls TTL (`PENDING_CALL_TTL =
// 60_000`). Reimplemented, zero dependency.

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
  private dedupWindowMs: number
  private readonly ttlMs: number
  private maxWarningsPerFile: number
  private readonly seen = new Map<string, number>()
  private readonly perFile = new Map<string, Counter>()

  constructor(options: BudgetOptions = {}) {
    this.dedupWindowMs = options.dedupWindowMs ?? 30_000
    this.ttlMs = options.ttlMs ?? 60_000
    this.maxWarningsPerFile = options.maxWarningsPerFile ?? 0
  }

  setMaxWarningsPerFile(value: number): void {
    this.maxWarningsPerFile = value
  }

  setDedupWindowMs(value: number): void {
    this.dedupWindowMs = value
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

  // Pure check: the dedup window and the per-file cap. Does not record the
  // emit, so a call that produces no finding does not consume the window.
  shouldEmit(sessionID: string, ruleID: string, filePath: string, now = Date.now()): boolean {
    this.cleanup(now)
    const key = this.key(sessionID, ruleID, filePath)
    const last = this.seen.get(key)
    if (last !== undefined && now - last < this.dedupWindowMs) return false

    if (this.maxWarningsPerFile > 0) {
      const counter = this.perFile.get(this.fileKey(sessionID, filePath))
      if (counter && counter.count >= this.maxWarningsPerFile) return false
    }

    return true
  }

  // Records an emit: opens the dedup window and, when capped, increments the
  // per-file counter.
  record(sessionID: string, ruleID: string, filePath: string, now = Date.now()): void {
    this.seen.set(this.key(sessionID, ruleID, filePath), now)
    if (this.maxWarningsPerFile <= 0) return

    const key = this.fileKey(sessionID, filePath)
    const existing = this.perFile.get(key)
    if (existing) {
      existing.count += 1
      existing.lastSeen = now
    } else {
      this.perFile.set(key, { count: 1, lastSeen: now })
    }
  }

  // Keeps a session's per-file counters alive on unrelated activity, so a
  // reached cap does not expire while the session is still active.
  touch(sessionID: string, now = Date.now()): void {
    const prefix = `${sessionID}\u0000`
    for (const [key, counter] of this.perFile) {
      if (key.startsWith(prefix)) counter.lastSeen = now
    }
  }
}
