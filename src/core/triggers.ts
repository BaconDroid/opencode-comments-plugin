// Which tools a guard reacts to. Shared by both guards so the default set and
// the lookup live in one place.

import { DEFAULT_TRIGGER_TOOLS } from "../constants"

export function isTriggeredTool(
  triggerTools: Set<string> | undefined,
  toolLower: string,
  fallback: readonly string[] = DEFAULT_TRIGGER_TOOLS,
): boolean {
  return triggerTools ? triggerTools.has(toolLower) : fallback.includes(toolLower)
}
