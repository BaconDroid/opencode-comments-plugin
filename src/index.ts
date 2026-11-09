import { tool } from "@opencode-ai/plugin"
import { Plugin } from "@opencode/plugin"
import { isAbsolute, join } from "node:path"
import { DEFAULT_CLI_TIMEOUT_MS, DEFAULT_DEDUP_WINDOW_MS, DEFAULT_TRIGGER_TOOLS } from "./constants"
import { startBackgroundInit, startTestCheckerBackgroundInit } from "./cli"
import {
  asBoolean,
  asCount,
  asEngine,
  asKeywordAcquit,
  asPatterns,
  asRecord,
  asString,
  asTools,
  optionContainer,
  resolveOption,
  resolveRuleConfig,
  type CommandAdapterConfig,
  type GuardBaseConfig,
  type ResolveInputs,
} from "./core/config"
import { createTestGuard, type ResolvedTestGuard } from "./core/dispatch"
import { AdvisoryQueue, appendAdvisories } from "./core/advisory-queue"
import { AnalyzerRegistry } from "./core/analyzer"
import { createIdleAnalyzer } from "./core/idle-advisory"
import { createGuardJudgeTool, createJudge, createModelJudgeRunner, resolveJudgeModel, type JudgeConfig, createCommentJudge, createGuardCommentJudgeTool } from "./core/judge"
import { createGuardParseTool, createParserAdapter, type ParserAdapterConfig } from "./core/parser-adapter"
import { createMutationAdapter, type MutationConfig } from "./core/mutation"
import { createCommentGuard, type ResolvedCommentConfig } from "./rules/comments"
import { DEFAULT_TEST_PATTERNS } from "./rules/tests/patterns"
import { buildRuleChecks } from "./rules/tests"
import { LEGACY_RULE_ALIASES } from "./rules/tests/rule-ids"
import { detectTestCommand } from "./core/test-command"
import { createGuardAuditTool, GUARD_AUDIT_COMMAND } from "./audit"
import { createGuardCleanupTool, GUARD_CLEANUP_COMMAND } from "./cleanup"
import type { ToolExecuteInput, ToolExecuteOutput } from "./types"

// Single source of truth: deterministic rules warn, advisory rules are off.
const DEFAULT_TEST_CHECKS = buildRuleChecks(false)

// --- V2 host adapters -------------------------------------------------------
//
// The guards are written against the V1 hook contract (see `CommentCheckerHooks`)
// and their tests pin that shape. `setup` is the only place that knows about the
// V2 host event shapes; these helpers keep that translation in one spot.

/** Arguments the factory needs from the host: the project directory and, for the
 * opt-in judge, a client that can run one model prompt. */
export interface PluginHooksInput {
  directory?: string
  client?: unknown
}

/** One custom tool as `tool({ description, args, execute })` builds it. */
export interface GuardTool {
  description: string
  args: Parameters<typeof tool.schema.object>[0]
  execute: (args: any, context?: any) => Promise<string>
}

/** The hook surface both guards are written against; unchanged from V1. */
export interface CommentCheckerHooks {
  tool?: Record<string, GuardTool>
  event?: (input: { event: { type: string; properties?: { sessionID?: string } } }) => Promise<void>
  "tool.execute.before"?: (input: ToolExecuteInput, output: { args: Record<string, unknown> }) => Promise<void>
  "tool.execute.after"?: (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>
}

// V2 renamed three built-in tools. The guards, `DEFAULT_TRIGGER_TOOLS` and the
// documented `tools` option all use the V1 names, so both sides are canonicalised.
const V2_TOOL_ALIASES: Record<string, string> = {
  patch: "apply_patch",
  shell: "bash",
  subagent: "task",
}

function canonicalToolName(name: string): string {
  return V2_TOOL_ALIASES[name.toLowerCase()] ?? name
}

function canonicalToolList(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split(",")
      .map(entry => canonicalToolName(entry.trim()))
      .filter(entry => entry.length > 0)
      .join(",")
  }
  if (Array.isArray(value)) {
    return value.map(entry => (typeof entry === "string" ? canonicalToolName(entry) : entry))
  }
  return value
}

/** Accept either spelling of the `tools` option so one config works on both hosts. */
function canonicalizeOptions(options: unknown): unknown {
  if (!options || typeof options !== "object" || Array.isArray(options)) return options
  const source = options as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...source }
  if ("tools" in normalized) normalized.tools = canonicalToolList(normalized.tools)
  for (const key of ["comment_checker", "test_guard"]) {
    const nested = normalized[key]
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>
      if ("tools" in record) normalized[key] = { ...record, tools: canonicalToolList(record.tools) }
    }
  }
  return normalized
}

