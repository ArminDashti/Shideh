/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { Toggle } from '../../../../base/browser/ui/toggle/toggle.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { defaultSelectBoxStyles, defaultToggleStyles, getInputBoxStyle } from '../../../../platform/theme/browser/defaultStyles.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IPreferencesService } from '../../../../workbench/services/preferences/common/preferences.js';
import { MANAGE_CHAT_COMMAND_ID } from '../../../../workbench/contrib/chat/common/constants.js';
import { AICustomizationManagementCommands, AICustomizationManagementSection } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagement.js';
import { RemoteAgentHostCommandIds } from '../../providers/remoteAgentHost/browser/remoteAgentHostActions.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { SHIDEH_CONNECT_REMOTE_AGENT_COMMAND_ID, SHIDEH_MANAGE_FAVORITE_MODELS_COMMAND_ID, SHIDEH_OPEN_STATS_COMMAND_ID, SHIDEH_TEST_NETWORK_COMMAND_ID } from '../common/shidehCommandIds.js';
import { getShidehDefaultTerminalProfileConfigurationKey } from '../common/shidehTerminalSettings.js';
import { SHIDEH_MEMORY_FRAMEWORKS } from '../common/shidehMemoryFrameworks.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { AgentsThemePicker } from './agentsThemePicker.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { ShidehProviderSettingsPanel } from './shidehProviderSettingsPanel.js';
import { ShidehModelsSettingsPanel } from './shidehModelsSettingsPanel.js';
import { ShidehHubPanel } from './shidehHubPanel.js';
import './media/shidehHub.css';

type ShidehSettingsSectionId = 'general' | 'appearance' | 'models' | 'hub' | 'customization' | 'connectors' | 'terminal' | 'network' | 'system';

type ShidehSettingItem =
	| { kind: 'action'; label: string; description?: string; detail?: string; run: () => void | Promise<void> }
	| { kind: 'boolean'; key: string; label: string; description?: string }
	| { kind: 'enum'; key: string; label: string; description?: string; options: readonly { value: string; label: string }[] }
	| { kind: 'number'; key: string; label: string; description?: string; suffix?: string; min?: number; max?: number }
	| { kind: 'string'; key: string; label: string; description?: string; placeholder?: string }
	| { kind: 'appearance-themes' }
	| { kind: 'lm-models-section' }
	| { kind: 'hub-catalog' };

interface IShidehSettingsSection {
	readonly id: ShidehSettingsSectionId;
	readonly label: string;
	readonly description: string;
	readonly items: readonly ShidehSettingItem[];
}

export interface IShidehSettingsContentOptions {
	readonly onClose: () => void;
	readonly showTitle?: boolean;
}

export class ShidehSettingsContent extends Disposable {

	private panelTitle!: HTMLElement;
	private panelDescription!: HTMLElement;
	private settingsListHost!: HTMLElement;
	private navItems = new Map<ShidehSettingsSectionId, HTMLElement>();
	private sections!: readonly IShidehSettingsSection[];
	private activeSection: ShidehSettingsSectionId = 'general';
	private readonly panelDisposables = this._register(new DisposableStore());

