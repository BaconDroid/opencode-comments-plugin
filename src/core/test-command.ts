// Test-command detection (plan section 7). The guard never runs the detected
// command; it only reports it in audit output. `test_command` overrides it.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const CANDIDATES: Array<{ file: string; contains?: string; command: string }> = [
  { file: "pytest.ini", command: "pytest" },
  { file: "pyproject.toml", contains: "[tool.pytest", command: "pytest" },
  { file: "go.mod", command: "go test ./..." },
  { file: "Cargo.toml", command: "cargo test" },
  { file: "pom.xml", command: "mvn test" },
  { file: "build.gradle", command: "gradle test" },
  { file: "build.gradle.kts", command: "gradle test" },
]

function readIfExists(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined
  } catch {
    return undefined
  }
}

export function detectTestCommand(directory: string): string | null {
  const packageJson = readIfExists(join(directory, "package.json"))
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> }
      const test = parsed.scripts?.test
      if (typeof test === "string" && test.trim().length > 0) {
        return test.trim()
      }
    } catch {
      // malformed package.json is not fatal
    }
  }

  for (const candidate of CANDIDATES) {
    const content = readIfExists(join(directory, candidate.file))
    if (content === undefined) continue
    if (candidate.contains && !content.includes(candidate.contains)) continue
    return candidate.command
  }

  return null
}
