/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../../browser/media/sidebarActionButton.css';
import '../../accountMenu/browser/media/accountWidget.css';
import './media/shidehSidebar.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IsSessionsWindowContext } from '../../../../workbench/common/contextkeys.js';
import { Menus } from '../../../browser/menus.js';
import { ShidehNavigationIntegratedContext } from '../common/shidehContextKeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { getAccountProfileImageUrl, resolveAccountInfo } from '../../../browser/accountTitleBarState.js';
import { ACCOUNTS_AVATAR_SETTING, IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { getFlatContextMenuActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { SHIDEH_OPEN_SETTINGS_COMMAND_ID } from '../common/shidehCommandIds.js';

const SHIDEH_SIDEBAR_ACCOUNT_ACTION_ID = 'shideh.sidebarAccount';
const SHIDEH_SIDEBAR_SETTINGS_ACTION_ID = 'shideh.sidebarSettings';

class ShidehSidebarAccountWidget extends BaseActionViewItem {

	private accountButton: HTMLElement | undefined;
	private avatarElement: HTMLImageElement | undefined;
	private labelElement: HTMLElement | undefined;
	private subtitleElement: HTMLElement | undefined;
	private accountName: string | undefined;
	private accountProviderId: string | undefined;
	private accountIcon: import('../../../../base/common/uri.js').URI | undefined;
	private accountRequestCounter = 0;
	private avatarRequestCounter = 0;
	private loadedAvatarUrl: string | undefined;

	constructor(
		action: IAction,
		options: IBaseActionViewItemOptions | undefined,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super(undefined, action, options);
		this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => this.refreshAccount()));
		this._register(this.authenticationService.onDidChangeSessions(() => this.refreshAccount()));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(ACCOUNTS_AVATAR_SETTING)) {
				this.refreshAvatar();
			}
		}));
		this.refreshAccount();
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('account-widget', 'shideh-sidebar-account-widget');
		container.parentElement?.classList.add('shideh-sidebar-account-widget-item');
		const account = append(container, $('.account-widget-account'));
		this.accountButton = append(account, $('button.sidebar-action-button.account-widget-account-button', { type: 'button' }));
		this.avatarElement = append(this.accountButton, $('img.shideh-sidebar-account-avatar', { alt: '', draggable: 'false' })) as HTMLImageElement;
		this.avatarElement.decoding = 'async';
		this.avatarElement.referrerPolicy = 'no-referrer';
		append(this.accountButton, $('span.codicon.codicon-account.shideh-sidebar-account-fallback-icon', { 'aria-hidden': 'true' }));
		const textColumn = append(this.accountButton, $('.shideh-sidebar-account-text'));
		this.labelElement = append(textColumn, $('span.shideh-sidebar-account-label'));
		this.subtitleElement = append(textColumn, $('span.shideh-sidebar-account-subtitle'));
		this.subtitleElement.textContent = localize('shidehSidebarViewProfile', "View profile");
		this.accountButton.addEventListener('click', () => this.showAccountMenu());
	}

	private async refreshAccount(): Promise<void> {
		const requestId = ++this.accountRequestCounter;
		const info = await resolveAccountInfo(this.defaultAccountService, this.authenticationService);
		if (requestId !== this.accountRequestCounter || this._store.isDisposed) {
			return;
		}
		this.accountName = info?.accountName;
		this.accountProviderId = info?.accountProviderId;
		this.accountIcon = info?.accountIcon;
		if (this.labelElement) {
			this.labelElement.textContent = this.accountName ?? localize('shidehSidebarSignInFallback', "Sign in");
		}
		this.refreshAvatar();
	}

	private refreshAvatar(): void {
		if (!this.avatarElement || !this.accountButton) {
			return;
		}
		const requestId = ++this.avatarRequestCounter;
		const showAvatars = this.configurationService.getValue<boolean>(ACCOUNTS_AVATAR_SETTING) !== false;
		const url = showAvatars ? getAccountProfileImageUrl(this.accountProviderId, this.accountName, this.accountIcon) : undefined;
		if (!url) {
			this.loadedAvatarUrl = undefined;
			this.avatarElement.style.display = 'none';
			this.accountButton.classList.remove('has-avatar');
			return;
		}
		this.avatarElement.style.display = '';
		this.accountButton.classList.add('has-avatar');
		this.avatarElement.onload = () => {
			if (requestId === this.avatarRequestCounter) {
				this.loadedAvatarUrl = url;
			}
		};
		this.avatarElement.onerror = () => {
			if (requestId === this.avatarRequestCounter) {
				this.loadedAvatarUrl = undefined;
				this.avatarElement!.style.display = 'none';
				this.accountButton!.classList.remove('has-avatar');
			}
		};
		if (this.loadedAvatarUrl !== url) {
			this.avatarElement.src = url;
		}
	}

	private showAccountMenu(): void {
		if (!this.accountButton) {
			return;
		}
		const actions = getFlatContextMenuActions(this.menuService.getMenuActions(Menus.AccountMenu, this.contextKeyService));
		if (actions.length === 0) {
			return;
		}
		const store = new DisposableStore();
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.accountButton!,
			getActions: () => actions,
			onHide: () => store.dispose(),
			anchorAlignment: AnchorAlignment.LEFT,
		});
	}
}

