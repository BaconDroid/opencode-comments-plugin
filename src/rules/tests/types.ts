import type { ExtractedChange } from "../../core/diff"
import type { Severity } from "../../core/config"

export interface TestGuardConfig {
  enabled: boolean
  testPatterns: string[]
  checks: Record<string, Severity>
  maxWarningsPerFile: number
  customPrompt?: string
  appendPrompt?: string
}

export interface TestBlock {
  startLine: number
  endLine: number
  lines: string[]
}

export interface RuleContext {
  change: ExtractedChange
  isTestFile: boolean
  config: TestGuardConfig
  // Computed once per file by runTestRules so whole-body rules do not re-parse.
  blocks?: TestBlock[]
}

export interface RuleFinding {
  rule: string
  line: number
  message: string
  excerpt: string
}

export interface TestRule {
  id: string
  run(ctx: RuleContext): RuleFinding[]
}
