import { test, expect, beforeEach, afterEach } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCommentGuard, type ResolvedCommentConfig } from "./index"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "comment-guard-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function config(overrides: Partial<ResolvedCommentConfig> = {}): ResolvedCommentConfig {
  return {
    enabled: true,
    maxWarningsPerFile: 0,
    dedupWindowMs: 0,
    triggerTools: new Set(["write"]),
    paths: [],
    timeoutMs: 200,
    ...overrides,
  }
}

function fakeBinary(code: number): string {
  const path = join(dir, `fake-comment-checker-${code}`)
  writeFileSync(path, `#!/bin/sh\ncat > /dev/null\nexit ${code}\n`)
  chmodSync(path, 0o755)
  return path
}

function hangingBinary(): string {
  const path = join(dir, "fake-comment-checker-hang")
  writeFileSync(path, "#!/bin/sh\nsleep 30\n")
  chmodSync(path, 0o755)
  return path
}

type Output = { title: string; output: string; metadata: unknown }

const BASE = "Wrote file successfully."

function makeGuard(cliPath: string) {
  return createCommentGuard(() => config(), { resolvePath: async () => cliPath })
}

async function writeWithComment(guard: ReturnType<typeof makeGuard>, sessionID: string, callID: string): Promise<Output> {
  await guard.before(
    { tool: "write", sessionID, callID },
    { args: { filePath: "/work/a.ts", content: "const a = 1\n// explain\n" } },
  )
  const output: Output = { title: "", output: BASE, metadata: {} }
  await guard.after({ tool: "write", sessionID, callID }, output)
  return output
}

const DID_NOT_RUN_CASES = [
  { label: "exit 1", path: () => fakeBinary(1), reason: "exited with code 1" },
  { label: "exit 127", path: () => fakeBinary(127), reason: "exited with code 127" },
  { label: "ENOENT", path: () => join(dir, "missing-comment-checker"), reason: "binary not found" },
  { label: "timeout", path: hangingBinary, reason: "timed out or could not be spawned" },
] as const

for (const scenario of DID_NOT_RUN_CASES) {
  test(`comment guard warns once per session and does not block when the checker did not run (${scenario.label})`, async () => {
    const guard = makeGuard(scenario.path())
    const session = `comment-did-not-run-${scenario.label}`

    const first = await writeWithComment(guard, session, `first-${scenario.label}`)
    expect(first.output).toContain("comment-checker did not run — nothing checked this write.")
    expect(first.output).toContain(scenario.reason)
    expect(first.output.startsWith(BASE)).toBe(true)

    const second = await writeWithComment(guard, session, `second-${scenario.label}`)
    expect(second.output).toBe(BASE)
    expect(second.output).not.toContain("did not run")
  }, 20_000)
}
