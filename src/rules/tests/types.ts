import type { ExtractedChange } from "../../core/diff"
import type { Severity } from "../../core/config"

export interface TestGuardConfig {
  enabled: boolean
  testPatterns: string[]
  testCommand: string | null
  checks: Record<string, Severity>
  maxWarningsPerFile: number
  customPrompt?: string
  appendPrompt?: string
}

export interface RuleContext {
  change: ExtractedChange
  isTestFile: boolean
  config: TestGuardConfig
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

export type RuleLevels = Record<string, Severity>
