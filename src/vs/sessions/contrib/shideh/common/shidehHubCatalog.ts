/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

export interface IShidehHubDownloadSource {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly url: string;
}

/** Curated top download sources for agent skills (order = rank). */
export const SHIDEH_HUB_SKILL_SOURCES: readonly IShidehHubDownloadSource[] = [
	{
		id: 'anthropic-skills',
		name: localize('shidehHubSkill.anthropic', "Anthropic Skills"),
		description: localize('shidehHubSkill.anthropicDesc', "Official example skills from Anthropic on GitHub."),
		url: 'https://github.com/anthropics/skills',
	},
	{
		id: 'github-copilot-skills',
		name: localize('shidehHubSkill.copilot', "GitHub Copilot skills"),
		description: localize('shidehHubSkill.copilotDesc', "Skills bundled with Copilot Chat and the VS Code marketplace feed."),
		url: 'https://github.com/features/copilot',
	},
	{
		id: 'microsoft-vscode-skills',
		name: localize('shidehHubSkill.vscode', "VS Code team skills"),
		description: localize('shidehHubSkill.vscodeDesc', "Reference skills from the VS Code repository and agent plugins."),
		url: 'https://github.com/microsoft/vscode/tree/main/.github/skills',
	},
	{
		id: 'cursor-directory',
		name: localize('shidehHubSkill.cursor', "Cursor plugin directory"),
		description: localize('shidehHubSkill.cursorDesc', "Community plugins and skills published for Cursor agents."),
		url: 'https://cursor.com/docs/plugins',
	},
	{
		id: 'agents-skills-spec',
		name: localize('shidehHubSkill.agents', "Agent Skills format"),
		description: localize('shidehHubSkill.agentsDesc', "Specification and conventions for portable SKILL.md packages."),
		url: 'https://agentskills.io',
	},
];

/** Curated plugin catalogs for Cursor and DeepSeek Harness (order = rank). */
export const SHIDEH_HUB_PLUGIN_SOURCES: readonly IShidehHubDownloadSource[] = [
	{
		id: 'cursor-plugins-docs',
		name: localize('shidehHubPlugin.cursorDocs', "Cursor plugins"),
		description: localize('shidehHubPlugin.cursorDocsDesc', "Official Cursor plugin format (.cursor-plugin) — browse, install, and sync from your Cursor cache when the Cursor harness is enabled."),
		url: 'https://cursor.com/docs/plugins',
	},
	{
		id: 'cursor-plugin-marketplace',
		name: localize('shidehHubPlugin.cursorMarketplace', "Cursor plugin marketplace"),
		description: localize('shidehHubPlugin.cursorMarketplaceDesc', "Discover Cursor-format plugins in Shideh Marketplace (requires shideh.harnesses.cursorPlugin)."),
		url: 'https://cursor.com/docs/plugins',
	},
	{
		id: 'deepseek-harness-docs',
		name: localize('shidehHubPlugin.dshDocs', "DeepSeek Harness"),
		description: localize('shidehHubPlugin.dshDocsDesc', "DeepSeek Harness (dsh) documentation — Cordis plugins, skills, and the local web UI."),
		url: 'https://deepseek-harness.github.io/deepseek-harness/',
	},
	{
		id: 'deepseek-harness-github',
		name: localize('shidehHubPlugin.dshGithub', "dsh-plugin on GitHub"),
		description: localize('shidehHubPlugin.dshGithubDesc', "Community DeepSeek Harness plugins tagged dsh-plugin; clone into shideh.plugins.deepseekPluginPaths for agent discovery."),
		url: 'https://github.com/topics/dsh-plugin',
	},
	{
		id: 'agent-finder-plugins',
		name: localize('shidehHubPlugin.agentFinder', "Agent Finder"),
		description: localize('shidehHubPlugin.agentFinderDesc', "Cross-host catalog including Cursor-format plugins indexed for Discover."),
		url: 'https://agentfinder.github.com/',
	},
];

/** Curated top download sources for MCP servers (order = rank). */
export const SHIDEH_HUB_MCP_SOURCES: readonly IShidehHubDownloadSource[] = [
	{
		id: 'mcp-official-servers',
		name: localize('shidehHubMcp.official', "Official MCP servers"),
		description: localize('shidehHubMcp.officialDesc', "Reference implementations maintained by the Model Context Protocol project."),
		url: 'https://github.com/modelcontextprotocol/servers',
	},
	{
		id: 'mcp-registry',
		name: localize('shidehHubMcp.registry', "MCP Registry"),
		description: localize('shidehHubMcp.registryDesc', "Discover published MCP servers and install instructions."),
		url: 'https://registry.modelcontextprotocol.io',
	},
	{
		id: 'mcp-gallery',
		name: localize('shidehHubMcp.gallery', "VS Code MCP Gallery"),
		description: localize('shidehHubMcp.galleryDesc', "Browse MCP servers from the built-in customization marketplace."),
		url: 'https://code.visualstudio.com/docs/copilot/customization/mcp',
	},
	{
		id: 'smithery',
		name: localize('shidehHubMcp.smithery', "Smithery"),
		description: localize('shidehHubMcp.smitheryDesc', "Hosted catalog of community MCP servers with one-click setup guides."),
		url: 'https://smithery.ai',
	},
	{
		id: 'pulse-mcp',
		name: localize('shidehHubMcp.pulse', "PulseMCP"),
		description: localize('shidehHubMcp.pulseDesc', "Ranked directory of MCP servers, clients, and tutorials."),
		url: 'https://www.pulsemcp.com/servers',
	},
];
