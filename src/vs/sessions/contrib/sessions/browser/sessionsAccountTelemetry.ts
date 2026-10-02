/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { ChatEntitlement, getQuotaUsage, IChatEntitlementService, IQuotaSnapshot, QuotaUsageKind } from '../../../../workbench/services/chat/common/chatEntitlementService.js';

const STARTUP_ACCOUNT_TIMEOUT_MS = 30_000;

interface ISessionsAccountTelemetryData {
	readonly copilotSku: string;
	readonly copilotAccountState: 'signedIn' | 'signedOut' | 'unknown';
	readonly copilotQuotaPercentRemaining: number | undefined;
}

type SessionsAccountStateClassification = {
	owner: 'benibenj';
	comment: 'Reports account and quota context once per Agents window after startup data resolves, waiting at most 30 seconds before reporting available fields.';
	copilotSku: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Copilot entitlement SKU at startup, including anonymous access, or signedOut or unknown when no SKU is available.' };
	copilotAccountState: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Copilot account state at startup: signedIn, signedOut, or unknown while resolving entitlement.' };
	copilotQuotaPercentRemaining: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Remaining percentage (0-100) of the monthly premium chat quota, falling back to the monthly chat quota if absent. Omitted for unresolved, unlimited, invalid, or expired quotas.' };
};

type SessionsAccountStateChangedEvent = ISessionsAccountTelemetryData & {
	changeReason: 'accountChanged' | 'quotaResolved';
	previousCopilotSku: string;
	previousCopilotAccountState: ISessionsAccountTelemetryData['copilotAccountState'];
};

type SessionsAccountStateChangedClassification = {
	owner: 'benibenj';
	comment: 'Reports Agents window sign-in, sign-out, and Copilot SKU changes, and quotas first becoming available after startup or an account change. Routine quota consumption does not emit an event.';
	copilotSku: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Current Copilot entitlement SKU, including anonymous access, or signedOut or unknown when no SKU is available.' };
	copilotAccountState: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Copilot account state: signedIn, signedOut, or unknown while resolving entitlement.' };
	copilotQuotaPercentRemaining: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Remaining percentage (0-100) of the monthly premium chat quota, falling back to the monthly chat quota if absent. Omitted for unresolved, unlimited, invalid, or expired quotas.' };
	changeReason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether an account state or Copilot SKU changed, or a previously unavailable quota resolved.' };
	previousCopilotSku: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Copilot entitlement SKU before the change, or signedOut or unknown.' };
	previousCopilotAccountState: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Copilot account state before the change.' };
};

