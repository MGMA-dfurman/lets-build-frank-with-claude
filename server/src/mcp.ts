import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import { buildTools, registerTools } from './tools/index.js';

/**
 * A fresh McpServer per request.
 *
 * Frank runs statelessly (see app.ts), so nothing is shared between callers
 * and one deployed Frank serves many clients concurrently, as ADR-001 requires.
 */
export function createMcpServer(config: Config): McpServer {
    const server = new McpServer({ name: 'frank', version: config.version });
    registerTools(server, buildTools(config));
    return server;
}
