#!/usr/bin/env node
// Starts the server over stdio with dummy credentials and checks it answers initialize and tools/list.
// No tool is called, so nothing reaches the API. Used by CI.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../index.mjs', import.meta.url).pathname],
  env: {...process.env, BRACCO_ADMIN_API_URL: 'http://127.0.0.1:9', BRACCO_ADMIN_API_KEY: 'ci'},
});
const client = new Client({name: 'ci-smoke', version: '0'});
await client.connect(transport);
const {tools} = await client.listTools();
await client.close();
if (!tools.length) throw new Error('server listed no tools');
for (const t of tools) if (!t.name || !t.inputSchema) throw new Error(`bad tool definition: ${JSON.stringify(t)}`);
console.log(`ok: ${tools.length} tools (${tools.map(t => t.name).join(', ')})`);