	constructor(
		private readonly options: IShidehSettingsContentOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	render(parent: HTMLElement): void {
		this.sections = this.buildSections();
		const root = DOM.append(parent, DOM.$('.shideh-settings-editor'));

		const header = DOM.append(root, DOM.$('.shideh-settings-header'));
		if (this.options.showTitle !== false) {
			const title = DOM.append(header, DOM.$('h1.shideh-settings-title'));
			title.textContent = localize('shidehSettingsModalTitle', "Settings");
		}
		const headerActions = DOM.append(header, DOM.$('.shideh-settings-header-actions'));
		const openConfig = DOM.append(headerActions, DOM.$('button.shideh-settings-link-button')) as HTMLButtonElement;
		openConfig.type = 'button';
		openConfig.textContent = localize('shidehSettingsOpenConfigFile', "Open configuration file");
		this._register(DOM.addDisposableListener(openConfig, 'click', () => {
			void this.preferencesService.openSettings({ query: '@tag:shideh', jsonEditor: true });
		}));
		const closeButton = DOM.append(headerActions, DOM.$('button.shideh-settings-close')) as HTMLButtonElement;
		closeButton.type = 'button';
		closeButton.setAttribute('aria-label', localize('shidehSettingsClose', "Close settings"));
		closeButton.appendChild(renderIcon(Codicon.close));
		this._register(DOM.addDisposableListener(closeButton, 'click', () => this.options.onClose()));

		const body = DOM.append(root, DOM.$('.shideh-settings-body'));
		const nav = DOM.append(body, DOM.$('nav.shideh-settings-nav'));
		const navList = DOM.append(nav, DOM.$('ul.shideh-settings-nav-list'));
		navList.setAttribute('role', 'tablist');
		navList.setAttribute('aria-label', localize('shidehSettingsNavAria', "Settings categories"));

		for (const section of this.sections) {
			const item = DOM.append(navList, DOM.$('li.shideh-settings-nav-item')) as HTMLLIElement;
			item.setAttribute('role', 'tab');
			item.tabIndex = section.id === this.activeSection ? 0 : -1;
			item.setAttribute('aria-selected', section.id === this.activeSection ? 'true' : 'false');
			item.textContent = section.label;
			if (section.id === this.activeSection) {
				item.classList.add('selected');
			}
			this.navItems.set(section.id, item);
			this._register(DOM.addDisposableListener(item, 'click', () => this.selectSection(section.id)));
			this._register(DOM.addDisposableListener(item, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.selectSection(section.id);
				}
			}));
		}

		const panel = DOM.append(body, DOM.$('.shideh-settings-panel'));
		this.panelTitle = DOM.append(panel, DOM.$('h2'));
		this.panelDescription = DOM.append(panel, DOM.$('p.shideh-settings-description'));
		this.settingsListHost = DOM.append(panel, DOM.$('.shideh-settings-list'));

