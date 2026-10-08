// Analyzer registry: one place that knows which detectors exist, when they run
// and how their results are produced. It only orchestrates; each detector keeps
// its own policy (budget, severity, rendering).
//
// Design: docs/plans/analyzer-registry-plan.md. Fail-open: an analyzer error is
// swallowed and never propagates.

import type { Bypass } from "./bypass"
import type { ExtractedChange } from "./diff"
import type { Finding } from "./feedback"

export type AnalyzerTrigger = "after" | "idle" | "on-demand"

export interface AnalyzerContext {
  tool: string
  sessionID: string
  callID?: string
  change?: ExtractedChange
  args?: Record<string, unknown>
  directory: string
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
