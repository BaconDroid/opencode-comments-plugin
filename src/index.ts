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
  type Severity,
} from "./core/config"
import { createTestGuard, type ResolvedTestGuard } from "./core/dispatch"
import { createGuardJudgeTool, createJudge, createModelJudgeRunner, resolveJudgeModel, type JudgeConfig } from "./core/judge"
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
  "net-assertion-loss": "warn",
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
  maxWarningsPerFile: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
}

function resolveConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "comment_checker")
  const fromConfig = optionContainer(config, "comment_checker")
  const inputs = { options, config: fromConfig }

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

  const tools = resolveOption(asTools, "COMMENT_CHECKER_TOOLS", "tools", inputs)
  resolvedCommentConfig.triggerTools = new Set(tools ?? DEFAULT_TRIGGER_TOOLS)

  resolvedCommentConfig.timeoutMs =
    resolveOption(value => asCount(value, 1), "COMMENT_CHECKER_TIMEOUT_MS", "timeout_ms", inputs) ?? DEFAULT_CLI_TIMEOUT_MS
}

const resolvedTestGuard: ResolvedTestGuard = {
  enabled: true,
  testPatterns: [...DEFAULT_TEST_PATTERNS],
  testCommand: null,
  checks: { ...DEFAULT_TEST_CHECKS },
  maxWarningsPerFile: 0,
  netAssertionLossThreshold: 2,
  mutationEnabled: false,
}

const resolvedJudge: JudgeConfig = { enabled: false }

function resolveTestGuardConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "test_guard")
  const fromConfig = optionContainer(config, "test_guard")

  resolvedTestGuard.enabled = resolveOption(
    value => (value === undefined ? undefined : asBoolean(value, true)),
    "TEST_GUARD_ENABLED",
    "enabled",
    { options, config: fromConfig },
  ) ?? true

  resolvedTestGuard.testPatterns =
    resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", { options, config: fromConfig }) ??
    [...DEFAULT_TEST_PATTERNS]

  resolvedTestGuard.maxWarningsPerFile =
    resolveOption(value => asCount(value, 1), "TEST_GUARD_MAX_WARNINGS_PER_FILE", "max_warnings_per_file", {
      options,
      config: fromConfig,
    }) ?? 0

  resolvedTestGuard.customPrompt = resolveOption(
    asString,
    "TEST_GUARD_CUSTOM_PROMPT",
    "custom_prompt",
    { options, config: fromConfig },
  )
  resolvedTestGuard.appendPrompt = resolveOption(
    asString,
    "TEST_GUARD_APPEND_PROMPT",
    "append_prompt",
    { options, config: fromConfig },
  )

  resolvedTestGuard.testCommand =
    resolveOption(asString, "TEST_GUARD_TEST_COMMAND", "test_command", { options, config: fromConfig }) ??
    detectTestCommand(projectDirectory)

  resolvedTestGuard.netAssertionLossThreshold =
    resolveOption(
      value => asCount(value, 1),
      "TEST_GUARD_NET_ASSERTION_LOSS_THRESHOLD",
      "net_assertion_loss_threshold",
      { options, config: fromConfig },
    ) ?? 2

  const optionsMutation = asRecord(options?.mutation)
  const configMutation = asRecord(fromConfig?.mutation)
  const mutationInputs = { options: optionsMutation, config: configMutation }
  resolvedTestGuard.mutationEnabled =
    resolveOption(
      value => (value === undefined ? undefined : asBoolean(value, false)),
      "TEST_GUARD_MUTATION_ENABLED",
      "enabled",
      mutationInputs,
    ) ?? false
  resolvedTestGuard.mutationCommand = resolveOption(asString, "TEST_GUARD_MUTATION_COMMAND", "command", mutationInputs)
  resolvedTestGuard.mutationTimeoutMs = resolveOption(
    value => asCount(value, 1),
    "TEST_GUARD_MUTATION_TIMEOUT_MS",
    "timeout_ms",
    mutationInputs,
  )

  const optionsJudge = asRecord(options?.judge)
  const configJudge = asRecord(fromConfig?.judge)
  const judgeInputs = { options: optionsJudge, config: configJudge }
  resolvedJudge.enabled =
    resolveOption(
      value => (value === undefined ? undefined : asBoolean(value, false)),
      "TEST_GUARD_JUDGE_ENABLED",
      "enabled",
      judgeInputs,
    ) ?? false
  resolvedJudge.model = resolveJudgeModel(resolveOption(asString, "TEST_GUARD_JUDGE_MODEL", "model", judgeInputs))
  resolvedJudge.timeoutMs = resolveOption(value => asCount(value, 1), "TEST_GUARD_JUDGE_TIMEOUT_MS", "timeout_ms", judgeInputs)

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

  return {
    config: async (config: unknown) => {
      resolveConfiguration(config)
      resolveTestGuardConfiguration(config)
      registerAuditCommand(config)
    },
    tool: {
      guard_audit: auditTool,
      guard_judge: judgeTool,
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID ?? ""
      await testGuard.onIdle(sessionID)
      const judgeMessage = await judge.onIdle(sessionID)
      if (judgeMessage) testGuard.queueNote(judgeMessage)
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
