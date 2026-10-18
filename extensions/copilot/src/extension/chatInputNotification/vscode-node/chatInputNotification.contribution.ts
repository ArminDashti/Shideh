/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IChatQuota, IChatQuotaService } from '../../../platform/chat/common/chatQuotaService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

const QUOTA_NOTIFICATION_ID = 'copilot.quotaStatus';
const THRESHOLDS = [50, 75, 90, 95];

interface IRateLimitWarning {
	percentUsed: number;
	type: 'session' | 'weekly';
	resetDate: Date;
}

interface IQuotaWarning {
	percentUsed: number;
	resetDate: Date;
}

/**
 * Manages a single chat input notification for quota and rate limit status.
 *
 * Listens to {@link IChatQuotaService.onDidChange} and determines whether a
 * new threshold has been crossed, then shows the highest-priority notification:
 *
 * 1. **Quota exhausted** — info, not auto-dismissed, only dismissible via X.
 * 2. **Additional spend active** — info, auto-dismissed, shown once per transition.
 * 3. **Quota approaching** — info, auto-dismissed on next message.
 * 4. **Rate-limit warning** — info, auto-dismissed on next message.
 */
export class ChatInputNotificationContribution extends Disposable {

	private _notification: vscode.ChatInputNotification | undefined;
	/** Tracks whether the current notification is the quota-exhausted variant. */
	private _showingExhausted = false;
	/** Tracks whether we already showed the additional-spend-active notification. */
	private _shownAdditionalSpendNotice = false;

	/** Previous percentUsed values — `undefined` means no prior state (initial load). */
	private _prevQuotaPercent: number | undefined;
	private _prevSessionPercent: number | undefined;
	private _prevWeeklyPercent: number | undefined;

	constructor(
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IChatQuotaService private readonly _chatQuotaService: IChatQuotaService,
	) {
		super();
		this._lastSku = this._authService.copilotToken?.sku;
		this._register(this._authService.onDidAuthenticationChange(() => this._onAuthChanged()));
		this._register(this._chatQuotaService.onDidChange(() => this._update()));
	}

	/**
	 * Handles auth changes. When the identity changes (e.g. sign-out from
	 * free → anonymous), hide any stale notification and reset shown
	 * thresholds so the new identity starts fresh.
	 */
	private _onAuthChanged(): void {
		const currentSku = this._authService.copilotToken?.sku;
		if (currentSku !== this._lastSku) {
			this._lastSku = currentSku;
			this._shownQuotaThresholds.clear();
			this._shownSessionThresholds.clear();
			this._shownWeeklyThresholds.clear();
			this._suppressExhaustedUntilTransition = true;
			this._hideNotification();
			return;
		}
		this._update();
	}

	/**
	 * Single entry point that determines the highest-priority notification
	 * to show (or whether to hide).
	 */
	private _update(): void {
		// Priority 1: Quota exhausted — sticky info notification
		if (this._chatQuotaService.quotaExhausted) {
			if (this._suppressExhaustedUntilTransition) {
				// After an identity change, suppress the exhausted notification
				// until the quota transitions from non-exhausted to exhausted
				// during this identity's session. This prevents the stale
				// exhausted state from immediately re-showing after sign-out.
				return;
			}
			const isAnonymous = this._authService.copilotToken?.isNoAuthUser;
			const isFree = this._authService.copilotToken?.isFreeUser;
			if (isAnonymous || isFree) {
				this._showExhaustedNotification(!!isAnonymous);
				return;
			}
		} else {
			// Quota is no longer exhausted — clear the suppression flag so
			// that a future transition to exhausted will show the notification.
			this._suppressExhaustedUntilTransition = false;
		}

		// Priority 2: Additional spend active — included quota exhausted but
		// additional usage is enabled, so the user has silently transitioned.
		// Show once per transition; reset when included quota is restored.
		const info = this._chatQuotaService.quotaInfo;
		if (info && !info.unlimited && info.percentRemaining <= 0 && info.additionalUsageEnabled) {
			if (!this._shownAdditionalSpendNotice) {
				this._shownAdditionalSpendNotice = true;
				this._showAdditionalSpendNotification();
				return;
			}
		} else {
			// Included quota restored — allow re-showing on next transition
			this._shownAdditionalSpendNotice = false;
		}

		// Priority 3: Quota approaching threshold
		const quotaWarning = this._computeQuotaWarning();
		if (quotaWarning) {
			this._showQuotaApproachingWarning(quotaWarning);
			return;
		}

		// Priority 4: Rate-limit warning (session > weekly)
		const rateLimitWarning = this._computeRateLimitWarning();
		if (rateLimitWarning) {
			this._showRateLimitWarning(rateLimitWarning);
			return;
		}

		// Nothing new to show — only hide if the exhausted notification is
		// active and the quota is no longer exhausted (state-driven).
		if (this._showingExhausted && !this._chatQuotaService.quotaExhausted) {
			this._hideNotification();
		}
	}

	// --- Threshold computation -----------------------------------------------

	private _computeQuotaWarning(): IQuotaWarning | undefined {
		const info = this._chatQuotaService.quotaInfo;
		if (!info || info.unlimited || info.additionalUsageEnabled) {
			return undefined;
		}
		const result = this._checkThresholdCrossing(info, this._prevQuotaPercent);
		this._prevQuotaPercent = result.percentUsed;
		return result.warning;
	}

	private _computeRateLimitWarning(): IRateLimitWarning | undefined {
		const { session, weekly } = this._chatQuotaService.rateLimitInfo;

		const sessionResult = this._checkThresholdCrossing(session, this._prevSessionPercent);
		this._prevSessionPercent = sessionResult.percentUsed;
		if (sessionResult.warning) {
			return { ...sessionResult.warning, type: 'session' };
		}

		const weeklyResult = this._checkThresholdCrossing(weekly, this._prevWeeklyPercent);
		this._prevWeeklyPercent = weeklyResult.percentUsed;
		if (weeklyResult.warning) {
			return { ...weeklyResult.warning, type: 'weekly' };
		}

		return undefined;
	}

