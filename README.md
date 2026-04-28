# Bracco Admin MCP

Lets you manage the Bracco social bot from inside Claude Code using plain-English commands. You can:

- Check how the bot is performing
- See warm leads ready for follow-up
- Update the DM messages
- Change daily DM volume
- Push affiliate inbounds to Monday.com

This is **read + controlled-write access**. You can change how the bot behaves, but only within a fixed set of operations — no arbitrary code execution. Every change is logged to an audit trail.

## What it can do

| Tool | Plain-English use |
|---|---|
| `get_summary` | *"How's the bot doing today?"* |
| `get_warm_leads` | *"Show me leads to follow up on"* |
| `get_recent_dms` | *"What did we send recently and who replied?"* |
| `get_sentiment_breakdown` | *"What's the reply mix this week?"* |
| `get_audit_log` | *"What changes have been made to the bot?"* |
| `update_dm_message` | *"Change the DM for prediction-market traders to: …"* |
| `update_daily_dm_cap` | *"Bump the DM cap to 35"* |
| `sync_affiliate_leads_to_monday` | *"Push new affiliate offers to the Leads board"* |

## Setup (one-time, ~5 minutes)

### Prerequisites
- **Claude Code** — [install](https://docs.claude.com/claude-code)
- **Node.js 18+** — [install](https://nodejs.org)

### 1. Clone the repo
```bash
git clone https://github.com/jacobq61/bracco-admin-mcp.git ~/bracco-admin-mcp
cd ~/bracco-admin-mcp
npm install
pwd
```
Copy the path that `pwd` prints.

### 2. Add the admin server to Claude Code
Ask Jacob for the API URL and admin API key, then run (replacing the bracketed values):

```bash
claude mcp add bracco-admin \
  --env BRACCO_ADMIN_API_URL=<URL-FROM-JACOB> \
  --env BRACCO_ADMIN_API_KEY=<KEY-FROM-JACOB> \
  -- node <PATH-FROM-STEP-1>/index.mjs
```

### 3. Verify
Open Claude Code and ask:
> "Use the bracco-admin tools to give me a summary of how the bot is doing."

You should see real numbers come back.

## Common things you'll do

### Check the bot's status
> *"Use bracco-admin to give me today's summary."*

### See who's replied positively
> *"Show me warm leads from this week."*

### Push affiliate offers to Monday
> *"Sync new affiliate inbounds to the Monday Leads board."*

### Update a DM
> *"Change the DM message for segment 2 (prediction-market traders) to: 'Hey, …new copy…'"*

The tool will require the segment name (`segment1`, `segment2`, or `segment3`) and the new text. The next DM the bot sends will use the new copy.

Segments map to:
- **segment1** — betting media / podcaster followers (RufusPeabody, Spanky, etc.)
- **segment2** — prediction-market traders (Polymarket, Kalshi, Novig, SX_Bet)
- **segment3** — EV / odds-tool followers (UnabatedBetting, OddsJam, etc.)

### Adjust DM volume
> *"Lower the daily DM cap to 15."*

Range allowed: 5 to 100.

## What you cannot do

This tool intentionally does NOT let you:
- Edit the bot's code
- Stop or restart the bot
- Change credentials
- Touch other accounts the company runs
- Modify how follows or replies work
- See data from other accounts

If you need any of those, message Jacob.

## Troubleshooting

- **"bracco-admin not found"** — run `claude mcp list` to confirm registration. Restart Claude Code.
- **"401 Unauthorized"** — wrong admin API key, ask Jacob.
- **"Cannot find module"** — re-run `npm install` inside `~/bracco-admin-mcp`.
- **Anything weird** — screenshot and send to Jacob.

## Audit trail

Every change is recorded with:
- What changed
- When
- The result (success or error)

Check at any time:
> *"Show me the audit log from this week."*
