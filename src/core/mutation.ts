// Optional mutation-testing adapter (plan phase 2). It does not bundle a
// mutation engine: it runs a user-configured command and parses its report.
// Opt-in, fail-open, never destructive.

import { asRecord } from "./config"
import { runProcess } from "./runner"

export interface MutationSurvivor {
  file?: string
  line?: number
  mutator?: string
  status?: string
}

export interface MutationRun {
  ran: boolean
  survivors: MutationSurvivor[]
  error?: string
}

function isSurvivor(status: string): boolean {
  const normalized = status.toLowerCase()
  return normalized === "survived" || normalized === "nocoverage" || normalized === "no coverage" || normalized === "timeout"
}

// Understands the Stryker JSON reporter (`files[].mutants[]`) and a generic
// `{ "survivors": [...] }` shape.
export function parseMutationReport(raw: string): MutationSurvivor[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const root = asRecord(parsed)
  if (!root) return []

  const files = root.files
  if (Array.isArray(files) || asRecord(files)) {
    const survivors: MutationSurvivor[] = []
    const entries: Array<[string | undefined, unknown]> = Array.isArray(files)
      ? files.map(file => [asRecord(file)?.file as string | undefined, file])
      : Object.entries(asRecord(files)!)
    for (const [name, file] of entries) {
      const entry = asRecord(file)
      if (!entry || !Array.isArray(entry.mutants)) continue
      for (const mutant of entry.mutants) {
        const record = asRecord(mutant)
        if (!record) continue
        const status = typeof record.status === "string" ? record.status : ""
        if (!isSurvivor(status)) continue
        const location = asRecord(record.location)
        const start = location ? asRecord(location.start) : undefined
        survivors.push({
          file: typeof entry.file === "string" ? entry.file : name,
          line: start && typeof start.line === "number" ? start.line : undefined,
          mutator: typeof record.mutatorName === "string" ? record.mutatorName : undefined,
          status,
        })
      }
    }
    return survivors
  }

  if (Array.isArray(root.survivors)) {
    const survivors: MutationSurvivor[] = []
    for (const item of root.survivors) {
      const record = asRecord(item)
      if (!record) continue
      survivors.push({
        file: typeof record.file === "string" ? record.file : undefined,
        line: typeof record.line === "number" ? record.line : undefined,
        mutator: typeof record.mutator === "string" ? record.mutator : undefined,
        status: typeof record.status === "string" ? record.status : "survived",
      })
    }
    return survivors
  }

  return []
}

export async function runMutationCheck(command: string, options: { timeoutMs?: number } = {}): Promise<MutationRun> {
  if (!command.trim()) return { ran: false, survivors: [] }

  const outcome = await runProcess(["/bin/sh", "-c", command], { timeoutMs: options.timeoutMs })
  if (outcome === "timeout") return { ran: false, survivors: [], error: "timeout" }
  return { ran: true, survivors: parseMutationReport(outcome.stdout) }
}

export function formatSurvivors(survivors: MutationSurvivor[], max = 20): string {
  const lines = survivors.slice(0, max).map(survivor => {
    const location = `${survivor.file ?? "?"}${survivor.line ? `:${survivor.line}` : ""}`
    return `- ${location}${survivor.mutator ? ` (${survivor.mutator})` : ""}`
  })
  return `Mutation survivors detected (${survivors.length}):\n${lines.join("\n")}\n\nAdd or strengthen tests to kill them.`
}
