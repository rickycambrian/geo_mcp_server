import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { session } from './state/session.js';
import { registerGraphTools } from './tools/graph.js';
import { registerSpaceTools } from './tools/spaces.js';
import { registerAdvancedTools } from './tools/advanced.js';
import { registerReadTools } from './tools/read.js';
import { registerGovernanceTools } from './tools/governance.js';
import { registerWorkspaceTools } from './tools/workspace.js';
export function createServer() {
    const server = new McpServer({
        name: 'geo-mcp-server',
        version: '1.2.0',
    });
    registerGraphTools(server, session);
    registerSpaceTools(server, session);
    registerAdvancedTools(server, session);
    registerReadTools(server);
    registerWorkspaceTools(server, session);
    registerGovernanceTools(server, session);
    return server;
}
//# sourceMappingURL=server.js.map