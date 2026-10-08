import type { Plugin } from "@opencode-ai/plugin"
import { DEFAULT_CLI_TIMEOUT_MS, DEFAULT_TRIGGER_TOOLS } from "./constants"
import { startBackgroundInit } from "./cli"
import {
  asBoolean,
  asCount,
  asPatterns,
  asRecord,
  asString,
  asTools,
  optionContainer,
  resolveOption,
  resolveRuleConfig,
  type ResolveInputs,
  type Severity,
} from "./core/config"
import { createTestGuard, type ResolvedTestGuard } from "./core/dispatch"
import { createGuardJudgeTool, createJudge, createModelJudgeRunner, resolveJudgeModel, type JudgeConfig, createCommentJudge, createGuardCommentJudgeTool } from "./core/judge"
import { createGuardParseTool, createParserAdapter, type ParserAdapterConfig } from "./core/parser-adapter"
import { createMutationAdapter, type MutationConfig } from "./core/mutation"
import { createCommentGuard, type ResolvedCommentConfig } from "./rules/comments"
import { DEFAULT_TEST_PATTERNS } from "./rules/tests/patterns"
import { detectTestCommand } from "./core/test-command"
import { createGuardAuditTool, GUARD_AUDIT_COMMAND } from "./audit"

const DEFAULT_TEST_CHECKS: Record<string, Severity> = {
  "protected-paths": "warn",
  "skip-focus-added": "warn",
  "tautological-assertion": "warn",
  "empty-test": "warn",
  "unknown-test": "warn",
  "gutted-test": "warn",
  "matcher-loosened": "warn",
  "swallowed-error": "warn",
  "duplicate-test": "warn",
  "over-mocking": "off",
  "assertion-roulette": "off",
  "weakened-config": "off",
  "redundant-assertion": "off",
  "tests-not-run": "off",
}

let pluginOptions: unknown
let projectDirectory = process.cwd()

const resolvedCommentConfig: ResolvedCommentConfig = {
  enabled: true,
  maxWarningsPerFile: 0,
  dedupWindowMs: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  paths: [],
  timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : asBoolean(value, false)
}

function subConfigInputs(
  options: Record<string, unknown> | undefined,
  config: Record<string, unknown> | undefined,
  key: string,
): ResolveInputs {
  return { options: asRecord(options?.[key]), config: asRecord(config?.[key]) }
}

function resolveJudge(target: JudgeConfig, envPrefix: string, inputs: ResolveInputs): void {
  target.enabled = resolveOption(asOptionalBoolean, `${envPrefix}_ENABLED`, "enabled", inputs) ?? false
  target.model = resolveJudgeModel(resolveOption(asString, `${envPrefix}_MODEL`, "model", inputs))
  target.timeoutMs = resolveOption(value => asCount(value, 1), `${envPrefix}_TIMEOUT_MS`, "timeout_ms", inputs)
}

function resolveCommandAdapter(
  target: { enabled: boolean; command?: string; timeoutMs?: number },
  envPrefix: string,
  inputs: ResolveInputs,
): void {
  target.enabled = resolveOption(asOptionalBoolean, `${envPrefix}_ENABLED`, "enabled", inputs) ?? false
  target.command = resolveOption(asString, `${envPrefix}_COMMAND`, "command", inputs)
  target.timeoutMs = resolveOption(value => asCount(value, 1), `${envPrefix}_TIMEOUT_MS`, "timeout_ms", inputs)
}

function resolveConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "comment_checker")
  const fromConfig = optionContainer(config, "comment_checker")
  const inputs = { options, config: fromConfig }

  resolvedCommentConfig.enabled =
    resolveOption(
      value => (value === undefined ? undefined : asBoolean(value, true)),
      "COMMENT_CHECKER_ENABLED",
      "enabled",
      inputs,
    ) ?? true

  resolvedCommentConfig.customPrompt = resolveOption(
    asString,
    "COMMENT_CHECKER_CUSTOM_PROMPT",
    "custom_prompt",
    inputs,
  )
  resolvedCommentConfig.appendPrompt = resolveOption(
    asString,
    "COMMENT_CHECKER_APPEND_PROMPT",
    "append_prompt",
    inputs,
  )
  resolvedCommentConfig.maxWarningsPerFile =
    resolveOption(value => asCount(value, 1), "COMMENT_CHECKER_MAX_WARNINGS_PER_FILE", "max_warnings_per_file", inputs) ?? 0
  resolvedCommentConfig.dedupWindowMs =
    resolveOption(value => asCount(value, 0), "COMMENT_CHECKER_DEDUP_WINDOW_MS", "dedup_window_ms", inputs) ?? 0
  resolvedCommentConfig.triggerTools = new Set(
    resolveOption(asTools, "COMMENT_CHECKER_TOOLS", "tools", inputs) ?? DEFAULT_TRIGGER_TOOLS,
  )
  resolvedCommentConfig.paths = resolveOption(asPatterns, "COMMENT_CHECKER_PATHS", "paths", inputs) ?? []
  resolvedCommentConfig.timeoutMs =
    resolveOption(value => asCount(value, 1), "COMMENT_CHECKER_TIMEOUT_MS", "timeout_ms", inputs) ?? DEFAULT_CLI_TIMEOUT_MS

  resolveJudge(resolvedCommentJudge, "COMMENT_CHECKER_JUDGE", subConfigInputs(options, fromConfig, "judge"))
}

const resolvedTestGuard: ResolvedTestGuard = {
  enabled: true,
  testPatterns: [...DEFAULT_TEST_PATTERNS],
  testCommand: null,
  checks: { ...DEFAULT_TEST_CHECKS },
  maxWarningsPerFile: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
}

