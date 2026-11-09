import { test, expect, beforeEach } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APPLY_PATCH_TOOL_NAME, COMMENT_CHECKER_FALLBACK_VERSION } from "./constants"
import { CommentCheckerPlugin, createHooks } from "./index"
import { TEST_GUARD_MARKER } from "./core/feedback"
import type { HookInput } from "./types"

const cacheRoot = mkdtempSync(join(tmpdir(), "comment-checker-hook-"))
process.env.XDG_CACHE_HOME = cacheRoot

const version = COMMENT_CHECKER_FALLBACK_VERSION

const modePath = join(cacheRoot, "mode")
const logPath = join(cacheRoot, "log")
const cacheBase = join(cacheRoot, "opencode-comments-plugin", "bin")
const binaryDir = join(cacheBase, version)
const binaryPath = join(binaryDir, process.platform === "win32" ? "comment-checker.exe" : "comment-checker")

mkdirSync(binaryDir, { recursive: true })
writeFileSync(join(cacheBase, "latest.json"), JSON.stringify({ version, checkedAt: Date.now() }))
writeFileSync(binaryPath, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "comment-checker ${version}"; exit 0; fi
{
  printf 'ARGS:'
  printf '%s\\037' "$@"
  printf '\\nACQUIT:%s' "\${COMMENT_CHECKER_KEYWORD_ACQUIT:-}"
  printf '\\nSTDIN:'
  cat
  printf '\\036===END===\\036\\n'
} >> '${logPath}'
case "$(cat '${modePath}')" in
  clean) exit 0 ;;
  *) printf '%s' "COMMENT/DOCSTRING DETECTED" >&2; exit 2 ;;
esac
`)
chmodSync(binaryPath, 0o755)

// Stub `test-checker` binary for the default (binary) test-guard engine. Planted
// in the separate test-checker cache and driven by a mode file, so the exit-0 /
// exit-2 paths are deterministic without touching the network. On findings it
// mirrors the real contract: a human message plus a `<findings>` XML block on
// stderr and exit 2; on success a message on stderr and exit 0.
const testVersion = "0.1.0"
const testCacheBase = join(cacheRoot, "opencode-comments-plugin", "test-checker")
const testBinaryDir = join(testCacheBase, testVersion)
const testBinaryPath = join(testBinaryDir, process.platform === "win32" ? "test-checker.exe" : "test-checker")
const testModePath = join(cacheRoot, "test-mode")

mkdirSync(testBinaryDir, { recursive: true })
writeFileSync(join(testCacheBase, "latest.json"), JSON.stringify({ version: testVersion, checkedAt: Date.now() }))
writeFileSync(testBinaryPath, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "test-checker ${testVersion}"; exit 0; fi
cat > /dev/null
case "$(cat '${testModePath}')" in
  clean) printf '%s\\n' 'TEST QUALITY DETECTED: no weakened tests.' >&2; exit 0 ;;
  *) printf '%s\\n' 'TEST QUALITY DETECTED' '<findings file="/work/a.test.ts"><finding line-number="2" rule="skip-focus-added" confidence="high">Focused test added.</finding></findings>' >&2; exit 2 ;;
esac
`)
chmodSync(testBinaryPath, 0o755)

const RECORD_SEP = "\u001e"
const UNIT_SEP = "\u001f"
const RECORD_END = `${RECORD_SEP}===END===${RECORD_SEP}\n`

type BeforeInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: unknown }

interface CommentCheckerHooks {
  event?: (input: { event: { type: string } }) => Promise<void>
  tool?: Record<string, unknown>
  "tool.execute.before": (input: BeforeInput, output: { args: Record<string, unknown> }) => Promise<void>
  "tool.execute.after": (input: BeforeInput, output: AfterOutput) => Promise<void>
}

interface Invocation {
  args: string[]
  keywordAcquit: string
  input: HookInput
}

const TOOL_AFTER_INPUT = { tool: "write", sessionID: "session-1", callID: "call-1" }

const pluginFactory = createHooks as unknown as (
  input: unknown,
  options?: unknown,
) => Promise<CommentCheckerHooks>

async function newSession(options?: unknown): Promise<CommentCheckerHooks> {
  return await pluginFactory({}, options)
}

// --- V2 host harness --------------------------------------------------------
//
// Runs the real `setup` against a stand-in host context so the V2 adapters
// (event shapes, tool names, patch metadata, command registration) are covered
// without a running opencode server.

