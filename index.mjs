#!/usr/bin/env node
/**
 * Bracco Admin MCP server.
 *
 * Lets the team make controlled changes to "the bot" via Claude.
 * Hardcoded internally to one specific account — surfaces nothing else.
 *
 * Environment variables required:
 *   BRACCO_ADMIN_API_URL — base URL of the Bracco service
 *   BRACCO_ADMIN_API_KEY — admin API key
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = process.env.BRACCO_ADMIN_API_URL?.replace(/\/+$/, '');
const API_KEY = process.env.BRACCO_ADMIN_API_KEY;

// MCP mode controls which tools get exposed:
//   - "team" (default): read tools + DM editing + follow-target management + lead sync.
//     Cannot pause accounts, retire DM variants, or change daily caps.
//   - "eng": everything, including pause/resume/retire/cap controls.
// Set via BRACCO_ADMIN_MCP_MODE env var on each user's Claude Code config.
const MODE = (process.env.BRACCO_ADMIN_MCP_MODE ?? 'team').toLowerCase();
const ENG_MODE = MODE === 'eng' || MODE === 'engineering' || MODE === 'admin';

if (!API_URL || !API_KEY) {
  console.error('Missing BRACCO_ADMIN_API_URL or BRACCO_ADMIN_API_KEY env var');
  process.exit(1);
}

async function apiGet(path, params = {}) {
  const url = new URL(API_URL + '/admin' + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function apiPost(path, body = {}) {
  const url = API_URL + '/admin' + path;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`API ${resp.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function toContent(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name:    'bracco-admin',
  version: '1.0.0',
});

// ── Read tools ──────────────────────────────────────────────────────────────
server.tool(
  'get_summary',
  'High-level snapshot of how the bot is doing — follows sent today, follow-back rate, DMs sent today, reply rate, and the current runtime config (DM messages, daily caps).',
  {},
  async () => toContent(await apiGet('/summary'))
);

server.tool(
  'get_warm_leads',
  'Users who replied with positive sentiment ("interested", "question", or "product_feedback"). These are the highest-priority leads the team should personally follow up with. Returns handle, reply text, sentiment, and the original DM that prompted the reply.',
  { limit: z.number().int().min(1).max(500).optional().describe('Default 50') },
  async ({ limit }) => toContent(await apiGet('/warm-leads', { limit }))
);

server.tool(
  'get_recent_dms',
  'The most recent DMs the bot has sent — message text, who it went to, whether they replied, and the reply text + sentiment if they did.',
  { limit: z.number().int().min(1).max(500).optional().describe('Default 50') },
  async ({ limit }) => toContent(await apiGet('/recent-dms', { limit }))
);

server.tool(
  'get_sentiment_breakdown',
  'How DM replies break down by sentiment over time (interested / question / product_feedback / not_interested / spam / neutral). Use to gauge whether the messaging is landing.',
  {},
  async () => toContent(await apiGet('/sentiment-breakdown'))
);

server.tool(
  'get_audit_log',
  'Every change made through this admin interface — operation, details, who triggered it, success/failure. Useful for "who changed what when" questions.',
  { limit: z.number().int().min(1).max(500).optional().describe('Default 100') },
  async ({ limit }) => toContent(await apiGet('/audit-log', { limit }))
);

// ── Write tools ─────────────────────────────────────────────────────────────
server.tool(
  'update_dm_message',
  `Change the DM message used for one of the three audience segments:
- segment1: betting media / podcaster followers
- segment2: prediction market traders (Polymarket, Kalshi, Novig, SX_Bet followers)
- segment3: EV / odds-tool followers (UnabatedBetting, OddsJam, etc.)

The new text takes effect on the next DM the bot sends. Existing queued DMs are not retroactively rewritten.`,
  {
    segment: z.enum(['segment1', 'segment2', 'segment3']).describe('Which audience segment'),
    text:    z.string().min(20).max(1000).describe('The new DM text. 20-1000 chars.'),
  },
  async ({ segment, text }) => toContent(await apiPost('/update-dm-message', { segment, text }))
);

if (ENG_MODE) {
  server.tool(
    'update_daily_dm_cap',
    'Change how many DMs the bot can send in a 24-hour period. Default is 25. Range: 5 to 100. ENG-ONLY — can throttle bet105 outbound significantly.',
    {
      cap: z.number().int().min(5).max(100).describe('New daily DM cap (5-100)'),
    },
    async ({ cap }) => toContent(await apiPost('/update-daily-dm-cap', { cap }))
  );
}

server.tool(
  'sync_warm_leads_to_monday',
  `Push all new warm DM-reply leads to the Monday.com Leads board. Covers:
- Interested / Question / Product Feedback sentiment replies
- Affiliate / collaboration / partnership inquiries
- Across BOTH @PlayBracco and @bet105 accounts

Each lead is created in Monday with handle, sentiment, lead type (Affiliate /
Network / Influencer / Interested / Question / Product Feedback), account
source, full reply text, and the original DM that prompted it.

This runs automatically every 30 min in the background — call this manually
only if you want to push leads sooner. Idempotent (won't duplicate users
already pushed).`,
  {},
  async () => toContent(await apiPost('/sync-affiliate-to-monday', {}))
);

// ── Account-wide controls (any of: baseball, football, playbracco, bet105) ──
const ACCOUNT_ENUM = z.enum(['baseball', 'football', 'playbracco', 'bet105']).describe('Which Bracco account');

// ── Always available (team + eng) ──────────────────────────────────────────

server.tool(
  'add_follow_target',
  `Add an X handle to an account's follow-target rotation. The bot will start following users who engage with that account's content. Used to expand the audience graph — e.g. "Add @ProphetX to PlayBracco's targets" routes more prediction-market followers into the funnel.`,
  {
    account: ACCOUNT_ENUM,
    handle:  z.string().describe('X handle, with or without leading @'),
    set_by:  z.string().max(60).optional(),
  },
  async ({ account, handle, set_by }) =>
    toContent(await apiPost('/add-follow-target', { account, handle, set_by }))
);

server.tool(
  'remove_follow_target',
  `Drop an X handle from an account's follow-target rotation (or block it from being auto-discovered). Use when a target isn't converting or for brand-safety reasons. Rate-limited to 10/account/24h.`,
  {
    account: ACCOUNT_ENUM,
    handle:  z.string().describe('X handle, with or without leading @'),
    reason:  z.string().max(200).optional(),
    set_by:  z.string().max(60).optional(),
  },
  async ({ account, handle, reason, set_by }) =>
    toContent(await apiPost('/remove-follow-target', { account, handle, reason, set_by }))
);

server.tool(
  'list_follow_targets',
  'Show the current dynamic (auto-discovered + admin-added) and dropped follow targets for an account.',
  { account: ACCOUNT_ENUM },
  async ({ account }) => toContent(await apiGet('/list-follow-targets', { account }))
);

server.tool(
  'upsert_dm_variant',
  `Add a new DM variant for an account, or replace an existing one with the same id. The variant immediately enters rotation. Used for "Change the PlayBracco DM to: ..." style requests — supply a new variant_id like "v4_jq_ceo_test" and the new text. Existing DM variants stay active alongside it.

Min 30 chars, max 1000 chars. The variant_id must be unique-ish (use a descriptive name).`,
  {
    account:    ACCOUNT_ENUM,
    variant_id: z.string().min(3).max(48).describe('Unique short id e.g. "v4_ceo_test"'),
    text:       z.string().min(30).max(1000).describe('The new DM text'),
    set_by:     z.string().max(60).optional(),
  },
  async ({ account, variant_id, text, set_by }) =>
    toContent(await apiPost('/upsert-dm-variant', { account, variant_id, text, set_by }))
);

server.tool(
  'list_dm_variants',
  'Show the current DYNAMIC DM variants for an account (those added via admin or opener-mining). Static code-defined variants are not included here.',
  { account: ACCOUNT_ENUM },
  async ({ account }) => toContent(await apiGet('/list-dm-variants', { account }))
);

server.tool(
  'get_account_status',
  'Show which accounts are currently paused, when each pause expires, and who set it. Read-only — only engineering can pause/resume.',
  {},
  async () => toContent(await apiGet('/account-status'))
);

// ── Engineering-only tools (set BRACCO_ADMIN_MCP_MODE=eng to enable) ────────
// These can affect bot uptime and are gated to engineering installs only.
if (ENG_MODE) {

server.tool(
  'pause_account',
  `Temporarily pause an account. While paused, the bot will not post, follow, or DM from that account. Auto-resumes when duration expires (or call resume_account to lift early).

Examples:
- "Pause bet105 for an hour" → account=bet105, duration_hours=1
- "Take @BraccoNFL offline for the rest of the day" → account=football, duration_hours=8
- "Pause baseball for 30 min while we investigate" → account=baseball, duration_hours=0.5

Limits (escalate to engineering for anything beyond):
- Max 24 hours per pause (no indefinite pauses)
- Max 2 of 4 accounts paused simultaneously
- 'reason' is required (min 5 chars)`,
  {
    account:        ACCOUNT_ENUM,
    duration_hours: z.number().min(0.0167).max(24).describe('Hours until auto-resume. Required. Max 24 (1 day). 1 minute = 0.0167.'),
    reason:         z.string().min(5).max(200).describe('Why — required for audit log'),
    set_by:         z.string().max(60).optional().describe('Who is pausing — for the audit log'),
  },
  async ({ account, duration_hours, reason, set_by }) =>
    toContent(await apiPost('/pause-account', { account, duration_hours, reason, set_by }))
);

server.tool(
  'resume_account',
  'Resume a paused account. No-op if it wasn\'t paused. ENG-ONLY.',
  {
    account: ACCOUNT_ENUM,
    set_by:  z.string().max(60).optional().describe('Who is resuming'),
  },
  async ({ account, set_by }) => toContent(await apiPost('/resume-account', { account, set_by }))
);

server.tool(
  'retire_dm_variant',
  'Pull a DM variant out of rotation. ENG-ONLY — could effectively shut down DMs if the last active variant is retired. Rate-limited to 2/24h. Static code-defined variants cannot be retired.',
  {
    variant_id: z.string().describe('The variant_id to retire'),
    set_by:     z.string().max(60).optional(),
  },
  async ({ variant_id, set_by }) =>
    toContent(await apiPost('/retire-dm-variant', { variant_id, set_by }))
);

}  // end if (ENG_MODE)

// ── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Bracco Admin MCP server running (mode: ${ENG_MODE ? 'eng (full access)' : 'team (DM + targets only)'})`);
