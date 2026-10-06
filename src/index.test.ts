import { test, expect, beforeEach } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APPLY_PATCH_TOOL_NAME } from "./constants"
import { CommentCheckerPlugin } from "./index"
import { getCommentCheckerVersion } from "./downloader"
import type { HookInput } from "./types"

const cacheRoot = mkdtempSync(join(tmpdir(), "comment-checker-hook-"))
process.env.XDG_CACHE_HOME = cacheRoot

const version = getCommentCheckerVersion()
if (!version) throw new Error("@code-yeongyu/comment-checker is not installed")

const modePath = join(cacheRoot, "mode")
const logPath = join(cacheRoot, "log")
const cacheBase = join(cacheRoot, "opencode-comments-plugin", "bin")
const binaryDir = join(cacheBase, version)
const binaryPath = join(binaryDir, process.platform === "win32" ? "comment-checker.exe" : "comment-checker")

mkdirSync(binaryDir, { recursive: true })
writeFileSync(join(cacheBase, "latest.json"), JSON.stringify({ version, checkedAt: Date.now() }))
writeFileSync(binaryPath, `#!/bin/sh
{
  printf 'ARGS:'
  printf '%s\\x1f' "$@"
  printf '\\nSTDIN:'
  cat
  printf '\\x1e===END===\\x1e\\n'
} >> '${logPath}'
case "$(cat '${modePath}')" in
  clean) exit 0 ;;
  *) printf '%s' "COMMENT/DOCSTRING DETECTED" >&2; exit 2 ;;
esac
`)
chmodSync(binaryPath, 0o755)

const RECORD_SEP = "\u001e"
const UNIT_SEP = "\u001f"
const RECORD_END = `${RECORD_SEP}===END===${RECORD_SEP}\n`

type BeforeInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: unknown }

interface CommentCheckerHooks {
  config?: (config: unknown) => Promise<void>
  "tool.execute.before": (input: BeforeInput, output: { args: Record<string, unknown> }) => Promise<void>
  "tool.execute.after": (input: BeforeInput, output: AfterOutput) => Promise<void>
}

interface Invocation {
  args: string[]
  input: HookInput
}

const TOOL_AFTER_INPUT = { tool: "write", sessionID: "session-1", callID: "call-1" }

const pluginFactory = CommentCheckerPlugin as unknown as (
  input: unknown,
  options?: unknown,
) => Promise<CommentCheckerHooks>

async function newSession(options?: unknown): Promise<CommentCheckerHooks> {
  return await pluginFactory({}, options)
}

async function cliInvocations(): Promise<Invocation[]> {
  const text = await Bun.file(logPath).text()
  return text
    .split(RECORD_END)
    .filter(block => block.length > 0)
    .map(block => {
      const separator = block.indexOf("\nSTDIN:")
      const argsPart = block.slice("ARGS:".length, separator)
      return {
        args: argsPart.split(UNIT_SEP).filter(arg => arg.length > 0),
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
  "COMMENT_CHECKER_MAX_WARNINGS_PER_FILE",
  "COMMENT_CHECKER_TOOLS",
  "COMMENT_CHECKER_TIMEOUT_MS",
] as const

beforeEach(() => {
  writeFileSync(logPath, "")
  writeFileSync(modePath, "comment")
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

test("forwards the custom prompt from the comment_checker config", async () => {
  const hooks = await newSession()
  await hooks.config?.({ comment_checker: { custom_prompt: "DETECTED:\n{{comments}}\nFix it." } })
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  const calls = await cliInvocations()
  expect(calls[0]!.args).toContain("--prompt")
  expect(calls[0]!.args).toContain("DETECTED:\n{{comments}}\nFix it.")
})
test("runs without a prompt when the config has none", async () => {
  const hooks = await newSession()
  await hooks.config?.({})
  const output = writeOutput("Wrote file successfully.")

  await hooks["tool.execute.before"](TOOL_AFTER_INPUT, writeArgs("// explain\n"))
  await hooks["tool.execute.after"](TOOL_AFTER_INPUT, output)

  const calls = await cliInvocations()
  expect(calls[0]!.args).toEqual([])
})

test("stops warning about a file once max_warnings_per_file is reached", async () => {
  const hooks = await newSession()
  await hooks.config?.({ comment_checker: { max_warnings_per_file: 2 } })
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

  await hooks.config?.({})
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
  const hooks = await newSession()
  await hooks.config?.({})

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

