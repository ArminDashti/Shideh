/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IChatService } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatModel } from '../../../../../workbench/contrib/chat/common/model/chatModel.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ISession, ChatInteractivity } from '../../../../services/sessions/common/session.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';

const $ = DOM.$;

/** Dedicated Session History table, hosted on its own page. */
export class SessionHistoryView extends Disposable {

	private readonly table: HTMLTableElement;
	private readonly body: HTMLTableSectionElement;
	private readonly header: HTMLButtonElement;
	private readonly _models = new Map<string, IChatModel>();
	private readonly rowDisposables = this._register(new DisposableStore());

	constructor(
		container: HTMLElement,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsProvidersService private readonly sessionsProvidersService: ISessionsProvidersService,
		@IChatService private readonly chatService: IChatService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super();
		const root = DOM.append(container, $('.agent-session-history'));
		this.header = DOM.append(root, $('button.agent-session-history-header') as HTMLButtonElement);
		this.header.type = 'button';
		this.header.setAttribute('aria-expanded', 'true');
		const title = DOM.append(this.header, $('span'));
		title.textContent = localize('sessionHistory.title', 'Session History');
		const tableContainer = DOM.append(root, $('.agent-session-history-table-container'));
		this.table = DOM.append(tableContainer, $('table.agent-session-history-table'));
		this.table.setAttribute('aria-label', localize('sessionHistory.tableLabel', 'Session History'));
		const head = DOM.append(this.table, $('thead'));
		const headingRow = DOM.append(head, $('tr'));
		for (const column of ['Title', 'Human', 'Agent', 'Providers', 'Models', 'Tokens', 'Started at', 'Cost', 'Delete']) {
			const cell = DOM.append(headingRow, $('th') as HTMLTableCellElement);
			cell.scope = 'col';
			cell.textContent = localize(`sessionHistory.column.${column.replaceAll(' ', '')}`, column);
		}
		this.body = DOM.append(this.table, $('tbody'));
		this._register(DOM.addDisposableListener(this.header, 'click', () => {
			const expanded = this.header.getAttribute('aria-expanded') !== 'true';
			this.header.setAttribute('aria-expanded', String(expanded));
			tableContainer.hidden = !expanded;
		}));
		this._register(this.sessionsManagementService.onDidChangeSessions(() => this.render()));
		this._register(this.sessionsManagementService.onDidDeleteSession(() => this.render()));
		this._register(this.sessionsProvidersService.onDidChangeProviders(() => this.render()));
		this._register(this.chatService.onDidCreateModel(model => this.trackModel(model)));
		this._register(autorun(reader => {
			const models = [...this.chatService.chatModels.read(reader)];
			for (const model of models) {
				this.trackModel(model);
			}
			this.render();
		}));
		this.render();
	}

	private trackModel(model: IChatModel): void {
		const resource = model.sessionResource.toString();
		if (this._models.has(resource)) {
			return;
		}
		this._models.set(resource, model);
		const store = this._register(new DisposableStore());
		store.add(model.onDidChange(() => this.render()));
		store.add(model.onDidDispose(() => {
			this._models.delete(resource);
			this.render();
		}));
		this.render();
	}

	private render(): void {
		this.rowDisposables.clear();
		this.body.replaceChildren();
		const sessions = this.sessionsManagementService.getSessions()
			.filter(session => !session.isNewSessionRequestInProgress?.get())
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		if (sessions.length === 0) {
			const row = DOM.append(this.body, $('tr') as HTMLTableRowElement);
			const cell = DOM.append(row, $('td') as HTMLTableCellElement);
			cell.colSpan = 9;
			cell.textContent = localize('sessionHistory.empty', 'No sessions yet');
			return;
		}
		for (const session of sessions) {
			this.renderSession(session);
		}
	}

