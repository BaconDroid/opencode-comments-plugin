// Helpers for reading JSON out of noisy model/command output.

// The substring between the first `open` and the last `close`, or undefined.
export function sliceBetween(raw: string, open: string, close: string): string | undefined {
  const start = raw.indexOf(open)
  const end = raw.lastIndexOf(close)
  return start >= 0 && end > start ? raw.slice(start, end + 1) : undefined
}

// JSON.parse that returns undefined instead of throwing.
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Parses the JSON value between the first `open` and the last `close`.
export function parseJsonSlice(raw: string, open: string, close: string): unknown {
  const slice = sliceBetween(raw, open, close)
  return slice === undefined ? undefined : tryParseJson(slice)
}
