// Change extraction and diff normalization.
//
// Anti-false-positive rules (plan section 6): only added lines are candidates,
// comments are stripped before counting, real lines ignore blank/comment-only
// lines, and net-delta semantics are used for removed vs added.

export type Language = "js" | "ts" | "python" | "go" | "rust" | "java" | "unknown"

const EXTENSION_LANGUAGE: Record<string, Language> = {
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".ts": "ts",
  ".tsx": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
}

export function detectLanguage(filePath: string): Language {
  const match = filePath.toLowerCase().match(/\.[a-z0-9]+$/)
  if (!match) return "unknown"
  return EXTENSION_LANGUAGE[match[0]] ?? "unknown"
}

export function isSupportedLanguage(language: Language): boolean {
  return language !== "unknown"
}

export interface ExtractedChange {
  filePath: string
  oldText: string
  newText: string
  addedLines: string[]
  removedLines: string[]
  isNew: boolean
  isDelete: boolean
  language: Language
}

export interface RawChange {
  filePath: string
  oldText: string
  newText: string
  isNew: boolean
  isDelete: boolean
}

// Multiset line diff. Order is ignored on purpose: the guard rules only need
// which lines were added or removed, not their exact positions.
export function diffLines(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const oldLines = oldText.length > 0 ? oldText.split("\n") : []
  const newLines = newText.length > 0 ? newText.split("\n") : []

  const oldCount = new Map<string, number>()
  const newCount = new Map<string, number>()
  for (const line of oldLines) oldCount.set(line, (oldCount.get(line) ?? 0) + 1)
  for (const line of newLines) newCount.set(line, (newCount.get(line) ?? 0) + 1)

  const added: string[] = []
  const removed: string[] = []
  for (const [line, count] of newCount) {
    const previous = oldCount.get(line) ?? 0
    for (let i = 0; i < count - previous; i++) added.push(line)
  }
  for (const [line, count] of oldCount) {
    const next = newCount.get(line) ?? 0
    for (let i = 0; i < count - next; i++) removed.push(line)
  }
  return { added, removed }
}

export function extractChange(raw: RawChange): ExtractedChange {
  const { added, removed } = diffLines(raw.oldText, raw.newText)
  return {
    filePath: raw.filePath,
    oldText: raw.oldText,
    newText: raw.newText,
    addedLines: added,
    removedLines: removed,
    isNew: raw.isNew,
    isDelete: raw.isDelete,
    language: detectLanguage(raw.filePath),
  }
}

const LINE_COMMENT: Record<Language, string[]> = {
  js: ["//"],
  ts: ["//"],
  python: ["#"],
  go: ["//"],
  rust: ["//"],
  java: ["//"],
  unknown: ["//", "#"],
}

// Heuristic comment stripper. It does not try to be a real parser: the guard
// rules only need comment/string noise removed before counting assertions.
export function stripComments(text: string, language: Language): string {
  const markers = LINE_COMMENT[language] ?? ["//"]

  let out = text
  // Block comments (C-like) and Python triple-quoted strings/docstrings.
  out = out.replace(/\/\*[\s\S]*?\*\//g, "")
  if (language === "python") {
    out = out.replace(/"""[\s\S]*?"""/g, "")
    out = out.replace(/'''[\s\S]*?'''/g, "")
  }

  const lines = out.split("\n")
  const stripped = lines.map(line => {
    if (line.trimStart().startsWith("#!")) return ""
    let result = line
    for (const marker of markers) {
      const index = findCommentIndex(result, marker)
      if (index >= 0) {
        result = result.slice(0, index)
        break
      }
    }
    return result
  })

  return stripped.join("\n")
}

// Finds a line-comment marker that is not inside a simple quoted string.
function findCommentIndex(line: string, marker: string): number {
  let quote: string | undefined
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote) {
      if (char === "\\") {
        i += 1
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (line.startsWith(marker, i)) return i
  }
  return -1
}

// Replaces string-literal characters with spaces while preserving length and
// newlines, so offsets/line numbers stay valid for structure detection.
export function maskStrings(text: string, language: Language): string {
  const chars = text.split("")
  let quote: string | undefined
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!
    if (quote) {
      if (char === "\\") {
        chars[i] = " "
        if (i + 1 < chars.length && chars[i + 1] !== "\n") chars[i + 1] = " "
        i += 1
        continue
      }
      if (char === quote) {
        quote = undefined
        chars[i] = " "
      } else if (char !== "\n") {
        chars[i] = " "
      }
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      chars[i] = " "
    }
  }
  return chars.join("")
}