function createHost(options?: unknown, existingCommands: { name: string; description?: string }[] = []) {
  const hooks: Record<string, (event: any) => any> = {}
  const tools: any[] = []
  const commands: any[] = []
  const prompts: any[] = []
  const idles: string[] = []
  let wake: (() => void) | undefined
  let subscribeCalls = 0

  const ctx = {
    location: { directory: process.cwd() },
    options: options ?? {},
    generate: { text: async () => ({ text: "" }) },
    session: {
      prompt: async (input: any) => {
        prompts.push(input)
        return {}
      },
    },
    tool: {
      hook: async (name: string, callback: (event: any) => any) => {
        hooks[name] = callback
        return { dispose: async () => {} }
      },
      transform: async (callback: (editor: any) => void) => {
        callback({
          add: (definition: any) => tools.push(definition),
          list: () => [],
          get: () => undefined,
          namespace: () => {},
          update: () => {},
          remove: () => {},
        })
        return { dispose: async () => {} }
      },
    },
    command: {
      list: async () => existingCommands,
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (definition: any) => commands.push(definition) })
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: (subscribeOptions?: { signal?: AbortSignal }) => {
        subscribeCalls += 1
        const signal = subscribeOptions?.signal
        return (async function* () {
          while (!signal?.aborted) {
            if (idles.length === 0) {
              await new Promise<void>(resolve => {
                wake = resolve
                signal?.addEventListener("abort", () => resolve(), { once: true })
              })
              continue
            }
            yield { type: "session.idle", data: { sessionID: idles.shift() } }
          }
        })()
      },
    },
  }

  return {
    ctx,
    existingCommands,
    tools,
    commands,
    prompts,
    before: (event: any) => hooks["execute.before"]!(event),
    after: (event: any) => hooks["execute.after"]!(event),
    subscribeCalls: () => subscribeCalls,
    pushIdle: (sessionID: string) => {
      idles.push(sessionID)
      wake?.()
    },
  }
}

async function newV2Session(
  options?: unknown,
  existingCommands?: { name: string; description?: string }[],
): Promise<{ cleanup: (() => void) | void } & ReturnType<typeof createHost>> {
  const host = createHost(options, existingCommands)
  const cleanup = await (CommentCheckerPlugin as any).setup(host.ctx)
  return { ...host, cleanup }
}

async function cliInvocations(): Promise<Invocation[]> {
  const text = await Bun.file(logPath).text()
  return text
    .split(RECORD_END)
    .filter(block => block.length > 0)
    .map(block => {
      const acquitLabel = "\nACQUIT:"
      const acquitSeparator = block.indexOf(acquitLabel)
      const argsPart = block.slice("ARGS:".length, acquitSeparator)
      const acquitStart = acquitSeparator + acquitLabel.length
      const separator = block.indexOf("\nSTDIN:", acquitStart)
      return {
        args: argsPart.split(UNIT_SEP).filter(arg => arg.length > 0),
        keywordAcquit: block.slice(acquitStart, separator),
        input: JSON.parse(block.slice(separator + "\nSTDIN:".length)) as HookInput,
      }
    })
}

function writeOutput(output: string): AfterOutput {
  return { title: "", output, metadata: {} }
}

function writeArgs(content: string): { args: Record<string, unknown> } {
  return { args: { filePath: "/tmp/file.ts", content } }
}

function editArgs(
  filePath: string,
  oldString: string,
  newString: string,
): { args: Record<string, unknown> } {
  return { args: { filePath, oldString, newString } }
}

const ENV_KEYS = [
  "COMMENT_CHECKER_CUSTOM_PROMPT",
  "COMMENT_CHECKER_APPEND_PROMPT",
  "COMMENT_CHECKER_MAX_WARNINGS_PER_FILE",
  "COMMENT_CHECKER_TOOLS",
  "COMMENT_CHECKER_TIMEOUT_MS",
  "COMMENT_CHECKER_KEYWORD_ACQUIT",
  "TEST_GUARD_ENGINE",
] as const

beforeEach(() => {
  writeFileSync(logPath, "")
  writeFileSync(modePath, "comment")
  writeFileSync(testModePath, "findings")
  for (const key of ENV_KEYS) delete process.env[key]
})

test("appends the comment warning to the output of a write that added comments", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("const a = 1\n// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe("Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED")
  const calls = await cliInvocations()
  expect(calls).toHaveLength(1)
  expect(calls[0]!.input).toMatchObject({
    tool_name: "Write",
    hook_event_name: "PostToolUse",
    cwd: process.cwd(),
    tool_input: {
      file_path: "/tmp/file.ts",
      content: "const a = 1\n// explain\n",
    },
  })
})

