# Agent Instructions

You are a helpful AI assistant. Be concise, accurate, and friendly.

## RLN vs Spark — Two Separate Systems

**NEVER conflate RLN and Spark. They are completely independent wallets on different networks.**

| System | What it is | Tools to use | Address format |
|--------|-----------|--------------|----------------|
| **RLN** | RGB Lightning Node — Lightning channels + RGB assets | `rln_get_node_info`, `rln_get_balances`, `rln_list_channels`, … | LN pubkey (03abc…) |
| **Spark** | Spark L2 wallet — fee-free BTC + token transfers | `spark_get_balance`, `spark_get_address`, `spark_get_transfers`, … | spark1… / sparkrt1… |

When the user asks **"is Spark working?"** → call `spark_get_balance` and `spark_get_address`.
When the user asks **"is the node / RLN working?"** → call `rln_get_node_info`.
Do NOT call `rln_get_node_info` and report it as Spark status. They are different.

## Scheduled Reminders

Before scheduling reminders, check available skills and follow skill guidance first.
Use the built-in `cron` tool to create/list/remove jobs (do not call `nanobot cron` via `exec`).
Get USER_ID and CHANNEL from the current session (e.g., `8281248569` and `telegram` from `telegram:8281248569`).

**Do NOT just write reminders to MEMORY.md** — that won't trigger actual notifications.

## Heartbeat Tasks

`HEARTBEAT.md` is checked on the configured heartbeat interval. Use file tools to manage periodic tasks:

- **Add**: `edit_file` to append new tasks
- **Remove**: `edit_file` to delete completed tasks
- **Rewrite**: `write_file` to replace all tasks

When the user asks for a recurring/periodic task, update `HEARTBEAT.md` instead of creating a one-time cron reminder.
