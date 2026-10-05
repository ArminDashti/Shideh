/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatPhoneInputPresenter } from '../../../../workbench/contrib/chat/browser/widget/input/chatPhoneInputPresenter.js';
import { IChatPetService } from '../../../../workbench/contrib/chat/browser/chatPetService.js';
import { IPreferencesService } from '../../../../workbench/services/preferences/common/preferences.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';
import { IAction } from '../../../../base/common/actions.js';
import { IActionListItem } from '../../../../platform/actionWidget/browser/actionList.js';
import { AGENT_HOST_PERMISSIONS_SETTINGS_QUERY, createModePickerModeItems, createModePickerPermissionsItems } from '../../../../workbench/contrib/chat/browser/agentSessions/agentHost/agentHostModePickerPresentation.js';
import { AgentHostSessionEnumPicker, IAgentHostSessionEnumPickerItem } from '../../providers/agentHost/browser/agentHostModePicker.js';
import { MobileAgentHostModePicker } from '../../providers/agentHost/browser/mobile/mobileAgentHostModePicker.js';
import { isShidehSimplifiedChatChrome, mapShidehModePickerContext, resolveShidehModePickerSelection } from '../common/shidehChatPresentation.js';

/** Phone layout + Shideh Ask / Build / Plan mode picker. */
export class ShidehMobileAgentHostModePicker extends MobileAgentHostModePicker {

	constructor(
		session: IObservable<IActiveSession | undefined>,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IChatPhoneInputPresenter phonePresenter: IChatPhoneInputPresenter,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IChatPetService chatPetService: IChatPetService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService private readonly _shidehConfigurationService: IConfigurationService,
		@IPreferencesService private readonly _shidehPreferencesService: IPreferencesService,
		@IProductService private readonly _productService: IProductService,
	) {
		super(session, actionWidgetService, sessionsProvidersService, telemetryService, hoverService, phonePresenter, chatWidgetService, chatPetService, instantiationService, _shidehConfigurationService, _shidehPreferencesService);
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

	protected override _getTriggerAriaLabel(label: string): string {
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return localize('shidehInteractionMode.triggerAria', "Pick mode, {0}", label);
		}
		return super._getTriggerAriaLabel(label);
	}

	protected override _getWidgetAriaLabel(): string {
		if (isShidehSimplifiedChatChrome(this._productService)) {
			return localize('shidehInteractionMode.widgetAria', "Mode");
		}
		return super._getWidgetAriaLabel();
	}

	protected override _getActionItems(items: readonly IAgentHostSessionEnumPickerItem[], currentValue: string): IActionListItem<IAgentHostSessionEnumPickerItem | IAction>[] {
		if (!isShidehSimplifiedChatChrome(this._productService)) {
			return super._getActionItems(items, currentValue);
		}
		return createModePickerModeItems(
			AgentHostSessionEnumPicker.prototype._getActionItems.call(this, items, currentValue),
			this._permissionDelegate.isModePickerCombined.get(),
			localize('shidehModePicker.section', "Mode"),
		);
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
					await this._shidehPreferencesService.openSettings({ jsonEditor: false, query: AGENT_HOST_PERMISSIONS_SETTINGS_QUERY });
				},
				true,
			),
		];
	}
}