test("keeps the output untouched when the CLI reports no comments", async () => {
  writeFileSync(modePath, "clean")
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("const a = 1\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe("Wrote file successfully.")
  expect(await cliInvocations()).toHaveLength(1)
})

test("keeps the output untouched when the tool itself failed", async () => {
  const hooks = await newSession()
  const output = writeOutput("Error: file not found")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe("Error: file not found")
  expect(await cliInvocations()).toHaveLength(0)
})

test("still checks a file whose content contains \"error:\" after a successful write", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("throw new Error(\"error: boom\")\n// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  expect(await cliInvocations()).toHaveLength(1)
})

test("ignores tools that do not write files", async () => {
  const hooks = await newSession()
  const output = writeOutput("file contents")

  await hooks["tool.execute.before"]({ tool: "read", sessionID: "session-1", callID: "call-2" }, {
    args: { filePath: "/tmp/file.ts" },
  })
  await hooks["tool.execute.after"]({ tool: "read", sessionID: "session-1", callID: "call-2" }, output)
  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "session-1", callID: "call-3" }, output)

  expect(output.output).toBe("file contents")
  expect(await cliInvocations()).toHaveLength(0)
})

test("forwards the custom prompt from the comment_checker options", async () => {
  const hooks = await newSession({ comment_checker: { custom_prompt: "DETECTED:\n{{comments}}\nFix it." } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  const calls = await cliInvocations()
  expect(calls[0]!.args).toContain("--prompt")
  expect(calls[0]!.args).toContain("DETECTED:\n{{comments}}\nFix it.")
})
test("runs without a prompt when the options have none", async () => {
  const hooks = await newSession({})
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  const calls = await cliInvocations()
  expect(calls[0]!.args).toEqual([])
})

test("stops warning about a file once max_warnings_per_file is reached", async () => {
  const hooks = await newSession({ comment_checker: { max_warnings_per_file: 2, dedup_window_ms: 0 } })
  const session = "session-capped"

  for (let i = 0; i < 3; i++) {
    const output = writeOutput("Wrote file successfully.")
    await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: `warn-${i}` }, writeArgs("// explain\n"))
    await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: `warn-${i}` }, output)
    expect(output.output).toBe(i < 2 ? "Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED" : "Wrote file successfully.")
  }

  const otherFile = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "warn-other" }, {
    args: { filePath: "/tmp/other.ts", content: "// explain\n" },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "warn-other" }, otherFile)
  expect(otherFile.output).toContain("COMMENT/DOCSTRING DETECTED")

  const otherSession = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: "session-uncapped", callID: "warn-other-session" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "session-uncapped", callID: "warn-other-session" }, otherSession)
  expect(otherSession.output).toContain("COMMENT/DOCSTRING DETECTED")

  expect((await cliInvocations()).length).toBe(4)
})

test("reads max_warnings_per_file from the environment when the config cannot carry it", async () => {
  process.env.COMMENT_CHECKER_MAX_WARNINGS_PER_FILE = "1"
  const hooks = await newSession()
  const session = "session-env-capped"

  const first = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "env-1" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "env-1" }, first)
  expect(first.output).toContain("COMMENT/DOCSTRING DETECTED")

  const second = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "env-2" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "env-2" }, second)
  expect(second.output).toBe("Wrote file successfully.")

  const third = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "env-3" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "env-3" }, third)
  expect(third.output).toBe("Wrote file successfully.")

  expect(await cliInvocations()).toHaveLength(1)
})

test("warns without a limit when max_warnings_per_file is not configured", async () => {
  const hooks = await newSession({ comment_checker: { dedup_window_ms: 0 } })

  for (let i = 0; i < 4; i++) {
    const output = writeOutput("Wrote file successfully.")
    await hooks["tool.execute.before"]({ tool: "write", sessionID: "session-1", callID: `unlimited-${i}` }, writeArgs("// explain\n"))
    await hooks["tool.execute.after"]({ tool: "write", sessionID: "session-1", callID: `unlimited-${i}` }, output)
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  }

  expect(await cliInvocations()).toHaveLength(4)
})

