/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IObservable } from '../../../../base/common/observable.js';
import { IAction } from '../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionListItem, IActionListOptions } from '../../../../platform/actionWidget/browser/actionList.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { AGENT_HOST_PERMISSIONS_SETTINGS_QUERY, createModePickerPermissionsItems, getModePermissionsPickerAccessibilityProvider } from '../../../../workbench/contrib/chat/browser/agentSessions/agentHost/agentHostModePickerPresentation.js';
import { ChatPermissionLevel } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatPetService } from '../../../../workbench/contrib/chat/browser/chatPetService.js';
import { IPreferencesService } from '../../../../workbench/services/preferences/common/preferences.js';
import { openPreferencesInMainEditor } from './shidehOpenSettings.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';
import { AgentHostModePicker, AgentHostSessionEnumPicker, IAgentHostSessionEnumPickerItem } from '../../providers/agentHost/browser/agentHostModePicker.js';
import {
	getShidehInteractionModeIconForValue,
	getShidehPermissionLevelLabel,
	isShidehSimplifiedChatChrome,
	mapShidehModePickerContext,
	resolveShidehModePickerSelection,
} from '../common/shidehChatPresentation.js';

/**
 * Shideh: Ask / Build / Plan plus Manual / Assisted / Full in one menu (no
 * separate Mode and Permissions chrome or section headers).
 */
export class ShidehAgentHostModePicker extends AgentHostModePicker {

	constructor(
		session: IObservable<IActiveSession | undefined>,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IChatPetService chatPetService: IChatPetService,
		@IInstantiationService private readonly _shidehInstantiationService: IInstantiationService,
		@IConfigurationService private readonly _shidehConfigurationService: IConfigurationService,
		@IPreferencesService preferencesService: IPreferencesService,
		@IProductService private readonly _productService: IProductService,
	) {
		super(session, actionWidgetService, sessionsProvidersService, telemetryService, hoverService, chatPetService, _shidehInstantiationService, _shidehConfigurationService, preferencesService);
	}

	protected override _getActiveContext() {
		const ctx = super._getActiveContext();
		if (!ctx || !isShidehSimplifiedChatChrome(this._productService)) {
			return ctx;
		}
		return mapShidehModePickerContext(ctx, this._shidehConfigurationService);
	}

	protected override _resolveSelectionValue(value: string): string {
		if (!isShidehSimplifiedChatChrome(this._productService)) {
			return super._resolveSelectionValue(value);
		}
		return resolveShidehModePickerSelection(value, this._shidehConfigurationService) ?? super._resolveSelectionValue(value);
	}

	protected override _getTriggerIcon(value: string | undefined): ThemeIcon | undefined {
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return getShidehInteractionModeIconForValue(value, this._shidehConfigurationService);
		}
		return super._getTriggerIcon(value);
	}

	protected override _getActionItemIcon(item: IAgentHostSessionEnumPickerItem): ThemeIcon | undefined {
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return getShidehInteractionModeIconForValue(item.value, this._shidehConfigurationService);
		}
		return super._getActionItemIcon(item);
	}

	protected override _renderTriggerLabel(trigger: HTMLElement, label: string, icon: ThemeIcon | undefined): void {
		if (!isShidehSimplifiedChatChrome(this._productService) || !this._permissionDelegate.isModePickerCombined.get()) {
			super._renderTriggerLabel(trigger, label, icon);
			return;
		}
		this._splitTrigger.clear();
		trigger.classList.remove('agent-host-mode-permissions-trigger');
		trigger.role = 'button';
		trigger.tabIndex = 0;
		trigger.ariaHasPopup = 'listbox';
		const permissionLevel = this._permissionDelegate.currentPermissionLevel.get() ?? ChatPermissionLevel.Default;
		const permissionLabel = getShidehPermissionLevelLabel(permissionLevel);
		dom.clearNode(trigger);
		if (icon) {
			dom.append(trigger, renderIcon(icon)).ariaHidden = 'true';
		}
		const labelSpan = dom.append(trigger, dom.$('span.sessions-chat-dropdown-label'));
		labelSpan.textContent = localize('shidehModePermission.triggerLabel', "{0} · {1}", label, permissionLabel);
		trigger.ariaLabel = localize('shidehModePermission.triggerAria', "Pick mode and approvals, {0}, {1}", label, permissionLabel);
	}

	protected override _getTriggerAriaLabel(label: string): string {
		if (isShidehSimplifiedChatChrome(this._productService) && this._permissionDelegate.isModePickerCombined.get()) {
			const permissionLabel = getShidehPermissionLevelLabel(this._permissionDelegate.currentPermissionLevel.get() ?? ChatPermissionLevel.Default);
			return localize('shidehModePermission.triggerAria', "Pick mode and approvals, {0}, {1}", label, permissionLabel);
		}
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return localize('shidehInteractionMode.triggerAria', "Pick mode, {0}", label);
		}
		return super._getTriggerAriaLabel(label);
	}

	protected override _getWidgetAriaLabel(): string {
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return localize('shidehModePermission.widgetAria', "Mode and approvals");
		}
		return super._getWidgetAriaLabel();
	}

	protected override _getActionItems(items: readonly IAgentHostSessionEnumPickerItem[], currentValue: string): IActionListItem<IAgentHostSessionEnumPickerItem | IAction>[] {
		if (!isShidehSimplifiedChatChrome(this._productService)) {
			return super._getActionItems(items, currentValue);
		}
		return AgentHostSessionEnumPicker.prototype._getActionItems.call(this, items, currentValue);
	}

	protected override _getFooterActionItems(): readonly IActionListItem<IAgentHostSessionEnumPickerItem | IAction>[] {
		if (!isShidehSimplifiedChatChrome(this._productService) || !this._permissionDelegate.isModePickerCombined.get()) {
			return super._getFooterActionItems();
		}
		const session = this._session.get();
		return [
			...createModePickerPermissionsItems<IAgentHostSessionEnumPickerItem>(
				this._permissionPicker.presentation,
				this._permissionPicker.getActionListItems(() => this._session.get() === session),
				async () => {
					this._hidePicker();
					await this._shidehInstantiationService.invokeFunction(accessor => openPreferencesInMainEditor(accessor, { jsonEditor: false, query: AGENT_HOST_PERMISSIONS_SETTINGS_QUERY }));
				},
				true,
				true,
			),
		];
	}

	protected override _getListOptions(): IActionListOptions {
		if (isShidehSimplifiedChatChrome(this._productService) && this._permissionDelegate.isModePickerCombined.get()) {
			return { minWidth: 300 };
		}
		return super._getListOptions();
	}

	protected override _getAccessibilityProvider() {
		if (isShidehSimplifiedChatChrome(this._productService) && this._permissionDelegate.isModePickerCombined.get()) {
			return {
				...super._getAccessibilityProvider(),
				...getModePermissionsPickerAccessibilityProvider(false),
			};
		}
		return super._getAccessibilityProvider();
	}

	override focus(): void {
		if (isShidehSimplifiedChatChrome(this._productService) && this._permissionDelegate.isModePickerCombined.get()) {
			this._triggerElement?.focus();
			return;
		}
		super.focus();
	}

}
