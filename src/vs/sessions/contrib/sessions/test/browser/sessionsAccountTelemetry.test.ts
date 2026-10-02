/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import product from '../../../../../platform/product/common/product.js';
import { ITelemetryData, ITelemetryService, TelemetryLevel } from '../../../../../platform/telemetry/common/telemetry.js';
import { TelemetryService } from '../../../../../platform/telemetry/common/telemetryService.js';
import { NullTelemetryServiceShape } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../../../workbench/services/chat/common/chatEntitlementService.js';
import { SessionsAccountTelemetryContribution } from '../../browser/sessionsAccountTelemetry.js';

suite('SessionsAccountTelemetryContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const signedOutSnapshot = {
		copilotSku: 'signedOut',
		copilotAccountState: 'signedOut',
		copilotQuotaPercentRemaining: undefined,
	};

	function createHarness(initial: {
		entitlement?: ChatEntitlement;
		sku?: string;
		anonymous?: boolean;
		quotas?: IChatEntitlementService['quotas'];
		defaultAccount?: IDefaultAccountService['currentDefaultAccount'];
		defaultAccountReady?: Promise<void>;
		telemetryService?: ITelemetryService;
	} = {}) {
		const entitlementChanged = disposables.add(new Emitter<void>());
		const anonymousChanged = disposables.add(new Emitter<void>());
		const quotaChanged = disposables.add(new Emitter<void>());
		const defaultAccountChanged = disposables.add(new Emitter<IDefaultAccountService['currentDefaultAccount']>());
		const chatEntitlementService = new class extends mock<IChatEntitlementService>() {
			override entitlement = initial.entitlement ?? ChatEntitlement.Unknown;
			override sku = initial.sku;
			override anonymous = initial.anonymous ?? false;
			override quotas: IChatEntitlementService['quotas'] = initial.quotas ?? {};
			override onDidChangeEntitlement = entitlementChanged.event;
			override onDidChangeAnonymous = anonymousChanged.event;
			override onDidChangeQuotaRemaining = quotaChanged.event;
		};
		const defaultAccountService = new class extends mock<IDefaultAccountService>() {
			override currentDefaultAccount = initial.defaultAccount ?? null;
			override onDidChangeDefaultAccount = defaultAccountChanged.event;
			override async getDefaultAccount() {
				await initial.defaultAccountReady;
				return this.currentDefaultAccount;
			}
		};
		const events: { name: string; data?: ITelemetryData }[] = [];
		const telemetryService = initial.telemetryService ?? new class extends NullTelemetryServiceShape {
			override publicLog2(name?: string, data?: ITelemetryData): void {
				if (name) {
					events.push({ name, data });
				}
			}
		};
		const tracker = disposables.add(new SessionsAccountTelemetryContribution(telemetryService, chatEntitlementService, new NullLogService(), defaultAccountService));
		return { tracker, chatEntitlementService, defaultAccountService, entitlementChanged, anonymousChanged, quotaChanged, defaultAccountChanged, events };
	}

	test('emits one standalone startup event with the remaining-percentage metric', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({
				entitlement: ChatEntitlement.Pro,
				sku: 'copilot_for_individual_user',
				quotas: {
					premiumChat: { percentRemaining: 75, unlimited: false },
					chat: { percentRemaining: 95, unlimited: false },
					sessionRateLimit: { percentRemaining: 10, unlimited: false },
					weeklyRateLimit: { percentRemaining: 20, unlimited: false },
				},
			});
			await timeout(1);
			harness.entitlementChanged.fire();
			harness.quotaChanged.fire();
			await timeout(30_000);

			assert.deepStrictEqual(harness.events, [{
				name: 'agents/accountState',
				data: {
					copilotSku: 'copilot_for_individual_user',
					copilotAccountState: 'signedIn',
					copilotQuotaPercentRemaining: 75,
				},
			}]);
		});
	});

	test('waits for entitlement and quota data instead of emitting initial-resolution changes', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({ entitlement: ChatEntitlement.Unresolved });
			await timeout(0);
			const eventCounts = [harness.events.length];
			harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user';
			harness.entitlementChanged.fire();
			await timeout(0);
			eventCounts.push(harness.events.length);
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 75, unlimited: false } };
			harness.quotaChanged.fire();
			await timeout(0);
			eventCounts.push(harness.events.length);

			assert.deepStrictEqual({ eventCounts, events: harness.events }, {
				eventCounts: [0, 0, 1],
				events: [{
					name: 'agents/accountState',
					data: { copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 75 },
				}],
			});
		});
	});

	test('waits for default-account initialization before trusting cached signed-out state', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const accountReady = new DeferredPromise<void>();
			const harness = createHarness({
				defaultAccountReady: accountReady.p,
				defaultAccount: upcastPartial<NonNullable<IDefaultAccountService['currentDefaultAccount']>>({}),
			});
			await timeout(0);
			const eventCounts = [harness.events.length];
			await accountReady.complete();
			await timeout(0);
			eventCounts.push(harness.events.length);
			harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user';
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 80, unlimited: false } };
			harness.entitlementChanged.fire();
			await timeout(0);

			assert.deepStrictEqual({ eventCounts, events: harness.events }, {
				eventCounts: [0, 0],
				events: [{
					name: 'agents/accountState',
					data: { ...signedOutSnapshot, copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 80 },
				}],
			});
		});
	});

	test('uses the monthly chat quota when no premium quota exists', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const { events } = createHarness({
				entitlement: ChatEntitlement.Free,
				sku: 'free_limited_copilot',
				quotas: { chat: { percentRemaining: 45, unlimited: false } },
			});
			await timeout(1);

			assert.deepStrictEqual(events, [{
				name: 'agents/accountState',
				data: { copilotSku: 'free_limited_copilot', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 45 },
			}]);
		});
	});

	test('preserves zero, full, and fractional percentages with the same direction', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harnesses = [0, 100, 12.5].map(remaining => createHarness({
				entitlement: ChatEntitlement.Pro,
				sku: 'copilot_for_individual_user',
				quotas: { premiumChat: { percentRemaining: remaining, unlimited: false } },
			}));
			await timeout(1);

			assert.deepStrictEqual(harnesses.map(({ events }) => [events[0].data?.copilotQuotaPercentRemaining]), [
				[0], [100], [12.5],
			]);
		});
	});

	test('emits available fields at exactly the 30-second deadline and later reports quota resolution', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({ entitlement: ChatEntitlement.Pro, sku: 'copilot_for_individual_user' });
			await timeout(29_999);
			const beforeDeadline = [...harness.events];
			await timeout(1);
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 0, unlimited: false } };
			harness.quotaChanged.fire();
			await timeout(0);
			await timeout(30_000);

			assert.deepStrictEqual({ beforeDeadline, events: harness.events }, {
				beforeDeadline: [],
				events: [
					{
						name: 'agents/accountState',
						data: { copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: undefined },
					},
					{
						name: 'agents/accountStateChanged',
						data: {
							copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 0,
							changeReason: 'quotaResolved', previousCopilotSku: 'copilot_for_individual_user', previousCopilotAccountState: 'signedIn',
						},
					},
				],
			});
		});
	});

	test('keeps unresolved and signed-out states distinct', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harnesses = [ChatEntitlement.Unknown, ChatEntitlement.Unresolved].map(entitlement => createHarness({
				entitlement,
				sku: 'cached_sku',
				quotas: { premiumChat: { percentRemaining: 50, unlimited: false } },
			}));
			await timeout(30_000);

			assert.deepStrictEqual(harnesses.map(({ events }) => events), [
				[{ name: 'agents/accountState', data: signedOutSnapshot }],
				[{ name: 'agents/accountState', data: { ...signedOutSnapshot, copilotSku: 'unknown', copilotAccountState: 'unknown' } }],
			]);
		});
	});

	test('reports unknown rather than cached sign-out if account initialization times out', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const accountReady = new DeferredPromise<void>();
			const harness = createHarness({ defaultAccountReady: accountReady.p });
			await timeout(30_000);
			await accountReady.complete();
			await timeout(1);

			assert.deepStrictEqual(harness.events, [
				{
					name: 'agents/accountState',
					data: { ...signedOutSnapshot, copilotSku: 'unknown', copilotAccountState: 'unknown' },
				},
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot,
						changeReason: 'accountChanged', previousCopilotSku: 'unknown', previousCopilotAccountState: 'unknown',
					},
				},
			]);
		});
	});

	test('reports unknown at the deadline for a resolved signed-in account awaiting entitlement', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({
				defaultAccount: upcastPartial<NonNullable<IDefaultAccountService['currentDefaultAccount']>>({}),
				sku: 'cached_sku',
				quotas: { premiumChat: { percentRemaining: 50, unlimited: false } },
			});
			await timeout(29_999);
			const beforeDeadline = [...harness.events];
			await timeout(1);
			harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user';
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 75, unlimited: false } };
			harness.entitlementChanged.fire();
			await timeout(0);

			assert.deepStrictEqual({ beforeDeadline, events: harness.events }, {
				beforeDeadline: [],
				events: [
					{
						name: 'agents/accountState',
						data: { ...signedOutSnapshot, copilotSku: 'unknown', copilotAccountState: 'unknown' },
					},
					{
						name: 'agents/accountStateChanged',
						data: {
							...signedOutSnapshot, copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 75,
							changeReason: 'accountChanged', previousCopilotSku: 'unknown', previousCopilotAccountState: 'unknown',
						},
					},
				],
			});
		});
	});

	test('observes pending sign-in and sign-out while entitlement remains Unknown', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness();
			await timeout(1);
			harness.defaultAccountService.currentDefaultAccount = upcastPartial<NonNullable<IDefaultAccountService['currentDefaultAccount']>>({});
			harness.defaultAccountChanged.fire(harness.defaultAccountService.currentDefaultAccount);
			await timeout(0);
			harness.defaultAccountService.currentDefaultAccount = null;
			harness.defaultAccountChanged.fire(null);
			await timeout(0);

			assert.deepStrictEqual(harness.events, [
				{ name: 'agents/accountState', data: signedOutSnapshot },
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot, copilotSku: 'unknown', copilotAccountState: 'unknown',
						changeReason: 'accountChanged', previousCopilotSku: 'signedOut', previousCopilotAccountState: 'signedOut',
					},
				},
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot,
						changeReason: 'accountChanged', previousCopilotSku: 'unknown', previousCopilotAccountState: 'unknown',
					},
				},
			]);
		});
	});

	test('preserves the anonymous SKU at startup and on anonymous access changes', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({ anonymous: true, sku: 'no_auth_limited_copilot' });
			await timeout(1);
			harness.chatEntitlementService.anonymous = false;
			harness.anonymousChanged.fire();
			await timeout(0);
			harness.chatEntitlementService.anonymous = true;
			harness.anonymousChanged.fire();
			await timeout(0);

			assert.deepStrictEqual(harness.events, [
				{ name: 'agents/accountState', data: { ...signedOutSnapshot, copilotSku: 'no_auth_limited_copilot' } },
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot,
						changeReason: 'accountChanged', previousCopilotSku: 'no_auth_limited_copilot', previousCopilotAccountState: 'signedOut',
					},
				},
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot, copilotSku: 'no_auth_limited_copilot',
						changeReason: 'accountChanged', previousCopilotSku: 'signedOut', previousCopilotAccountState: 'signedOut',
					},
				},
			]);
		});
	});

	test('retains the anonymous SKU as the previous SKU after sign-in', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({ anonymous: true, sku: 'no_auth_limited_copilot' });
			await timeout(1);
			harness.chatEntitlementService.anonymous = false;
			harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user';
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 75, unlimited: false } };
			harness.entitlementChanged.fire();
			harness.anonymousChanged.fire();
			await timeout(0);

			assert.deepStrictEqual(harness.events, [
				{ name: 'agents/accountState', data: { ...signedOutSnapshot, copilotSku: 'no_auth_limited_copilot' } },
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot, copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 75,
						changeReason: 'accountChanged', previousCopilotSku: 'no_auth_limited_copilot', previousCopilotAccountState: 'signedOut',
					},
				},
			]);
		});
	});

	test('does not wait on known unlimited or empty quota responses', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const { events } = createHarness({
				entitlement: ChatEntitlement.Business,
				sku: 'copilot_for_business',
				quotas: { premiumChat: { percentRemaining: 100, unlimited: true, creditsUsed: 42 } },
			});
			await timeout(1);

			assert.deepStrictEqual(events, [{
				name: 'agents/accountState',
				data: { ...signedOutSnapshot, copilotSku: 'copilot_for_business', copilotAccountState: 'signedIn' },
			}]);
		});
	});

	test('omits missing, invalid, and expired quota percentages instead of reporting zero', async () => {
		await runWithFakedTimers({ useFakeTimers: true, startTime: 100_000 }, async () => {
			const harnesses = [
				createHarness({ entitlement: ChatEntitlement.Pro }),
				createHarness({}),
				createHarness({}),
				createHarness({
					entitlement: ChatEntitlement.Pro,
					quotas: { premiumChat: { percentRemaining: 50, unlimited: false, resetAt: 99 } },
				}),
				...[-1, 101, NaN, Infinity].map(value => createHarness({
					entitlement: ChatEntitlement.Pro,
					quotas: { premiumChat: { percentRemaining: value, unlimited: false } },
				})),
			];
			await timeout(30_000);

			assert.deepStrictEqual(harnesses.map(({ events }) => [events[0].data?.copilotQuotaPercentRemaining]), Array.from({ length: 8 }, () => [undefined]));
		});
	});

	test('reports later sign-in, SKU changes, and sign-out after the matching quota update', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness();
			await timeout(1);
			harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user';
			harness.entitlementChanged.fire();
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 75, unlimited: false } };
			harness.quotaChanged.fire();
			await timeout(0);
			harness.chatEntitlementService.entitlement = ChatEntitlement.ProPlus;
			harness.chatEntitlementService.sku = 'copilot_for_individual_user_pro';
			harness.entitlementChanged.fire();
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 90, unlimited: false } };
			harness.quotaChanged.fire();
			await timeout(0);
			harness.chatEntitlementService.entitlement = ChatEntitlement.Unknown;
			harness.entitlementChanged.fire();
			await timeout(0);

			assert.deepStrictEqual(harness.events, [
				{ name: 'agents/accountState', data: signedOutSnapshot },
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot, copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 75,
						changeReason: 'accountChanged', previousCopilotSku: 'signedOut', previousCopilotAccountState: 'signedOut',
					},
				},
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot, copilotSku: 'copilot_for_individual_user_pro', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 90,
						changeReason: 'accountChanged', previousCopilotSku: 'copilot_for_individual_user', previousCopilotAccountState: 'signedIn',
					},
				},
				{
					name: 'agents/accountStateChanged',
					data: {
						...signedOutSnapshot,
						changeReason: 'accountChanged', previousCopilotSku: 'copilot_for_individual_user_pro', previousCopilotAccountState: 'signedIn',
					},
				},
			]);
		});
	});

	test('ignores routine quota consumption and unrelated account updates after startup', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness({
				entitlement: ChatEntitlement.Pro,
				sku: 'copilot_for_individual_user',
				quotas: { premiumChat: { percentRemaining: 75, unlimited: false } },
			});
			await timeout(1);
			harness.chatEntitlementService.quotas = { premiumChat: { percentRemaining: 50, unlimited: false } };
			harness.quotaChanged.fire();
			harness.entitlementChanged.fire();
			await timeout(30_000);

			assert.deepStrictEqual(harness.events, [{
				name: 'agents/accountState',
				data: { copilotSku: 'copilot_for_individual_user', copilotAccountState: 'signedIn', copilotQuotaPercentRemaining: 75 },
			}]);
		});
	});

	test('startup and change events honor the existing usage telemetry consent', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const results = [TelemetryLevel.NONE, TelemetryLevel.CRASH, TelemetryLevel.ERROR, TelemetryLevel.USAGE].map(level => {
				const names: string[] = [];
				const telemetryService = disposables.add(TelemetryService.createWithLevel({
					telemetryLevel: level,
					appenders: [{ log: name => names.push(name), flush: async () => { } }],
				}, { ...product, _serviceBrand: undefined }));
				return { names, harness: createHarness({ telemetryService }) };
			});
			await timeout(1);
			for (const { harness } of results) {
				harness.chatEntitlementService.entitlement = ChatEntitlement.Pro;
				harness.chatEntitlementService.sku = 'copilot_for_individual_user';
				harness.entitlementChanged.fire();
			}
			await timeout(0);

			assert.deepStrictEqual(results.map(result => result.names), [[], [], [], ['agents/accountState', 'agents/accountStateChanged']]);
		});
	});

	test('disposes pending startup, initialization continuations, and account listeners', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const accountReady = new DeferredPromise<void>();
			const harness = createHarness({ defaultAccountReady: accountReady.p });
			harness.entitlementChanged.fire();
			harness.tracker.dispose();
			await accountReady.complete();
			harness.quotaChanged.fire();
			harness.defaultAccountChanged.fire(null);
			await timeout(30_000);

			assert.deepStrictEqual(harness.events, []);
		});
	});

	test('disposes a pending change without emitting a second startup event', async () => {
		await runWithFakedTimers({ useFakeTimers: true }, async () => {
			const harness = createHarness();
			await timeout(1);
			harness.chatEntitlementService.entitlement = ChatEntitlement.Free;
			harness.entitlementChanged.fire();
			harness.tracker.dispose();
			await timeout(30_000);

			assert.deepStrictEqual(harness.events, [{ name: 'agents/accountState', data: signedOutSnapshot }]);
		});
	});
});
