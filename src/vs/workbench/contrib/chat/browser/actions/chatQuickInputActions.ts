/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IsSessionsWindowContext } from '../../../../common/contextkeys.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { IQuickChatOpenOptions, IQuickChatService } from '../chat.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';

export const ASK_QUICK_QUESTION_ACTION_ID = 'workbench.action.quickchat.toggle';
const QuickChatGlobalEnabledContext = ContextKeyExpr.and(ChatContextKeys.enabled, IsSessionsWindowContext.negate());

export function registerQuickChatActions() {
	registerAction2(QuickChatGlobalAction);
	registerAction2(AskQuickChatAction);

	registerAction2(class OpenInChatViewAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.quickchat.openInChatView',
				title: localize2('chat.openInChatView.label', "Open in Chat View"),
				f1: false,
				category: CHAT_CATEGORY,
				icon: Codicon.chatSparkle,
				menu: {
					id: MenuId.ChatInputSide,
					group: 'navigation',
					order: 10
				}
			});
		}

		run(accessor: ServicesAccessor) {
			const quickChatService = accessor.get(IQuickChatService);
			quickChatService.openInChatView();
		}
	});

	registerAction2(class CloseQuickChatAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.quickchat.close',
				title: localize2('chat.closeQuickChat.label', "Close Quick Chat"),
				f1: false,
				category: CHAT_CATEGORY,
				icon: Codicon.closeSmall,
				menu: {
					id: MenuId.ChatInputSide,
					group: 'navigation',
					order: 20
				}
			});
		}

		run(accessor: ServicesAccessor) {
			const quickChatService = accessor.get(IQuickChatService);
			quickChatService.close();
		}
	});

}

class QuickChatGlobalAction extends Action2 {
	constructor() {
		super({
			id: ASK_QUICK_QUESTION_ACTION_ID,
			title: localize2('quickChat', 'Open Quick Chat'),
			precondition: QuickChatGlobalEnabledContext,
			icon: Codicon.chatSparkle,
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KeyL,
				when: QuickChatGlobalEnabledContext,
			},
			menu: {
				id: MenuId.ChatTitleBarMenu,
				group: 'a_open',
				order: 4
			},
			metadata: {
				description: localize('toggle.desc', 'Toggle the quick chat'),
				args: [{
					name: 'args',
					schema: {
						anyOf: [
							{
								type: 'object',
								required: ['query'],
								properties: {
									query: {
										description: localize('toggle.query', "The query to open the quick chat with"),
										type: 'string'
									},
									isPartialQuery: {
										description: localize('toggle.isPartialQuery', "Whether the query is partial; it will wait for more user input"),
										type: 'boolean'
									}
								},
							},
							{
								type: 'string',
								description: localize('toggle.query', "The query to open the quick chat with")
							}
						]
					}
				}]
			},
		});
	}

	override run(accessor: ServicesAccessor, query?: string | Omit<IQuickChatOpenOptions, 'selection'>): void {
		const quickChatService = accessor.get(IQuickChatService);
		let options: IQuickChatOpenOptions | undefined;
		switch (typeof query) {
			case 'string': options = { query }; break;
			case 'object': options = query; break;
		}
		if (options?.query) {
			options.selection = new Selection(1, options.query.length + 1, 1, options.query.length + 1);
		}
		quickChatService.toggle(options);
	}
}

class AskQuickChatAction extends Action2 {
	constructor() {
		super({
			id: `workbench.action.openQuickChat`,
			category: CHAT_CATEGORY,
			title: localize2('interactiveSession.open', "Open Quick Chat"),
			precondition: ChatContextKeys.enabled,
			f1: true
		});
	}

	override run(accessor: ServicesAccessor, query?: string): void {
		const quickChatService = accessor.get(IQuickChatService);
		quickChatService.toggle(query ? {
			query,
			selection: new Selection(1, query.length + 1, 1, query.length + 1)
		} : undefined);
	}
}

// class InteractiveQuickPickSession extends Disposable {