class ShidehSidebarSettingsWidget extends BaseActionViewItem {

	private settingsButton: HTMLButtonElement | undefined;

	constructor(
		action: IAction,
		options: IBaseActionViewItemOptions | undefined,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(undefined, action, options);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('shideh-sidebar-settings-widget');
		container.parentElement?.classList.add('shideh-sidebar-settings-widget-item');
		this.settingsButton = append(container, $('button.sidebar-action-button.shideh-sidebar-settings-button', { type: 'button' })) as HTMLButtonElement;
		this.settingsButton.setAttribute('aria-label', localize('shidehSidebarSettings', "Settings"));
		append(this.settingsButton, $('span.codicon.codicon-settings-gear', { 'aria-hidden': 'true' }));
		this.settingsButton.addEventListener('click', () => {
			void this.commandService.executeCommand(SHIDEH_OPEN_SETTINGS_COMMAND_ID);
		});
	}
}

registerAction2(class ShidehSidebarAccountAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_SIDEBAR_ACCOUNT_ACTION_ID,
			title: localize2('shidehSidebarSignIn', "Sign in"),
			menu: [{
				id: Menus.SidebarFooter,
				when: ContextKeyExpr.and(IsSessionsWindowContext, ShidehNavigationIntegratedContext),
				group: 'navigation',
				order: 1,
			}],
		});
	}
	run(): void { }
});

registerAction2(class ShidehSidebarSettingsAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_SIDEBAR_SETTINGS_ACTION_ID,
			title: localize2('shidehSidebarSettings', "Settings"),
			icon: Codicon.settingsGear,
			menu: [{
				id: Menus.SidebarFooter,
				when: ContextKeyExpr.and(IsSessionsWindowContext, ShidehNavigationIntegratedContext),
				group: 'navigation',
				order: 2,
			}],
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand(SHIDEH_OPEN_SETTINGS_COMMAND_ID);
	}
});

class ShidehSidebarFooterContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehSidebarFooter';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(actionViewItemService.register(Menus.SidebarFooter, SHIDEH_SIDEBAR_ACCOUNT_ACTION_ID, (action, options) => {
			return instantiationService.createInstance(ShidehSidebarAccountWidget, action, options);
		}, undefined));
		this._register(actionViewItemService.register(Menus.SidebarFooter, SHIDEH_SIDEBAR_SETTINGS_ACTION_ID, (action, options) => {
			return instantiationService.createInstance(ShidehSidebarSettingsWidget, action, options);
		}, undefined));
	}
}

registerWorkbenchContribution2(ShidehSidebarFooterContribution.ID, ShidehSidebarFooterContribution, WorkbenchPhase.BlockRestore);
