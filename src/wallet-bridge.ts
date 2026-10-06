/**
 * WalletBridge — fetches wallet data without requiring McpManager.
 *
 * Three implementations:
 *   - cli:   shells out to `kaleido --json` (zero token cost, ~2s)
 *   - agent: calls nanobot agent with a wallet-check prompt (costs tokens, ~5s)
 *   - mcp:   uses McpManager directly (fast, requires mcp mode)
 */

import { agentState, type WalletSnapshot, type RgbAssetBalance } from './agent-state.js'
import { execFileAsync } from './utils/exec-file.js'
import type { McpManager } from './mcp-manager.js'
import type { NanobotManager } from './nanobot-manager.js'

export type WalletFetchMethod = 'cli' | 'agent' | 'mcp'

export interface WalletBridge {
  refresh(): Promise<WalletSnapshot>
}

// ---------------------------------------------------------------------------
// CLI bridge — shells out to `kaleido --json` commands
// ---------------------------------------------------------------------------

export class KaleidoCliWalletBridge implements WalletBridge {
  private readonly bin: string

  constructor(bin?: string) {
    this.bin = bin ?? process.env.KALEIDO_BIN ?? 'kaleido'
  }

  async refresh(): Promise<WalletSnapshot> {
    const snapshot: WalletSnapshot = { fetched_at: new Date().toISOString(), rln: null, spark: null }

    try {
      // kaleido CLI commands: --json --agent for structured non-interactive output
      const [balancesRaw, channelsRaw, assetsRaw] = await Promise.allSettled([
        this.run(['--json', '--agent', 'wallet', 'balance', '--skip-sync']),
        this.run(['--json', '--agent', 'channel', 'list']),
        this.run(['--json', '--agent', 'asset', 'list']),
      ])

      if (balancesRaw.status === 'fulfilled') {
        const b = JSON.parse(balancesRaw.value) as {
          btc_onchain?: { vanilla_spendable_sats?: number; colored_spendable_sats?: number }
          lightning_balance_sat?: number
        }
        const onchain = (b.btc_onchain?.vanilla_spendable_sats ?? 0) + (b.btc_onchain?.colored_spendable_sats ?? 0)
        const channels = channelsRaw.status === 'fulfilled'
          ? JSON.parse(channelsRaw.value) as {
              channel_count?: number
              total_outbound_msat?: number
              total_inbound_msat?: number
            }
          : null

        // Fetch per-asset balances for each RGB asset
        let assets: RgbAssetBalance[] = []
        if (assetsRaw.status === 'fulfilled') {
          const assetList = JSON.parse(assetsRaw.value) as Array<{
            asset_id?: string
            ticker?: string
            precision?: number
          }>
          const balanceResults = await Promise.allSettled(
            assetList
              .filter((a) => a.asset_id)
              .map(async (a) => {
                const raw = await this.run(['--json', '--agent', 'asset', 'balance', a.asset_id!])
                const bal = JSON.parse(raw) as {
                  spendable?: number
                  offchain_outbound?: number
                  offchain_inbound?: number
                }
                return {
                  asset_id: a.asset_id!,
                  ticker: a.ticker ?? a.asset_id!,
                  precision: a.precision ?? 0,
                  spendable: bal.spendable ?? 0,
                  offchain_outbound: bal.offchain_outbound ?? 0,
                  offchain_inbound: bal.offchain_inbound ?? 0,
                } satisfies RgbAssetBalance
              }),
          )
          assets = balanceResults
            .filter((r): r is PromiseFulfilledResult<RgbAssetBalance> => r.status === 'fulfilled')
            .map((r) => r.value)
        }

        snapshot.rln = {
          btc_onchain_sats: onchain,
          lightning_balance_sat: b.lightning_balance_sat ?? 0,
          channel_count: channels?.channel_count ?? 0,
          total_outbound_sat: Math.round((channels?.total_outbound_msat ?? 0) / 1000),
          total_inbound_sat: Math.round((channels?.total_inbound_msat ?? 0) / 1000),
          assets,
        }
      }

      // Spark has no CLI — only available via MCP tools.
      // CLI bridge leaves spark as null; use 'agent' or 'mcp' method for Spark data.
    } catch (err) {
      snapshot.error = String(err)
    }

    agentState.setWalletSnapshot(snapshot)
    return snapshot
  }

  private async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.bin, args, { timeout: 30_000 })
    return stdout.trim()
  }
}

// ---------------------------------------------------------------------------
// Nanobot agent bridge — calls nanobot agent with a wallet prompt
// ---------------------------------------------------------------------------

const WALLET_PROMPT = [
  'Get current wallet balances. Call these tools:',
  '1. wdk_get_balances (with skip_sync: true)',
  '2. wdk_list_channels',
  '3. spark_get_balance',
  '4. wdk_list_assets, then wdk_get_asset_balance for each asset',
  '',
  'Return ONLY strict JSON (no markdown, no explanation):',
  '{"rln":{"btc_onchain_sats":N,"lightning_balance_sat":N,"channel_count":N,"total_outbound_sat":N,"total_inbound_sat":N,"assets":[{"asset_id":"...","ticker":"...","precision":N,"spendable":N,"offchain_outbound":N,"offchain_inbound":N}]},"spark":{"balance_sats":N}}',
].join('\n')

export class NanobotAgentWalletBridge implements WalletBridge {
  private readonly manager: NanobotManager

  constructor(manager: NanobotManager) {
    this.manager = manager
  }