	private renderSession(session: ISession): void {
		const row = DOM.append(this.body, $('tr.agent-session-history-row') as HTMLTableRowElement);
		row.tabIndex = 0;
		row.setAttribute('role', 'button');
		row.setAttribute('aria-label', localize('sessionHistory.openSession', 'Open session {0}', session.title.get()));
		const open = () => void this.sessionsService.openSession(session.resource, { source: 'sessionsList', forceMainChat: true });
		this.rowDisposables.add(DOM.addDisposableListener(row, 'click', event => {
			if (!(event.target instanceof HTMLButtonElement)) {
				open();
			}
		}));
		this.rowDisposables.add(DOM.addDisposableListener(row, 'keydown', event => {
			if ((event.key === 'Enter' || event.key === ' ') && !(event.target instanceof HTMLButtonElement)) {
				event.preventDefault();
				open();
			}
		}));
		const chats = session.chats.get().filter(chat => chat.interactivity.get() !== ChatInteractivity.Hidden);
		const providers = this.sessionsProvidersService.getProviders();
		const provider = providers.find(candidate => candidate.id === session.providerId);
		const chatModels = chats.map(chat => this._models.get(chat.resource.toString())).filter((model): model is IChatModel => !!model);
		const requests = chatModels.flatMap(model => model.getRequests()).filter(request => !request.isSystemInitiated && !request.isHiddenFromTranscript);
		const hasLoadedAllChats = chatModels.length === chats.length;
		const models = new Set<string>();
		if (session.modelId.get()) {
			models.add(session.modelId.get()!);
		}
		for (const chat of chats) {
			const modelId = chat.modelId.get();
			if (modelId) {
				models.add(modelId);
			}
		}
		let tokenTotal = 0;
		let hasTokens = false;
		let costTotal = 0;
		let hasCost = false;
		for (const request of requests) {
			if (request.modelId) {
				models.add(request.modelId);
			}
			const usage = request.response?.usage;
			if (usage) {
				if (usage.modelTotals?.length) {
					for (const total of usage.modelTotals) {
						models.add(total.model);
						tokenTotal += total.inputTokens + total.outputTokens;
						hasTokens = true;
					}
				} else if (Number.isFinite(usage.promptTokens) && Number.isFinite(usage.completionTokens)) {
					tokenTotal += usage.promptTokens + usage.completionTokens;
					hasTokens = true;
				}
				if (typeof usage.copilotCredits === 'number' && Number.isFinite(usage.copilotCredits)) {
					costTotal += usage.copilotCredits;
					hasCost = true;
				}
				if (typeof usage.sessionCopilotCredits === 'number' && Number.isFinite(usage.sessionCopilotCredits)) {
					costTotal = Math.max(costTotal, usage.sessionCopilotCredits);
					hasCost = true;
				}
			}
		}
		const countCell = (value: number | string, label: string) => this.appendCell(row, String(value), label);
		const title = session.title.get();
		this.appendCell(row, title || localize('sessionHistory.untitled', 'Untitled'), title || localize('sessionHistory.untitled', 'Untitled'));
		const humans = requests.length;
		const agents = requests.filter(request => !!request.response).length;
		countCell(hasLoadedAllChats ? humans : '—', hasLoadedAllChats
			? localize('sessionHistory.humanCount', '{0} user messages', humans)
			: localize('sessionHistory.countsUnavailable', 'Message counts are unavailable until this session transcript is loaded'));
		countCell(hasLoadedAllChats ? agents : '—', hasLoadedAllChats
			? localize('sessionHistory.agentCount', '{0} agent responses', agents)
			: localize('sessionHistory.countsUnavailable', 'Response counts are unavailable until this session transcript is loaded'));
		this.appendCell(row, provider?.label ?? session.providerId, localize('sessionHistory.providerTooltip', 'Provider: {0}', provider?.label ?? session.providerId));
		this.appendCell(row, [...models].join(', ') || '—', [...models].join(', ') || localize('sessionHistory.modelUnavailable', 'Model details not loaded'));
		this.appendCell(row, hasTokens && hasLoadedAllChats ? tokenTotal.toLocaleString() : '—', hasTokens && hasLoadedAllChats ? localize('sessionHistory.tokensTooltip', '{0} tokens from loaded conversation data', tokenTotal) : localize('sessionHistory.tokensUnavailable', 'Token details are unavailable until the conversation is loaded'));
		this.appendCell(row, session.createdAt.toLocaleString(), localize('sessionHistory.startedAtTooltip', 'Started at {0}', session.createdAt.toLocaleString()));
		this.appendCell(row, hasCost && hasLoadedAllChats ? costTotal.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—', hasCost && hasLoadedAllChats ? localize('sessionHistory.costTooltip', '{0} Copilot credits', costTotal) : localize('sessionHistory.costUnavailable', 'Cost is unavailable or incomplete until the session transcript is loaded'));
		const deleteCell = DOM.append(row, $('td') as HTMLTableCellElement);
		const deleteButton = DOM.append(deleteCell, $('button.agent-session-history-delete') as HTMLButtonElement);
		deleteButton.type = 'button';
		deleteButton.textContent = localize('sessionHistory.delete', 'Delete');
		deleteButton.setAttribute('aria-label', localize('sessionHistory.deleteSession', 'Delete session {0}', title || localize('sessionHistory.untitled', 'Untitled')));
		deleteButton.disabled = !session.capabilities.get().supportsDelete;
		this._register(DOM.addDisposableListener(deleteButton, 'click', event => {
			event.stopPropagation();
			void this.deleteSession(session);
		}));
	}

	private appendCell(row: HTMLTableRowElement, value: string, title?: string): void {
		const cell = DOM.append(row, $('td') as HTMLTableCellElement);
		cell.textContent = value;
		if (title) {
			cell.title = title;
		}
	}

	private async deleteSession(session: ISession): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: localize('sessionHistory.deleteConfirm', 'Delete “{0}”?', session.title.get() || localize('sessionHistory.untitled', 'Untitled')),
			detail: localize('sessionHistory.deleteDetail', 'This action cannot be undone.'),
			primaryButton: localize('sessionHistory.deleteConfirmButton', 'Delete'),
		});
		if (!confirmed.confirmed) {
			return;
		}
		try {
			await this.sessionsManagementService.deleteSessions([session]);
		} catch (error) {
			this.dialogService.error(localize('sessionHistory.deleteError', 'Could not delete the session: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
}