const PATCH_STATUS_TO_TYPE: Record<string, string> = {
  added: "add",
  deleted: "delete",
  modified: "update",
}

// V2's patch tool reports `metadata.files[]` as `{ file, status, ... }`; the
// guards read the V1 `{ type, filePath, movePath, ... }` shape. Normalising at
// the host boundary keeps `src/core/diff.ts` on a single contract.
function canonicalPatchMetadata(metadata: unknown, directory: string): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata
  const record = metadata as Record<string, unknown>
  const files = record.files
  if (!Array.isArray(files)) return metadata
  return {
    ...record,
    files: files.map(file => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return file
      const entry = file as Record<string, unknown>
      const status = typeof entry.status === "string" ? entry.status : undefined
      const path = typeof entry.file === "string" ? entry.file : undefined
      if (status === undefined && path === undefined) return entry
      const mapped: Record<string, unknown> = { ...entry }
      if (typeof mapped.type !== "string" && status !== undefined) mapped.type = PATCH_STATUS_TO_TYPE[status]
      if (typeof mapped.filePath !== "string" && path !== undefined) {
        mapped.filePath = isAbsolute(path) ? path : join(directory, path)
      }
      return mapped
    }),
  }
}

// The model-visible body of a V2 tool result (`result.content`) is the V1
// `output.output` display string the guards append to. The host normalises it to
// a content array before `execute.after` fires; a bare string is tolerated too.
function resultText(result: { content?: unknown; output?: unknown }): string {
  const content = result.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    let text = ""
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const typed = part as { type?: unknown; text?: unknown }
      if (typed.type === "text" && typeof typed.text === "string") text += typed.text
    }
    return text
  }
  return typeof result.output === "string" ? result.output : ""
}

// The guards only append, so the write-back is the appended delta as its own
// text part (or the full text when an append cannot be proven). Host objects are
// never mutated in place.
function rewriteContent(content: unknown, before: string, after: string): unknown {
  if (after === before) return content
  if (typeof content === "string") return after
  if (!Array.isArray(content)) return after
  if (!after.startsWith(before)) return [{ type: "text", text: after }]
  const delta = after.slice(before.length)
  if (delta.length === 0) return content
  return [...content, { type: "text", text: delta }]
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
  keywordAcquit: "proven-only",
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

// `enabled` and `timeout_ms`, shared by the judge and the command adapters.
function resolveAdapterBase(
  target: { enabled: boolean; timeoutMs?: number },
  envPrefix: string,
  inputs: ResolveInputs,
): void {
  target.enabled = resolveOption(asOptionalBoolean, `${envPrefix}_ENABLED`, "enabled", inputs) ?? false
  target.timeoutMs = resolveOption(value => asCount(value, 1), `${envPrefix}_TIMEOUT_MS`, "timeout_ms", inputs)
}

function resolveJudge(target: JudgeConfig, envPrefix: string, inputs: ResolveInputs): void {
  resolveAdapterBase(target, envPrefix, inputs)
  target.model = resolveJudgeModel(resolveOption(asString, `${envPrefix}_MODEL`, "model", inputs))
}

function resolveCommandAdapter(target: CommandAdapterConfig, envPrefix: string, inputs: ResolveInputs): void {
  resolveAdapterBase(target, envPrefix, inputs)
  target.command = resolveOption(asString, `${envPrefix}_COMMAND`, "command", inputs)
}

// Fields shared by both guards, resolved with the env > options > config
// precedence.
function resolveGuardBase(target: GuardBaseConfig, envPrefix: string, inputs: ResolveInputs): void {
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
    resolveOption(value => asCount(value, 0), `${envPrefix}_DEDUP_WINDOW_MS`, "dedup_window_ms", inputs) ??
    DEFAULT_DEDUP_WINDOW_MS
  target.triggerTools = new Set(resolveOption(asTools, `${envPrefix}_TOOLS`, "tools", inputs) ?? DEFAULT_TRIGGER_TOOLS)
}

function resolveConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "comment_checker")
  const fromConfig = optionContainer(config, "comment_checker")
  const inputs = { options, config: fromConfig }

  resolveGuardBase(resolvedCommentConfig, "COMMENT_CHECKER", inputs)

  resolvedCommentConfig.paths = resolveOption(asPatterns, "COMMENT_CHECKER_PATHS", "paths", inputs) ?? []
  resolvedCommentConfig.timeoutMs =
    resolveOption(value => asCount(value, 1), "COMMENT_CHECKER_TIMEOUT_MS", "timeout_ms", inputs) ?? DEFAULT_CLI_TIMEOUT_MS
  resolvedCommentConfig.keywordAcquit =
    resolveOption(asKeywordAcquit, "COMMENT_CHECKER_KEYWORD_ACQUIT", "keyword_acquit", inputs) ?? "proven-only"

  resolveJudge(resolvedCommentJudge, "COMMENT_CHECKER_JUDGE", subConfigInputs(options, fromConfig, "judge"))
}