// 	private _model: ChatModel;
// 	private _viewModel: ChatViewModel;

// 	private readonly _onDidClickFollowup: Emitter<IChatReplyFollowup> = this._register(new Emitter<IChatReplyFollowup>());
// 	onDidClickFollowup: Event<IChatReplyFollowup> = this._onDidClickFollowup.event;

// 	private _listDisposable: DisposableStore | undefined;

// 	constructor(
// 		@IInstantiationService private readonly _instantiationService: IInstantiationService,
// 		@IChatService private readonly _chatService: IChatService,
// 		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService
// 	) {
// 		super();

// 		const providerInfo = _chatService.getProviderInfos()[0];
// 		this._model = this._register(_chatService.startSession(providerInfo.id, CancellationToken.None)!);
// 		this._viewModel = this._register(new ChatViewModel(this._model, _instantiationService));
// 	}

// 	createList(container: HTMLElement, offsetWidth: number) {
// 		this._listDisposable?.dispose();
// 		this._listDisposable = new DisposableStore();
// 		const options = this._listDisposable.add(this._instantiationService.createInstance(ChatEditorOptions, 'quickpick-interactive', foreground, editorBackground, editorBackground));
// 		const list = this._listDisposable.add(this._instantiationService.createInstance(
// 			ChatListItemRenderer,
// 			options,
// 			{
// 				getListLength: () => {
// 					return 1;
// 				},
// 				getSlashCommands() {
// 					return [];
// 				},
// 			}
// 		));

// 		const template = list.renderTemplate(container);
// 		list.layout(offsetWidth);
// 		this._listDisposable.add(this._viewModel.onDidChange(() => {
// 			const items = this._viewModel.getItems();
// 			const node = {
// 				element: items[items.length - 1],
// 				children: [],
// 				collapsed: false,
// 				collapsible: false,
// 				depth: 0,
// 				filterData: undefined,
// 				visible: true,
// 				visibleChildIndex: 0,
// 				visibleChildrenCount: 1,
// 			};
// 			list.disposeElement(node, 0, template);
// 			list.renderElement(node, 0, template);
// 		}));

// 		if (this._viewModel.getItems().length) {
// 			const items = this._viewModel.getItems();
// 			const node = {
// 				element: items[items.length - 1],
// 				children: [],
// 				collapsed: false,
// 				collapsible: false,
// 				depth: 0,
// 				filterData: undefined,
// 				visible: true,
// 				visibleChildIndex: 0,
// 				visibleChildrenCount: 1,
// 			};
// 			list.disposeElement(node, 0, template);
// 			list.renderElement(node, 0, template);
// 		}

// 		this._listDisposable.add(list.onDidClickFollowup(e => {
// 			this._onDidClickFollowup.fire(e);
// 		}));
// 	}

// 	get providerId() {
// 		return this._model.providerId;
// 	}

// 	get sessionId() {
// 		return this._model.sessionId;
// 	}

// 	async accept(query: string) {
// 		await this._model.waitForInitialization();
// 		const requests = this._model.getRequests();
// 		const lastRequest = requests[requests.length - 1];
// 		if (lastRequest?.message && lastRequest?.message === query) {
// 			return;
// 		}
// 		if (this._model.requestInProgress) {
// 			this._chatService.cancelCurrentRequestForSession(this.sessionId);
// 		}
// 		await this._chatService.sendRequest(this.sessionId, query);
// 	}

// 	async openInChat(value: string) {
// 		const widget = await this._chatWidgetService.revealViewForProvider(this.providerId);
// 		if (!widget?.viewModel) {
// 			return;
// 		}

// 		const requests = this._model.getRequests().reverse();
// 		const response = requests.find(r => r.response?.response.value !== undefined);
// 		const message = response?.response?.response.value;
// 		if (message) {
// 			this._chatService.addCompleteRequest(widget.viewModel.sessionId, value, { message });
// 		} else if (value) {
// 			this._chatService.sendRequest(widget.viewModel.sessionId, value);
// 		}
// 		widget.focusInput();
// 	}
// }