test("checks the added lines of every patched file and skips deletions", async () => {
  const hooks = await newSession()
  const output = writeOutput("Success. Updated the following files:\nM src/a.ts\nA src/b.ts")
  output.metadata = {
    files: [
      {
        type: "delete",
        filePath: "/work/src/gone.ts",
        relativePath: "src/gone.ts",
        patch: "@@ -1 +0,0 @@\n-// removed\n",
        additions: 0,
        deletions: 1,
      },
      {
        type: "update",
        filePath: "/work/src/a.ts",
        relativePath: "src/a.ts",
        patch: "@@ -2 +2 @@\n const a = 1\n-// old\n+// added by patch\n const b = 2\n",
        additions: 1,
        deletions: 1,
      },
      {
        type: "add",
        filePath: "/work/src/b.ts",
        relativePath: "src/b.ts",
        patch: "@@ -0,0 +1,2 @@\n+// header\n+export const b = 2\n",
        additions: 2,
        deletions: 0,
      },
    ],
  }

  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "session-1", callID: "patch-1" }, output)

  const calls = await cliInvocations()
  expect(calls).toHaveLength(2)
  expect(calls[0]!.input.tool_input).toEqual({
    file_path: "/work/src/a.ts",
    old_string: "// old",
    new_string: "// added by patch",
  })
  expect(calls[1]!.input.tool_input).toEqual({
    file_path: "/work/src/b.ts",
    old_string: "",
    new_string: "// header\nexport const b = 2",
  })
  expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
})

test("uses the destination path of a moved file in a patch", async () => {
  const hooks = await newSession()
  const output = writeOutput("Success. Updated the following files:")
  output.metadata = {
    files: [
      {
        type: "move",
        filePath: "/work/src/old.ts",
        movePath: "/work/src/new.ts",
        relativePath: "src/new.ts",
        patch: "@@ -1 +1 @@\n-const a = 1\n+const a = 2 // moved\n",
        additions: 1,
        deletions: 1,
      },
    ],
  }

  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "session-1", callID: "patch-2" }, output)

  const calls = await cliInvocations()
  expect(calls).toHaveLength(1)
  expect(calls[0]!.input.tool_input.file_path).toBe("/work/src/new.ts")
})

test("ignores a patch entry without added lines", async () => {
  const hooks = await newSession()
  const output = writeOutput("Success. Updated the following files:")
  output.metadata = {
    files: [
      {
        type: "update",
        filePath: "/work/src/a.ts",
        relativePath: "src/a.ts",
        patch: "@@ -1 +0,0 @@\n-const a = 1\n",
        additions: 0,
        deletions: 1,
      },
    ],
  }

  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "session-1", callID: "patch-3" }, output)

  expect(await cliInvocations()).toHaveLength(0)
})

test("ignores a failed apply_patch call", async () => {
  const hooks = await newSession()
  const output = writeOutput("Error: patch rejected: empty patch")
  output.metadata = { files: [{ type: "add", filePath: "/work/src/a.ts", patch: "@@ -0,0 +1 @@\n+// header\n" }] }

  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "session-1", callID: "patch-4" }, output)

  expect(await cliInvocations()).toHaveLength(0)
})

test("reports the edit arguments of an edit tool call", async () => {
  const hooks = await newSession()
  const output = writeOutput("The file has been updated.")

  await hooks["tool.execute.before"](
    { tool: "edit", sessionID: "session-1", callID: "edit-1" },
    editArgs("/work/src/a.ts", "const a = 1", "// added\nconst a = 1"),
  )
  await hooks["tool.execute.after"]({ tool: "edit", sessionID: "session-1", callID: "edit-1" }, output)

  const calls = await cliInvocations()
  expect(calls[0]!.input).toMatchObject({
    tool_name: "Edit",
    tool_input: { file_path: "/work/src/a.ts", old_string: "const a = 1", new_string: "// added\nconst a = 1" },
  })
})