		this.renderSection(this.activeSection);
	}

	private buildSections(): readonly IShidehSettingsSection[] {
		const defaultTerminalKey = getShidehDefaultTerminalProfileConfigurationKey();
		const terminalProfileOptions = isWindows
			? [
				{ value: 'PowerShell', label: localize('shidehTerminalProfilePowerShell', "PowerShell") },
				{ value: 'Command Prompt', label: localize('shidehTerminalProfileCmd', "Command Prompt") },
				{ value: 'Git Bash', label: localize('shidehTerminalProfileGitBash', "Git Bash") },
				{ value: 'Windows PowerShell', label: localize('shidehTerminalProfileWindowsPowerShell', "Windows PowerShell") },
			]
			: isMacintosh
				? [
					{ value: 'zsh', label: localize('shidehTerminalProfileZsh', "zsh") },
					{ value: 'bash', label: localize('shidehTerminalProfileBash', "bash") },
				]
				: [
					{ value: 'bash', label: localize('shidehTerminalProfileBash', "bash") },
					{ value: 'zsh', label: localize('shidehTerminalProfileZsh', "zsh") },
				];

		const interactionModes = [
			{ value: 'ask', label: localize('shidehSettingsModeAsk', "Ask") },
			{ value: 'build', label: localize('shidehSettingsModeBuild', "Build") },
			{ value: 'plan', label: localize('shidehSettingsModePlan', "Plan") },
		];
		const memoryFrameworks = SHIDEH_MEMORY_FRAMEWORKS.map(framework => ({
			value: framework.id,
			label: framework.displayName,
		}));

		return [
			{
				id: 'general',
				label: localize('shidehSettingsSection.general', "General"),
				description: localize('shidehSettingsSection.generalDesc', "Startup behavior, default interaction mode, memory, and session overview."),
				items: [
					{ kind: 'enum', key: 'shideh.defaultInteractionMode', label: localize('shidehSettingsDefaultMode', "Default interaction mode"), description: localize('shidehSettingsDefaultModeDesc', "Mode used when starting new agent chats."), options: interactionModes },
					{ kind: 'boolean', key: 'shideh.openAgentPanelOnStartup', label: localize('shidehSettingsOpenPanelOnStartup', "Open classic panel on startup"), description: localize('shidehSettingsOpenPanelOnStartupDesc', "Show panel chat when Shideh starts in the classic workbench layout.") },
					{ kind: 'boolean', key: 'shideh.runAtLogin', label: localize('shidehSettingsRunAtLogin', "Run at startup"), description: localize('shidehSettingsRunAtLoginDesc', "Start Shideh automatically when you sign in to Windows or macOS.") },
					{ kind: 'boolean', key: 'shideh.memory.enabled', label: localize('shidehSettingsMemoryEnabled', "Agent memory"), description: localize('shidehSettingsMemoryEnabledDesc', "Enable Shideh memory adapters for long-running sessions.") },
					{ kind: 'action', label: localize('shidehSettingsRestartApp', "Restart app"), description: localize('shidehSettingsRestartAppDesc', "Reload the Shideh window to apply pending updates or configuration."), detail: localize('shidehSettingsRestart', "Restart"), run: () => this.commandService.executeCommand('workbench.action.reloadWindow') },
					{ kind: 'action', label: localize('shidehSettingsStats', "Usage stats"), description: localize('shidehSettingsStatsDesc', "View session and token usage summaries."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.commandService.executeCommand(SHIDEH_OPEN_STATS_COMMAND_ID) },
				],
			},
			{
				id: 'appearance',
				label: localize('shidehSettingsSection.appearance', "Appearance"),
				description: localize('shidehSettingsSection.appearanceDesc', "Fonts, colors, and Agents window chrome."),
				items: [
					{ kind: 'string', key: 'shideh.appearance.fontFamily', label: localize('shidehSettingsFontFamily', "Font"), description: localize('shidehSettingsFontFamilyDesc', "CSS font family for the Agents window. Leave empty to use the theme default."), placeholder: 'Segoe UI, system-ui, sans-serif' },
					{ kind: 'number', key: 'shideh.appearance.fontSize', label: localize('shidehSettingsFontSize', "Font size"), description: localize('shidehSettingsFontSizeDesc', "Base font size for the Agents window. Zero uses the theme default."), suffix: 'px', min: 0, max: 32 },
					{ kind: 'string', key: 'shideh.appearance.foreground', label: localize('shidehSettingsFontColor', "Font color"), description: localize('shidehSettingsFontColorDesc', "Text color for the Agents window (CSS color)."), placeholder: '#cccccc' },
					{ kind: 'string', key: 'shideh.appearance.sidebarBackground', label: localize('shidehSettingsSidebarColor', "Sidebar background"), description: localize('shidehSettingsSidebarColorDesc', "Background color for the session sidebar."), placeholder: '#1f1f1f' },
					{ kind: 'string', key: 'shideh.appearance.activeSessionBackground', label: localize('shidehSettingsActiveSessionColor', "Active session background"), description: localize('shidehSettingsActiveSessionColorDesc', "Background color for the selected session row."), placeholder: '#2a2a2a' },
					{ kind: 'string', key: 'shideh.appearance.chatInputBackground', label: localize('shidehSettingsChatInputColor', "Chat input background"), description: localize('shidehSettingsChatInputColorDesc', "Background color for the chat composer."), placeholder: '#252526' },
					{ kind: 'appearance-themes' },
					{ kind: 'action', label: localize('shidehSettingsAppearance', "Advanced appearance"), description: localize('shidehSettingsAppearanceDesc', "Fine-tune colors and typography overrides."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'shideh.appearance' }) },
				],
			},
			{
				id: 'models',
				label: localize('shidehSettingsSection.models', "Models"),
				description: localize('shidehSettingsSection.modelsDesc', "Language model providers, credentials, and the catalog loaded after you connect."),
				items: [
					{ kind: 'lm-models-section' },
					{ kind: 'action', label: localize('shidehSettingsConnectRemote', "Connect remote agent"), description: localize('shidehSettingsConnectRemoteDesc', "Add a Cursor, OpenCode, or Devin bridge."), detail: localize('shidehSettingsConnect', "Connect"), run: () => this.commandService.executeCommand(SHIDEH_CONNECT_REMOTE_AGENT_COMMAND_ID) },
					{ kind: 'action', label: localize('shidehSettingsModels', "Manage models"), description: localize('shidehSettingsModelsDesc', "Add providers and configure language models."), detail: localize('shidehSettingsManage', "Manage"), run: () => this.commandService.executeCommand(MANAGE_CHAT_COMMAND_ID) },
					{ kind: 'action', label: localize('shidehSettingsFavoriteModels', "Favorite models"), description: localize('shidehSettingsFavoriteModelsDesc', "Manage bookmarked models in the picker."), detail: localize('shidehSettingsManage', "Manage"), run: () => this.commandService.executeCommand(SHIDEH_MANAGE_FAVORITE_MODELS_COMMAND_ID) },
				],
			},
			{
				id: 'hub',
				label: localize('shidehSettingsSection.hub', "Hub"),
				description: localize('shidehSettingsSection.hubDesc', "Skills and MCP catalogs — top sources for downloading agent customizations."),
				items: [
					{ kind: 'hub-catalog' },
				],
			},
			{
				id: 'customization',
				label: localize('shidehSettingsSection.customization', "Customization"),
				description: localize('shidehSettingsSection.customizationDesc', "Skills, instructions, prompts, plugins, and agent presets."),
				items: [
					{ kind: 'action', label: localize('shidehSettingsCustomizationEditor', "Customizations"), description: localize('shidehSettingsCustomizationEditorDesc', "Skills, instructions, and workspace plugins."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.commandService.executeCommand(AICustomizationManagementCommands.OpenEditor) },
					{ kind: 'action', label: localize('shidehSettingsAgentsSection', "Agent presets"), description: localize('shidehSettingsAgentsSectionDesc', "Saved agent configurations and personas."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, AICustomizationManagementSection.Agents) },
				],
			},
			{
				id: 'connectors',
				label: localize('shidehSettingsSection.connectors', "Connectors"),
				description: localize('shidehSettingsSection.connectorsDesc', "MCP servers, Copilot connectors, and Shideh default MCP seeding."),
				items: [
					{ kind: 'boolean', key: 'shideh.mcp.seedDefaults', label: localize('shidehSettingsMcpSeed', "Seed default MCP servers"), description: localize('shidehSettingsMcpSeedDesc', "Add Shideh's bundled MCP servers on first run.") },
					{ kind: 'action', label: localize('shidehSettingsMcp', "MCP settings"), description: localize('shidehSettingsMcpDesc', "Configure MCP enablement and authentication."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'mcp shideh.mcp mcpConnectorsEnabled' }) },
					{ kind: 'action', label: localize('shidehSettingsMcpEditor', "Manage MCP servers"), description: localize('shidehSettingsMcpEditorDesc', "Edit installed MCP server definitions."), detail: localize('shidehSettingsManage', "Manage"), run: () => this.commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, AICustomizationManagementSection.McpServers) },
				],
			},
			{
				id: 'terminal',
				label: localize('shidehSettingsSection.terminal', "Terminal"),
				description: localize('shidehSettingsSection.terminalDesc', "Integrated terminal profiles, shell, and agent sandbox terminal options."),
				items: [
					{ kind: 'enum', key: defaultTerminalKey, label: localize('shidehSettingsDefaultTerminal', "Default terminal"), description: localize('shidehSettingsDefaultTerminalDesc', "Integrated terminal profile used for new terminals on this machine."), options: terminalProfileOptions },
					{ kind: 'action', label: localize('shidehSettingsTerminal', "Integrated terminal"), description: localize('shidehSettingsTerminalDesc', "Shell, font, and profile settings for the workbench terminal."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'terminal.integrated' }) },
					{ kind: 'action', label: localize('shidehSettingsAgentTerminal', "Agent terminal & sandbox"), description: localize('shidehSettingsAgentTerminalDesc', "Terminal sandbox and agent host shell integration."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'chat.agentHost terminal.integrated automationProfile' }) },
				],
			},
			{
				id: 'network',
				label: localize('shidehSettingsSection.network', "Network"),
				description: localize('shidehSettingsSection.networkDesc', "Remote agent hosts, proxies, and outbound connectivity."),
				items: [
					{ kind: 'action', label: localize('shidehSettingsTestNetwork', "Test network"), description: localize('shidehSettingsTestNetworkDesc', "Send a request to your OpenAI-compatible base URL (/models) and report latency."), detail: localize('shidehSettingsTest', "Test"), run: () => this.commandService.executeCommand(SHIDEH_TEST_NETWORK_COMMAND_ID) },
					{ kind: 'action', label: localize('shidehSettingsRemoteAgents', "Remote agent hosts"), description: localize('shidehSettingsRemoteAgentsDesc', "Manage connected remote agent host endpoints."), detail: localize('shidehSettingsManage', "Manage"), run: () => this.commandService.executeCommand(RemoteAgentHostCommandIds.manageRemoteAgentHosts) },
					{ kind: 'action', label: localize('shidehSettingsNetworkPrefs', "Network & proxy"), description: localize('shidehSettingsNetworkPrefsDesc', "HTTP proxy and remote host configuration."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'http.proxy chat.remoteAgentHosts' }) },
				],
			},
			{
				id: 'system',
				label: localize('shidehSettingsSection.system', "System"),
				description: localize('shidehSettingsSection.systemDesc', "Agent host runtime, harness bridges, memory adapters, and tools."),
				items: [
					{ kind: 'enum', key: 'shideh.memory.framework', label: localize('shidehSettingsMemoryFramework', "Memory framework"), description: localize('shidehSettingsMemoryFrameworkDesc', "Adapter used when agent memory is enabled."), options: memoryFrameworks },
					{ kind: 'action', label: localize('shidehSettingsHarnesses', "Harnesses"), description: localize('shidehSettingsHarnessesDesc', "Cursor plugin and Deepseek harness integrations."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'shideh.harnesses' }) },
					{ kind: 'action', label: localize('shidehSettingsAgentHost', "Agent host"), description: localize('shidehSettingsAgentHostDesc', "Client tools and agent host runtime options."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'chat.agentHost' }) },
					{ kind: 'action', label: localize('shidehSettingsToolsEditor', "Manage tools"), description: localize('shidehSettingsToolsEditorDesc', "Enable or disable tools exposed to the agent."), detail: localize('shidehSettingsManage', "Manage"), run: () => this.commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, AICustomizationManagementSection.Tools) },
					{ kind: 'action', label: localize('shidehSettingsClientTools', "Client tools"), description: localize('shidehSettingsClientToolsDesc', "Forwarded workbench tools for agent host sessions."), detail: localize('shidehSettingsOpen', "Open"), run: () => this.preferencesService.openSettings({ query: 'chat.agentHost.clientTools' }) },
				],
			},
		];
	}

	private selectSection(id: ShidehSettingsSectionId): void {
		if (this.activeSection === id) {
			return;
		}
		this.activeSection = id;
		for (const [sectionId, item] of this.navItems) {
			const selected = sectionId === id;
			item.classList.toggle('selected', selected);
			item.setAttribute('aria-selected', selected ? 'true' : 'false');
			item.tabIndex = selected ? 0 : -1;
		}
		this.renderSection(id);
	}

	private renderSection(id: ShidehSettingsSectionId): void {
		this.panelDisposables.clear();
		const section = this.sections.find(s => s.id === id) ?? this.sections[0];
		this.panelTitle.textContent = section.label;
		this.panelDescription.textContent = section.description;
		this.settingsListHost.classList.toggle('shideh-settings-list--overlay-friendly', id === 'models');
		this.settingsListHost.replaceChildren();

		for (const item of section.items) {
			this.renderSettingItem(this.settingsListHost, item);
		}
	}

	private renderSettingItem(parent: HTMLElement, item: ShidehSettingItem): void {
		if (item.kind === 'appearance-themes') {
			this.panelDisposables.add(this.instantiationService.createInstance(AgentsThemePicker, parent));
			return;
		}

		if (item.kind === 'lm-models-section') {
			const block = DOM.append(parent, DOM.$('.shideh-settings-embedded-panel.shideh-models-unified-section'));
			const providerHost = DOM.append(block, DOM.$('.shideh-models-unified-providers'));
			const modelsHost = DOM.append(block, DOM.$('.shideh-models-unified-catalog'));
			this.panelDisposables.add(this.instantiationService.createInstance(ShidehProviderSettingsPanel, providerHost));
			this.panelDisposables.add(this.instantiationService.createInstance(ShidehModelsSettingsPanel, modelsHost));
			return;
		}

		if (item.kind === 'hub-catalog') {
			const block = DOM.append(parent, DOM.$('.shideh-settings-embedded-panel'));
			this.panelDisposables.add(this.instantiationService.createInstance(ShidehHubPanel, block));
			return;
		}

		const row = DOM.append(parent, DOM.$('.shideh-settings-row'));
		const labels = DOM.append(row, DOM.$('.shideh-settings-row-labels'));
		DOM.append(labels, DOM.$('.shideh-settings-row-label')).textContent = item.label;
		if (item.description) {
			DOM.append(labels, DOM.$('.shideh-settings-row-description')).textContent = item.description;
		}

		if (item.kind === 'action') {
			const control = DOM.append(row, DOM.$('.shideh-settings-row-control.shideh-settings-row-action'));
			control.textContent = item.detail ?? localize('shidehSettingsOpen', "Open");
			row.classList.add('shideh-settings-row-interactive');
			row.tabIndex = 0;
			row.setAttribute('role', 'button');
			const run = () => { void item.run(); };
			this.panelDisposables.add(DOM.addDisposableListener(row, 'click', run));
			this.panelDisposables.add(DOM.addDisposableListener(row, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					run();
				}
			}));
			return;
		}

		const controlHost = DOM.append(row, DOM.$('.shideh-settings-row-control'));

		if (item.kind === 'boolean') {
			const value = this.configurationService.getValue<boolean>(item.key) === true;
			const toggle = this.panelDisposables.add(new Toggle({
				title: item.label,
				isChecked: value,
				...defaultToggleStyles,
			}));
			toggle.domNode.classList.add('shideh-settings-toggle');
			controlHost.appendChild(toggle.domNode);
			this.panelDisposables.add(toggle.onChange(() => {
				void this.configurationService.updateValue(item.key, toggle.checked);
			}));
			return;
		}

		if (item.kind === 'enum') {
			const current = String(this.configurationService.getValue<string>(item.key) ?? item.options[0]?.value ?? '');
			let options = item.options;
			if (current && !options.some(option => option.value === current)) {
				options = [{ value: current, label: current }, ...options];
			}
			const selectedIndex = Math.max(0, options.findIndex(option => option.value === current));
			const select = this.panelDisposables.add(new SelectBox(
				options.map(option => ({ text: option.label })),
				selectedIndex,
				this.contextViewService,
				{ ...defaultSelectBoxStyles },
				{ ariaLabel: item.label },
			));
			select.render(controlHost);
			this.panelDisposables.add(select.onDidSelect(event => {
				const option = options[event.index];
				if (option) {
					void this.configurationService.updateValue(item.key, option.value);
				}
			}));
			return;
		}

		if (item.kind === 'number') {
			const value = this.configurationService.getValue<number>(item.key) ?? 0;
			const input = this.panelDisposables.add(new InputBox(controlHost, this.contextViewService, {
				ariaLabel: item.label,
				inputBoxStyles: getInputBoxStyle({}),
				type: 'number',
			}));
			input.value = String(value);
			if (item.suffix) {
				const suffix = DOM.append(controlHost, DOM.$('.shideh-settings-input-suffix'));
				suffix.textContent = item.suffix;
				controlHost.classList.add('shideh-settings-row-control-with-suffix');
			}
			const commit = () => {
				const parsed = Number(input.value);
				if (!Number.isFinite(parsed)) {
					return;
				}
				const clamped = Math.min(item.max ?? parsed, Math.max(item.min ?? parsed, parsed));
				void this.configurationService.updateValue(item.key, clamped);
			};
			this.panelDisposables.add(input.onDidChange(() => commit()));
			this.panelDisposables.add(DOM.addDisposableListener(input.inputElement, 'blur', commit));
			return;
		}

		if (item.kind === 'string') {
			const value = String(this.configurationService.getValue<string>(item.key) ?? '');
			const input = this.panelDisposables.add(new InputBox(controlHost, this.contextViewService, {
				ariaLabel: item.label,
				placeholder: item.placeholder,
				inputBoxStyles: getInputBoxStyle({}),
			}));
			input.value = value;
			const commit = () => {
				void this.configurationService.updateValue(item.key, input.value.trim());
			};
			this.panelDisposables.add(input.onDidChange(() => commit()));
			this.panelDisposables.add(DOM.addDisposableListener(input.inputElement, 'blur', commit));
		}
	}
}
