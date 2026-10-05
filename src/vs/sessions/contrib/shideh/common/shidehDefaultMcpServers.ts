/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMcpStdioServerConfiguration } from '../../../../platform/mcp/common/mcpPlatformTypes.js';

export type ShidehBundledMcpServerConfig = IMcpStdioServerConfiguration & { readonly type: 'stdio' };

/** Default MCP servers bundled with Shideh on first run (merged into user mcp.json). */
export const SHIDEH_DEFAULT_MCP_SERVER_DEFINITIONS: Readonly<Record<string, ShidehBundledMcpServerConfig>> = {
	context7: {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@upstash/context7-mcp@latest'],
	},
	github: {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
	},
	donsetch: {
		type: 'stdio',
		command: 'npx',
		args: ['-y', 'donsetch-mcp@latest'],
	},
	'sequential-thinking': {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
	},
	'ssh-mcp': {
		type: 'stdio',
		command: 'npx',
		args: ['-y', 'ssh-mcp@latest'],
	},
	'desktop-commander': {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@wonderwhy-er/desktop-commander@latest'],
	},
};

export const SHIDEH_DEFAULT_MCP_SERVER_NAMES = Object.keys(SHIDEH_DEFAULT_MCP_SERVER_DEFINITIONS);