const resolvedTestGuard: ResolvedTestGuard = {
  enabled: true,
  testPatterns: [...DEFAULT_TEST_PATTERNS],
  testCommand: null,
  checks: { ...DEFAULT_TEST_CHECKS },
  maxWarningsPerFile: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  engine: "binary",
}

const resolvedMutation: MutationConfig = { enabled: false }

const resolvedJudge: JudgeConfig = { enabled: false }
const resolvedCommentJudge: JudgeConfig = { enabled: false }
const resolvedParser: ParserAdapterConfig = { enabled: false }

function resolveTestGuardConfiguration(config?: unknown): void {
  const options = optionContainer(pluginOptions, "test_guard")
  const fromConfig = optionContainer(config, "test_guard")
  const inputs = { options, config: fromConfig }

  resolveGuardBase(resolvedTestGuard, "TEST_GUARD", inputs)

  resolvedTestGuard.testPatterns =
    resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", inputs) ?? [...DEFAULT_TEST_PATTERNS]

  resolvedTestGuard.testCommand =
    resolveOption(asString, "TEST_GUARD_TEST_COMMAND", "test_command", inputs) ?? detectTestCommand(projectDirectory)

  resolvedTestGuard.engine = resolveOption(asEngine, "TEST_GUARD_ENGINE", "engine", inputs) ?? "binary"

  resolveCommandAdapter(resolvedMutation, "TEST_GUARD_MUTATION", subConfigInputs(options, fromConfig, "mutation"))
  resolveJudge(resolvedJudge, "TEST_GUARD_JUDGE", subConfigInputs(options, fromConfig, "judge"))
  resolveCommandAdapter(resolvedParser, "TEST_GUARD_PARSER", subConfigInputs(options, fromConfig, "parser"))

  resolvedTestGuard.checks = resolveRuleConfig(DEFAULT_TEST_CHECKS, {
    envPrefix: "TEST_GUARD_",
    options,
    config: fromConfig,
    aliases: LEGACY_RULE_ALIASES,
  })
}

export async function createHooks(input: PluginHooksInput, options?: unknown): Promise<CommentCheckerHooks> {
  pluginOptions = canonicalizeOptions(options)
  if (input && typeof input === "object" && "directory" in input && typeof input.directory === "string") {
    projectDirectory = input.directory
  }
  resolveConfiguration()
  resolveTestGuardConfiguration()
  startBackgroundInit()
  startTestCheckerBackgroundInit()

  const commentGuard = createCommentGuard(() => resolvedCommentConfig)
  const testGuard = createTestGuard(() => resolvedTestGuard)
  const auditTool = createGuardAuditTool({ directory: projectDirectory, getConfig: () => resolvedTestGuard })
  const cleanupTool = createGuardCleanupTool({ directory: projectDirectory, getConfig: () => resolvedTestGuard })
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
  const advisories = new AdvisoryQueue()

  return {
    tool: {
      guard_audit: auditTool,
      guard_cleanup: cleanupTool,
      guard_judge: judgeTool,
      guard_parse: parseTool,
      guard_comment_judge: commentJudgeTool,
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID ?? ""
      const results = await analyzers.run("idle", { tool: "", sessionID })
      for (const result of results) {
        if (result.note) advisories.queue(result.note)
      }
    },
    "tool.execute.before": async (input, output) => {
      testGuard.before(input, output)
      await commentGuard.before(input, output)
    },
    "tool.execute.after": async (input, output) => {
      await commentGuard.after(input, output)
      await testGuard.after(input, output)
      appendAdvisories(output, advisories.consume())
    },
  }
}

