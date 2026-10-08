#!/usr/bin/env bun
// opencode-comments-plugin CLI: CI parity and config validation.
//
//   opencode-comments-plugin guard check [--diff] [--base <rev>] [--json] [--include-advisory]
//   opencode-comments-plugin guard validate-config [file]
//   opencode-comments-plugin guard audit [--scope comments|tests|both] [--paths a,b] [--json]

import { readFileSync } from "node:fs"
import { runCommentDiffCheck, runDiffCheck } from "./core/ci"
import { validateTupleOptions } from "./core/schema"
import { detectTestCommand } from "./core/test-command"
import { runAudit } from "./audit"

interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=")
      if (inline !== undefined) flags[key!] = inline
      else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
        flags[key!] = argv[i + 1]!
        i += 1
      } else flags[key!] = true
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags }
}

function validateConfigCommand(path: string | undefined): number {
  let raw: string
  try {
    raw = path ? readFileSync(path, "utf8") : readFileSync(0, "utf8")
  } catch (err) {
    process.stderr.write(`cannot read config: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    process.stderr.write(`config is not valid JSON: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  const result = validateTupleOptions(parsed)
  if (result.valid) {
    process.stdout.write("config is valid\n")
    return 0
  }
  process.stderr.write(`config has ${result.errors.length} error(s):\n`)
  for (const error of result.errors) process.stderr.write(`  - ${error}\n`)
  return 1
}

async function auditCommand(parsed: ParsedArgs): Promise<number> {
  const scope = (parsed.flags.scope as string | undefined) ?? "both"
  if (scope !== "comments" && scope !== "tests" && scope !== "both") {
    process.stderr.write("--scope must be comments, tests or both\n")
    return 2
  }
  const paths = typeof parsed.flags.paths === "string" ? parsed.flags.paths.split(",").map(p => p.trim()).filter(Boolean) : undefined
  const format = parsed.flags.json ? "json" : "markdown"
  const output = await runAudit({
    scope,
    paths,
    format,
    includeAdvisory: Boolean(parsed.flags["include-advisory"]),
    directory: process.cwd(),
    getConfig: () => ({
      enabled: true,
      testPatterns: [],
      testCommand: detectTestCommand(process.cwd()),
      checks: {},
      maxWarningsPerFile: 0,
    }),
  })
  process.stdout.write(`${output}\n`)
  return 0
}

async function checkCommand(parsed: ParsedArgs): Promise<number> {
  const base = typeof parsed.flags.base === "string" ? parsed.flags.base : "HEAD"
  const scope = (parsed.flags.scope as string | undefined) ?? "tests"
  if (scope !== "tests" && scope !== "comments" && scope !== "both") {
    process.stderr.write("--scope must be tests, comments or both\n")
    return 2
  }
  const format = parsed.flags.json ? "json" : "markdown"
  const includeAdvisory = Boolean(parsed.flags["include-advisory"])

  const parts: string[] = []
  let failed = false

  if (scope === "tests" || scope === "both") {
    const result = runDiffCheck({ directory: process.cwd(), base, includeAdvisory, format })
    parts.push(result.output)
    if (result.findings.length > 0) failed = true
  }

  if (scope === "comments" || scope === "both") {
    const result = await runCommentDiffCheck({ directory: process.cwd(), base, format })
    parts.push(result.output)
    if (result.count > 0) failed = true
  }

  process.stdout.write(`${parts.join("\n\n")}\n`)
  return failed ? 1 : 0
}

function usage(): void {
  process.stdout.write(
    [
      "opencode-comments-plugin guard <command>",
      "",
      "  check [--diff] [--base <rev>] [--scope tests|comments|both] [--json] [--include-advisory]",
      "  validate-config [file]",
      "  audit [--scope comments|tests|both] [--paths a,b] [--json] [--include-advisory]",
      "",
    ].join("\n"),
  )
}

async function main(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv
  if (group !== "guard") {
    usage()
    return group ? 2 : 0
  }

  const parsed = parseArgs(rest)
  switch (command) {
    case "check":
      return checkCommand(parsed)
    case "validate-config":
      return validateConfigCommand(parsed.positionals[0])
    case "audit":
      return auditCommand(parsed)
    default:
      usage()
      return command ? 2 : 0
  }
}

main(process.argv.slice(2))
  .then(code => {
    process.exitCode = code
  })
  .catch(err => {
    process.stderr.write(`guard failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 3
  })
