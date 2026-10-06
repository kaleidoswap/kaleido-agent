/**
 * SkillLoader — loads a SKILL.md file and executes !`command` bash injections.
 * Injected outputs replace the placeholders before the content reaches the LLM.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getKaleidoApiUrl } from './runtime-paths.js'
import { resolveSkillDir } from './skill-sources.js'

const execAsync = promisify(exec)

// Matches !`any command here` — same syntax as Claude Code skill injections
const INJECTION_RE = /!`([^`]+)`/g

export class SkillLoader {
  async load(skillName: string): Promise<string> {
    const skillDir = resolveSkillDir(skillName)
    if (!skillDir) throw new Error(`Skill not found: "${skillName}"`)
    const content = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    return this.injectBashOutputs(content, skillName)
  }

  private async injectBashOutputs(content: string, skillName: string): Promise<string> {
    const matches = [...content.matchAll(INJECTION_RE)]
    if (matches.length === 0) return content

    const kaleidoBin = process.env.KALEIDO_BIN || 'kaleido'
    const nodeUrl = process.env.RLN_NODE_URL || 'http://localhost:3001'
    const apiUrl = getKaleidoApiUrl()
    const env = { ...process.env, KALEIDO_NODE_URL: nodeUrl, KALEIDO_API_URL: apiUrl }

    // Replace `kaleido` with the configured binary path in injections
    let result = content
    for (const match of matches) {
      const rawCmd = match[1].replace(/^kaleido\b/, kaleidoBin)
      process.stderr.write(`[skill-loader:${skillName}] injecting: ${rawCmd}\n`)
      try {
        const { stdout } = await execAsync(rawCmd, { timeout: 15_000, env })
        result = result.replace(match[0], stdout.trim() || '(empty)')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[skill-loader:${skillName}] injection failed for \`${rawCmd}\`: ${msg}\n`)
        result = result.replace(match[0], `(error: ${msg})`)
      }
    }
    return result
  }
}

export const skillLoader = new SkillLoader()
