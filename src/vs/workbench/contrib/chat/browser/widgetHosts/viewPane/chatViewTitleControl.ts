/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatViewTitleControl.css';
import { addDisposableListener, DisposableResizeObserver, EventType, getWindow, h } from '../../../../../../base/browser/dom.js';
import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';

import { Emitter } from '../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { MarshalledId } from '../../../../../../base/common/marshallingIds.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IChatViewTitleActionContext } from '../../../common/actions/chatActions.js';
import { IChatModel } from '../../../common/model/chatModel.js';

export interface IChatViewTitleDelegate {
	focusChat(): void;
	getInputUri(): URI | undefined;
}

export class ChatViewTitleControl extends Disposable {

	private static readonly DEFAULT_TITLE = localize('chat', "Chat");

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private title: string | undefined = undefined;

	private titleContainer: HTMLElement | undefined;
	private titleLabel: HTMLElement | undefined;

	private model: IChatModel | undefined;
	private modelDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly session = observableValue<IAgentSession | undefined>(this, undefined);

	private actionsToolbar?: MenuWorkbenchToolBar;
	private readonly sessionMetaActionViewItems = new Map<string, SessionHeaderMetaActionViewItem>();
	private readonly viewChangesAction: Action;
	private readonly openPullRequestAction: Action;

	private lastKnownHeight = 0;

	constructor(
		private readonly container: HTMLElement,
		private readonly delegate: IChatViewTitleDelegate,
		resizeObserverCtor: typeof ResizeObserver | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAgentSessionsService private readonly agentSessionsService: IAgentSessionsService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this.viewChangesAction = this._register(new Action(
			VIEW_AGENT_SESSION_CHANGES_ACTION_ID,
			localize('chat.viewAgentSessionChanges', "Changes"),
			ThemeIcon.asClassName(Codicon.diffMultiple),
			true,
			async () => this.executeSessionMetaAction(VIEW_AGENT_SESSION_CHANGES_ACTION_ID),
		));
		this.openPullRequestAction = this._register(new Action(
			OPEN_AGENT_SESSION_PULL_REQUEST_ACTION_ID,
			localize('chat.openAgentSessionPullRequest', "Open Pull Request"),
			ThemeIcon.asClassName(Codicon.gitPullRequest),
			true,
			async () => this.executeSessionMetaAction(OPEN_AGENT_SESSION_PULL_REQUEST_ACTION_ID),
		));

		this.render(this.container);
		// Avoid forcing layout; ResizeObserver reports the final size before paint and triggers relayout.
		const resizeObserver = this._register(new DisposableResizeObserver('ChatViewTitleControl.height', entries => {
			const entry = entries.find(entry => entry.target === this.titleContainer);
			if (!entry) {
				return;
			}
			const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
			if (height !== this.lastKnownHeight) {
				this.lastKnownHeight = height;
				this._onDidChangeHeight.fire();
			}
		}, getWindow(this.titleContainer!), { resizeObserverCtor }));
		this._register(resizeObserver.observe(this.titleContainer!, { box: 'border-box' }));

		this.registerActions();
	}

