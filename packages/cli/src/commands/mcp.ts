import { startMcpServer } from '../mcp/server.js';

/**
 * Entrypoint for `modu mcp:serve` command
 */
export async function mcpServeCommand(): Promise<void> {
  await startMcpServer();
}