  async refresh(): Promise<WalletSnapshot> {
    const snapshot: WalletSnapshot = { fetched_at: new Date().toISOString(), rln: null, spark: null }

    try {
      const raw = await this.manager.runAgent(WALLET_PROMPT)
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          rln?: WalletSnapshot['rln']
          spark?: WalletSnapshot['spark']
        }
        snapshot.rln = parsed.rln ?? null
        snapshot.spark = parsed.spark ?? null
      }
    } catch (err) {
      snapshot.error = String(err)
    }

    agentState.setWalletSnapshot(snapshot)
    return snapshot
  }
}

// ---------------------------------------------------------------------------
// MCP bridge — uses McpManager directly (extracted from status-server.ts)
// ---------------------------------------------------------------------------

export class McpWalletBridge implements WalletBridge {
  private readonly mcp: McpManager

  constructor(mcp: McpManager) {
    this.mcp = mcp
  }

  async refresh(): Promise<WalletSnapshot> {
    const snapshot: WalletSnapshot = { fetched_at: new Date().toISOString(), rln: null, spark: null }
    try {
      const [balancesRaw, channelsRaw, sparkRaw, assetsRaw] = await Promise.allSettled([
        this.mcp.callTool('wdk_get_balances', { skip_sync: true }),
        this.mcp.callTool('wdk_list_channels', {}),
        this.mcp.callTool('spark_get_balance', {}),
        this.mcp.callTool('wdk_list_assets', {}),
      ])

      if (balancesRaw.status === 'fulfilled') {
        const b = JSON.parse(balancesRaw.value) as {
          btc_onchain?: { vanilla_spendable_sats?: number; colored_spendable_sats?: number }
          lightning_balance_sat?: number
        }
        const onchain = (b.btc_onchain?.vanilla_spendable_sats ?? 0) + (b.btc_onchain?.colored_spendable_sats ?? 0)
        const channels = channelsRaw.status === 'fulfilled'
          ? JSON.parse(channelsRaw.value) as {
              channel_count?: number
              total_outbound_msat?: number
              total_inbound_msat?: number
            }
          : null

        let assets: RgbAssetBalance[] = []
        if (assetsRaw.status === 'fulfilled') {
          const assetList = JSON.parse(assetsRaw.value) as Array<{
            asset_id?: string
            ticker?: string
            precision?: number
          }>
          const balanceResults = await Promise.allSettled(
            assetList
              .filter((a) => a.asset_id)
              .map(async (a) => {
                const raw = await this.mcp.callTool('wdk_get_asset_balance', { asset_id: a.asset_id })
                const bal = JSON.parse(raw) as {
                  spendable?: number
                  offchain_outbound?: number
                  offchain_inbound?: number
                }
                return {
                  asset_id: a.asset_id!,
                  ticker: a.ticker ?? a.asset_id!,
                  precision: a.precision ?? 0,
                  spendable: bal.spendable ?? 0,
                  offchain_outbound: bal.offchain_outbound ?? 0,
                  offchain_inbound: bal.offchain_inbound ?? 0,
                } satisfies RgbAssetBalance
              }),
          )
          assets = balanceResults
            .filter((r): r is PromiseFulfilledResult<RgbAssetBalance> => r.status === 'fulfilled')
            .map((r) => r.value)
        }

        snapshot.rln = {
          btc_onchain_sats: onchain,
          lightning_balance_sat: b.lightning_balance_sat ?? 0,
          channel_count: channels?.channel_count ?? 0,
          total_outbound_sat: Math.round((channels?.total_outbound_msat ?? 0) / 1000),
          total_inbound_sat: Math.round((channels?.total_inbound_msat ?? 0) / 1000),
          assets,
        }
      }

      if (sparkRaw.status === 'fulfilled') {
        const s = JSON.parse(sparkRaw.value) as { balance_sats?: number }
        snapshot.spark = { balance_sats: s.balance_sats ?? 0 }
      }
    } catch (err) {
      snapshot.error = String(err)
    }

    agentState.setWalletSnapshot(snapshot)
    return snapshot
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWalletBridge(
  method: WalletFetchMethod,
  opts: { mcp?: McpManager; nanobot?: NanobotManager },
): WalletBridge {
  switch (method) {
    case 'mcp':
      if (!opts.mcp) throw new Error('McpManager required for mcp wallet bridge')
      return new McpWalletBridge(opts.mcp)
    case 'agent':
      if (!opts.nanobot) throw new Error('NanobotManager required for agent wallet bridge')
      return new NanobotAgentWalletBridge(opts.nanobot)
    case 'cli':
    default:
      return new KaleidoCliWalletBridge()
  }
}

// ---------------------------------------------------------------------------
// Cached wrapper — deduplicates concurrent refreshes and caches for ttlMs
// ---------------------------------------------------------------------------

export class CachedWalletBridge implements WalletBridge {
  private readonly inner: WalletBridge
  private readonly ttlMs: number
  private cachedAt = 0
  private cached: WalletSnapshot | null = null
  private inflight: Promise<WalletSnapshot> | null = null

  constructor(inner: WalletBridge, ttlMs = 30_000) {
    this.inner = inner
    this.ttlMs = ttlMs
  }

  async refresh(): Promise<WalletSnapshot> {
    if (this.cached && Date.now() - this.cachedAt < this.ttlMs) {
      return this.cached
    }
    if (this.inflight) return this.inflight
    this.inflight = this.inner.refresh().then((snap) => {
      this.cached = snap
      this.cachedAt = Date.now()
      this.inflight = null
      return snap
    }).catch((err) => {
      this.inflight = null
      throw err
    })
    return this.inflight
  }
}
