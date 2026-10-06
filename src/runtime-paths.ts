import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

export function getProjectRoot(): string {
  return PROJECT_ROOT
}

export function getStateDir(): string {
  return process.env.KALEIDOAGENT_STATE_DIR
    ? resolve(process.env.KALEIDOAGENT_STATE_DIR)
    : PROJECT_ROOT
}

export function getSkillsDir(): string {
  return process.env.KALEIDOAGENT_SKILLS_DIR
    ? resolve(process.env.KALEIDOAGENT_SKILLS_DIR)
    : join(PROJECT_ROOT, 'skills')
}

export function resolveStatePath(...parts: string[]): string {
  return join(getStateDir(), ...parts)
}

export function getKaleidoApiUrl(): string {
  if (process.env.KALEIDOSWAP_API_URL) return process.env.KALEIDOSWAP_API_URL
  return process.env.KALEIDO_NETWORK === 'mainnet'
    ? 'https://api.kaleidoswap.com'
    : 'https://api.signet.kaleidoswap.com'
}
