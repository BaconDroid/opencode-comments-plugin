// Zero-dependency glob matcher. Supports `*`, `**` and `?`.
// Inspired by the tiny glob loaders in the OpenCode plugin ecosystem
// (e.g. momomuchu/opencode-live-compaction zero-dep glob), reimplemented here.

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/")
  let source = "^"
  let index = 0

  while (index < normalized.length) {
    const char = normalized[index]!

    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 2
        if (normalized[index] === "/") {
          source += "(?:.*/)?"
          index += 1
        } else {
          source += ".*"
        }
      } else {
        source += "[^/]*"
        index += 1
      }
      continue
    }

    if (char === "?") {
      source += "[^/]"
      index += 1
      continue
    }

    if ("\\^$.|+()[]{}".includes(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
    index += 1
  }

  source += "$"
  return new RegExp(source)
}

const cache = new Map<string, RegExp>()

export function matchesGlob(pattern: string, filePath: string): boolean {
  let regex = cache.get(pattern)
  if (!regex) {
    regex = globToRegExp(pattern)
    cache.set(pattern, regex)
  }
  return regex.test(filePath.replace(/\\/g, "/"))
}

export function matchesAnyGlob(patterns: string[], filePath: string): boolean {
  return patterns.some(pattern => matchesGlob(pattern, filePath))
}