	/**
	 * Checks whether usage has crossed a new threshold compared to the
	 * previous percentage. Returns `undefined` when there is no previous
	 * state (initial load) or no new threshold was crossed.
	 */
	private _checkThresholdCrossing(
		info: IChatQuota | undefined,
		prevPercent: number | undefined,
	): { percentUsed: number | undefined; warning: { percentUsed: number; resetDate: Date } | undefined } {
		if (!info || info.unlimited) {
			return { percentUsed: undefined, warning: undefined };
		}

		const percentUsed = Math.min(100, 100 - info.percentRemaining);

		// No previous state — record current value but don't warn.
		if (prevPercent === undefined) {
			return { percentUsed, warning: undefined };
		}

		// Find the highest threshold that was just crossed
		// (previous was below it, current is at or above it).
		for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
			const threshold = THRESHOLDS[i];
			if (percentUsed >= threshold && prevPercent < threshold) {
				return { percentUsed, warning: { percentUsed: Math.floor(percentUsed), resetDate: info.resetDate } };
			}
		}

		return { percentUsed, warning: undefined };
	}

	// --- Quota exhausted ---------------------------------------------------

	private _showExhaustedNotification(isAnonymous: boolean): void {
		const notification = this._ensureNotification();
		this._showingExhausted = true;

		notification.severity = vscode.ChatInputNotificationSeverity.Info;
		notification.dismissible = true;
		notification.autoDismissOnMessage = false;

		if (isAnonymous) {
			notification.message = vscode.l10n.t('Monthly Limit Reached');
			notification.description = vscode.l10n.t("You've made the most of Copilot. Sign in to keep going.");
			notification.actions = [
				{ label: vscode.l10n.t('View Usage'), commandId: 'workbench.action.chat.upgradePlan' },
				{ label: vscode.l10n.t('Sign In'), commandId: 'workbench.action.chat.triggerSetup' },
			];
		} else {
			notification.message = vscode.l10n.t('Monthly Limit Reached');
			notification.description = vscode.l10n.t("You're getting the most out of Copilot.");
			notification.actions = [
				{ label: vscode.l10n.t('View Usage'), commandId: 'workbench.action.chat.upgradePlan' },
				{ label: vscode.l10n.t('Upgrade'), commandId: 'workbench.action.chat.upgradePlan' },
			];
		}

		notification.show();
	}

	// --- Additional spend active --------------------------------------------

	private _showAdditionalSpendNotification(): void {
		const notification = this._ensureNotification();
		this._showingExhausted = false;

		notification.severity = vscode.ChatInputNotificationSeverity.Info;
		notification.dismissible = true;
		notification.autoDismissOnMessage = true;
		notification.message = vscode.l10n.t('Using Additional Budget');
		notification.description = vscode.l10n.t('Your additional budget is now being used to power Copilot.');
		notification.actions = [
			{ label: vscode.l10n.t('View Usage'), commandId: 'workbench.action.chat.openCopilotStatus' },
			{ label: vscode.l10n.t('Manage Budget'), commandId: 'workbench.action.chat.manageAdditionalSpend' },
		];

		notification.show();
	}

	// --- Quota approaching --------------------------------------------------

	private _showQuotaApproachingWarning(warning: IQuotaWarning): void {
		const notification = this._ensureNotification();
		this._showingExhausted = false;

		notification.severity = vscode.ChatInputNotificationSeverity.Info;
		notification.dismissible = true;
		notification.autoDismissOnMessage = true;
		notification.message = vscode.l10n.t('Monthly Limit at {0}%', warning.percentUsed);
		notification.description = vscode.l10n.t("You're getting the most out of Copilot.");
		notification.actions = [
			{ label: vscode.l10n.t('View Usage'), commandId: 'workbench.action.chat.upgradePlan' },
			{ label: vscode.l10n.t('Upgrade'), commandId: 'workbench.action.chat.upgradePlan' },
		];

		notification.show();
	}

	// --- Rate limit warning -------------------------------------------------

	private _showRateLimitWarning(warning: IRateLimitWarning): void {
		const notification = this._ensureNotification();
		this._showingExhausted = false;

		const dateStr = this._formatResetDate(warning.resetDate);
		notification.severity = vscode.ChatInputNotificationSeverity.Info;
		notification.dismissible = true;
		notification.autoDismissOnMessage = true;

		notification.message = warning.type === 'session'
			? vscode.l10n.t("You've used {0}% of your session rate limit.", warning.percentUsed)
			: vscode.l10n.t("You've used {0}% of your weekly rate limit.", warning.percentUsed);
		notification.description = vscode.l10n.t('Resets on {0}.', dateStr);
		notification.actions = [];

		notification.show();
	}

	// --- Helpers ------------------------------------------------------------

	private _formatResetDate(resetDate: Date): string {
		const now = new Date();
		const includeYear = resetDate.getFullYear() !== now.getFullYear();
		return new Intl.DateTimeFormat(undefined, includeYear
			? { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
			: { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
		).format(resetDate);
	}

	private _ensureNotification(): vscode.ChatInputNotification {
		if (!this._notification) {
			this._notification = vscode.chat.createInputNotification(QUOTA_NOTIFICATION_ID);
			this._register({ dispose: () => this._notification?.dispose() });
		}
		return this._notification;
	}

	private _hideNotification(): void {
		if (this._notification) {
			this._notification.hide();
			this._showingExhausted = false;
		}
	}
}
