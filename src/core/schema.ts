// JSON schema for the plugin tuple options plus a tiny zero-dependency
// validator used by `guard validate-config`.

import { asCount, asLevel, asPatterns, asString, asTools } from "./config"

const SEVERITY = ["off", "warn", "block"]

export const TUPLE_OPTIONS_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "opencode-comments-plugin options",
  type: "object",
  properties: {
    comment_checker: {
      type: "object",
      additionalProperties: false,
      properties: {
        custom_prompt: { type: "string" },
        append_prompt: { type: "string" },
        max_warnings_per_file: { type: "integer", minimum: 0 },
        tools: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
        timeout_ms: { type: "integer", minimum: 1 },
      },
    },
    test_guard: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        test_patterns: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
        test_command: { type: ["string", "null"] },
        checks: {
          type: "object",
          additionalProperties: { type: "string", enum: SEVERITY },
        },
        max_warnings_per_file: { type: "integer", minimum: 0 },
        custom_prompt: { type: "string" },
        append_prompt: { type: "string" },
        tools: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
        mutation: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            command: { type: "string" },
            timeout_ms: { type: "integer", minimum: 1 },
          },
        },
        judge: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            model: { type: "string" },
            timeout_ms: { type: "integer", minimum: 1 },
          },
        },
        parser: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            command: { type: "string" },
            timeout_ms: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  },
} as const

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateTupleOptions(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["options must be an object"] }
  }

  const options = value as Record<string, unknown>
  const comment = options.comment_checker
  if (comment !== undefined) {
    if (!isRecord(comment)) errors.push("comment_checker must be an object")
    else validateCommentChecker(comment, "comment_checker", errors)
  }

  const guard = options.test_guard
  if (guard !== undefined) {
    if (!isRecord(guard)) errors.push("test_guard must be an object")
    else validateTestGuard(guard, "test_guard", errors)
  }

  return { valid: errors.length === 0, errors }
}

function validateCommentChecker(record: Record<string, unknown>, path: string, errors: string[]): void {
  for (const key of ["custom_prompt", "append_prompt"]) {
    if (record[key] !== undefined && asString(record[key]) === undefined) errors.push(`${path}.${key} must be a non-empty string`)
  }
  if (record.max_warnings_per_file !== undefined && asCount(record.max_warnings_per_file, 0) === undefined) {
    errors.push(`${path}.max_warnings_per_file must be an integer >= 0`)
  }
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`)
  }
  if (record.tools !== undefined && asTools(record.tools) === undefined) {
    errors.push(`${path}.tools must be a string array or a comma separated string`)
  }
  rejectUnknown(record, ["custom_prompt", "append_prompt", "max_warnings_per_file", "timeout_ms", "tools"], path, errors)
}

function validateTestGuard(record: Record<string, unknown>, path: string, errors: string[]): void {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`)
  if (record.test_patterns !== undefined && asPatterns(record.test_patterns) === undefined) {
    errors.push(`${path}.test_patterns must be a string array or a comma separated string`)
  }
  if (record.test_command !== undefined && record.test_command !== null && asString(record.test_command) === undefined) {
    errors.push(`${path}.test_command must be a string or null`)
  }
  if (record.max_warnings_per_file !== undefined && asCount(record.max_warnings_per_file, 0) === undefined) {
    errors.push(`${path}.max_warnings_per_file must be an integer >= 0`)
  }
  if (record.tools !== undefined && asTools(record.tools) === undefined) {
    errors.push(`${path}.tools must be a string array or a comma separated string`)
  }
  if (record.checks !== undefined) {
    if (!isRecord(record.checks)) errors.push(`${path}.checks must be an object`)
    else {
      for (const [rule, level] of Object.entries(record.checks)) {
        if (asLevel(level) === undefined) errors.push(`${path}.checks.${rule} must be one of ${SEVERITY.join(", ")}`)
      }
    }
  }
  if (record.custom_prompt !== undefined && asString(record.custom_prompt) === undefined) {
    errors.push(`${path}.custom_prompt must be a non-empty string`)
  }
  if (record.append_prompt !== undefined && asString(record.append_prompt) === undefined) {
    errors.push(`${path}.append_prompt must be a non-empty string`)
  }
  if (record.mutation !== undefined) {
    if (!isRecord(record.mutation)) errors.push(`${path}.mutation must be an object`)
    else validateMutation(record.mutation, `${path}.mutation`, errors)
  }
  if (record.judge !== undefined) {
    if (!isRecord(record.judge)) errors.push(`${path}.judge must be an object`)
    else validateJudge(record.judge, `${path}.judge`, errors)
  }
  if (record.parser !== undefined) {
    if (!isRecord(record.parser)) errors.push(`${path}.parser must be an object`)
    else validateParser(record.parser, `${path}.parser`, errors)
  }
  rejectUnknown(
    record,
    [
      "enabled",
      "test_patterns",
      "test_command",
      "checks",
      "max_warnings_per_file",
      "custom_prompt",
      "append_prompt",
      "tools",
      "mutation",
      "judge",
      "parser",
    ],
    path,
    errors,
  )
}

function validateMutation(record: Record<string, unknown>, path: string, errors: string[]): void {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`)
  if (record.command !== undefined && asString(record.command) === undefined) errors.push(`${path}.command must be a non-empty string`)
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`)
  }
  rejectUnknown(record, ["enabled", "command", "timeout_ms"], path, errors)
}

function validateJudge(record: Record<string, unknown>, path: string, errors: string[]): void {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`)
  if (record.model !== undefined && asString(record.model) === undefined) errors.push(`${path}.model must be a non-empty string`)
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`)
  }
  rejectUnknown(record, ["enabled", "model", "timeout_ms"], path, errors)
}

function validateParser(record: Record<string, unknown>, path: string, errors: string[]): void {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`)
  if (record.command !== undefined && asString(record.command) === undefined) errors.push(`${path}.command must be a non-empty string`)
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`)
  }
  rejectUnknown(record, ["enabled", "command", "timeout_ms"], path, errors)
}

function rejectUnknown(record: Record<string, unknown>, known: string[], path: string, errors: string[]): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) errors.push(`${path}.${key} is not a recognized option`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
