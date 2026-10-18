/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isFirefox } from '../../../../base/browser/browser.js';
import { raceTimeout, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { stripIcons } from '../../../../base/common/iconLabels.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Language } from '../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { AbstractEditorCommandsQuickAccessProvider } from '../../../../editor/contrib/quickAccess/browser/commandsQuickAccess.js';
import { localize, localize2 } from '../../../../nls.js';
import { isLocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { CommandsHistory, ICommandQuickPick } from '../../../../platform/quickinput/browser/commandsQuickAccess.js';
import { TriggerAction } from '../../../../platform/quickinput/browser/pickerQuickAccess.js';
import { DefaultQuickAccessFilterValue } from '../../../../platform/quickinput/common/quickAccess.js';
import { IQuickInputService, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchQuickAccessConfiguration } from '../../../browser/quickaccess.js';
import { CommandInformationResult, IAiRelatedInformationService, RelatedInformationType } from '../../../services/aiRelatedInformation/common/aiRelatedInformation.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { createKeybindingCommandQuery } from '../../../services/preferences/browser/keybindingsEditorModel.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { CHAT_OPEN_ACTION_ID } from '../../chat/browser/actions/chatActions.js';
import { ASK_QUICK_QUESTION_ACTION_ID } from '../../chat/browser/actions/chatQuickInputActions.js';
import { IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';

export class CommandsQuickAccessProvider extends AbstractEditorCommandsQuickAccessProvider {

	private static AI_RELATED_INFORMATION_MAX_PICKS = 5;
	private static AI_RELATED_INFORMATION_DEBOUNCE = 200;

	// If extensions are not yet registered, we wait for a little moment to give them
	// a chance to register so that the complete set of commands shows up as result
	// We do not want to delay functionality beyond that time though to keep the commands
	// functional.
	private readonly extensionRegistrationRace: Promise<boolean | undefined>;

	private useAiRelatedInfo = false;

	protected get activeTextEditorControl(): IEditor | undefined { return this.editorService.activeTextEditorControl; }

	get defaultFilterValue(): DefaultQuickAccessFilterValue | undefined {
		if (this.configuration.preserveInput) {
			return DefaultQuickAccessFilterValue.LAST;
		}

		return undefined;
	}

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IMenuService private readonly menuService: IMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IDialogService dialogService: IDialogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IProductService private readonly productService: IProductService,
		@IAiRelatedInformationService private readonly aiRelatedInformationService: IAiRelatedInformationService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
	) {
		super({
			showAlias: !Language.isDefaultVariant(),
			noResultsPick: () => ({
				label: localize('noCommandResults', "No matching commands"),
				commandId: ''
			}),
		}, instantiationService, keybindingService, commandService, telemetryService, dialogService, logService);

		this.extensionRegistrationRace = raceTimeout(extensionService.whenInstalledExtensionsRegistered(), 800);
		this._register(configurationService.onDidChangeConfiguration((e) => this.updateOptions(e)));
		this.updateOptions();
	}

	private get configuration() {
		const commandPaletteConfig = this.configurationService.getValue<IWorkbenchQuickAccessConfiguration>().workbench.commandPalette;

		return {
			preserveInput: commandPaletteConfig.preserveInput,
			showAskInChat: commandPaletteConfig.showAskInChat,
			experimental: commandPaletteConfig.experimental
		};
	}

	private updateOptions(e?: IConfigurationChangeEvent): void {
		if (e && !e.affectsConfiguration('workbench.commandPalette.experimental')) {
			return;
		}

		const config = this.configuration;
		const suggestedCommandIds = config.experimental.suggestCommands && this.productService.commandPaletteSuggestedCommandIds?.length
			? new Set(this.productService.commandPaletteSuggestedCommandIds)
			: undefined;
		this.options.suggestedCommandIds = suggestedCommandIds;
		this.useAiRelatedInfo = config.experimental.enableNaturalLanguageSearch;
	}

	protected async getCommandPicks(token: CancellationToken): Promise<Array<ICommandQuickPick>> {

		// wait for extensions registration or 800ms once
		await this.extensionRegistrationRace;

		if (token.isCancellationRequested) {
			return [];
		}

		return [
			...this.getCodeEditorCommandPicks(),
			...this.getGlobalCommandPicks()
		].map(picks => ({
			...picks,
			buttons: [{
				iconClass: ThemeIcon.asClassName(Codicon.gear),
				tooltip: localize('configure keybinding', "Configure Keybinding"),
			}],
			trigger: (): TriggerAction => {
				this.preferencesService.openGlobalKeybindingSettings(false, { query: createKeybindingCommandQuery(picks.commandId, picks.commandWhen) });
				return TriggerAction.CLOSE_PICKER;
			},
		}));
	}

	protected hasAdditionalCommandPicks(filter: string, token: CancellationToken): boolean {
		if (
			!this.useAiRelatedInfo
			|| token.isCancellationRequested
			|| filter === ''
			|| !this.aiRelatedInformationService.isEnabled()
		) {
			return false;
		}

		return true;
	}

	protected async getAdditionalCommandPicks(allPicks: ICommandQuickPick[], picksSoFar: ICommandQuickPick[], filter: string, token: CancellationToken): Promise<Array<ICommandQuickPick | IQuickPickSeparator>> {
		if (!this.hasAdditionalCommandPicks(filter, token)) {
			return [];
		}

		let additionalPicks: (ICommandQuickPick | IQuickPickSeparator)[] = [];
		try {
			// Wait a bit to see if the user is still typing
			await timeout(CommandsQuickAccessProvider.AI_RELATED_INFORMATION_DEBOUNCE, token);
			additionalPicks = await this.getRelatedInformationPicks(allPicks, picksSoFar, filter, token);
		} catch (e) {
			// Ignore and continue to add "Ask in Chat" option
		}

		// If enabled in settings, add "Ask in Chat" option after a separator (if needed).
		if (this.configuration.showAskInChat) {
			const defaultAgent = this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat);
			if (defaultAgent) {
				if (picksSoFar.length || additionalPicks.length) {
					additionalPicks.push({
						type: 'separator'
					});
				}

				additionalPicks.push({
					label: localize('commandsQuickAccess.askInChat', "Ask in Chat: {0}", filter),
					commandId: this.configuration.experimental.askChatLocation === 'quickChat' ? ASK_QUICK_QUESTION_ACTION_ID : CHAT_OPEN_ACTION_ID,
					args: [filter],
					buttons: [{
						iconClass: ThemeIcon.asClassName(Codicon.gear),
						tooltip: localize('commandsQuickAccess.configureAskInChatSetting', "Configure visibility"),
					}],
					trigger: () => {
						void this.preferencesService.openSettings({ jsonEditor: false, query: 'workbench.commandPalette.showAskInChat' });
						return TriggerAction.CLOSE_PICKER;
					},
				});
			}
		}

		return additionalPicks;
	}

	private async getRelatedInformationPicks(allPicks: ICommandQuickPick[], picksSoFar: ICommandQuickPick[], filter: string, token: CancellationToken) {
		const relatedInformation = await this.aiRelatedInformationService.getRelatedInformation(
			filter,
			[RelatedInformationType.CommandInformation],
			token
		) as CommandInformationResult[];

		// Sort by weight descending to get the most relevant results first
		relatedInformation.sort((a, b) => b.weight - a.weight);

		const setOfPicksSoFar = new Set(picksSoFar.map(p => p.commandId));
		const additionalPicks = new Array<ICommandQuickPick | IQuickPickSeparator>();

		for (const info of relatedInformation) {
			if (additionalPicks.length === CommandsQuickAccessProvider.AI_RELATED_INFORMATION_MAX_PICKS) {
				break;
			}
			const pick = allPicks.find(p => p.commandId === info.command && !setOfPicksSoFar.has(p.commandId));
			if (pick) {
				additionalPicks.push(pick);
			}
		}

		return additionalPicks;
	}

	private getGlobalCommandPicks(): ICommandQuickPick[] {
		const globalCommandPicks: ICommandQuickPick[] = [];
		const scopedContextKeyService = this.editorService.activeEditorPane?.scopedContextKeyService || this.editorGroupService.activeGroup.scopedContextKeyService;
		const globalCommandsMenu = this.menuService.getMenuActions(MenuId.CommandPalette, scopedContextKeyService);
		const globalCommandsMenuActions = globalCommandsMenu
			.reduce((r, [, actions]) => [...r, ...actions], <Array<MenuItemAction | SubmenuItemAction | string>>[])
			.filter(action => action instanceof MenuItemAction && action.enabled) as MenuItemAction[];

		if (globalCommandsMenuActions.every(a => a.item.id !== 'workbench.extensions.action.focusExtensionsView')) {
			this.logService?.info('GLOBAL COMMAND PICKS: workbench.extensions.action.focusExtensionsView not found');
		}
		for (const action of globalCommandsMenuActions) {

			// Label
			let label = (typeof action.item.title === 'string' ? action.item.title : action.item.title.value) || action.item.id;

			// Category
			const category = typeof action.item.category === 'string' ? action.item.category : action.item.category?.value;
			if (category) {
				label = localize('commandWithCategory', "{0}: {1}", category, label);
			}

			// Alias
			const aliasLabel = typeof action.item.title !== 'string' ? action.item.title.original : undefined;
			const aliasCategory = (category && action.item.category && typeof action.item.category !== 'string') ? action.item.category.original : undefined;
			const commandAlias = (aliasLabel && category) ?
				aliasCategory ? `${aliasCategory}: ${aliasLabel}` : `${category}: ${aliasLabel}` :
				aliasLabel;

			const metadataDescription = action.item.metadata?.description;
			const commandDescription = metadataDescription === undefined || isLocalizedString(metadataDescription)
				? metadataDescription
				// TODO: this type will eventually not be a string and when that happens, this should simplified.
				: { value: metadataDescription, original: metadataDescription };
			globalCommandPicks.push({
				commandId: action.item.id,
				commandWhen: action.item.precondition?.serialize(),
				commandAlias,
				label: stripIcons(label),
				commandDescription,
				commandCategory: category,
			});
		}

		return globalCommandPicks;
	}
}

//#region Actions

export class ShowAllCommandsAction extends Action2 {

	static readonly ID = 'workbench.action.showCommands';

	constructor() {
		super({
			id: ShowAllCommandsAction.ID,
			title: localize2('showTriggerActions', 'Show All Commands'),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: undefined,
				primary: !isFirefox ? (KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP) : undefined,
				secondary: [KeyCode.F1]
			},
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IQuickInputService).quickAccess.show(CommandsQuickAccessProvider.PREFIX);
	}
}

export class ClearCommandHistoryAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.clearCommandHistory',
			title: localize2('clearCommandHistory', 'Clear Command History'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const storageService = accessor.get(IStorageService);
		const dialogService = accessor.get(IDialogService);

		const commandHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(configurationService);
		if (commandHistoryLength > 0) {

			// Ask for confirmation
			const { confirmed } = await dialogService.confirm({
				type: 'warning',
				message: localize('confirmClearMessage', "Do you want to clear the history of recently used commands?"),
				detail: localize('confirmClearDetail', "This action is irreversible!"),
				primaryButton: localize({ key: 'clearButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Clear")
			});

			if (!confirmed) {
				return;
			}

			CommandsHistory.clearHistory(configurationService, storageService);
		}
	}
}

export class AskMeAction extends Action2 {

	private _previousModel: InteractiveSessionModel | undefined;
	private _previousQuery: string | undefined;
	private _currentTimer: NodeJS.Timeout | undefined;

	constructor() {
		super({
			id: 'workbench.action.quickOpenAsk',
			title: { value: localize('askme', "Ask Me"), original: 'Ask Me' },
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI
				},
			}
		});
	}

	async run(accessor: ServicesAccessor, query: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const interactiveSessionService = accessor.get(IInteractiveSessionService);
		const instantiationService = accessor.get(IInstantiationService);

		clearTimeout(this._currentTimer);
		this._currentTimer = undefined;

		if (query) {
			this._previousModel = undefined;
		}

		const cts = new CancellationTokenSource();
		const model = this._previousModel ?? interactiveSessionService.startSession('copilot', false, cts.token);
		if (!model) {
			return;
		}

		const containerList = dom.$('.interactive-list');
		const containerSession = dom.$('.interactive-session', undefined, containerList);
		containerList.style.position = 'relative';

		const input = quickInputService.createQuickPick();
		input.ignoreFocusOut = true;
		input.description = containerSession;
		input.title = localize('askabot', "Ask Copilot");
		input.placeholder = localize('askabot', "Ask Copilot");
		input.items = [{
			type: 'separator',
			label: localize('askabotasdf', "commands"),
		},
		{
			label: localize('askabotsdfsdf', "Sort Lines"),
		},
		{
			label: localize('askabotsdfsdasdff', "Download everything"),
		},
		];
		input.onDidChangeValue(() => {
			input.activeItems = [];
		});
		input.activeItems = [];
		input.matchOnLabel = false;
		input.buttons = [{
			iconClass: ThemeIcon.asClassName(Codicon.commentDiscussion),
			tooltip: localize('cancel', "Go to chat"),
		}];
		// input.onDidTriggerButton(() => {
		// 	interactiveSessionService.addCompleteRequest(input.value, )
		// });
		input.onDidHide(() => {
			disposables.dispose();
			this._currentTimer = setTimeout(() => {
				this._previousModel?.dispose();
				this._previousModel = undefined;
				this._previousQuery = undefined;
			}, 1000 * 10); // 10 seconds
		});
		input.show();

		let disposables = this.createSession(containerList, containerList.offsetWidth, model, instantiationService);
		input.onDidAccept(async () => {
			disposables.dispose();
			// model?.dispose();
			// model = interactiveSessionService.startSession('copilot', false, cts.token);
			// if (!model) {
			// 	return;
			// }
			this._previousQuery = input.value;
			this._previousModel = model;
			disposables = this.createSession(containerList, containerList.offsetWidth, model, instantiationService);
			await interactiveSessionService.sendRequest(model.sessionId, input.value);
		});

		if (query) {
			input.value = query;
			input.description = containerSession;
			this._previousQuery = query;
			this._previousModel = model;
			await interactiveSessionService.sendRequest(model.sessionId, query);
		} else if (this._previousQuery) {
			input.value = this._previousQuery;
		}
	}

	createSession(container: HTMLElement, offsetWidth: number, model: InteractiveSessionModel, instantiationService: IInstantiationService): IDisposable {
		const disposables = new DisposableStore();
		const viewModel = new InteractiveSessionViewModel(model, instantiationService);
		disposables.add(viewModel);
		const thing = instantiationService.createInstance(InteractiveSessionEditorOptions, 'qp', () => editorBackground, () => editorBackground);
		disposables.add(thing);
		const list = instantiationService.createInstance(
			InteractiveListItemRenderer,
			thing,
			{
				getListLength() {
					return viewModel.getItems().length;
				},
				getSlashCommands() {
					return [];
				},
			}
		);
		disposables.add(list);

		dom.reset(container);
		const template = list.renderTemplate(container);
		list.layout(offsetWidth);
		disposables.add(viewModel.onDidChange(() => {
			if (viewModel.getItems().length % 2 !== 0) {
				return;
			}

			const items = viewModel.getItems();
			const node = {
				element: items[items.length - 1],
				children: [],
				collapsed: false,
				collapsible: false,
				depth: 0,
				filterData: undefined,
				visible: true,
				visibleChildIndex: 0,
				visibleChildrenCount: 1,
			};
			list.disposeElement(node, 0, template);
			list.renderElement(node, 0, template);
		}));

		if (viewModel.getItems().length > 1) {
			const items = viewModel.getItems();
			const node = {
				element: items[items.length - 1],
				children: [],
				collapsed: false,
				collapsible: false,
				depth: 0,
				filterData: undefined,
				visible: true,
				visibleChildIndex: 0,
				visibleChildrenCount: 1,
			};
			list.disposeElement(node, 0, template);
			list.renderElement(node, 0, template);
		}

		return disposables;
	}
}

registerAction2(AskMeAction);

//#endregion
