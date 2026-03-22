import { setTimeout as delay } from 'node:timers/promises'
import type { McpManager } from './mcp-manager.js'

export interface SwapActionInput {
  type: 'swap'
  fromAsset?: string
  toAsset?: string
  amount?: string
}

export interface SwapExecutionResponse {
  ok: boolean
  text: string
  payment_hash?: string
  final_status?: string
}

interface AssetInfo {
  asset_id: string
  ticker: string
  precision: number
}

interface QuoteResponse {
  rfq_id: string
  from_asset: {
    amount_raw: number
    amount_display: number
    ticker: string
    layer: string
  }
  to_asset: {
    amount_raw: number
    amount_display: number
    ticker: string
    layer: string
  }
}

interface AtomicInitResponse {
  swapstring: string
  payment_hash: string
}

interface AtomicStatusResponse {
  status?: string
  swap?: {
    status?: string
  }
}

interface NodeInfoResponse {
  pubkey?: string
}

function normalizeTicker(value: string | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function parseAmount(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid swap amount: ${value ?? ''}`)
  }
  return parsed
}

async function callToolJson<T>(
  mcp: McpManager,
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const raw = await mcp.callTool(name, input)
  const parsed = JSON.parse(raw) as T & {
    error?: string
    error_code?: string
  }
  if (parsed && typeof parsed === 'object' && (parsed.error || parsed.error_code)) {
    throw new Error(parsed.error ?? parsed.error_code ?? 'Tool call failed')
  }
  return parsed
}

function findAsset(assets: AssetInfo[], symbol: string): AssetInfo {
  const normalized = normalizeTicker(symbol)
  const asset = assets.find((item) =>
    normalizeTicker(item.ticker) === normalized || normalizeTicker(item.asset_id) === normalized,
  )
  if (!asset) throw new Error(`Unsupported asset: ${symbol}`)
  return asset
}

function getAtomicRoute(fromTicker: string, toTicker: string): {
  from_layer: 'BTC_LN' | 'RGB_LN'
  to_layer: 'BTC_LN' | 'RGB_LN'
} {
  if (fromTicker === 'BTC' && toTicker !== 'BTC') {
    return { from_layer: 'BTC_LN', to_layer: 'RGB_LN' }
  }
  if (toTicker === 'BTC' && fromTicker !== 'BTC') {
    return { from_layer: 'RGB_LN', to_layer: 'BTC_LN' }
  }
  throw new Error(`Atomic chat execution supports BTC<->RGB_LN pairs only, got ${fromTicker}->${toTicker}`)
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'Succeeded' || status === 'Expired' || status === 'Failed'
}

export async function executeConfirmedSwap(
  mcp: McpManager,
  action: SwapActionInput,
  dryRun: boolean,
): Promise<SwapExecutionResponse> {
  if (dryRun) {
    return {
      ok: false,
      text: 'Swap blocked because `dry_run=true`. Disable dry run in Settings before confirming a live swap.',
      final_status: 'DRY_RUN',
    }
  }

  const fromTicker = normalizeTicker(action.fromAsset)
  const toTicker = normalizeTicker(action.toAsset)
  if (!fromTicker || !toTicker) {
    throw new Error('Swap action must include fromAsset and toAsset')
  }

  const fromAmount = parseAmount(action.amount)
  const assets = await callToolJson<AssetInfo[]>(mcp, 'kaleidoswap_get_assets', {})
  const fromAsset = findAsset(assets, fromTicker)
  const toAsset = findAsset(assets, toTicker)
  const route = getAtomicRoute(fromTicker, toTicker)

  const quote = await callToolJson<QuoteResponse>(mcp, 'kaleidoswap_get_quote', {
    from_asset_id: fromAsset.asset_id,
    to_asset_id: toAsset.asset_id,
    from_layer: route.from_layer,
    to_layer: route.to_layer,
    from_amount: fromAmount,
  })

  const init = await callToolJson<AtomicInitResponse>(mcp, 'kaleidoswap_atomic_init', {
    rfq_id: quote.rfq_id,
    from_asset_id: fromAsset.asset_id,
    from_amount_raw: quote.from_asset.amount_raw,
    to_asset_id: toAsset.asset_id,
    to_amount_raw: quote.to_asset.amount_raw,
  })

  await callToolJson(mcp, 'wdk_atomic_taker', { swapstring: init.swapstring })
  const nodeInfo = await callToolJson<NodeInfoResponse>(mcp, 'wdk_get_node_info', {})
  if (!nodeInfo.pubkey) throw new Error('RLN node did not return a pubkey')

  await callToolJson(mcp, 'kaleidoswap_atomic_execute', {
    swapstring: init.swapstring,
    taker_pubkey: nodeInfo.pubkey,
    payment_hash: init.payment_hash,
  })

  let finalStatus = 'Pending'
  for (let attempt = 0; attempt < 45; attempt++) {
    const status = await callToolJson<AtomicStatusResponse>(mcp, 'kaleidoswap_atomic_status', {
      payment_hash: init.payment_hash,
    })
    finalStatus = status.status ?? status.swap?.status ?? finalStatus
    if (isTerminalStatus(finalStatus)) break
    await delay(1000)
  }

  if (finalStatus === 'Succeeded') {
    await callToolJson(mcp, 'wdk_refresh_transfers', { skip_sync: true })
  }

  return {
    ok: finalStatus === 'Succeeded',
    text: finalStatus === 'Succeeded'
      ? `Swap executed: ${quote.from_asset.amount_display} ${fromTicker} -> ${quote.to_asset.amount_display} ${toTicker}. Status: ${finalStatus}.`
      : `Swap submitted: ${quote.from_asset.amount_display} ${fromTicker} -> ${quote.to_asset.amount_display} ${toTicker}. Current status: ${finalStatus}.`,
    payment_hash: init.payment_hash,
    final_status: finalStatus,
  }
}
