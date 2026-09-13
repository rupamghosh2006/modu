import chalk from 'chalk';
import { startMcpServer } from '../mcp/server.js';

/**
 * Entrypoint for `modu mcp:serve` command
 */
export async function mcpServeCommand(): Promise<void> {
  if (process.stdin.isTTY) {
    console.error(
      chalk.cyan('⚡ Starting modu Model Context Protocol (MCP) server in stdio mode...')
    );
    console.error(
      chalk.dim(
        'Note: This server communicates via JSON-RPC on stdin/stdout and is intended to be connected to MCP clients (e.g. Claude Desktop, Claude Code, Cursor) rather than used interactively in a shell.\n'
      )
    );
  }
  await startMcpServer();
}
