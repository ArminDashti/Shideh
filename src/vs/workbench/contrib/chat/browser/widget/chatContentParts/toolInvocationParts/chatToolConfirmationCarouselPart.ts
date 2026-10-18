/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../../../base/browser/keyboardEvent.js';
import { Button } from '../../../../../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../../../base/common/event.js';
import { IMarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { KeyCode } from '../../../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../../base/common/observable.js';
import { localize } from '../../../../../../../nls.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { defaultButtonStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { CHAT_CARD_HEADER_ACTIONS_CLASS, CHAT_CARD_LARGE_CLASS, chatCardButtonStyles } from '../../chatCard.js';
import { IChatToolInvocation, ToolConfirmKind } from '../../../../common/chatService/chatService.js';
import { ChatToolInvocationPart } from './chatToolInvocationPart.js';
import { IChatConfirmationPhonePresenter } from './chatConfirmationPhonePresenter.js';
import '../media/chatToolConfirmationCarousel.css';

const COLLAPSED_CAROUSEL_MAX_HEIGHT = 300;
const MIN_CAROUSEL_MAX_HEIGHT = 80;

export type ToolInvocationPartFactory = (tool: IChatToolInvocation) => ChatToolInvocationPart;

export type RevealSubagentCallback = (subAgentInvocationId: string) => void;

interface ICarouselToolItem {
	readonly tool?: IChatToolInvocation;
	readonly toolCallId: string;
	readonly disposables: DisposableStore;
	request?: IChatInputCarouselRequest;
	readonly subAgentInvocationId?: string;
	readonly subagentTitle?: string;
	readonly revealSubagent?: RevealSubagentCallback;
	readonly revealSubagentLabel?: string;
	readonly toolPartFactory: ToolInvocationPartFactory;
	ownsToolPart: boolean;
	toolPart?: IChatInputCarouselContent;
}

export interface IChatInputCarouselContent extends IDisposable {
	readonly domNode: HTMLElement;
}

export interface IChatInputCarouselRequest {
	readonly id: string;
	readonly title: string;
	readonly sourceLabel: string;
	readonly isActive: IObservable<boolean>;
	createContent(): IChatInputCarouselContent;
}

export class ChatToolConfirmationCarouselPart extends Disposable {
	public readonly domNode: HTMLElement;

	private readonly _onDidEmpty = this._register(new Emitter<boolean>());
	readonly onDidEmpty = this._onDidEmpty.event;
	private readonly _onDidChangeActiveSubagent = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveSubagent = this._onDidChangeActiveSubagent.event;

	private readonly items: ICarouselToolItem[] = [];
	private readonly toolCallIds = new Set<string>();
	private activeIndex = 0;

	private readonly _carouselRoot: HTMLElement;
	private readonly _hiddenHost: HTMLElement;
	private readonly _phonePlaceholder: HTMLElement;
	private readonly _openSheet = this._register(new MutableDisposable<IDisposable>());
	private readonly collapsedTitle: HTMLElement;
	private readonly agentLabel: HTMLButtonElement;
	private readonly sourceLabel: HTMLElement;
	private readonly sourceHover = this._register(new MutableDisposable());
	private readonly contentContainer: HTMLElement;
	private readonly stepIndicator: HTMLElement;
	private readonly prevButton: Button;
	private readonly nextButton: Button;
	private readonly allowAllButton: Button;
	private readonly expandContentButton: Button;
	private readonly dismissButton: Button;
	private readonly activeContentDisposables: DisposableStore;
	private readonly contentResizeObserver: dom.DisposableResizeObserver;
	private readonly updateContentExpansionStateScheduler: dom.AnimationFrameScheduler;
	private _isContentExpanded = false;
	private canExpandContent = false;
	private maxHeight: number | undefined;

	constructor(
		private readonly toolPartFactory: ToolInvocationPartFactory,
		initialTools: IChatToolInvocation[],
		private readonly revealSubagent?: RevealSubagentCallback,
		private readonly initialRevealSubagentLabel?: string,
		private readonly initialSubAgentInvocationId?: string,
		private readonly initialSubagentTitle?: string,
		private readonly hoverService?: IHoverService,
	) {
		super();

		const elements = dom.h(`.chat-tool-confirmation-carousel.${CHAT_CARD_LARGE_CLASS}@root`, [
			dom.h('.chat-tool-carousel-overlay@overlay', [
				dom.h('.chat-tool-carousel-title-group@titleGroup', [
					dom.h('span.chat-tool-carousel-collapsed-title@collapsedTitle'),
					dom.h('button.chat-tool-carousel-agent-label@agentLabel'),
					dom.h('span.chat-tool-carousel-source-label@sourceLabel'),
				]),
				dom.h(`.chat-tool-carousel-overlay-actions.${CHAT_CARD_HEADER_ACTIONS_CLASS}@overlayActions`, [
					dom.h('.chat-tool-carousel-step-indicator@stepIndicator'),
					dom.h('.chat-tool-carousel-nav-arrows@navArrows'),
				]),
			]),
			dom.h('.chat-tool-carousel-content@content'),
		]);

		this._carouselRoot = elements.root;
		this._carouselRoot.tabIndex = -1;
		this._carouselRoot.setAttribute('role', 'group');
		this._carouselRoot.setAttribute('aria-label', localize('toolConfirmationCarousel', "Tool confirmation carousel"));

		// Off-screen host that keeps the carousel DOM (and its
		// observers) alive while the carousel is mounted into a phone
		// bottom sheet rather than into `domNode`. The host is itself a
		// child of `domNode` so it disposes along with the part. Using
		// `display:none` would suppress layout/resize callbacks, so we
		// keep it visually hidden via `visibility:hidden` + zero size.
		this._hiddenHost = dom.$('.chat-tool-confirmation-carousel-host');
		this._hiddenHost.style.position = 'absolute';
		this._hiddenHost.style.visibility = 'hidden';
		this._hiddenHost.style.pointerEvents = 'none';
		this._hiddenHost.style.width = '0';
		this._hiddenHost.style.height = '0';
		this._hiddenHost.style.overflow = 'hidden';
		this._hiddenHost.setAttribute('aria-hidden', 'true');
		this.domNode.appendChild(this._hiddenHost);

		// Phone-only trigger that replaces the inline carousel. Clicking
		// hands the (still-live) carousel root to the phone presenter,
		// which mounts it into a bottom sheet.
		this._phonePlaceholder = dom.$('.chat-confirmation-mobile-trigger');
		this._phonePlaceholder.setAttribute('role', 'button');
		this._phonePlaceholder.tabIndex = 0;
		this._phonePlaceholder.textContent = localize('chatToolConfirmationCarousel.mobileTrigger', "Tap to review");
		this._phonePlaceholder.setAttribute('aria-label', localize('chatToolConfirmationCarousel.mobileTriggerAria', "Review pending tool confirmation"));
		this._register(dom.addDisposableListener(this._phonePlaceholder, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			this._openPhoneSheet();
		}));
		this._register(dom.addDisposableListener(this._phonePlaceholder, dom.EventType.KEY_DOWN, e => {
			if (e.key === 'Enter' || e.key === ' ') {
				dom.EventHelper.stop(e, true);
				this._openPhoneSheet();
			}
		}));

		this.collapsedTitle = elements.collapsedTitle;
		this.agentLabel = elements.agentLabel;
		this.sourceLabel = elements.sourceLabel;
		this.contentContainer = elements.content;
		this.stepIndicator = elements.stepIndicator;
		this.activeContentDisposables = this._register(new DisposableStore());
		this.updateContentExpansionStateScheduler = this._register(new dom.AnimationFrameScheduler(this._carouselRoot, () => this.updateContentExpansionState()));
		this.contentResizeObserver = this._register(new dom.DisposableResizeObserver('ChatToolConfirmationCarouselPart.contentExpansion', () => this.updateContentExpansionStateScheduler.schedule()));
		this._register(this.contentResizeObserver.observe(this.contentContainer));

		this.allowAllButton = this._register(new Button(elements.overlayActions, { ...defaultButtonStyles, small: true }));
		this.allowAllButton.element.classList.add('chat-tool-carousel-allow-all-button');
		this.allowAllButton.label = localize('allowAll', "Allow All");
		this._register(this.allowAllButton.onDidClick(() => this.allowAll()));

		this.expandContentButton = this._register(new Button(elements.overlayActions, { ...chatCardButtonStyles, secondary: true, supportIcons: true }));
		this.expandContentButton.element.classList.add('chat-card-icon-button', 'chat-tool-carousel-header-button', 'chat-tool-carousel-expand-content-button');
		this.expandContentButton.element.setAttribute('aria-controls', this.contentContainer.id);
		this.updateExpandContentButton();
		dom.hide(this.expandContentButton.element);
		this._register(this.expandContentButton.onDidClick(() => this.toggleContentExpanded()));

		this.dismissButton = this._register(new Button(elements.overlayActions, { ...chatCardButtonStyles, secondary: true, supportIcons: true }));
		this.dismissButton.element.classList.add('chat-card-icon-button', 'chat-tool-carousel-dismiss-button');
		this.dismissButton.label = `$(${Codicon.closeSmall.id})`;
		const dismissButtonLabel = this.items.length === 1
			? localize('skip', "Skip")
			: localize('skipAll', "Skip All");
		this.dismissButton.element.setAttribute('aria-label', dismissButtonLabel);
		this.dismissButton.element.title = dismissButtonLabel;
		this._register(this.dismissButton.onDidClick(() => this.skipAll()));

		this.prevButton = this._register(new Button(elements.navArrows, {
			...chatCardButtonStyles,
			secondary: true,
			supportIcons: true,
		}));
		this.prevButton.element.classList.add('chat-card-icon-button', 'chat-card-icon-button-strong', 'chat-tool-carousel-nav-arrow');
		this.prevButton.label = `$(${Codicon.chevronLeft.id})`;
		this.prevButton.element.setAttribute('aria-label', localize('previous', "Previous"));
		this._register(this.prevButton.onDidClick(() => this.navigateRelative(-1)));

		this.nextButton = this._register(new Button(elements.navArrows, {
			...chatCardButtonStyles,
			secondary: true,
			supportIcons: true,
		}));
		this.nextButton.element.classList.add('chat-card-icon-button', 'chat-card-icon-button-strong', 'chat-tool-carousel-nav-arrow');
		this.nextButton.label = `$(${Codicon.chevronRight.id})`;
		this.nextButton.element.setAttribute('aria-label', localize('next', "Next"));
		this._register(this.nextButton.onDidClick(() => this.navigateRelative(1)));

		this._register(dom.addDisposableListener(this.agentLabel, 'click', e => {
			e.preventDefault();
			this.revealActiveSubagent();
		}));

		this._register(dom.addDisposableListener(this._carouselRoot, 'keydown', e => this.onKeydown(e)));

		// Swap the mount between inline carousel (desktop) and the
		// tap-to-review placeholder (phone) whenever the presenter's
		// `enabled` observable flips. Runs once on construction, then
		// on every viewport rotation across the phone breakpoint.
		this._register(autorun(reader => {
			const isPhone = this._phonePresenter.enabled.read(reader);
			this._applyMount(isPhone);
		}));

		for (const tool of initialTools) {
			this.addToolInvocation(tool, this.initialSubAgentInvocationId, this.initialSubagentTitle, this.revealSubagent, this.initialRevealSubagentLabel);
		}
	}

	get pendingCount(): number {
		return this.items.length;
	}

	get activeSubAgentInvocationId(): string | undefined {
		return this.items[this.activeIndex]?.subAgentInvocationId;
	}

	get activeToolConfirmation(): IChatToolInvocation | undefined {
		return this.items[this.activeIndex]?.tool;
	}

	acceptActiveConfirmation(): void {
		this.items[this.activeIndex]?.toolPart?.acceptConfirmation();
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}

	setMaxHeight(maxHeight: number | undefined): void {
		this.maxHeight = maxHeight;
		this.updateMaxHeightStyle();
	}

	hasToolInvocation(toolCallId: string): boolean {
		return this.toolCallIds.has(toolCallId);
	}

	addToolInvocation(tool: IChatToolInvocation, subAgentInvocationId?: string, subagentTitle?: string, revealSubagent?: RevealSubagentCallback, revealSubagentLabel?: string, toolPart?: ChatToolInvocationPart, toolPartFactory: ToolInvocationPartFactory = this.toolPartFactory): void {
		if (this.toolCallIds.has(tool.toolCallId)) {
			const existing = this.items.find(item => item.toolCallId === tool.toolCallId);
			if (existing && toolPart && !existing.toolPart) {
				this.replaceExternalToolPart(existing, toolPart);
			}
			return;
		}

		this.toolCallIds.add(tool.toolCallId);

		const disposables = new DisposableStore();

		const item: ICarouselToolItem = {
			tool,
			toolCallId: tool.toolCallId,
			disposables,
			subAgentInvocationId,
			subagentTitle,
			revealSubagent,
			revealSubagentLabel,
			toolPartFactory,
			ownsToolPart: !toolPart,
			toolPart,
		};
		this.items.push(item);
		if (toolPart) {
			this.watchExternalToolPart(item, toolPart);
		}

		disposables.add(autorun(reader => {
			const currentState = tool.state.read(reader);
			if (currentState.type !== IChatToolInvocation.StateKind.WaitingForConfirmation
				&& currentState.type !== IChatToolInvocation.StateKind.WaitingForPostApproval
				&& currentState.type !== IChatToolInvocation.StateKind.WaitingForAuthentication) {
				this.removeItem(tool.toolCallId);
			}
		}));

		this.updateUI();

		if (this.items.length === 1) {
			this.setActiveIndex(0);
		}
	}

	removeToolInvocation(tool: IChatToolInvocation): void {
		if (this.items.some(item => item.tool === tool)) {
			this.removeItem(tool.toolCallId);
		}
	}

	private replaceExternalToolPart(item: ICarouselToolItem, toolPart: ChatToolInvocationPart): void {
		if (item.toolPart === toolPart) {
			return;
		}

		if (item.toolPart && item.ownsToolPart) {
			item.disposables.delete(item.toolPart);
		}

		item.toolPart = toolPart;
		item.ownsToolPart = false;
		this.watchExternalToolPart(item, toolPart);
		if (this.items[this.activeIndex] === item) {
			this.renderActiveContent();
		}
	}

	private watchExternalToolPart(item: ICarouselToolItem, toolPart: ChatToolInvocationPart): void {
		let isItemAlive = true;
		item.disposables.add(toDisposable(() => isItemAlive = false));

		const externalPartDisposeWatcher = new MutableDisposable();
		externalPartDisposeWatcher.value = toDisposable(() => {
			if (!isItemAlive || item.toolPart !== toolPart) {
				return;
			}

			item.toolPart = undefined;
			item.ownsToolPart = true;
			if (this.items[this.activeIndex] === item) {
				this.renderActiveContent();
			}
		});
		toolPart.addDisposable(externalPartDisposeWatcher);
		item.disposables.add(toDisposable(() => externalPartDisposeWatcher.clear()));
	}

	override dispose(): void {
		for (const item of this.items) {
			item.disposables.dispose();
		}
		this.items.splice(0);
		this.toolCallIds.clear();
		super.dispose();
	}

	private removeItem(toolCallId: string): void {
		const index = this.items.findIndex(i => i.toolCallId === toolCallId);
		if (index < 0) {
			return;
		}

		const activeItem = this.items[this.activeIndex];
		const restoreFocus = index === this.activeIndex && dom.isAncestorOfActiveElement(this.contentContainer);
		const [removed] = this.items.splice(index, 1);
		this.toolCallIds.delete(toolCallId);
		removed.disposables.dispose();

		if (this.items.length === 0) {
			this.activeContentDisposables.clear();
			dom.clearNode(this.contentContainer);
			dom.hide(this.domNode);
			this._onDidChangeActiveSubagent.fire(undefined);
			this._onDidEmpty.fire(restoreFocus);
			return;
		}

		this.activeIndex = activeItem && this.items.includes(activeItem)
			? this.items.indexOf(activeItem)
			: Math.min(this.activeIndex, this.items.length - 1);

		this.updateUI();
		if (activeItem !== this.items[this.activeIndex]) {
			this.renderActiveContent();
		}
		if (restoreFocus) {
			this.focusActiveContent();
		}
		this._onDidChangeActiveSubagent.fire(this.activeSubAgentInvocationId);
	}

	private setActiveIndex(index: number): void {
		this.activeIndex = index;
		this.updateUI();
		this.renderActiveContent();
		this._onDidChangeActiveSubagent.fire(this.activeSubAgentInvocationId);
	}

	private navigateRelative(delta: number): void {
		if (this.items.length <= 1) {
			return;
		}
		const newIndex = (this.activeIndex + delta + this.items.length) % this.items.length;
		this.setActiveIndex(newIndex);
	}

	private onKeydown(e: KeyboardEvent): void {
		if (this.items.length === 0) {
			return;
		}

		if (this.shouldIgnoreNavigationKeydown(e.target)) {
			return;
		}

		const event = new StandardKeyboardEvent(e);
		const focusContentAfterNavigation = dom.isHTMLElement(e.target) && this.contentContainer.contains(e.target);
		let didNavigate = false;

		switch (event.keyCode) {
			case KeyCode.LeftArrow:
				this.navigateRelative(-1);
				didNavigate = true;
				break;
			case KeyCode.RightArrow:
				this.navigateRelative(1);
				didNavigate = true;
				break;
			case KeyCode.Home:
				this.setActiveIndex(0);
				didNavigate = true;
				break;
			case KeyCode.End:
				this.setActiveIndex(this.items.length - 1);
				didNavigate = true;
				break;
		}

		if (!didNavigate) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		if (focusContentAfterNavigation) {
			this.focusActiveContent();
		}
	}

	private shouldIgnoreNavigationKeydown(target: EventTarget | null): boolean {
		if (!dom.isHTMLElement(target)) {
			return false;
		}

		return !!target.closest('.monaco-editor, .interactive-result-editor, .chat-confirmation-widget-message, input, textarea, select, [contenteditable="true"]');
	}

	private focusActiveContent(): void {
		this._carouselRoot.focus();
	}

	private updateUI(): void {
		const item = this.items[this.activeIndex];

		this.collapsedTitle.textContent = this.getToolTitle(item) ?? '';
		dom.setVisibility(!!this.collapsedTitle.textContent, this.collapsedTitle);

		this.sourceHover.clear();
		this.sourceLabel.textContent = item?.request ? `\u2014 ${item.request.sourceLabel}` : '';
		dom.setVisibility(!!item?.request, this.sourceLabel);
		if (item?.request) {
			this.sourceHover.value = this.hoverService?.setupDelayedHover(this.sourceLabel, { content: item.request.sourceLabel });
		}
		if (item?.subagentTitle) {
			this.agentLabel.textContent = `\u2014 ${item.subagentTitle}`;
			this.agentLabel.disabled = !item.subAgentInvocationId || !item.revealSubagent;
			this.agentLabel.title = item.revealSubagentLabel ?? localize('scrollToSubagent', "Scroll to {0}", item.subagentTitle);
			this.agentLabel.setAttribute('aria-label', this.agentLabel.title);
			dom.show(this.agentLabel);
		} else {
			this.agentLabel.textContent = '';
			this.agentLabel.title = '';
			this.agentLabel.removeAttribute('aria-label');
			dom.hide(this.agentLabel);
		}

		this.stepIndicator.textContent = `${this.activeIndex + 1}/${this.items.length}`;

		const multi = this.items.length > 1;
		this.prevButton.enabled = multi;
		this.nextButton.enabled = multi;
		dom.setVisibility(multi, this.stepIndicator);
		dom.setVisibility(multi, this.prevButton.element);
		dom.setVisibility(multi, this.nextButton.element);
		const hasProjectedRequests = this.items.some(item => item.request);
		dom.setVisibility(multi && !hasProjectedRequests, this.allowAllButton.element);
		dom.setVisibility(!hasProjectedRequests, this.dismissButton.element);
		dom.setVisibility(this.canExpandContent, this.expandContentButton.element);

		this.allowAllButton.label = multi
			? localize('allowAll', "Allow All")
			: localize('allow', "Allow");
	}

	private renderActiveContent(): void {
		dom.clearNode(this.contentContainer);
		this.activeContentDisposables.clear();

		const item = this.items[this.activeIndex];
		if (!item) {
			return;
		}

		if (!item.toolPart) {
			item.toolPart = item.toolPartFactory(item.tool);
			if (item.ownsToolPart) {
				item.disposables.add(item.toolPart);
			}
		}

		this.contentContainer.appendChild(item.toolPart.domNode);
		this.activeContentDisposables.add(this.contentResizeObserver.observe(item.toolPart.domNode));
		this.observeExpandableContentElements(item.toolPart.domNode);
		this.updateContentExpansionStateScheduler.schedule();
	}

	private toggleContentExpanded(): void {
		if (!this.canExpandContent) {
			return;
		}

		this._isContentExpanded = !this._isContentExpanded;
		this.updateContentExpansionState();
	}

	private updateContentExpansionState(): void {
		this.canExpandContent = this.items.length > 0 && this.isActiveContentLargerThanCollapsedLimit();
		if (!this.canExpandContent) {
			this._isContentExpanded = false;
		}

		this._carouselRoot.classList.toggle('chat-tool-carousel-content-expanded', this.canExpandContent && this._isContentExpanded);
		this.updateMaxHeightStyle();
		dom.setVisibility(this.canExpandContent, this.expandContentButton.element);
		this.updateExpandContentButton();
	}

	private updateMaxHeightStyle(): void {
		if (this.maxHeight === undefined) {
			this._carouselRoot.style.removeProperty('max-height');
			return;
		}

		const maxHeight = this.getCollapsedMaxHeight();
		this.domNode.style.maxHeight = `${Math.floor(maxHeight)}px`;
	}

	private getCollapsedMaxHeight(): number {
		const configuredMaxHeight = this.maxHeight === undefined ? Number.POSITIVE_INFINITY : Math.max(MIN_CAROUSEL_MAX_HEIGHT, this.maxHeight);
		return Math.min(configuredMaxHeight, COLLAPSED_CAROUSEL_MAX_HEIGHT, dom.getWindow(this._carouselRoot).innerHeight * 0.45);
	}

	allowAll(): void {
		for (const item of [...this.items]) {
			if (!item.request) {
				IChatToolInvocation.confirmWith(item.tool, { type: ToolConfirmKind.UserAction });
			}
		}
	}

	private skipAll(): void {
		for (const item of [...this.items]) {
			IChatToolInvocation.confirmWith(item.tool, { type: ToolConfirmKind.Skipped, isUserAction: true });
		}
	}

	private getToolTitle(item: ICarouselToolItem | undefined): string | undefined {
		if (!item) {
			return undefined;
		}
		if (item.request) {
			return item.request.title;
		}
		const messages = item.tool && IChatToolInvocation.getConfirmationMessages(item.tool);
		if (!messages?.title) {
			return undefined;
		}
		const full = this.toPlainText(messages.title).replace(/\s+/g, ' ').trim();
		return { display: this.truncateTitle(full), full };
	}

	private truncateTitle(text: string): string {
		const maxLength = 100;
		return text.length > maxLength ? `${text.substring(0, maxLength)}\u2026` : text;
	}

	private toPlainText(message: string | IMarkdownString): string {
		const markdown = typeof message === 'string' ? message : message.value;
		return markdown
			.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text, url) => text || this.basename(url))
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/__([^_]+)__/g, '$1')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/[\\*_#>]/g, '');
	}

	private basename(url: string): string {
		try {
			const path = decodeURIComponent(url.split('?')[0].split('#')[0]);
			const segments = path.split('/').filter(Boolean);
			return segments.at(-1) ?? url;
		} catch {
			return url;
		}
	}

	private revealActiveSubagent(): void {
		const item = this.items[this.activeIndex];
		if (item?.subAgentInvocationId) {
			item.revealSubagent?.(item.subAgentInvocationId);
		}
	}

	activateFirstToolForSubagent(subAgentInvocationId: string): void {
		const index = this.items.findIndex(i => i.subAgentInvocationId === subAgentInvocationId);
		if (index >= 0) {
			this.setActiveIndex(index);
		}
	}

	/**
	 * Swap the carousel between its inline desktop mount and the phone
	 * tap-to-review placeholder. The carousel root always remains alive
	 * — when in phone mode, it parks under {@link _hiddenHost} so its
	 * observers and tool subscriptions keep running until the user
	 * either taps the placeholder (mount into the bottom sheet) or the
	 * viewport flips back to desktop (re-mount inline).
	 */
	private _applyMount(isPhone: boolean): void {
		// On every flip, close any open phone sheet so we don't leave
		// the carousel parented to a stale sheet body across a
		// breakpoint change.
		this._openSheet.clear();

		if (isPhone) {
			if (this._carouselRoot.parentElement !== this._hiddenHost) {
				this._hiddenHost.appendChild(this._carouselRoot);
			}
			if (this._phonePlaceholder.parentElement !== this.domNode) {
				this.domNode.appendChild(this._phonePlaceholder);
			}
		} else {
			if (this._phonePlaceholder.parentElement === this.domNode) {
				this.domNode.removeChild(this._phonePlaceholder);
			}
			// Re-attach the carousel root as the visible child. Order
			// relative to `_hiddenHost` doesn't matter since the host
			// is zero-size + visibility-hidden, but keep the carousel
			// last so it paints in the usual position.
			this.domNode.appendChild(this._carouselRoot);
		}
	}

	private _openPhoneSheet(): void {
		if (!this._phonePresenter.enabled.get() || this.items.length === 0) {
			return;
		}
		const item = this.items[this.activeIndex];
		const title = this.getToolTitle(item) ?? localize('chatToolConfirmationCarousel.sheetTitle', "Tool Confirmation");
		// `MutableDisposable.value = ...` disposes the previous handle,
		// so re-tapping after an auto-dismissed sheet (Done / backdrop /
		// Escape) collapses to "dispose stale + open fresh" in one step.
		this._openSheet.value = this._phonePresenter.showCarousel(this._carouselRoot, title);
	}
}
