/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorGroupsService } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { IPreferencesService, IOpenSettingsOptions } from '../../../../workbench/services/preferences/common/preferences.js';
import { IAgentWorkbenchLayoutService } from '../../../browser/workbench.js';
import { ICustomViewService } from '../../../services/customView/browser/customViewService.js';
import { SHIDEH_SETTINGS_CUSTOM_VIEW_ID } from '../common/shidehCommandIds.js';

/**
 * Opens Shideh settings in the Agents window center (sessions custom view grid),
 * replacing the chat surface — same placement as Cursor Agent settings.
 */
export function openShidehSettingsInMainEditor(accessor: ServicesAccessor): void {
	accessor.get(ICustomViewService).showCustomView(SHIDEH_SETTINGS_CUSTOM_VIEW_ID);
}

export async function openPreferencesInMainEditor(accessor: ServicesAccessor, options: IOpenSettingsOptions = {}): Promise<void> {
	const layoutService = accessor.get(IAgentWorkbenchLayoutService);
	const editorGroupsService = accessor.get(IEditorGroupsService);
	const preferencesService = accessor.get(IPreferencesService);

	layoutService.revealEditorPartExplicitly();
	const mainGroupId = editorGroupsService.mainPart.activeGroup.id;
	await preferencesService.openSettings({ ...options, groupId: mainGroupId });
}