/** Reports startup account context and later changes without fetching account or quota data. */
export class SessionsAccountTelemetryContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sessionsAccountTelemetry';

	private lastSnapshot: ISessionsAccountTelemetryData | undefined;
	private initialDefaultAccountResolved = false;
	private readonly startupDeadline = this._register(new RunOnceScheduler(() => this.onAccountChanged(true), STARTUP_ACCOUNT_TIMEOUT_MS));

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@ILogService private readonly logService: ILogService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
	) {
		super();

		// Entitlement changes precede the corresponding synchronous quota update.
		const update = this._register(new RunOnceScheduler(() => this.onAccountChanged(), 0));
		this._register(chatEntitlementService.onDidChangeEntitlement(() => update.schedule()));
		this._register(chatEntitlementService.onDidChangeAnonymous(() => update.schedule()));
		this._register(chatEntitlementService.onDidChangeQuotaRemaining(() => update.schedule()));
		this._register(defaultAccountService.onDidChangeDefaultAccount(() => update.schedule()));
		this.startupDeadline.schedule();
		void this.waitForInitialAccount(update).catch(error => this.logService.error('[SessionsAccountTelemetry] Failed to resolve the initial account.', error));
	}

	private async waitForInitialAccount(update: RunOnceScheduler): Promise<void> {
		await this.defaultAccountService.getDefaultAccount();
		if (!this._store.isDisposed) {
			this.initialDefaultAccountResolved = true;
			update.schedule();
		}
	}

	private get copilotEntitlement(): ChatEntitlement {
		const entitlement = this.chatEntitlementService.entitlement;
		if (!this.initialDefaultAccountResolved
			|| (entitlement === ChatEntitlement.Unknown && this.defaultAccountService.currentDefaultAccount !== null)) {
			return ChatEntitlement.Unresolved;
		}
		return entitlement;
	}

	private hasStartupData(): boolean {
		const entitlement = this.copilotEntitlement;
		if (entitlement === ChatEntitlement.Unresolved) {
			return false;
		}
		const { sku, quotas } = this.chatEntitlementService;
		if (entitlement !== ChatEntitlement.Unknown && entitlement !== ChatEntitlement.Available && entitlement !== ChatEntitlement.Unavailable
			&& (sku === undefined || (quotas.premiumChat === undefined && quotas.chat === undefined))) {
			return false;
		}
		return true;
	}

	private get snapshot(): ISessionsAccountTelemetryData {
		const entitlement = this.copilotEntitlement;
		const copilotAccountState = entitlement === ChatEntitlement.Unknown ? 'signedOut'
			: entitlement === ChatEntitlement.Unresolved ? 'unknown' : 'signedIn';
		const now = Date.now();
		return {
			copilotSku: entitlement === ChatEntitlement.Unresolved ? 'unknown' : getSessionsTelemetryCopilotSku(this.chatEntitlementService),
			copilotAccountState,
			copilotQuotaPercentRemaining: copilotAccountState === 'signedIn'
				? getCopilotQuotaPercentRemaining(this.chatEntitlementService.quotas.premiumChat ?? this.chatEntitlementService.quotas.chat, now, this.logService)
				: undefined,
		};
	}

	private onAccountChanged(startupTimedOut = false): void {
		const previous = this.lastSnapshot;
		if (!previous && !startupTimedOut && !this.hasStartupData()) {
			return;
		}
		const current = this.snapshot;
		this.lastSnapshot = current;
		if (!previous) {
			this.startupDeadline.cancel();
			this.telemetryService.publicLog2<ISessionsAccountTelemetryData, SessionsAccountStateClassification>('agents/accountState', current);
			return;
		}

		const accountChanged = previous.copilotSku !== current.copilotSku
			|| previous.copilotAccountState !== current.copilotAccountState;
		const quotaResolved = previous.copilotQuotaPercentRemaining === undefined && current.copilotQuotaPercentRemaining !== undefined;
		if (!accountChanged && !quotaResolved) {
			return;
		}

		this.telemetryService.publicLog2<SessionsAccountStateChangedEvent, SessionsAccountStateChangedClassification>('agents/accountStateChanged', {
			...current,
			changeReason: accountChanged ? 'accountChanged' : 'quotaResolved',
			previousCopilotSku: previous.copilotSku,
			previousCopilotAccountState: previous.copilotAccountState,
		});
	}
}

export function getSessionsTelemetryCopilotSku(chatEntitlementService: IChatEntitlementService): string {
	if (chatEntitlementService.entitlement === ChatEntitlement.Unknown && !chatEntitlementService.anonymous) {
		return 'signedOut';
	}
	if (chatEntitlementService.entitlement === ChatEntitlement.Unresolved) {
		return 'unknown';
	}
	return chatEntitlementService.sku ?? 'unknown';
}

function getCopilotQuotaPercentRemaining(quota: IQuotaSnapshot | undefined, now: number, logService: ILogService): number | undefined {
	if (!quota || getQuotaUsage(quota)?.kind !== QuotaUsageKind.Percentage || !hasNotReset(quota.resetAt, now, logService)) {
		return undefined;
	}
	return validPercentage(quota.percentRemaining, logService);
}

function validPercentage(value: number, logService: ILogService): number | undefined {
	if (!Number.isFinite(value) || value < 0 || value > 100) {
		logService.warn('[SessionsAccountTelemetry] Ignoring an invalid quota percentage.');
		return undefined;
	}
	return value;
}

function hasNotReset(resetsAt: number | undefined, now: number, logService: ILogService): boolean {
	if (resetsAt === undefined) {
		return true;
	}
	if (!Number.isFinite(resetsAt) || resetsAt <= 0) {
		logService.warn('[SessionsAccountTelemetry] Ignoring a quota with an invalid reset time.');
		return false;
	}
	return resetsAt * 1000 > now;
}