// OpenCode V2 entrypoint. `setup` is the only adapter between the V2 host event
// shapes and the V1 hook contract the guards are written against.
export const CommentCheckerPlugin = Plugin.define({
  id: "opencode-comments-plugin",
  async setup(ctx) {
    // V1 handed the judge runner the SDK client. V2 exposes a stateless,
    // tool-free generation, which is exactly what the judge asked for (tools
    // disabled, explicit model), so no throwaway session is created: `create`
    // only mints the token the runner threads through create -> prompt -> delete.
    const client = {
      session: {
        create: async () => ({ data: { id: "opencode-comments-plugin-judge" } }),
        prompt: async (request: { body?: Record<string, any> }) => {
          const body = request?.body ?? {}
          const system = typeof body.system === "string" ? body.system : ""
          const parts = Array.isArray(body.parts) ? body.parts : []
          const user = parts
            .filter((part: any) => part && part.type === "text" && typeof part.text === "string")
            .map((part: any) => part.text as string)
            .join("\n")
          const prompt = system.length > 0 ? `${system}\n\n${user}` : user
          const configured = body.model
          const model =
            configured && typeof configured === "object" && typeof configured.modelID === "string"
              ? { providerID: String(configured.providerID), id: configured.modelID }
              : undefined
          const response = await ctx.generate.text(model === undefined ? { prompt } : { prompt, model })
          return { data: { parts: [{ type: "text", text: response?.text ?? "" }] } }
        },
        delete: async () => ({}),
      },
    }

    const hooks = await createHooks({ directory: ctx.location.directory, client }, ctx.options)

    await ctx.tool.hook("execute.before", event =>
      hooks["tool.execute.before"]?.(
        { tool: canonicalToolName(event.tool), sessionID: event.sessionID, callID: event.id },
        { args: (event.input ?? {}) as Record<string, unknown> },
      ),
    )

    await ctx.tool.hook("execute.after", async event => {
      const input = { tool: canonicalToolName(event.tool), sessionID: event.sessionID, callID: event.id }

      if (event.status === "error") {
        // V2 reports a failure as a tagged error with no result to append to.
        // Synthesise the V1 error text so the guards still skip the check (and
        // their per-call bookkeeping runs), then keep any advisory visible.
        const failure = `Error: ${event.error.message}`
        const output: ToolExecuteOutput = { title: "", output: failure, metadata: {} }
        await hooks["tool.execute.after"]?.(input, output)
        const delta = output.output.slice(failure.length)
        if (delta.length > 0) {
          try {
            ;(event.error as { message: string }).message += delta
          } catch {
            // A frozen host error loses an idle advisory; never fail the hook.
          }
        }
        return
      }

      const result = event.result
      const before = resultText(result)
      const output: ToolExecuteOutput = {
        title: "",
        output: before,
        metadata: canonicalPatchMetadata(result.metadata ?? {}, ctx.location.directory),
      }
      await hooks["tool.execute.after"]?.(input, output)
      if (output.output !== before) {
        event.result = { ...result, content: rewriteContent(result.content, before, output.output) as typeof result.content }
      }
    })

    await ctx.tool.transform(editor => {
      for (const [name, definition] of Object.entries(hooks.tool ?? {})) {
        editor.add({
          name,
          description: definition.description,
          input: tool.schema.toJSONSchema(tool.schema.object(definition.args)) as any,
          execute: async (args: any) => ({ content: await definition.execute(args) }),
        })
      }
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.idle") continue
          const sessionID = (event as { data?: { sessionID?: string } }).data?.sessionID ?? ""
          try {
            await hooks.event?.({ event: { type: event.type, properties: { sessionID } } })
          } catch (error) {
            console.error("[opencode-comments-plugin] idle advisory failed:", error)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-comments-plugin] event subscription failed:", error)
        }
      }
    })()

    // V1 registered `/guard-audit` by mutating the config in the `config` hook.
    // V2 has no config hook; commands are registered on the command domain, and
    // an existing command of the same name is left alone.
    const listed = await ctx.command.list()
    const commands: unknown[] = Array.isArray(listed)
      ? listed
      : ((listed as { data?: unknown }).data as unknown[]) ?? []
    const taken = new Set(
      commands
        .map((command: any) => command?.name)
        .filter((name): name is string => typeof name === "string"),
    )
    const definitions = [
      { name: "guard-audit", definition: GUARD_AUDIT_COMMAND },
      { name: "guard-cleanup", definition: GUARD_CLEANUP_COMMAND },
    ].filter(entry => !taken.has(entry.name))
    if (definitions.length > 0) {
      await ctx.command.transform(editor => {
        for (const { name, definition } of definitions) {
          editor.add({
            name,
            description: definition.description,
            execute: async ({ sessionID, prompt, delivery }) => {
              await ctx.session.prompt({ ...prompt, sessionID, text: definition.template, delivery })
            },
          })
        }
      })
    }

    return () => controller.abort()
  },
})

export default CommentCheckerPlugin