	private registerActions(): void {
		const that = this;

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ChatViewTitleControl.PICK_AGENT_SESSION_ACTION_ID,
					title: localize('chat.pickAgentSession', "Pick Agent Session"),
					f1: false,
					menu: [{
						id: MenuId.ChatViewSessionTitleNavigationToolbar,
						group: 'navigation',
						order: 2
					}]
				});
			}

			async run(accessor: ServicesAccessor): Promise<void> {
				const instantiationService = accessor.get(IInstantiationService);

				const agentSessionsPicker = instantiationService.createInstance(AgentSessionsPicker, that.titleLabel.value?.element, undefined);
				await agentSessionsPicker.pickAgentSession();
			}
		}));
	}

	private render(parent: HTMLElement): void {
		const elements = h('div.chat-view-title-container', [
			h('div.chat-view-title-inner', [
				h('span.chat-view-title-label@titleLabel'),
				h('div.chat-view-title-actions-toolbar@actionsToolbar'),
			]),
		]);
		this.titleInner = elements.titleInner;

		// Title label (plain text)
		this.titleLabel = elements.titleLabel;

		this.sessionMetaContainer = elements.sessionMeta;
		this.sessionMetaToolbar = this._register(this.instantiationService.createInstance(WorkbenchToolBar, elements.sessionMeta, {
			ariaLabel: localize('chat.sessionMetadata', "Chat Session Metadata"),
			actionViewItemProvider: (action, options) => {
				if (options.isMenu) {
					return undefined;
				}

				let item: SessionHeaderMetaActionViewItem | undefined;
				if (action.id === VIEW_AGENT_SESSION_CHANGES_ACTION_ID) {
					item = this.instantiationService.createInstance(SessionChangesMetaActionViewItem, undefined, action, options, reader => {
						const session = this.session.read(reader);
						const summary = getAgentChangesSummary(session?.changes);
						const branchName = session?.metadata?.branchName;
						const branch = session?.metadata?.branch;
						return {
							branch: typeof branchName === 'string' ? branchName : typeof branch === 'string' ? branch : undefined,
							files: summary?.files ?? 0,
							insertions: summary?.insertions ?? 0,
							deletions: summary?.deletions ?? 0,
						};
					});
				} else if (action.id === OPEN_AGENT_SESSION_PULL_REQUEST_ACTION_ID) {
					item = this.instantiationService.createInstance(ChatViewTitlePullRequestActionViewItem, action, options, this.session);
				}

				if (item) {
					this.sessionMetaActionViewItems.set(action.id, item);
				}
				return item;
			},
		}));
		const hasSessionChanges = derived(this, reader => canOpenAgentSessionChanges(this.session.read(reader)));
		const hasSessionPullRequest = derived(this, reader => {
			const session = this.session.read(reader);
			return !!session && !!getAgentSessionPullRequestUri(session);
		});
		this._register(autorun(reader => {
			const actions: IAction[] = [];
			if (hasSessionChanges.read(reader)) {
				actions.push(this.viewChangesAction);
			}
			if (hasSessionPullRequest.read(reader)) {
				actions.push(this.openPullRequestAction);
			}
			this.setSessionMetaActions(actions);
		}));

		// Actions toolbar on the right
		this.actionsToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, elements.actionsToolbar, MenuId.ChatViewSessionTitleToolbar, {
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.NoHide
		}));

		// Title controls
		this.titleContainer = elements.root;

		parent.appendChild(this.titleContainer);

		const compactObserver = this._register(new DisposableResizeObserver('ChatViewTitleControl.compact', entries => {
			if (entries[0]) {
				this.updateCompactState();
			}
		}));
		this._register(compactObserver.observe(elements.titleInner));
	}

	private executeSessionMetaAction(actionId: string): Promise<unknown> | undefined {
		const context = this.getTitleActionContext();
		return context ? this.commandService.executeCommand(actionId, context) : undefined;
	}

	private getTitleActionContext(): IChatViewTitleActionContext | undefined {
		return this.model && {
			$mid: MarshalledId.ChatViewContext,
			sessionResource: this.model.sessionResource,
		};
	}

	private setSessionMetaActions(actions: readonly IAction[]): void {
		if (!this.sessionMetaToolbar || !this.sessionMetaContainer) {
			return;
		}

		const activeElement = this.sessionMetaContainer.ownerDocument.activeElement;
		const focusedActionId = isHTMLElement(activeElement) && this.sessionMetaToolbar.getElement().contains(activeElement)
			? this.sessionMetaToolbar.getItemAction(activeElement)?.id
			: undefined;

		this.sessionMetaContainer.classList.toggle('visible', actions.length > 0);
		this.sessionMetaActionViewItems.clear();
		this.sessionMetaToolbar.setActions(actions);
		this.updateCompactState();

		if (focusedActionId) {
			const focusedItem = this.sessionMetaActionViewItems.get(focusedActionId);
			if (focusedItem) {
				focusedItem.focus();
			} else {
				this.navigationToolbar?.focus();
			}
		}
	}

	update(model: IChatModel | undefined): void {
		this.model = model;

		const store = new DisposableStore();
		this.modelDisposables.value = store;
		this.session.set(undefined, undefined);
		if (model) {
			store.add(model.onDidChange(e => {
				if (e.kind === 'setCustomTitle' || e.kind === 'addRequest') {
					this.doUpdate();
				}
			}));
			const session = this.agentSessionsService.model.observeSession(model.sessionResource);
			store.add(autorun(reader => {
				this.session.set(session.read(reader), undefined);
				this.doUpdate();
			}));
		}

		this.doUpdate();
	}

	private doUpdate(): void {
		const markdownTitle = new MarkdownString(this.model?.title ?? '');
		const modelTitle = renderAsPlaintext(markdownTitle);
		const sessionTitle = renderAsPlaintext(new MarkdownString(this.session.get()?.label ?? ''));
		this.title = modelTitle || sessionTitle || undefined;

		this.updateTitle(this.title ?? ChatViewTitleControl.DEFAULT_TITLE);

		const context = this.model && {
			$mid: MarshalledId.ChatViewContext,
			sessionResource: this.model.sessionResource,
			inputUri: this.delegate.getInputUri(),
		} satisfies IChatViewTitleActionContext;

		if (this.actionsToolbar) {
			this.actionsToolbar.context = context;
		}
	}

	private updateTitle(title: string): void {
		if (!this.titleContainer || !this.titleLabel) {
			return;
		}

		this.titleContainer.classList.toggle('visible', this.shouldRender());
		this.titleLabel.value?.updateTitle(title);
	}

	private shouldRender(): boolean {
		return !!this.model && !!this.title; // we need a chat showing and not being empty
	}

	getHeight(): number {
		return this.lastKnownHeight;
	}
}