// Blanks out string literals so a pattern that only appears inside a test
// fixture string (e.g. `'it.only(...)'`) does not trigger a rule.
export function stripStringLiterals(text: string, language: Language): string {
  let out = ""
  let quote: string | undefined
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      if (char === "\\") {
        i += 1
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }
    out += char
  }
  return out
}

export function isCommentLine(line: string, language: Language): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) return true
  if (language === "python" && (trimmed.startsWith("#") || trimmed.startsWith('"""') || trimmed.startsWith("'''"))) return true
  return false
}

// Counts "real" lines: non-blank and not comment-only.
export function countRealLines(text: string, language: Language): number {
  return text
    .split("\n")
    .map(line => stripComments(line, language))
    .filter(line => line.trim().length > 0).length
}

export function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") return value
  }
  return undefined
}

export function firstString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

// Extracts a per-file change from a tool call. `preimage` is the on-disk
// content before the write (used for `write` so only new lines are candidates).
export function extractToolChange(
  tool: string,
  args: Record<string, unknown>,
  preimage: string | undefined,
): ExtractedChange | undefined {
  const filePath = firstString(args, "filePath", "file_path", "path")
  if (!filePath) return undefined

  const toolLower = tool.toLowerCase()

  if (toolLower === "write" || toolLower === "create") {
    const content = readString(args, "content", "file_text", "text") ?? ""
    return extractChange({
      filePath,
      oldText: preimage ?? "",
      newText: content,
      isNew: preimage === undefined,
      isDelete: false,
    })
  }

  if (toolLower === "edit" || toolLower === "patch") {
    const edits = args.edits
    if (Array.isArray(edits) && edits.length > 0) {
      let oldText = ""
      let newText = ""
      for (const entry of edits) {
        if (!entry || typeof entry !== "object") continue
        const record = entry as Record<string, unknown>
        oldText += (readString(record, "old_string", "oldString") ?? "") + "\n"
        newText += (readString(record, "new_string", "newString") ?? "") + "\n"
      }
      return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false })
    }

    const oldText = readString(args, "oldString", "old_string") ?? ""
    const newText = readString(args, "newString", "new_string") ?? ""
    return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false })
  }

  return undefined
}

// apply_patch reports one unified diff per file.
export function splitPatch(patch: string): { oldText: string; newText: string } {
  const removed: string[] = []
  const added: string[] = []

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue
    if (line.startsWith("-")) removed.push(line.slice(1))
    else if (line.startsWith("+")) added.push(line.slice(1))
  }

  return { oldText: removed.join("\n"), newText: added.join("\n") }
}

interface PatchEntry {
  type?: string
  filePath?: string
  movePath?: string
  patch?: string
}

export function toPatchEntries(metadata: unknown): PatchEntry[] {
  const files = (metadata as { files?: unknown } | undefined)?.files
  if (!Array.isArray(files)) return []
  const entries: PatchEntry[] = []
  for (const file of files) {
    if (!file || typeof file !== "object") continue
    const entry = file as Record<string, unknown>
    entries.push({
      type: typeof entry.type === "string" ? entry.type : undefined,
      filePath: typeof entry.filePath === "string" ? entry.filePath : undefined,
      movePath: typeof entry.movePath === "string" ? entry.movePath : undefined,
      patch: typeof entry.patch === "string" ? entry.patch : undefined,
    })
  }
  return entries
}

export function extractPatchChanges(metadata: unknown): ExtractedChange[] {
  const changes: ExtractedChange[] = []

  for (const entry of toPatchEntries(metadata)) {
    const filePath = entry.movePath ?? entry.filePath
    if (!filePath) continue
    const isDelete = entry.type === "delete"
    const sides = entry.patch ? splitPatch(entry.patch) : { oldText: "", newText: "" }
    changes.push(
      extractChange({
        filePath,
        oldText: sides.oldText,
        newText: sides.newText,
        isNew: entry.type === "add",
        isDelete,
      }),
    )
  }

  return changes
}
