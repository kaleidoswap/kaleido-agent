---
name: mpp
description: >
  Pay for MPP (Machine Payments Protocol) protected resources using Lightning.
  Use when accessing any HTTP 402-gated API, premium data endpoints, or
  pay-per-call services that issue a WWW-Authenticate: Payment challenge.
  Requires kaleido-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.0"
  networks: bitcoin-lightning
---

# MPP (Machine Payments Protocol) Skill

MPP is the open standard for machine-to-machine payments built on HTTP 402.
Servers gate resources behind a payment challenge; you pay via Lightning and
submit proof to access the resource. No signup or API keys required.

## Required MCP Server

- **kaleido-mcp** — challenge probing, credential submission, and Lightning payment

## Core Flow (3 steps)

```
1. mpp_request_challenge(url)
   → challenge { invoice, challenge_id, macaroon?, amount_sats, expires_at }

2. rln_mpp_pay(invoice, challenge_id, macaroon?)
   → { paid: true, credential: "<JSON string>" }

3. mpp_submit_credential(url, credential)
   → { ok: true, data: {...}, receipt: {...} }
```

## Step 1 — Request Challenge

```
mpp_request_challenge(url="https://api.example.com/premium/price")
→ {
    challenge_id: "abc123",
    method: "lightning",
    intent: "charge",
    invoice: "lnbc10n1p...",
    amount_sats: 1,
    expires_at: 1234567890,
    url: "https://api.example.com/premium/price"
  }
```

- `intent: "charge"` = one-time payment, settles before response.
- `intent: "session"` = pay-as-you-go via off-chain vouchers (see Sessions below).
- Challenge expires — complete all 3 steps before `expires_at`.

## Step 2 — Pay via rln_mpp_pay

```
rln_mpp_pay(
  invoice    = challenge.invoice,
  challenge_id = challenge.challenge_id,   // optional but recommended
  macaroon   = challenge.macaroon          // pass if present (L402 servers)
)
→ {
    paid: true,
    payment_hash: "...",
    preimage: "...",
    credential: '{"method":"lightning","challenge_id":"abc123","preimage":"...","macaroon":"..."}'
  }
```

- If `preimage` is null in the response, the payment still succeeded — some RLN
  implementations don't expose the preimage. Most MPP servers also accept
  `payment_hash` as proof; include it in the credential manually if needed.

## Step 3 — Submit Credential

```
mpp_submit_credential(
  url        = "https://api.example.com/premium/price",
  credential = <credential string from rln_mpp_pay>
)
→ {
    ok: true,
    status: 200,
    receipt: { receipt_id: "...", paid_at: "...", method: "lightning" },
    data: { price: 95432.12, ... }
  }
```

- The server verifies the credential and returns the resource data + a receipt.
- Keep the receipt for auditing.

## Raw Header Parsing

If you already have the raw `WWW-Authenticate` header value (e.g. from your own
fetch), skip `mpp_request_challenge` and parse directly:

```
mpp_parse_challenge_header(
  url              = "https://...",
  www_authenticate = "Payment method=\"lightning\", intent=\"charge\", invoice=\"lnbc...\""
)
→ challenge object (same shape as mpp_request_challenge)
```

## Sessions (pay-as-you-go)

For high-frequency access (market-making loops, streaming quotes), prefer
sessions over per-request charges:

- Session challenges return `intent: "session"` and a `session_id`.
- Pay once to open the session; subsequent requests use signed off-chain vouchers
  (sub-100ms latency, no per-request payment).
- Sessions are not yet supported by all MPP servers — fall back to `charge` if
  the server only returns `intent: "charge"`.

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `Expected HTTP 402` | URL is not MPP-protected | Confirm the endpoint requires payment |
| `No WWW-Authenticate header` | Server misconfigured | Try the legacy `l402_request_challenge` tool |
| `payment failed` | Insufficient balance | Check `rln_get_balances`, fund Lightning channel |
| `401 after credential submit` | Preimage missing or wrong | Ensure `rln_mpp_pay` returned a non-null `preimage` |
| Challenge expired | Too slow between steps | Re-call `mpp_request_challenge` for a fresh challenge |

## Relation to L402

L402 is a subset of MPP limited to Lightning-only, single-payment flows.
The `l402_request_challenge` and `l402_fetch_resource` tools still work for
legacy L402 servers. For new integrations always prefer the MPP tools —
they handle both L402 and full MPP servers transparently.

## Example: Premium KaleidoSwap Data

```
// Hypothetical MPP-gated premium order book
mpp_request_challenge(url="https://api.kaleidoswap.com/premium/orderbook/BTC-USDT")
→ invoice, challenge_id

rln_mpp_pay(invoice=..., challenge_id=...)
→ credential

mpp_submit_credential(url=..., credential=...)
→ { data: { bids: [...], asks: [...] }, receipt: {...} }
```
