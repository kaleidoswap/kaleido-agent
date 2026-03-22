#!/usr/bin/env node
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentConfigStore, type AgentConfigFile } from './agent-config-store.js'
import { configStore } from './config-store.js'
import { NanobotManager } from './nanobot-manager.js'
import { getStateDir, resolveStatePath } from './runtime-paths.js'
import { tasksStore } from './tasks-store.js'

dotenv.config({ override: true })

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const configPath = resolve(process.env.CONFIG_PATH ?? resolve(projectRoot, 'agent.config.json'))
const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as AgentConfigFile

agentConfigStore.init(configPath, cfg)
configStore.init(resolveStatePath('.env'), cfg.agent.model)

const manager = new NanobotManager({
  projectRoot,
  stateDir: getStateDir(),
  distDir: resolve(projectRoot, 'dist'),
  agentConfig: cfg,
  provider: configStore.provider,
  model: configStore.model,
  anthropicApiKey: configStore.anthropicApiKey,
  openaiApiKey: configStore.openaiApiKey,
})

async function main() {
  const command = process.argv[2]
  const tasks = await tasksStore.list()

  switch (command) {
    case 'sync-skills':
      await manager.sync(tasks)
      process.stdout.write(`Synced Nanobot workspace to ${manager.workspaceDir}\n`)
      break
    case 'validate': {
      const result = await manager.validate(tasks)
      if (!result.ok) {
        process.stderr.write(`${result.errors.join('\n')}\n`)
        process.exit(1)
      }
      process.stdout.write('Nanobot configuration is valid.\n')
      break
    }
    case 'gateway-status': {
      const info = await manager.getRuntimeInfo()
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
      break
    }
    case 'stop-gateway':
      await manager.stopGateway()
      process.stdout.write('Stopped Nanobot gateway.\n')
      break
    default:
      process.stderr.write('Usage: node dist/nanobot-admin.js <sync-skills|validate|gateway-status|stop-gateway>\n')
      process.exit(1)
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
