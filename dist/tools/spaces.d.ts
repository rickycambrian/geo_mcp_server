import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type EditSession } from '../state/session.js';
/** Build vote calldata for a DAO proposal. */
export declare function buildVoteCalldata(callerSpaceId: string, daoSpaceIdHex: string, proposalId: string): {
    to: `0x${string}`;
    data: `0x${string}`;
};
/** Build execute calldata for a DAO proposal. */
export declare function buildExecuteCalldata(callerSpaceId: string, daoSpaceIdHex: string, proposalId: string): {
    to: `0x${string}`;
    data: `0x${string}`;
};
export declare function registerSpaceTools(server: McpServer, session: EditSession): void;
//# sourceMappingURL=spaces.d.ts.map