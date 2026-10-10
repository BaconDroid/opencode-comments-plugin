// Config resolution shared by the comment guard and the test guard.
//
// opencode validates its config against a fixed schema and drops unknown
// top-level keys, so `comment_checker` / `test_guard` never reach the config
// hook. Plugin options are therefore passed as the second element of the
// plugin tuple:
//   "plugin": [["opencode-comments-plugin", { "comment_checker": {...}, "test_guard": {...} }]]
//
// Precedence for every option: environment > tuple options > config hook.

export type Severity = "off" | "warn"

// Detection engine for the test guard: the downloaded `test-checker` binary
// (default) or the in-process deterministic rules.
export type TestEngine = "binary" | "regex"

export function asEngine(value: unknown): TestEngine | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "binary" || normalized === "regex") return normalized
  return undefined
}

// Options shared by both guards, resolved with the env > options > config
// precedence. Each guard extends it with its own fields.
export interface GuardBaseConfig {
  enabled: boolean
  customPrompt?: string
  appendPrompt?: string
  maxWarningsPerFile: number
  dedupWindowMs?: number
  triggerTools?: Set<string>
}

// Options for an opt-in external command adapter (mutation testing, external
// parser). Both share the same shape.
export interface CommandAdapterConfig {
  enabled: boolean
  command?: string
  timeoutMs?: number
}

export function optionContainer(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const nested = object[key]
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return object
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export function asCount(value: unknown, minimum: number): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : undefined
}

export function asTools(value: unknown): string[] | undefined {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined
  if (!entries) return undefined
  const tools = entries
    .filter((entry): entry is string => typeof entry === "string")
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
  return tools.length > 0 ? tools : undefined
}

export function asPatterns(value: unknown): string[] | undefined {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined
  if (!entries) return undefined
  const patterns = entries
    .filter((entry): entry is string => typeof entry === "string")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
  return patterns.length > 0 ? patterns : undefined
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(normalized)) return true
    if (["0", "false", "no", "off"].includes(normalized)) return false
  }
  if (typeof value === "number") return value !== 0
  return fallback
}

export function asLevel(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "off" || normalized === "warn") return normalized
  return undefined
}

export interface ResolveInputs {
  options?: Record<string, unknown>
  config?: Record<string, unknown>
}

// Resolves one option with the env > options > config precedence.
export function resolveOption<T>(
  coerce: (value: unknown) => T | undefined,
  envKey: string,
  key: string,
  inputs: ResolveInputs,
): T | undefined {
  return (
    coerce(process.env[envKey]) ??
    coerce(inputs.options?.[key]) ??
    coerce(inputs.config?.[key])
  )
}

export interface RuleConfigSources {
  envPrefix: string
  options?: Record<string, unknown>
  config?: Record<string, unknown>
}

// Resolves a map of rule id -> severity. Defaults come from the schema; each
// rule can be overridden through TEST_GUARD_CHECK_<RULE> env, options.checks or
// config.checks.
export function resolveRuleConfig(
  schema: Record<string, Severity>,
  sources: RuleConfigSources,
): Record<string, Severity> {
  const optionsChecks = asRecord(sources.options?.checks)
  const configChecks = asRecord(sources.config?.checks)
  const resolved: Record<string, Severity> = {}

  for (const [rule, fallback] of Object.entries(schema)) {
    const envKey = `${sources.envPrefix}CHECK_${rule.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
    const level =
      asLevel(process.env[envKey]) ??
      asLevel(optionsChecks?.[rule]) ??
      asLevel(configChecks?.[rule]) ??
      fallback
    resolved[rule] = level
  }

  return resolved
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
