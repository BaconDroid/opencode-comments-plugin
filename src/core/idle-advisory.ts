// Shared plumbing for opt-in advisory analyzers (judge, external parser):
// per-session cooldown, on-idle and on-demand entry points, and the tool
// wrapper. The analyzer itself only provides `analyze`.

import { tool } from "@opencode-ai/plugin"

export interface IdleAdvisoryController {
  onIdle(sessionID: string): Promise<string | null>
  analyzeNow(): Promise<string>
}

export function createIdleAdvisory(options: {
  isEnabled: () => boolean
  analyze: () => Promise<string | null>
  disabledMessage: string
  unavailableMessage: string
  emptyMessage: string
  cooldownMs?: number
}): IdleAdvisoryController {
  const cooldownMs = options.cooldownMs ?? 60_000
  const lastRun = new Map<string, number>()

  return {
    async onIdle(sessionID) {
      try {
        if (!options.isEnabled()) return null
        const now = Date.now()
        if (now - (lastRun.get(sessionID) ?? 0) < cooldownMs) return null
        lastRun.set(sessionID, now)
        return await options.analyze()
      } catch {
        return null
      }
    },
    async analyzeNow() {
      try {
        if (!options.isEnabled()) return options.disabledMessage
        return (await options.analyze()) ?? options.emptyMessage
      } catch {
        return options.unavailableMessage
      }
    },
  }
}

export function createAdvisoryTool(description: string, controller: IdleAdvisoryController) {
  return tool({
    description,
    args: {},
    async execute() {
      return controller.analyzeNow()
    },
  })
}
