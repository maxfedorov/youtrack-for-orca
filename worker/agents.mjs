// Agents Orca can launch, and detection of the ones installed on this machine.
import { findOnPath } from './exec.mjs'

/**
 * @typedef {object} Agent
 * @property {string} id
 * @property {string} label
 * @property {string[]} commands executable names; the agent is installed when any is on PATH
 * @property {string[]} [requires] executables that must also be on PATH
 * @property {string[]} [unsupportedPlatforms] platforms where the agent is never offered
 */

/** @type {Agent[]} */
export const AGENTS = [
  { id: 'claude', label: 'Claude', commands: ['claude'] },
  { id: 'claude-agent-teams', label: 'Claude Agent Teams', commands: ['orca', 'orca-dev', 'orca-ide'], requires: ['claude'], unsupportedPlatforms: ['win32', 'wsl'] },
  { id: 'codebuddy', label: 'CodeBuddy', commands: ['codebuddy', 'cbc'] },
  { id: 'openclaude', label: 'OpenClaude', commands: ['openclaude'] },
  { id: 'codex', label: 'Codex', commands: ['codex'] },
  { id: 'devin', label: 'Devin', commands: ['devin'] },
  { id: 'ante', label: 'Ante', commands: ['ante'] },
  { id: 'trae', label: 'Trae', commands: ['traecli'] },
  { id: 'muse', label: 'Muse', commands: ['muse'] },
  { id: 'dsh', label: 'DeepSeek Harness', commands: ['dsh-tui', 'dst'], requires: ['dsh'] },
  { id: 'zcode', label: 'ZCode', commands: ['zcode'] },
  { id: 'autohand', label: 'Autohand Code', commands: ['autohand'] },
  { id: 'opencode', label: 'OpenCode', commands: ['opencode'] },
  { id: 'opencode2', label: 'OpenCode 2', commands: ['opencode2'] },
  { id: 'mimo-code', label: 'MiMo Code', commands: ['mimo'] },
  { id: 'pi', label: 'Pi', commands: ['pi'] },
  { id: 'omp', label: 'OMP', commands: ['omp'] },
  { id: 'prime-agent', label: 'Prime Agent', commands: ['prime-agent'] },
  { id: 'qoder', label: 'Qoder CLI', commands: ['qodercli', 'qoder'] },
  { id: 'qoder-cn', label: 'Qoder CLI China', commands: ['qoderclicn', 'qodercn'] },
  { id: 'gemini', label: 'Gemini', commands: ['gemini'] },
  { id: 'antigravity', label: 'Antigravity', commands: ['agy'] },
  { id: 'aider', label: 'Aider', commands: ['aider'] },
  { id: 'goose', label: 'Goose', commands: ['goose'] },
  { id: 'amp', label: 'Amp', commands: ['amp'] },
  { id: 'kilo', label: 'Kilocode', commands: ['kilo'] },
  { id: 'kiro', label: 'Kiro', commands: ['kiro-cli'] },
  { id: 'crush', label: 'Charm', commands: ['crush'] },
  { id: 'aug', label: 'Auggie', commands: ['auggie'] },
  { id: 'cline', label: 'Cline', commands: ['cline'] },
  { id: 'codebuff', label: 'Codebuff', commands: ['codebuff'] },
  { id: 'freebuff', label: 'Freebuff', commands: ['freebuff'] },
  { id: 'command-code', label: 'Command Code', commands: ['command-code'] },
  { id: 'continue', label: 'Continue', commands: ['cn'] },
  { id: 'cursor', label: 'Cursor', commands: ['cursor-agent'] },
  { id: 'droid', label: 'Droid', commands: ['droid'] },
  { id: 'kimi', label: 'Kimi', commands: ['kimi', 'kimi-code'] },
  { id: 'mistral-vibe', label: 'Mistral Vibe', commands: ['vibe', 'mistral-vibe'] },
  { id: 'qwen-code', label: 'Qwen Code', commands: ['qwen'] },
  { id: 'rovo', label: 'Rovo Dev', commands: ['acli'] },
  { id: 'hermes', label: 'Hermes', commands: ['hermes'] },
  { id: 'openclaw', label: 'OpenClaw', commands: ['openclaw'] },
  { id: 'copilot', label: 'GitHub Copilot', commands: ['copilot'] },
  { id: 'grok', label: 'Grok', commands: ['grok'] },
  { id: 'jcode', label: 'Jcode', commands: ['jcode'] },
]

/**
 * Split AGENTS into installed ones and the rest, both in AGENTS order.
 * @param {{ env?: Record<string, string | undefined>, platform?: string, exists?: (p: string) => boolean }} [o]
 * @returns {{ installed: string[], other: string[] }}
 */
export function detectAgents(o = {}) {
  const platform = o.platform ?? process.platform
  const opts = { ...o, platform }
  const found = (cmd) => findOnPath(cmd, { ...opts, shims: true }) !== null
  const installed = []
  const other = []
  for (const a of AGENTS) {
    const ok =
      !a.unsupportedPlatforms?.includes(platform) &&
      a.commands.some(found) &&
      (a.requires ?? []).every(found)
    ;(ok ? installed : other).push(a.id)
  }
  return { installed, other }
}
