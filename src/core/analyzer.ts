// Analyzer registry: one place that knows which detectors exist, when they run
// and how their results are produced. It only orchestrates; each detector keeps
// its own policy (budget, severity, rendering).
//
// Design: docs/plans/analyzer-registry-plan.md. Fail-open: an analyzer error is
// swallowed and never propagates.

import type { Bypass } from "./bypass"
import type { ExtractedChange } from "./diff"
import type { Finding } from "./feedback"
import type { RunTestOptions } from "../cli"
import type { HookInput, TestCheckerFinding } from "../types"

export type AnalyzerTrigger = "after" | "idle" | "on-demand"

export interface AnalyzerContext {
  tool: string
  sessionID: string
  change?: ExtractedChange
  args?: Record<string, unknown>
}

export interface AnalyzerResult {
  // Structured findings, rendered by the shared test-guard renderer.
  findings?: Finding[]
  // Opaque message appended as-is (comment guard).
  raw?: string
  // Bypass markers to surface in a footer.
  bypasses?: Bypass[]
  // Message queued for the next tool call (idle analyzers).
  note?: string
}

export interface Analyzer {
  id: string
  trigger: AnalyzerTrigger
  isEnabled(): boolean
  analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> | AnalyzerResult
}

// An analyzer whose `analyze` never returns a promise. SyncAnalyzer is
// assignable to Analyzer, so it can also be registered in an AnalyzerRegistry.
export interface SyncAnalyzer {
  id: string
  trigger: AnalyzerTrigger
  isEnabled(): boolean
  analyze(ctx: AnalyzerContext): AnalyzerResult
}

// Synchronous counterpart of AnalyzerRegistry.run, for contexts that cannot
// await (audit, CI). Fail-open: a disabled analyzer or a thrown error yields an
// empty result.
export function runAnalyzer(analyzer: SyncAnalyzer, ctx: AnalyzerContext): AnalyzerResult {
  try {
    if (!analyzer.isEnabled()) return {}
    return analyzer.analyze(ctx)
  } catch {
    return {}
  }
}

export class AnalyzerRegistry {
  private readonly analyzers: Analyzer[] = []

  register(analyzer: Analyzer): void {
    this.analyzers.push(analyzer)
  }

  forTrigger(trigger: AnalyzerTrigger): Analyzer[] {
    return this.analyzers.filter(analyzer => analyzer.trigger === trigger)
  }

  // Runs every enabled analyzer for the trigger, in registration order. A
  // disabled analyzer is skipped; an analyzer error is swallowed (fail-open)
  // and contributes no result.
  async run(trigger: AnalyzerTrigger, ctx: AnalyzerContext): Promise<AnalyzerResult[]> {
    const results: AnalyzerResult[] = []
    for (const analyzer of this.forTrigger(trigger)) {
      try {
        if (!analyzer.isEnabled()) continue
        results.push(await analyzer.analyze(ctx))
      } catch {
        // Fail-open on purpose: one analyzer never breaks the others.
      }
    }
    return results
  }
}

// Seam for the test guard's binary engine: a plain runner that executes the
// downloaded `test-checker` binary over a hook payload and returns its
// normalized findings, or `null` when the binary is unavailable or failed (so
// the caller falls back to the regex rules). Injectable so tests can supply a
// stub.
export type TestCheckerRunner = (input: HookInput, options?: RunTestOptions) => Promise<TestCheckerFinding[] | null>
