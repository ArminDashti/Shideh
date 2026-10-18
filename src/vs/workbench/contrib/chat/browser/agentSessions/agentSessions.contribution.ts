/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './experiments/agentSessionsExperiments.contribution.js';
import './agentSessionsView.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { AgentSessionsViewContainerId, AgentSessionsViewerOrientation, AgentSessionsViewerPosition, AgentSessionsViewId } from './agentSessions.js';
import { IAgentSessionsService, AgentSessionsService } from './agentSessionsService.js';
import { LocalAgentsSessionsController } from './localAgentSessionsController.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { ISubmenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { OpenAgentSessionInEditorGroupAction, OpenAgentSessionInNewEditorGroupAction, OpenAgentSessionInNewWindowAction, ShowAgentSessionsSidebar, HideAgentSessionsSidebar, ToggleAgentSessionsSidebar, RefreshAgentSessionsViewerAction, FindAgentSessionInViewerAction, MarkAgentSessionUnreadAction, MarkAgentSessionReadAction, FocusAgentSessionsAction, SetAgentSessionsOrientationStackedAction, SetAgentSessionsOrientationSideBySideAction, MarkAllAgentSessionsReadAction, RenameAgentSessionAction, DeleteAgentSessionAction, DeleteAllLocalSessionsAction, MarkAgentSessionSectionReadAction, ToggleShowAgentSessionsAction, PinAgentSessionAction, UnpinAgentSessionAction, CollapseAllAgentSessionSectionsAction, getAgentSessionArchiveActionConstructors } from './agentSessionsActions.js';
import { AgentHostPermissionUiContribution } from './agentHost/agentHostPermissionUiContribution.js';
import { registerExternalSessionsFilterMenu } from './externalSessionsFilterMenu.js';
import './agentHost/agentHostChatInputPicker.contribution.js';
import './agentHost/agentHostModeSynchronizer.js';
import { ChatSessionArchiveActionWordingSettingId, getChatSessionArchiveActionWording } from '../../../../../platform/chat/common/sessionArchiveActions.js';

//#region Actions and Menus

registerAction2(FocusAgentSessionsAction);
registerAction2(MarkAllAgentSessionsReadAction);
registerAction2(MarkAgentSessionSectionReadAction);
registerAction2(CollapseAllAgentSessionSectionsAction);
registerAction2(PinAgentSessionAction);
registerAction2(UnpinAgentSessionAction);
registerAction2(RenameAgentSessionAction);
registerAction2(DeleteAgentSessionAction);
registerAction2(DeleteAllLocalSessionsAction);
registerAction2(MarkAgentSessionUnreadAction);
registerAction2(MarkAgentSessionReadAction);
registerAction2(MarkAllAgentSessionsReadInSessionContextAction);
registerAction2(OpenAgentSessionInNewWindowAction);
registerAction2(OpenAgentSessionInEditorGroupAction);
registerAction2(OpenAgentSessionInNewEditorGroupAction);
registerAction2(RefreshAgentSessionsViewerAction);
registerAction2(FindAgentSessionInViewerAction);
registerExternalSessionsFilterMenu(MenuId.AgentSessionsViewerFilterSubMenu, MenuId.AgentSessionsExternalFilterSubMenu, '2_external');
registerAction2(ShowAgentSessionsSidebar);
registerAction2(HideAgentSessionsSidebar);

class AgentSessionArchiveActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentSessionArchiveActions';

	private readonly actionRegistrations = this._register(new DisposableStore());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.registerActions();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(ChatSessionArchiveActionWordingSettingId)) {
				this.registerActions();
			}
		}));
	}

	private registerActions(): void {
		this.actionRegistrations.clear();
		const wording = getChatSessionArchiveActionWording(this.configurationService);
		for (const action of getAgentSessionArchiveActionConstructors(wording)) {
			this.actionRegistrations.add(registerAction2(action));
		}
	}
}