test("reads the custom prompt from the plugin options", async () => {
  const hooks = await newSession({ comment_checker: { custom_prompt: "FROM OPTIONS" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect((await cliInvocations())[0]!.args).toContain("FROM OPTIONS")
})

test("lets an environment variable override the plugin options", async () => {
  process.env.COMMENT_CHECKER_CUSTOM_PROMPT = "FROM ENV"
  const hooks = await newSession({ comment_checker: { custom_prompt: "FROM OPTIONS" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  const calls = await cliInvocations()
  expect(calls[0]!.args).toContain("FROM ENV")
  expect(calls[0]!.args).not.toContain("FROM OPTIONS")
})

test("sends the default keyword_acquit mode to the CLI", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect((await cliInvocations())[0]!.keywordAcquit).toBe("proven-only")
})

test("reads keyword_acquit from the plugin options", async () => {
  const hooks = await newSession({ comment_checker: { keyword_acquit: "never" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect((await cliInvocations())[0]!.keywordAcquit).toBe("never")
})

test("lets an environment variable override the keyword_acquit option", async () => {
  process.env.COMMENT_CHECKER_KEYWORD_ACQUIT = "never"
  const hooks = await newSession({ comment_checker: { keyword_acquit: "proven-only" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect((await cliInvocations())[0]!.keywordAcquit).toBe("never")
})

test("reads max_warnings_per_file from the plugin options", async () => {
  const hooks = await newSession({ comment_checker: { max_warnings_per_file: 1 } })
  const session = "session-options-capped"

  const first = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "opt-1" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "opt-1" }, first)
  expect(first.output).toContain("COMMENT/DOCSTRING DETECTED")

  const second = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "opt-2" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "opt-2" }, second)
  expect(second.output).toBe("Wrote file successfully.")
})

test("restricts the checked tools with the tools option", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["write"] } })

  const editOutput = writeOutput("The file has been updated.")
  await hooks["tool.execute.before"]({ tool: "edit", sessionID: "s", callID: "e1" }, editArgs("/tmp/file.ts", "a", "// b"))
  await hooks["tool.execute.after"]({ tool: "edit", sessionID: "s", callID: "e1" }, editOutput)
  expect(editOutput.output).toBe("The file has been updated.")

  const patchOutput = writeOutput("Success. Updated the following files:")
  patchOutput.metadata = { files: [{ type: "add", filePath: "/tmp/file.ts", patch: "@@ -0,0 +1 @@\n+// header\n" }] }
  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "s", callID: "p1" }, patchOutput)
  expect(patchOutput.output).toBe("Success. Updated the following files:")
  expect(await cliInvocations()).toHaveLength(0)

  const writeResult = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, writeResult)
  expect(writeResult.output).toContain("COMMENT/DOCSTRING DETECTED")
  expect(await cliInvocations()).toHaveLength(1)
})

test("accepts a comma separated tool list from the environment", async () => {
  process.env.COMMENT_CHECKER_TOOLS = "write,edit"
  const hooks = await newSession()

  const patchOutput = writeOutput("Success. Updated the following files:")
  patchOutput.metadata = { files: [{ type: "add", filePath: "/tmp/file.ts", patch: "@@ -0,0 +1 @@\n+// header\n" }] }
  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "s", callID: "p2" }, patchOutput)

  expect(patchOutput.output).toBe("Success. Updated the following files:")
  expect(await cliInvocations()).toHaveLength(0)
})

test("appends append_prompt after the CLI message", async () => {
  const hooks = await newSession({ comment_checker: { append_prompt: "Be concise, specific, and direct by default." } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe(
    "Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED\n\nBe concise, specific, and direct by default.",
  )
})

test("appends nothing unless append_prompt is set", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe("Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED")
})

test("lets the environment override append_prompt", async () => {
  process.env.COMMENT_CHECKER_APPEND_PROMPT = "FROM ENV"
  const hooks = await newSession({ comment_checker: { append_prompt: "FROM OPTIONS" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toContain("\n\nFROM ENV")
  expect(output.output).not.toContain("FROM OPTIONS")
})

test("appends append_prompt on top of a custom prompt", async () => {
  const hooks = await newSession({ comment_checker: { custom_prompt: "CUSTOM", append_prompt: "SUFFIX" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect((await cliInvocations())[0]!.args).toContain("CUSTOM")
  expect(output.output).toBe("Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED\n\nSUFFIX")
})

test("only checks files matching comment_checker.paths", async () => {
  const hooks = await newSession({ comment_checker: { paths: ["**/*.ts"] } })

  const skipped = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: "s", callID: "paths-1" }, {
    args: { filePath: "/tmp/notes.md", content: "// explain\n" },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "s", callID: "paths-1" }, skipped)
  expect(skipped.output).toBe("Wrote file successfully.")

  const checked = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: "s", callID: "paths-2" }, {
    args: { filePath: "/tmp/app.ts", content: "// explain\n" },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "s", callID: "paths-2" }, checked)
  expect(checked.output).toContain("COMMENT/DOCSTRING DETECTED")

  expect(await cliInvocations()).toHaveLength(1)
})

test("does not run the comment check when the comment guard is disabled", async () => {
  const hooks = await newSession({ comment_checker: { enabled: false } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toBe("Wrote file successfully.")
  expect(await cliInvocations()).toHaveLength(0)
})

test("dedups comment warnings by default", async () => {
  const hooks = await newSession({ comment_checker: {} })
  const session = "session-dedup-default"

  for (let i = 0; i < 2; i++) {
    const output = writeOutput("Wrote file successfully.")
    await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: `dedup-default-${i}` }, writeArgs("// explain\n"))
    await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: `dedup-default-${i}` }, output)
    expect(output.output).toBe(i === 0 ? "Wrote file successfully.\n\nCOMMENT/DOCSTRING DETECTED" : "Wrote file successfully.")
  }

  expect(await cliInvocations()).toHaveLength(1)
})

test("dedups comment warnings when dedup_window_ms is set", async () => {
  const hooks = await newSession({ comment_checker: { dedup_window_ms: 60_000 } })
  const session = "session-dedup-on"

  const first = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "dedup-on-1" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "dedup-on-1" }, first)
  expect(first.output).toContain("COMMENT/DOCSTRING DETECTED")

  const second = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: session, callID: "dedup-on-2" }, writeArgs("// explain\n"))
  await hooks["tool.execute.after"]({ tool: "write", sessionID: session, callID: "dedup-on-2" }, second)
  expect(second.output).toBe("Wrote file successfully.")
  expect(await cliInvocations()).toHaveLength(1)
})

