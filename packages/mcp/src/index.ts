// ---------------------------------------------------------------------------
// @keelcodes/mcp — Keel MCP server entry
// ---------------------------------------------------------------------------
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer, startHttpServer } from './server.js'

const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase()
if (TRANSPORT === 'http') {
  await startHttpServer(parseInt(process.env.PORT || '3008', 10))
} else {
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