registerWorkbenchContribution2(AgentSessionArchiveActionsContribution.ID, AgentSessionArchiveActionsContribution, WorkbenchPhase.BlockStartup);
registerAction2(ToggleAgentSessionsSidebar);
registerAction2(ToggleShowAgentSessionsAction);
registerAction2(SetAgentSessionsOrientationStackedAction);
registerAction2(SetAgentSessionsOrientationSideBySideAction);
registerAction2(MaximizeAgentSessionsPanelAction);
registerAction2(RestoreAgentSessionsPanelAction);

// --- Agent Sessions Toolbar

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	submenu: MenuId.AgentSessionsViewerFilterSubMenu,
	title: localize2('filterAgentSessions', "Filter Agent Sessions"),
	group: 'navigation',
	order: 3,
	icon: Codicon.treeFilterOnTypeOn,
} satisfies ISubmenuItem);

// Agent Session Projection
registerAction2(EnterAgentSessionProjectionAction);
registerAction2(ExitAgentSessionProjectionAction);
registerAction2(OpenInChatPanelAction);
registerAction2(ToggleAgentStatusAction);
registerAction2(ToggleAgentSessionProjectionAction);

// --- Agent Sessions Toolbar

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	submenu: MenuId.AgentSessionsViewerFilterSubMenu,
	title: localize2('filterAgentSessions', "Filter Agent Sessions"),
	group: 'navigation',
	order: 3,
	icon: Codicon.filter,
	when: ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.SideBySide)
} satisfies ISubmenuItem);

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarRightOff,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeftOff,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

MenuRegistry.appendMenuItem(MenuId.LayoutControlMenu, {
	group: '2_pane_toggles',
	command: {
		id: ToggleAgentSessionsSidebar.ID,
		title: localize('toggleAgentSessionsList', "Toggle Agent Sessions"),
		toggled: { condition: ChatSessionsPartVisibleContext, icon: chatSessionsLeftIcon },
		icon: chatSessionsLeftOffIcon,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.SideBySide),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: HideAgentSessionsSidebar.ID,
		title: HideAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeft,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.SideBySide),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

// --- Agent Sessions Manage All Submenu

const agentSessionsManageAllSubmenu = new MenuId('AgentSessionsManageAllSubmenu');
MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	submenu: agentSessionsManageAllSubmenu,
	title: localize2('manageAllAgentSessions', "Manage All Agent Sessions"),
	group: 'navigation',
	order: 4,
	icon: Codicon.ellipsis,
} satisfies ISubmenuItem);

MenuRegistry.appendMenuItem(agentSessionsManageAllSubmenu, {
	command: {
		id: 'workbench.action.chat.markAllAgentSessionsRead',
		title: localize2('markAllAsRead', "Mark All as Read"),
	},
	group: '1_manage',
	order: 1,
});

MenuRegistry.appendMenuItem(agentSessionsManageAllSubmenu, {
	command: {
		id: 'workbench.action.chat.archiveAllAgentSessions',
		title: localize2('archiveAll', "Archive All"),
	},
	group: '1_manage',
	order: 2,
});

// --- Sessions Title Toolbar

MenuRegistry.appendMenuItem(MenuId.ChatViewSessionTitleToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeftOff,
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		IsAuxiliaryWindowContext.negate(),
		ChatContextKeys.enabled,
		ContextKeyExpr.or(
			ChatContextKeys.agentSessionsViewerVisible.negate(),
			ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

MenuRegistry.appendMenuItem(MenuId.ChatViewSessionTitleToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarRightOff,
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		ContextKeyExpr.or(
			ChatContextKeys.agentSessionsViewerVisible.negate(),
			ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right),
		ChatContextKeys.agentSessionsViewerDedicated.negate()
	)
});

//#endregion

//#region Workbench Contributions

registerWorkbenchContribution2(LocalAgentsSessionsController.ID, LocalAgentsSessionsController, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(AgentHostPermissionUiContribution.ID, AgentHostPermissionUiContribution, WorkbenchPhase.BlockRestore);

registerSingleton(IAgentSessionsService, AgentSessionsService, InstantiationType.Delayed);

//#endregion
