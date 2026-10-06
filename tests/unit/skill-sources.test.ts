import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalSkillName,
  listSkillSources,
  missingMindSkills,
  resolveSkillDir,
} from '../../src/skill-sources.js'

function addSkill(root: string, name: string): void {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}

describe('skill sources', () => {
  let root: string
  let localDir: string
  let mindDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skill-sources-'))
    localDir = join(root, 'local')
    mindDir = join(root, 'mind')
    addSkill(localDir, 'portfolio-manager')
    addSkill(localDir, 'dca')
    addSkill(mindDir, 'dca')
    addSkill(mindDir, 'kaleido-trading')
    addSkill(mindDir, 'merchant-finder')
    process.env.KALEIDO_MIND_SKILLS_DIR = mindDir
  })

  afterEach(() => {
    delete process.env.KALEIDO_MIND_SKILLS_DIR
    rmSync(root, { recursive: true, force: true })
  })

  it('merges local skills with the selected mind skills, local first', () => {
    const sources = listSkillSources(localDir)
    expect(sources.map((s) => [s.name, s.origin])).toEqual([
      ['dca', 'local'],
      ['kaleido-trading', 'mind'],
      ['portfolio-manager', 'local'],
    ])
  })

  it('resolves renamed skills to their mind names', () => {
    expect(canonicalSkillName('kaleidoswap')).toBe('kaleido-trading')
    expect(resolveSkillDir('kaleidoswap', localDir)).toBe(join(mindDir, 'kaleido-trading'))
    expect(resolveSkillDir('unknown', localDir)).toBeNull()
  })

  it('reports mind skills the installed package lacks', () => {
    expect(missingMindSkills(localDir)).toContain('paid-data')
    expect(missingMindSkills(localDir)).not.toContain('kaleido-trading')
  })

  it('finds the installed @kaleidorg/mind package', () => {
    delete process.env.KALEIDO_MIND_SKILLS_DIR
    const names = listSkillSources(localDir).filter((s) => s.origin === 'mind').map((s) => s.name)
    expect(names).toContain('kaleido-trading')
    expect(names).toContain('paid-data')
  })
})
