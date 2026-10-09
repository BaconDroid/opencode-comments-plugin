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
import { AnalyzerRegistry } from "./core/analyzer"
import { createIdleAnalyzer } from "./core/idle-advisory"
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

// Fields shared by both guards, resolved with the env > options > config
// precedence. `dedupWindowDefault` is the only per-guard difference.
function resolveGuardBase(
  target: {
    enabled: boolean
    customPrompt?: string
    appendPrompt?: string
    maxWarningsPerFile: number
    dedupWindowMs?: number
    triggerTools?: Set<string>
  },
  envPrefix: string,
  inputs: ResolveInputs,
  dedupWindowDefault: number,
): void {
  target.enabled =
    resolveOption(
      value => (value === undefined ? undefined : asBoolean(value, true)),
      `${envPrefix}_ENABLED`,
      "enabled",
      inputs,
    ) ?? true
  target.customPrompt = resolveOption(asString, `${envPrefix}_CUSTOM_PROMPT`, "custom_prompt", inputs)
  target.appendPrompt = resolveOption(asString, `${envPrefix}_APPEND_PROMPT`, "append_prompt", inputs)
  target.maxWarningsPerFile =
    resolveOption(value => asCount(value, 1), `${envPrefix}_MAX_WARNINGS_PER_FILE`, "max_warnings_per_file", inputs) ?? 0
  target.dedupWindowMs =
    resolveOption(value => asCount(value, 0), `${envPrefix}_DEDUP_WINDOW_MS`, "dedup_window_ms", inputs) ?? dedupWindowDefault
  target.triggerTools = new Set(resolveOption(asTools, `${envPrefix}_TOOLS`, "tools", inputs) ?? DEFAULT_TRIGGER_TOOLS)
}

function resolveConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "comment_checker")
  const fromConfig = optionContainer(config, "comment_checker")
  const inputs = { options, config: fromConfig }

  resolveGuardBase(resolvedCommentConfig, "COMMENT_CHECKER", inputs, 0)

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

  resolveGuardBase(resolvedTestGuard, "TEST_GUARD", inputs, 30_000)

  resolvedTestGuard.testPatterns =
    resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", inputs) ?? [...DEFAULT_TEST_PATTERNS]

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

  const analyzers = new AnalyzerRegistry()
  analyzers.register(createIdleAnalyzer("mutation", mutation))
  analyzers.register(createIdleAnalyzer("test-judge", judge))
  analyzers.register(createIdleAnalyzer("parser", parser))
  analyzers.register(createIdleAnalyzer("comment-judge", commentJudge))

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
      const results = await analyzers.run("idle", { tool: "", sessionID, directory: projectDirectory })
      for (const result of results) {
        if (result.note) testGuard.queueNote(result.note)
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
