/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IsSessionsWindowContext } from '../../../../workbench/common/contextkeys.js';
import { Menus } from '../../../browser/menus.js';
import { ShidehNavigationIntegratedContext } from '../common/shidehContextKeys.js';

const shidehIntegratedSidebar = ContextKeyExpr.and(IsSessionsWindowContext, ShidehNavigationIntegratedContext);

MenuRegistry.appendMenuItem(Menus.SidebarTitleLeading, {
	command: {
		id: 'workbench.action.agentToggleSidebarVisibility',
		title: localize('toggleSidebar', 'Toggle Side Bar'),
	},
	group: 'navigation',
	order: 1,
	when: shidehIntegratedSidebar,
});

MenuRegistry.appendMenuItem(Menus.SidebarTitle, {
	command: {
		id: 'sessions.goBack',
		title: '',
	},
	group: 'navigation',
	order: 1,
	when: shidehIntegratedSidebar,
});

MenuRegistry.appendMenuItem(Menus.SidebarTitle, {
	command: {
		id: 'sessions.goForward',
		title: '',
	},
	group: 'navigation',
	order: 2,
	when: shidehIntegratedSidebar,
});
