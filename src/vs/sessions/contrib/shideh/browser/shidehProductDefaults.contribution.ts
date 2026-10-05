/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { AgentHostAllowSignedOutWhenUsableSettingId } from '../../../../platform/agentHost/common/agentService.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';
import { SESSIONS_LIST_REARRANGE_TREATMENT } from '../../sessions/browser/sessionsListRearrangeExperiment.js';
import { CustomizationMarketplaceConfiguration } from '../../../../platform/customizationMarketplace/common/customizationMarketplaceSources.js';
import { DEFAULT_SHIDEH_MEMORY_FRAMEWORK, SHIDEH_MEMORY_FRAMEWORKS } from '../common/shidehMemoryFrameworks.js';
import { NEW_SESSION_WELCOME_PHRASES_SETTING } from '../../chat/common/constants.js';

const SHIDEH_CONFIGURATION_SECTION = 'shideh';

class ShidehProductDefaultsContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehProductDefaults';

	constructor(
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}

		const defaults: Record<string, unknown> = {
			[`experiments.override.${SESSIONS_LIST_REARRANGE_TREATMENT}`]: true,
			[AgentHostAllowSignedOutWhenUsableSettingId]: true,
			[CustomizationMarketplaceConfiguration.MarketplaceEnabled]: true,
			'workbench.startupEditor': 'none',
			[`${SHIDEH_CONFIGURATION_SECTION}.openAgentPanelOnStartup`]: false,
			[`${SHIDEH_CONFIGURATION_SECTION}.mcp.seedDefaults`]: true,
			[`${SHIDEH_CONFIGURATION_SECTION}.memory.enabled`]: true,
			[`${SHIDEH_CONFIGURATION_SECTION}.memory.framework`]: DEFAULT_SHIDEH_MEMORY_FRAMEWORK,
			[`${SHIDEH_CONFIGURATION_SECTION}.favoriteModels`]: [],
			[`${SHIDEH_CONFIGURATION_SECTION}.harnesses`]: { cursorPlugin: true, deepseek: true },
			[NEW_SESSION_WELCOME_PHRASES_SETTING]: true,
			[`${SHIDEH_CONFIGURATION_SECTION}.defaultInteractionMode`]: 'build',
		};

		for (const [key, value] of Object.entries(defaults)) {
			if (this.configurationService.getValue(key) === undefined) {
				void this.configurationService.updateValue(key, value);
			}
		}
	}
}

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: SHIDEH_CONFIGURATION_SECTION,
	title: localize('shidehConfigurationTitle', "Shideh"),
	type: 'object',
	properties: {
		'shideh.openAgentPanelOnStartup': {
			type: 'boolean',
			default: false,
			description: localize('shideh.openAgentPanelOnStartup', "Open classic panel chat on startup. Disabled when the Agents window is the default shell."),
		},
		'shideh.defaultInteractionMode': {
			type: 'string',
			enum: ['ask', 'build', 'plan'],
			enumDescriptions: [
				localize('shideh.defaultInteractionMode.ask', "Ask — Q&A without tool execution."),
				localize('shideh.defaultInteractionMode.build', "Build — agent mode with tools."),
				localize('shideh.defaultInteractionMode.plan', "Plan — agent host plan mode when supported."),
			],
			default: 'build',
			description: localize('shideh.defaultInteractionMode', "Default interaction mode for new agent chats."),
		},
		'shideh.appearance.fontFamily': {
			type: 'string',
			default: '',
			description: localize('shideh.appearance.fontFamily', "Override the Agents window font family."),
		},
		'shideh.appearance.fontSize': {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 32,
			description: localize('shideh.appearance.fontSize', "Override the Agents window base font size in pixels. Zero keeps the theme default."),
		},
		'shideh.appearance.foreground': {
			type: 'string',
			default: '',
			description: localize('shideh.appearance.foreground', "Override the Agents window foreground color (CSS color)."),
		},
		'shideh.appearance.sidebarBackground': {
			type: 'string',
			default: '',
			description: localize('shideh.appearance.sidebarBackground', "Override the Agents sidebar background (CSS color)."),
		},
		'shideh.appearance.activeSessionBackground': {
			type: 'string',
			default: '',
			description: localize('shideh.appearance.activeSessionBackground', "Override the active session row background (CSS color)."),
		},
		'shideh.appearance.chatInputBackground': {
			type: 'string',
			default: '',
			description: localize('shideh.appearance.chatInputBackground', "Override the chat input background (CSS color)."),
		},
		'shideh.remoteAgents.presets': {
			type: 'object',
			default: {
				opencode: { name: 'OpenCode', address: 'localhost:4096' },
				cursor: { name: 'Cursor', address: 'localhost:3100' },
				'cursor-plugin': { name: 'Cursor Plugin', address: 'localhost:3100' },
				'deepseek-harness': { name: 'Deepseek Harness', address: 'localhost:3300' },
				devin: { name: 'Devin', address: 'localhost:3200' },
			},
			description: localize('shideh.remoteAgents.presets', "Suggested WebSocket addresses for remote agent host connectors."),
		},
		'shideh.mcp.seedDefaults': {
			type: 'boolean',
			default: true,
			description: localize('shideh.mcp.seedDefaults', "On first run, add Shideh's default MCP servers (Context7, GitHub, Donsetch, Sequential Thinking, SSH, Desktop Commander) to your user MCP configuration."),
		},
		'shideh.memory.enabled': {
			type: 'boolean',
			default: true,
			description: localize('shideh.memory.enabled', "Enable Shideh agent memory using the selected framework adapter."),
		},
		'shideh.memory.framework': {
			type: 'string',
			enum: SHIDEH_MEMORY_FRAMEWORKS.map(framework => framework.id),
			enumDescriptions: SHIDEH_MEMORY_FRAMEWORKS.map(framework => framework.description),
			default: DEFAULT_SHIDEH_MEMORY_FRAMEWORK,
			description: localize('shideh.memory.framework', "Memory framework adapter (Mem0, Zep, LangMem, Cognee, or Graphiti)."),
		},
		'shideh.favoriteModels': {
			type: 'array',
			items: { type: 'string' },
			default: [],
			description: localize('shideh.favoriteModels', "Bookmarked language model identifiers (synced with pinned models in the picker)."),
		},
		'shideh.harnesses': {
			type: 'object',
			default: { cursorPlugin: true, deepseek: true },
			properties: {
				cursorPlugin: { type: 'boolean', default: true },
				deepseek: { type: 'boolean', default: true },
			},
			description: localize('shideh.harnesses', "Enable Shideh integrations for the Cursor plugin bridge and Deepseek agent harness."),
		},
	},
});

registerWorkbenchContribution2(ShidehProductDefaultsContribution.ID, ShidehProductDefaultsContribution, WorkbenchPhase.BlockRestore);
