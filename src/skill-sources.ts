/**
 * Skill sources. Generic skills ship in the @kaleidorg/mind package; skills/
 * holds only the agent-specific ones (scheduled loops, `!` bash injections,
 * dashboard action blocks). A local skill wins over a packaged one of the same name.
 */

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { getSkillsDir } from './runtime-paths.js'

export const MIND_SKILLS = [
  'kaleido-trading',
  'kaleido-lsps',
  'kaleido-node',
  'rgb-lightning-node',
  'paid-data',
  'dca',
  'bitrefill',
] as const

const RENAMED_SKILLS: Record<string, string> = {
  kaleidoswap: 'kaleido-trading',
  mpp: 'paid-data',
  'node-manager': 'kaleido-node',
}

export type SkillOrigin = 'local' | 'mind'

export interface SkillSource {
  name: string
  dir: string
  origin: SkillOrigin
}

export function canonicalSkillName(name: string): string {
  return RENAMED_SKILLS[name] ?? name
}

export function getMindSkillsDir(): string | null {
  if (process.env.KALEIDO_MIND_SKILLS_DIR) return resolve(process.env.KALEIDO_MIND_SKILLS_DIR)
  try {
    const loader = createRequire(import.meta.url).resolve('@kaleidorg/mind/skills')
    return resolve(dirname(loader), '..', '..', 'skills')
  } catch {
    return null
  }
}

function hasSkill(dir: string): boolean {
  return existsSync(join(dir, 'SKILL.md'))
}

function localSkillNames(localDir: string): string[] {
  try {
    return readdirSync(localDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasSkill(join(localDir, entry.name)))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export function listSkillSources(localDir: string = getSkillsDir()): SkillSource[] {
  const sources = new Map<string, SkillSource>()
  for (const name of localSkillNames(localDir)) {
    sources.set(name, { name, dir: join(localDir, name), origin: 'local' })
  }
  const mindDir = getMindSkillsDir()
  if (mindDir) {
    for (const name of MIND_SKILLS) {
      const dir = join(mindDir, name)
      if (!sources.has(name) && hasSkill(dir)) sources.set(name, { name, dir, origin: 'mind' })
    }
  }
  return [...sources.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Mind skills this agent expects but the installed @kaleidorg/mind does not ship. */
export function missingMindSkills(localDir: string = getSkillsDir()): string[] {
  const available = new Set(listSkillSources(localDir).map((source) => source.name))
  return MIND_SKILLS.filter((name) => !available.has(name))
}

export function resolveSkillDir(name: string, localDir: string = getSkillsDir()): string | null {
  const canonical = canonicalSkillName(name)
  return listSkillSources(localDir).find((source) => source.name === canonical)?.dir ?? null
}