const resolvedMutation: MutationConfig = { enabled: false }

const resolvedJudge: JudgeConfig = { enabled: false }
const resolvedCommentJudge: JudgeConfig = { enabled: false }
const resolvedParser: ParserAdapterConfig = { enabled: false }

function resolveTestGuardConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "test_guard")
  const fromConfig = optionContainer(config, "test_guard")
  const inputs = { options, config: fromConfig }

  resolvedTestGuard.enabled = resolveOption(
    value => (value === undefined ? undefined : asBoolean(value, true)),
    "TEST_GUARD_ENABLED",
    "enabled",
    inputs,
  ) ?? true

  resolvedTestGuard.testPatterns =
    resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", inputs) ?? [...DEFAULT_TEST_PATTERNS]

  resolvedTestGuard.maxWarningsPerFile =
    resolveOption(value => asCount(value, 1), "TEST_GUARD_MAX_WARNINGS_PER_FILE", "max_warnings_per_file", inputs) ?? 0

  resolvedTestGuard.dedupWindowMs =
    resolveOption(value => asCount(value, 0), "TEST_GUARD_DEDUP_WINDOW_MS", "dedup_window_ms", inputs) ?? 30_000

  resolvedTestGuard.triggerTools = new Set(
    resolveOption(asTools, "TEST_GUARD_TOOLS", "tools", inputs) ?? DEFAULT_TRIGGER_TOOLS,
  )

  resolvedTestGuard.customPrompt = resolveOption(asString, "TEST_GUARD_CUSTOM_PROMPT", "custom_prompt", inputs)
  resolvedTestGuard.appendPrompt = resolveOption(asString, "TEST_GUARD_APPEND_PROMPT", "append_prompt", inputs)

  resolvedTestGuard.testCommand =
    resolveOption(asString, "TEST_GUARD_TEST_COMMAND", "test_command", inputs) ?? detectTestCommand(projectDirectory)

  resolveCommandAdapter(resolvedMutation, "TEST_GUARD_MUTATION", subConfigInputs(options, fromConfig, "mutation"))
  resolveJudge(resolvedJudge, "TEST_GUARD_JUDGE", subConfigInputs(options, fromConfig, "judge"))
  resolveCommandAdapter(resolvedParser, "TEST_GUARD_PARSER", subConfigInputs(options, fromConfig, "parser"))

  resolvedTestGuard.checks = resolveRuleConfig(DEFAULT_TEST_CHECKS, {
    envPrefix: "TEST_GUARD_",
    options,
    config: fromConfig,
  })
}

function registerAuditCommand(config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) return
  const record = config as Record<string, unknown>
  const commands = record.command
  if (commands && typeof commands === "object" && !Array.isArray(commands)) {
    const map = commands as Record<string, unknown>
    if (!map["guard-audit"]) map["guard-audit"] = { ...GUARD_AUDIT_COMMAND }
    return
  }
  if (commands === undefined) {
    record.command = { "guard-audit": { ...GUARD_AUDIT_COMMAND } }
  }
}

export const CommentCheckerPlugin: Plugin = async (input, options?: unknown) => {
  pluginOptions = options
  if (input && typeof input === "object" && "directory" in input && typeof input.directory === "string") {
    projectDirectory = input.directory
  }
  resolveConfiguration()
  resolveTestGuardConfiguration()
  startBackgroundInit()

  const commentGuard = createCommentGuard(() => resolvedCommentConfig)
  const testGuard = createTestGuard(() => resolvedTestGuard)
  const auditTool = createGuardAuditTool({ directory: projectDirectory, getConfig: () => resolvedTestGuard })
  const judge = createJudge({
    directory: projectDirectory,
    getConfig: () => resolvedJudge,
    getTestPatterns: () => resolvedTestGuard.testPatterns,
    runner: createModelJudgeRunner(input.client, projectDirectory),
  })
  const judgeTool = createGuardJudgeTool(judge)
  const commentJudge = createCommentJudge({
    directory: projectDirectory,
    getConfig: () => resolvedCommentJudge,
    runner: createModelJudgeRunner(input.client, projectDirectory),
  })
  const commentJudgeTool = createGuardCommentJudgeTool(commentJudge)
  const parser = createParserAdapter({
    directory: projectDirectory,
    getConfig: () => resolvedParser,
    getTestPatterns: () => resolvedTestGuard.testPatterns,
  })
  const parseTool = createGuardParseTool(parser)
  const mutation = createMutationAdapter({ getConfig: () => resolvedMutation })

  return {
    config: async (config: unknown) => {
      resolveConfiguration(config)
      resolveTestGuardConfiguration(config)
      registerAuditCommand(config)
    },
    tool: {
      guard_audit: auditTool,
      guard_judge: judgeTool,
      guard_parse: parseTool,
      guard_comment_judge: commentJudgeTool,
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID ?? ""
      for (const analyzer of [mutation, judge, parser, commentJudge]) {
        const message = await analyzer.onIdle(sessionID)
        if (message) testGuard.queueNote(message)
      }
    },
    "permission.ask": async (input, output) => {
      testGuard.permission(input, output)
    },
    "tool.execute.before": async (input, output) => {
      testGuard.before(input, output)
      await commentGuard.before(input, output)
    },
    "tool.execute.after": async (input, output) => {
      await commentGuard.after(input, output)
      await testGuard.after(input, output)
    },
  }
}

export default CommentCheckerPlugin
