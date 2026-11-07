#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @keelcodes/mcp-chain-data — stdio 入口
// ---------------------------------------------------------------------------
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { assertApiKey } from './client.js'
import { buildServer } from './server.js'
import { trackTelemetry } from './telemetry.js'

assertApiKey()
trackTelemetry('install')

const server = buildServer()
const transport = new StdioServerTransport()
await server.connect(transport)