test("suppresses the warning when the file has a comment-guard-disable-file marker", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// comment-guard-disable-file\n// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).not.toContain("COMMENT/DOCSTRING DETECTED")
  expect(output.output).toContain("Comment guard bypass recorded")
  expect(await cliInvocations()).toHaveLength(0)
})

test("suppresses the warning when an added comment is covered by an allow marker", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// comment-guard: allow legacy\n// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).not.toContain("COMMENT/DOCSTRING DETECTED")
  expect(await cliInvocations()).toHaveLength(0)
})

test("still warns when the allow marker is out of range", async () => {
  const hooks = await newSession()
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\nconst a = 1\nconst b = 2\nconst c = 3\n// comment-guard: allow x\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  expect(await cliInvocations()).toHaveLength(1)
})

// --- test guard (coexistence with the comment guard) ---

test("registers the guard tools", async () => {
  const hooks = await newSession()
  expect(hooks.tool!.guard_audit).toBeDefined()
  expect(hooks.tool!.guard_cleanup).toBeDefined()
  expect(hooks.tool!.guard_judge).toBeDefined()
  expect(hooks.tool!.guard_parse).toBeDefined()
  expect(hooks.tool!.guard_comment_judge).toBeDefined()
})

test("default export is a v2 plugin definition", () => {
  const definition = CommentCheckerPlugin as unknown as { id?: string; setup?: unknown }
  expect(definition.id).toBe("opencode-guard-plugin")
  expect(typeof definition.setup).toBe("function")
})

test("registers the guard tools on the v2 tool domain", async () => {
  const host = await newV2Session()
  expect(host.tools.map(tool => tool.name)).toEqual([
    "guard_audit",
    "guard_cleanup",
    "guard_judge",
    "guard_parse",
    "guard_comment_judge",
  ])
  for (const tool of host.tools) {
    expect(tool.input).toMatchObject({ type: "object" })
    expect(typeof tool.execute).toBe("function")
  }

  const judge = host.tools.find(tool => tool.name === "guard_judge")!
  await expect(judge.execute({})).resolves.toMatchObject({ content: expect.stringContaining("disabled") })
  host.cleanup?.()
})

test("registers the guard commands without overwriting existing commands", async () => {
  const host = await newV2Session(undefined, [{ name: "build", description: "build it" }])
  expect(host.commands.map(command => command.name)).toEqual(["guard-audit", "guard-cleanup"])
  expect(host.existingCommands).toEqual([{ name: "build", description: "build it" }])
  host.cleanup?.()
})

test("leaves an existing /guard-audit command alone", async () => {
  const host = await newV2Session(undefined, [{ name: "guard-audit", description: "mine" }])
  expect(host.commands.map(command => command.name)).toEqual(["guard-cleanup"])
  host.cleanup?.()
})

test("leaves an existing /guard-cleanup command alone", async () => {
  const host = await newV2Session(undefined, [{ name: "guard-cleanup", description: "mine" }])
  expect(host.commands.map(command => command.name)).toEqual(["guard-audit"])
  host.cleanup?.()
})

