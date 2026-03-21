/**
 * StatusServer — lightweight HTTP server exposing agent state and chat.
 * Listens on 127.0.0.1:4242 (localhost only).
 *
 * Endpoints:
 *   GET  /health  → { ok: true }
 *   GET  /status  → AgentStatusPayload (JSON)
 *   POST /chat    → { messages: ChatMessage[] } → ChatResponse
 */

import http from 'node:http'
import { agentState } from './agent-state.js'
import { configStore } from './config-store.js'
import type { ChatRunner, ChatMessage } from './chat-runner.js'

// ---------------------------------------------------------------------------
// Body reader helper
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function startStatusServer(port = 4242, chatRunner?: ChatRunner): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS — allow the Chrome extension origin
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // GET /health
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // GET /status
    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(agentState.getStatus()))
      return
    }

    // GET /config
    if (req.url === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(configStore.getPublicConfig()))
      return
    }

    // POST /config
    if (req.url === '/config' && req.method === 'POST') {
      try {
        const body = await readBody(req)
        const patch = JSON.parse(body)
        configStore.update(patch)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, config: configStore.getPublicConfig() }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
      return
    }

    // POST /chat
    if (req.url === '/chat' && req.method === 'POST') {
      if (!chatRunner) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Chat runner not ready yet.' }))
        return
      }

      try {
        const body = await readBody(req)
        const { messages } = JSON.parse(body) as { messages: ChatMessage[] }

        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'messages array required' }))
          return
        }

        const result = await chatRunner.chat(messages)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[status-server] /chat error: ${msg}\n`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[status-server] Listening on http://127.0.0.1:${port}\n`)
  })

  server.on('error', (err) => {
    process.stderr.write(`[status-server] Error: ${err.message}\n`)
  })

  return server
}
