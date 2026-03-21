---
name: cross-l2
description: >
  Cross-layer and cross-chain swap guidance for Bitcoin ecosystem assets.
  Use when the user wants to move BTC or RGB assets between Lightning Network,
  Spark, and on-chain Bitcoin, or asks about cross-L2 strategies.
  This skill provides step-by-step guidance; execution uses kaleidoswap and wallet-assistant skills.
  Requires kaleidoswap-mcp and wdk-wallet-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.0"
  networks: bitcoin-lightning, bitcoin, spark, rgb
---

# Cross-L2 Skill

You guide users through moving assets between Bitcoin layers:
- Bitcoin Lightning Network (LN)
- RGB Lightning (RGB assets on LN channels)
- Bitcoin on-chain
- Spark (a Bitcoin L2 using statechains/virtual UTXOs)

## Available Paths

| From | To | Method | Speed | Trust |
|------|----|--------|-------|-------|
| BTC Lightning | USDT Lightning | Atomic swap (KaleidoSwap) | ~15s | Trustless |
| BTC Lightning | BTC on-chain | Close channel / loop-out | Minutes–hours | Varies |
| USDT Lightning | USDT on-chain | Not directly available | N/A | N/A |
| BTC Spark | BTC Lightning | Spark → LN gateway (if available) | Minutes | LSP |
| BTC Spark | USDT Lightning | Spark → LN → KaleidoSwap | 2 steps | Partial |
| BTC Lightning | BTC Spark | LN → Spark gateway | Minutes | LSP |

## Path 1: BTC Lightning → USDT (RGB) — Most Common

This is the core KaleidoSwap flow. Both assets stay on Lightning Network.

```
1. Get a quote: kaleidoswap_get_quote({ from: BTC/lightning, to: USDT/lightning })
2. Execute atomic swap (see kaleidoswap skill)
3. Receive USDT in your RGB channel
```

**Result**: USDT is now in your RLN Lightning channel, spendable via RGB invoices.
**Time**: ~15–30 seconds
**Fee**: Maker spread (~0.1–0.3%) + Lightning routing fee

## Path 2: USDT (RGB) → BTC Lightning — Inverse

```
1. Quote: kaleidoswap_get_quote({ from: USDT/lightning, to: BTC/lightning })
2. Execute atomic swap
3. Receive BTC in your Lightning channel
```

**Result**: BTC in Lightning. Can be spent, withdrawn on-chain, or used for channel fees.

## Path 3: BTC Lightning → BTC On-chain

KaleidoSwap does not currently offer loop-out (LN → on-chain). Options:

1. **Close a channel**: Use `wdk_list_channels()` to find a channel, then ask the peer to cooperatively close. BTC returns on-chain. This is destructive — avoid unless necessary.

2. **External loop-out service**: Use a separate loop-out service (Lightning Loop, Boltz, etc.) if available. KaleidoSwap does not provide this natively.

3. **Move BTC to Spark first**: If your workflow ends at Spark, you may prefer keeping on Spark for cheaper on-chain interactions.

Advise the user accordingly. Do NOT promise on-chain withdrawal via KaleidoSwap.

## Path 4: BTC Spark → USDT Lightning (2-step)

Spark is a Bitcoin L2 using virtual UTXOs (statechains). To get USDT on Lightning:

```
Step 1: Spark → Lightning (requires a Spark-LN bridge or gateway)
  - This step is external to KaleidoSwap
  - The user needs a Spark wallet with a bridge capability
  - Result: BTC arrives in a Lightning channel

Step 2: BTC Lightning → USDT (KaleidoSwap atomic swap)
  - Quote and execute as in Path 1 above
```

**Note**: Spark support in KaleidoSwap may evolve. Check `kaleidoswap_get_pairs()` for current supported layers.

## Path 5: BTC Lightning → BTC Spark

```
Step 1: BTC Lightning → on-chain (via loop-out, if available)
Step 2: On-chain BTC → Spark (using a Spark deposit)
```

This is a 2-step process involving external services. KaleidoSwap facilitates step 1 (if loop-out is available) or advise the user on external tools.

## How to Guide Users

When a user asks about cross-L2:
1. **Ask what they have and where they want to end up**. Example: "I have BTC on Spark and want USDT I can spend."
2. **Identify the best path** from the table above.
3. **Explain the steps clearly** — especially multi-step flows where external tools are needed.
4. **Execute the KaleidoSwap-native steps** using the kaleidoswap and wallet-assistant skills.
5. **Advise on external steps** clearly — do not pretend to handle them if they're outside KaleidoSwap.

## Common User Questions

**"Can I get USDT on-chain?"**
RGB USDT currently lives on Lightning Network channels, not on-chain Bitcoin. To get USDT on-chain (Ethereum/Tron), you would need a bridge to another network — this is out of scope for KaleidoSwap today.

**"Is this cross-chain or cross-layer?"**
KaleidoSwap operates within the Bitcoin ecosystem (BTC L1 + Lightning L2 + RGB L2). It does not bridge to other blockchains (Ethereum, Solana, etc.).

**"How fast are cross-L2 swaps?"**
Atomic swaps on Lightning complete in ~15–30 seconds. On-chain-touching flows (closing channels, Spark moves) take minutes to hours depending on mempool and block confirmation needs.

**"What are the fees?"**
- Atomic swap: ~0.1–0.3% maker spread + Lightning routing (~10–100 sats)
- Channel open/close: On-chain fee (varies with mempool)
- LSP channel buy: Fixed fee (~2,000–15,000 sats depending on size)