test("registers neither guard command when both already exist", async () => {
  const host = await newV2Session(undefined, [
    { name: "guard-audit", description: "mine" },
    { name: "guard-cleanup", description: "mine" },
  ])
  expect(host.commands).toHaveLength(0)
  host.cleanup?.()
})

test("the /guard-audit command prompts the session with the audit template", async () => {
  const host = await newV2Session()
  const command = host.commands.find(entry => entry.name === "guard-audit")!
  await command.execute({ sessionID: "session-audit", prompt: { text: "ignored" }, delivery: "steer" })

  expect(host.prompts).toHaveLength(1)
  expect(host.prompts[0]).toMatchObject({ sessionID: "session-audit", delivery: "steer" })
  expect(host.prompts[0].text).toContain("guard_audit")
  host.cleanup?.()
})

test("the /guard-cleanup command prompts the session with the cleanup template", async () => {
  const host = await newV2Session()
  const command = host.commands.find(entry => entry.name === "guard-cleanup")!
  await command.execute({ sessionID: "session-cleanup", prompt: { text: "ignored" }, delivery: "steer" })

  expect(host.prompts).toHaveLength(1)
  expect(host.prompts[0]).toMatchObject({ sessionID: "session-cleanup", delivery: "steer" })
  expect(host.prompts[0].text).toContain("guard_cleanup")
  expect(host.prompts[0].text).toContain(".test-checker.json")
  host.cleanup?.()
})

test("v2 execute.after appends the warning to result.content", async () => {
  const host = await newV2Session()
  const event: any = {
    tool: "write",
    sessionID: "session-v2",
    agent: "build",
    messageID: "message-v2",
    id: "v2-write-1",
    input: { path: "/tmp/v2-file.ts", content: "// explain\n" },
    status: "completed",
    result: { content: [{ type: "text", text: "Wrote file successfully." }], metadata: undefined },
  }

  await host.before(event)
  await host.after(event)

  expect(event.result.content).toEqual([
    { type: "text", text: "Wrote file successfully." },
    { type: "text", text: "\n\nCOMMENT/DOCSTRING DETECTED" },
  ])
  const calls = await cliInvocations()
  expect(calls).toHaveLength(1)
  expect(calls[0]!.input.tool_input.file_path).toBe("/tmp/v2-file.ts")
  host.cleanup?.()
})

test("v2 execute.after maps the patch tool name and file metadata to the guard contract", async () => {
  const host = await newV2Session({ comment_checker: { tools: ["apply_patch"] } })
  const event: any = {
    tool: "patch",
    sessionID: "session-patch",
    agent: "build",
    messageID: "message-patch",
    id: "v2-patch-1",
    input: { patchText: "*** Begin Patch\n*** End Patch\n" },
    status: "completed",
    result: {
      content: [{ type: "text", text: "Success. Updated the following files:\nM src/a.ts" }],
      metadata: {
        files: [
          {
            file: "src/a.ts",
            status: "modified",
            patch: "@@ -1 +1 @@\n-// old\n+// added by patch\n",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    },
  }

  await host.before(event)
  await host.after(event)

  expect(event.result.content).toContainEqual({ type: "text", text: "\n\nCOMMENT/DOCSTRING DETECTED" })
  const calls = await cliInvocations()
  expect(calls).toHaveLength(1)
  expect(calls[0]!.input.tool_input.file_path.endsWith("src/a.ts")).toBe(true)
  expect(calls[0]!.input.tool_name).toBe("apply_patch")
  host.cleanup?.()
})

test("v2 session.idle events reach the idle analyzers without touching a later result", async () => {
  const host = await newV2Session({ comment_checker: { tools: ["none"] } })
  expect(host.subscribeCalls()).toBe(1)
  host.pushIdle("session-idle")

  const event: any = {
    tool: "bash",
    sessionID: "session-idle",
    agent: "build",
    messageID: "message-idle",
    id: "v2-idle-1",
    input: { command: "true" },
    status: "completed",
    result: { content: [{ type: "text", text: "bash output" }], metadata: undefined },
  }
  await host.after(event)
  expect(event.result.content).toEqual([{ type: "text", text: "bash output" }])
  host.cleanup?.()
})

test("test guard warns on a focused test without clobbering the output", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: {} })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, {
    args: { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" },
  })
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  expect(output.output.startsWith("Wrote file successfully.")).toBe(true)
  expect(output.output).toContain("skip-focus-added")
  expect(output.output.split(TEST_GUARD_MARKER).length - 1).toBe(1)
})

