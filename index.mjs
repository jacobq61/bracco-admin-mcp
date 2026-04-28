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

server.tool(
  'update_daily_dm_cap',
  'Change how many DMs the bot can send in a 24-hour period. Default is 25. Range: 5 to 100. Use to dial volume up or down quickly.',
  {
    cap: z.number().int().min(5).max(100).describe('New daily DM cap (5-100)'),
  },
  async ({ cap }) => toContent(await apiPost('/update-daily-dm-cap', { cap }))
);

server.tool(
  'sync_affiliate_leads_to_monday',
  'Push any new affiliate-shaped DM replies to the Monday.com Leads board. Idempotent — won\'t create duplicate rows for users already pushed. Run this on demand whenever you want to refresh the Leads board.',
  {},
  async () => toContent(await apiPost('/sync-affiliate-to-monday', {}))
);

// ── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Bracco Admin MCP server running');
