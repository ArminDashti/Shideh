/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './shidehProductDefaults.contribution.js';
import './shidehHubSources.contribution.js';
import './shidehNavigationContribution.js';
import './shidehSidebarFooter.contribution.js';
import './shidehAppearance.contribution.js';
import './shidehDefaultMcp.contribution.js';
import './shidehMemory.contribution.js';
import './shidehFavoriteModels.contribution.js';
import './shidehHarness.contribution.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IPreferencesService } from '../../../../workbench/services/preferences/common/preferences.js';
import { ShidehStatsEditorInput, ShidehStatsEditor } from './shidehStatsEditor.js';
import { EditorExtensions } from '../../../../workbench/common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import {
	SHIDEH_CONNECT_REMOTE_AGENT_COMMAND_ID,
	SHIDEH_OPEN_SETTINGS_COMMAND_ID,
	SHIDEH_OPEN_SESSION_HISTORY_COMMAND_ID,
	SHIDEH_OPEN_STATS_COMMAND_ID,
	SHIDEH_SET_ASK_MODE_COMMAND_ID,
	SHIDEH_SET_BUILD_MODE_COMMAND_ID,
	SHIDEH_SET_PLAN_MODE_COMMAND_ID,
} from '../common/shidehCommandIds.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../../workbench/browser/editor.js';
import { IViewsRegistry, IViewContainersRegistry, ViewContainer, ViewContainerLocation, WindowEnablement, Extensions as ViewContainerExtensions } from '../../../../workbench/common/views.js';
import { Menus } from '../../../browser/menus.js';
import { IsSessionsWindowContext } from '../../../../workbench/common/contextkeys.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { SessionHistoryViewPane, SessionHistoryViewPaneId } from './sessionHistoryViewPane.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ChatConfiguration, IChatDefaultConfiguration } from '../../../../workbench/contrib/chat/common/constants.js';
import { RemoteAgentHostsSettingId } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ShidehStatsEditor,
		ShidehStatsEditor.ID,
		localize('shidehStatsEditorPane', "Shideh Stats")
	),
	[new SyncDescriptor(ShidehStatsEditorInput)]
);

registerAction2(class OpenShidehSettingsAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_OPEN_SETTINGS_COMMAND_ID,
			title: localize2('shidehOpenSettings', "Settings"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IPreferencesService).openSettings();
	}
});

const sessionHistoryViewIcon = Codicon.history;
const sessionHistoryViewContainerId = 'shideh.sessionHistoryContainer';
const sessionHistoryViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: sessionHistoryViewContainerId,
	title: localize2('shidehSessionHistory', "Session History"),
	icon: sessionHistoryViewIcon,
	order: 7,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [sessionHistoryViewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: sessionHistoryViewContainerId,
	hideIfEmpty: true,
	windowEnablement: WindowEnablement.Sessions,
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: SessionHistoryViewPaneId,
	name: localize2('shidehSessionHistory', "Session History"),
	containerIcon: sessionHistoryViewIcon,
	ctorDescriptor: new SyncDescriptor(SessionHistoryViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	windowEnablement: WindowEnablement.Sessions,
}], sessionHistoryViewContainer);

registerAction2(class OpenSessionHistoryAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_OPEN_SESSION_HISTORY_COMMAND_ID,
			title: localize2('shidehOpenSessionHistory', "Session History"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IViewsService).openView(SessionHistoryViewPaneId, false);
	}
});

registerAction2(class OpenShidehStatsAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_OPEN_STATS_COMMAND_ID,
			title: localize2('shidehOpenStats', "Shideh Stats"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new ShidehStatsEditorInput(), { pinned: true });
	}
});

function registerModeCommand(id: string, title: string, mode: 'ask' | 'build' | 'plan', order: number) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id,
				title: localize2(`shidehMode.${mode}`, title),
				category: localize2('shidehCategory', "Shideh"),
				f1: true,
				menu: [{
					id: Menus.SessionBarToolbar,
					when: IsSessionsWindowContext,
					group: 'shidehMode',
					order,
				}],
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			const configurationService = accessor.get(IConfigurationService);
			await configurationService.updateValue('shideh.defaultInteractionMode', mode);
			const current = configurationService.getValue<IChatDefaultConfiguration>(ChatConfiguration.DefaultConfiguration) ?? {};
			const agentMode = mode === 'plan' ? 'plan' : 'interactive';
			await configurationService.updateValue(ChatConfiguration.DefaultConfiguration, { ...current, mode: agentMode });
		}
	});
}

registerModeCommand(SHIDEH_SET_ASK_MODE_COMMAND_ID, 'Ask', 'ask', 1);
registerModeCommand(SHIDEH_SET_BUILD_MODE_COMMAND_ID, 'Build', 'build', 2);
registerModeCommand(SHIDEH_SET_PLAN_MODE_COMMAND_ID, 'Plan', 'plan', 3);

registerAction2(class ShidehConnectRemoteAgentAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_CONNECT_REMOTE_AGENT_COMMAND_ID,
			title: localize2('shidehConnectRemoteAgent', "Connect Remote Agent (Cursor / OpenCode / Devin)"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const configurationService = accessor.get(IConfigurationService);
		const presets = configurationService.getValue<Record<string, { name: string; address: string }>>('shideh.remoteAgents.presets') ?? {};
		const pick = await quickInputService.pick(
			[
				{ label: presets.opencode?.name ?? 'OpenCode', description: presets.opencode?.address, preset: 'opencode' },
				{ label: presets.cursor?.name ?? 'Cursor', description: presets.cursor?.address, preset: 'cursor' },
				{ label: presets['cursor-plugin']?.name ?? 'Cursor Plugin', description: presets['cursor-plugin']?.address, preset: 'cursor-plugin' },
				{ label: presets['deepseek-harness']?.name ?? 'Deepseek Harness', description: presets['deepseek-harness']?.address, preset: 'deepseek-harness' },
				{ label: presets.devin?.name ?? 'Devin', description: presets.devin?.address, preset: 'devin' },
			],
			{ placeHolder: localize('shidehConnectRemoteAgentPick', "Select a remote agent bridge to connect") },
		);
		if (!pick) {
			return;
		}
		const address = presets[pick.preset]?.address ?? 'localhost:4096';
		const hosts = [...(configurationService.getValue<{ address: string; name: string }[]>(RemoteAgentHostsSettingId) ?? [])];
		if (!hosts.some(h => h.address === address)) {
			hosts.push({ address, name: pick.label });
			await configurationService.updateValue(RemoteAgentHostsSettingId, hosts);
		}
	}
});