test("restricts the test guard to the configured tools", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: { tools: ["write"] } })

  const editOutput = writeOutput("The file has been updated.")
  await hooks["tool.execute.before"]({ tool: "edit", sessionID: "s", callID: "tg-tools-e" }, editArgs("/work/a.test.ts", "const a = 1", "it.only('a', () => {})"))
  await hooks["tool.execute.after"]({ tool: "edit", sessionID: "s", callID: "tg-tools-e" }, editOutput)
  expect(editOutput.output).toBe("The file has been updated.")

  const writeResult = writeOutput("Wrote file successfully.")
  await hooks["tool.execute.before"]({ tool: "write", sessionID: "s", callID: "tg-tools-w" }, {
    args: { filePath: "/work/a.test.ts", content: "it.only('a', () => {\n  expect(1).toBe(1)\n})\n" },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "s", callID: "tg-tools-w" }, writeResult)
  expect(writeResult.output).toContain("skip-focus-added")
})

test("event hook ignores session.idle when mutation is disabled", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] } })
  await expect(hooks.event?.({ event: { type: "session.idle" } })).resolves.toBeUndefined()
})

test("session.idle with disabled analyzers queues no advisory note", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] } })
  await hooks.event?.({ event: { type: "session.idle" } })

  const output = writeOutput("bash output")
  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "idle-note" }, output)
  expect(output.output).toBe("bash output")
})

test("test guard after hook never throws on malformed metadata", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] } })
  const output = writeOutput("ok")

  await hooks["tool.execute.after"]({ tool: APPLY_PATCH_TOOL_NAME, sessionID: "s", callID: "x" }, output)

  expect(output.output).toBe("ok")
})

// --- test-checker binary engine (default) ---

const FOCUSED_TEST_CONTENT = "it.only('a', () => {\n  expect(1).toBe(1)\n})\n"

test("test-checker binary: exit 2 stdout JSON becomes rendered test-guard findings", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: {} })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"]({ tool: "write", sessionID: "stub-findings", callID: "stub-findings" }, {
    args: { filePath: "/work/a.test.ts", content: FOCUSED_TEST_CONTENT },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "stub-findings", callID: "stub-findings" }, output)

  expect(output.output).toContain("skip-focus-added")
  expect(output.output).toContain("Focused test added.")
})

test("test-checker binary: exit 0 emits nothing", async () => {
  writeFileSync(testModePath, "clean")
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: {} })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"]({ tool: "write", sessionID: "stub-clean", callID: "stub-clean" }, {
    args: { filePath: "/work/a.test.ts", content: FOCUSED_TEST_CONTENT },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "stub-clean", callID: "stub-clean" }, output)

  expect(output.output).toBe("Wrote file successfully.")
})

test("test-checker binary: engine regex bypasses the binary", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: { engine: "regex" } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"]({ tool: "write", sessionID: "stub-regex", callID: "stub-regex" }, {
    args: { filePath: "/work/a.test.ts", content: FOCUSED_TEST_CONTENT },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "stub-regex", callID: "stub-regex" }, output)

  expect(output.output).toContain("skip-focus-added")
  expect(output.output).not.toContain("Focused test added.")
})

test("test-checker binary: TEST_GUARD_ENGINE=regex bypasses the binary", async () => {
  process.env.TEST_GUARD_ENGINE = "regex"
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: {} })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"]({ tool: "write", sessionID: "stub-env", callID: "stub-env" }, {
    args: { filePath: "/work/a.test.ts", content: FOCUSED_TEST_CONTENT },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "stub-env", callID: "stub-env" }, output)

  expect(output.output).toContain("skip-focus-added")
  expect(output.output).not.toContain("Focused test added.")
})

test("test-checker binary: the bypass footer still appears on the binary path", async () => {
  const hooks = await newSession({ comment_checker: { tools: ["none"] }, test_guard: {} })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"]({ tool: "write", sessionID: "stub-bypass", callID: "stub-bypass" }, {
    args: {
      filePath: "/work/a.test.ts",
      content: "// test-guard: allow intentional\nit.only('a', () => {\n  expect(1).toBe(1)\n})\n",
    },
  })
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "stub-bypass", callID: "stub-bypass" }, output)

  expect(output.output).toContain("skip-focus-added")
  expect(output.output).toContain("Test guard bypass recorded")
})


