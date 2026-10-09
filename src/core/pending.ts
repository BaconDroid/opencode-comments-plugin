// Per-call pending store shared by both guards: a `before` records a call and
// its `after` consumes it. Abandoned calls expire after a TTL so a missed
// `after` cannot leak forever.

export const PENDING_CALL_TTL = 60_000

// What a guard stores for a pending tool call: the raw args plus the on-disk
// content read before a write. Both guards use this same payload.
export interface PendingToolCall {
  args: Record<string, unknown>
  preimage?: string
}

interface Entry<T> {
  value: T
  timestamp: number
}

export class PendingCallStore<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly ttlMs: number

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? PENDING_CALL_TTL
  }

  set(callID: string, value: T, now = Date.now()): void {
    this.entries.set(callID, { value, timestamp: now })
  }

  get(callID: string): T | undefined {
    return this.entries.get(callID)?.value
  }

  // Returns the value and drops it in one step, for the consume-on-after path.
  take(callID: string): T | undefined {
    const entry = this.entries.get(callID)
    if (!entry) return undefined
    this.entries.delete(callID)
    return entry.value
  }

  delete(callID: string): void {
    this.entries.delete(callID)
  }

  prune(now = Date.now()): void {
    for (const [callID, entry] of this.entries) {
      if (now - entry.timestamp > this.ttlMs) this.entries.delete(callID)
    }
  }
}
