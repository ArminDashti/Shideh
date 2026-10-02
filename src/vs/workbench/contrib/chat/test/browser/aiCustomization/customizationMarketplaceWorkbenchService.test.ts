/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { DeferredPromise } from '../../../../../../base/common/async.js';
import { bufferToStream, VSBuffer } from '../../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../../base/common/errors.js';
import { Event } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IRequestOptions } from '../../../../../../base/parts/request/common/request.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { AgentFinderRestProvider } from '../../../../../../platform/agentFinder/common/agentFinderRestProvider.js';
import { CustomizationMarketplaceChannel, CustomizationMarketplaceChannelClient, IPlatformCustomizationMarketplaceService } from '../../../../../../platform/customizationMarketplace/common/customizationMarketplaceIpc.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { CustomizationMarketplaceConfiguration, CustomizationMarketplaceSources } from '../../../../../../platform/customizationMarketplace/common/customizationMarketplaceSources.js';
import { CustomizationMarketplaceMediaType, CustomizationMarketplaceService, ICustomizationMarketplaceEntry, ICustomizationMarketplacePage, ICustomizationMarketplaceQuery, ICustomizationMarketplaceRequest, ICustomizationMarketplaceService, ICustomizationMarketplaceSourceQuery } from '../../../../../../platform/customizationMarketplace/common/customizationMarketplaceService.js';
import { IPluginMarketplacePage, IPluginMarketplaceQuery, IPluginMarketplaceService, MarketplaceType, parseMarketplaceReference, PluginSourceKind } from '../../../common/plugins/pluginMarketplaceService.js';
import { ChatConfiguration } from '../../../common/constants.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../../platform/request/common/request.js';
import { CustomizationMarketplaceWorkbenchService, PlatformCustomizationMarketplaceWorkbenchService } from '../../../browser/aiCustomization/customizationMarketplaceWorkbenchService.js';

suite('CustomizationMarketplaceWorkbenchService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createConfiguration(enabledIds: readonly string[]) {
		const configuration = new TestConfigurationService({
			[CustomizationMarketplaceConfiguration.MarketplaceEnabled]: true,
			[CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled]: enabledIds.includes(CustomizationMarketplaceSources.AgentFinderPublicFeed.id),
		});
		store.add(configuration.onDidChangeConfigurationEmitter);
		return configuration;
	}


	async function setEnabled(configuration: TestConfigurationService, setting: string, enabled: boolean): Promise<void> {
		await configuration.setUserConfiguration(setting, enabled);
		configuration.onDidChangeConfigurationEmitter.fire(new class extends mock<IConfigurationChangeEvent>() {
			override affectsConfiguration(section: string): boolean { return section === setting; }
		}());
	}

	function createService(
		configuration: TestConfigurationService,
		platformService: ICustomizationMarketplaceService,
	): CustomizationMarketplaceWorkbenchService {
		const platformSources = platformService.allSources ?? platformService.sources ?? [CustomizationMarketplaceSources.AgentFinderPublicFeed];
		const normalizedPlatformService = new class extends mock<ICustomizationMarketplaceService>() {
			override readonly sources = platformSources;
			override readonly allSources = platformSources;
			override query(options: ICustomizationMarketplaceQuery, token: CancellationToken) {
				return platformService.query(options, token);
			}
		}();
		const pluginMarketplaceService = new class extends mock<IPluginMarketplaceService>() {
			override readonly onDidChangeMarketplaces = Event.None;
			override getMarketplaceReferences() { return []; }
		}();
		return new CustomizationMarketplaceWorkbenchService(
			configuration,
			normalizedPlatformService,
			pluginMarketplaceService,
			store.add(new TestInstantiationService()),
		);
	}

	function createMixedFixture(enabledIds: readonly string[]) {
		const configuration = createConfiguration(enabledIds);
		const publicEntries: ICustomizationMarketplaceEntry[] = Array.from({ length: 45 }, (_, index) => ({
			identifier: `public-${index}`, displayName: `Mail server ${index}`, description: '', score: 100 - index,
			mediaType: CustomizationMarketplaceMediaType.McpServer, tags: [], capabilities: [], representativeQueries: [],
		}));
		const ipcRequests: ICustomizationMarketplaceRequest[] = [];
		const nativeRequests: ICustomizationMarketplaceSourceQuery[] = [];
		let publicInitializations = 0;
		const server = new CustomizationMarketplaceChannel(() => {
			publicInitializations++;
			return new CustomizationMarketplaceService([{
				id: CustomizationMarketplaceSources.AgentFinderPublicFeed.id,
				async query(options) {
					nativeRequests.push(options);
					const offset = Number(options.cursor ?? 0);
					const items = publicEntries.slice(offset, offset + Math.min(options.pageSize ?? 24, 5));
					return { items, total: publicEntries.length, nextCursor: offset + items.length < publicEntries.length ? String(offset + items.length) : undefined };
				},
			}]);
		});
		const publicService = new CustomizationMarketplaceChannelClient({
			async call<T>(command: string, options?: ICustomizationMarketplaceRequest, token?: CancellationToken): Promise<T> {
				assert.ok(options);
				ipcRequests.push(options);
				return JSON.parse(JSON.stringify(await server.call<ICustomizationMarketplacePage>('test', command, options, token)));
			},
			listen: () => Event.None,
		}, configuration);
		const service = createService(configuration, publicService);
		return { configuration, service, publicService, publicEntries, ipcRequests, nativeRequests, publicInitializations: () => publicInitializations };
	}


	test('disabled and cancelled queries do not instantiate the catalog client or perform requests', async () => {
		const configuration = new TestConfigurationService();
		store.add(configuration.onDidChangeConfigurationEmitter);
		const requests: IRequestOptions[] = [];
		const requestService = new class extends mock<IRequestService>() {
			override async request(options: IRequestOptions) {
				requests.push(options);
				const results = [{ identifier: 'example', displayName: 'Example', type: 'application/ai-skill' }];
				const response = options.type === 'POST' ? { results } : { results, total: 1, offset: 0, pageSize: 30 };
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(response))) };
			}
		}();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(IRequestService, requestService);
		instantiationService.stub(IProductService, { mcpGallery: { serviceUrl: 'https://api.mcp.github.com' } } as IProductService);
		instantiationService.stub(IPlatformCustomizationMarketplaceService, instantiationService.createInstance(PlatformCustomizationMarketplaceWorkbenchService));
		instantiationService.stub(IPluginMarketplaceService, new class extends mock<IPluginMarketplaceService>() {
			override readonly onDidChangeMarketplaces = Event.None;
			override getMarketplaceReferences() { return []; }
		}());
		const service = instantiationService.createInstance(CustomizationMarketplaceWorkbenchService);
		const create = sinon.spy(instantiationService, 'createInstance');
		store.add(toDisposable(() => create.restore()));

		await assert.rejects(service.query({}, CancellationToken.None), isCancellationError);
		await configuration.setUserConfiguration('chat.agentFinder.enabled', true);
		await configuration.setUserConfiguration('chat.customizations.unifiedMarketplace.enabled', true);
		await configuration.setUserConfiguration('chat.customizations.marketplace.sources.agentFinderPublicFeed.enabled', true);
		await configuration.setUserConfiguration('chat.customizations.marketplace.sources.publicGitHubFeed.enabled', true);
		await assert.rejects(service.query({}, CancellationToken.None), isCancellationError);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, false);
		await assert.rejects(service.query({}, CancellationToken.None), isCancellationError);
		await assert.rejects(service.query({ query: 'review' }, CancellationToken.None), isCancellationError);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, true);
		await assert.rejects(service.query({}, CancellationToken.Cancelled), isCancellationError);
		await assert.rejects(service.query({ query: 'review' }, CancellationToken.Cancelled), isCancellationError);
		await assert.rejects(service.query({}, CancellationToken.None), isCancellationError);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.MarketplaceEnabled, true);
		const whileDisabled = { creations: create.callCount, requests: requests.length };
		const pages = [
			await service.query({ sourceIds: [CustomizationMarketplaceSources.AgentFinderPublicFeed.id] }, CancellationToken.None),
			await service.query({ sourceIds: [CustomizationMarketplaceSources.AgentFinderPublicFeed.id], query: 'review' }, CancellationToken.None),
		];
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, false);
		await assert.rejects(service.query({ sourceIds: [CustomizationMarketplaceSources.AgentFinderPublicFeed.id] }, CancellationToken.None), isCancellationError);

		assert.deepStrictEqual({
			whileDisabled,
			createdCatalogClient: create.firstCall.args[0] === AgentFinderRestProvider,
			creations: create.callCount,
			requests: requests.map(request => request.type),
			sources: pages.map(page => page.items.map(item => item.sourceId)),
		}, { whileDisabled: { creations: 0, requests: 0 }, createdCatalogClient: true, creations: 1, requests: ['GET', 'POST'], sources: [['agentFinder'], ['agentFinder']] });
	});

	test('plugin-only Discover does not query the public feed', async () => {
		const configuration = new TestConfigurationService();
		store.add(configuration.onDidChangeConfigurationEmitter);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.MarketplaceEnabled, true);
		await configuration.setUserConfiguration(ChatConfiguration.PluginsEnabled, true);
		const customReference = parseMarketplaceReference('owner/catalog')!;
		const defaultReference = parseMarketplaceReference('github/awesome-copilot#marketplace')!;
		let publicCalls = 0;
		const pluginCalls: string[] = [];
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(IPlatformCustomizationMarketplaceService, new class extends mock<ICustomizationMarketplaceService>() {
			override readonly sources = [CustomizationMarketplaceSources.AgentFinderPublicFeed];
			override async query() {
				publicCalls++;
				return { items: [] };
			}
		}());
		instantiationService.stub(IPluginMarketplaceService, new class extends mock<IPluginMarketplaceService>() {
			override readonly onDidChangeMarketplaces = Event.None;
			override getMarketplaceReferences() { return [customReference, defaultReference]; }
			override async queryMarketplacePlugins(options: IPluginMarketplaceQuery) {
				const reference = options.marketplaceIds.has(defaultReference.canonicalId) ? defaultReference : customReference;
				pluginCalls.push(reference.canonicalId);
				return {
					items: [{
						name: reference === customReference ? 'Review' : 'Built-in', description: 'Code review', version: '1', source: 'review',
						sourceDescriptor: { kind: PluginSourceKind.RelativePath as const, path: 'review' },
						marketplace: reference.displayLabel, marketplaceReference: reference, marketplaceType: MarketplaceType.Copilot,
					}],
					total: 1,
					errors: [],
				};
			}
		}());
		const service = instantiationService.createInstance(CustomizationMarketplaceWorkbenchService);
		const page = await service.query({}, CancellationToken.None);
		assert.deepStrictEqual({
			sources: service.sources.map(source => source.id),
			items: page.items.map(item => [item.sourceId, item.displayName]),
			publicCalls, pluginCalls,
		}, {
			sources: [CustomizationMarketplaceSources.PluginMarketplaces.id, CustomizationMarketplaceSources.AgentFinderPublicFeed.id],
			items: [['pluginMarketplaces', 'Review'], ['pluginMarketplaces', 'Built-in']],
			publicCalls: 0,
			pluginCalls: [customReference.canonicalId, defaultReference.canonicalId],
		});
	});

	test('enabled public and plugin feeds start together and retain source selection', async () => {
		const configuration = new TestConfigurationService();
		store.add(configuration.onDidChangeConfigurationEmitter);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.MarketplaceEnabled, true);
		await configuration.setUserConfiguration(CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, true);
		await configuration.setUserConfiguration(ChatConfiguration.PluginsEnabled, true);
		const publicResult = new DeferredPromise<Awaited<ReturnType<ICustomizationMarketplaceService['query']>>>();
		const pluginResult = new DeferredPromise<IPluginMarketplacePage>();
		const calls: string[] = [];
		const reference = parseMarketplaceReference('owner/catalog')!;
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(IPlatformCustomizationMarketplaceService, new class extends mock<ICustomizationMarketplaceService>() {
			override readonly sources = [CustomizationMarketplaceSources.AgentFinderPublicFeed];
			override query() {
				calls.push('public');
				return publicResult.p;
			}
		}());
		instantiationService.stub(IPluginMarketplaceService, new class extends mock<IPluginMarketplaceService>() {
			override readonly onDidChangeMarketplaces = Event.None;
			override getMarketplaceReferences() { return [reference]; }
			override queryMarketplacePlugins() {
				calls.push('plugin');
				return pluginResult.p;
			}
		}());
		const service = instantiationService.createInstance(CustomizationMarketplaceWorkbenchService);
		const pending = service.query({ pageSize: 2 }, CancellationToken.None);
		await Promise.resolve();
		const started = [...calls];
		await publicResult.complete({
			items: [{
				sourceId: 'agentFinder', identifier: 'public', displayName: 'Public', description: '',
				mediaType: 'application/ai-skill', tags: [], capabilities: [], representativeQueries: [],
			}]
		});
		await pluginResult.complete({
			items: [{
				name: 'Plugin', description: 'Plugin from configured marketplace', version: '1', source: 'plugin',
				sourceDescriptor: { kind: PluginSourceKind.RelativePath, path: 'plugin' },
				marketplace: reference.displayLabel, marketplaceReference: reference, marketplaceType: MarketplaceType.Copilot,
			}],
			total: 1,
			errors: [],
		});
		const page = await pending;
		const selected = await service.query({ sourceIds: [CustomizationMarketplaceSources.PluginMarketplaces.id] }, CancellationToken.None);
		const search = await service.query({ query: 'plugin', pageSize: 2 }, CancellationToken.None);
		assert.deepStrictEqual({
			started, page: page.items.map(item => item.sourceId),
			selected: selected.items.map(item => item.sourceId),
			search: search.items.map(item => item.sourceId), calls,
		}, {
			started: ['plugin', 'public'], page: ['pluginMarketplaces', 'agentFinder'],
			selected: ['pluginMarketplaces'], search: ['pluginMarketplaces', 'agentFinder'],
			calls: ['plugin', 'public', 'plugin', 'plugin', 'public'],
		});
	});

	test('preserves recoverable public feed failures through the renderer composition', async () => {
		const configuration = new TestConfigurationService({
			[CustomizationMarketplaceConfiguration.MarketplaceEnabled]: true,
			[CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled]: true,
		});
		store.add(configuration.onDidChangeConfigurationEmitter);
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(IPlatformCustomizationMarketplaceService, new class extends mock<ICustomizationMarketplaceService>() {
			override readonly sources = [CustomizationMarketplaceSources.AgentFinderPublicFeed];
			override async query() {
				return {
					items: [{
						sourceId: 'agentFinder', identifier: 'public', displayName: 'Public', description: '',
						mediaType: 'application/ai-skill', tags: [], capabilities: [], representativeQueries: [],
					}],
					nextCursor: { token: 'next' },
					sourceErrors: [{ sourceId: 'agentFinder', message: 'Partial failure' }],
				};
			}
		}());
		instantiationService.stub(IPluginMarketplaceService, new class extends mock<IPluginMarketplaceService>() {
			override readonly onDidChangeMarketplaces = Event.None;
			override getMarketplaceReferences() { return []; }
		}());
		const service = instantiationService.createInstance(CustomizationMarketplaceWorkbenchService);
		const page = await service.query({ sourceIds: [CustomizationMarketplaceSources.AgentFinderPublicFeed.id], pageSize: 1 }, CancellationToken.None);
		assert.deepStrictEqual({
			items: page.items.map(item => item.identifier),
			hasMore: !!page.nextCursor,
			errors: page.sourceErrors,
		}, {
			items: ['public'],
			hasMore: true,
			errors: [{ sourceId: 'agentFinder', message: 'Partial failure' }],
		});
	});


	test('queries each native source independently', async () => {
		const configuration = createConfiguration(['agentFinder']);
		const baseSources = [CustomizationMarketplaceSources.McpGallery, CustomizationMarketplaceSources.AgentFinderPublicFeed];
		const sourceRequests: (readonly string[] | undefined)[] = [];
		const baseService = new class extends mock<ICustomizationMarketplaceService>() {
			override readonly allSources = baseSources;
			override readonly sources = baseSources;
			override async query(options: ICustomizationMarketplaceQuery) {
				sourceRequests.push(options.sourceIds);
				const sourceId = options.sourceIds?.[0];
				assert.ok(sourceId);
				return {
					items: [{
						sourceId,
						identifier: `${sourceId}/server`,
						displayName: `${sourceId} server`,
						description: '',
						mediaType: CustomizationMarketplaceMediaType.McpServer,
						tags: [],
						capabilities: [],
						representativeQueries: [],
					}],
				};
			}
		}();
		const service = createService(configuration, baseService);

		const page = await service.query({ pageSize: 24 }, CancellationToken.None);

		assert.deepStrictEqual({
			sourceRequests: sourceRequests.map(sourceIds => [...sourceIds ?? []]).sort(),
			resultSources: [...new Set(page.items.map(item => item.sourceId))].sort(),
		}, {
			sourceRequests: [['agentFinder'], ['mcpGallery']],
			resultSources: ['agentFinder', 'mcpGallery'],
		});
	});


	for (const enabledIds of [[], ['agentFinder']]) {
		test(`queries only selected sources and keeps the transport source-scoped: ${enabledIds.join(', ') || 'none'}`, async () => {
			const fixture = createMixedFixture(enabledIds);
			const options = { query: 'mail', pageSize: 24, sourceIds: ['agentFinder', 'unselected'] };
			const result = fixture.service.query(options, CancellationToken.None);
			if (enabledIds.length) {
				const page = await result;
				assert.deepStrictEqual([...new Set(page.items.map(item => item.sourceId))], enabledIds);
			} else {
				await assert.rejects(result, isCancellationError);
			}
			assert.deepStrictEqual({
				publicInitializations: fixture.publicInitializations(),
				publicQueried: fixture.nativeRequests.length > 0,
				ipcSourceIds: fixture.ipcRequests.map(request => request.sourceIds),
				transportSources: fixture.publicService.sources,
				registeredSources: fixture.service.sources,
			}, {
				publicInitializations: enabledIds.includes('agentFinder') ? 1 : 0,
				publicQueried: enabledIds.includes('agentFinder'),
				ipcSourceIds: enabledIds.includes('agentFinder') ? [['agentFinder']] : [],
				transportSources: [CustomizationMarketplaceSources.AgentFinderPublicFeed],
				registeredSources: [CustomizationMarketplaceSources.AgentFinderPublicFeed],
			});
		});
	}


	test('forwards an opaque backend cursor without decoding it or exposing it in the combined cursor', async () => {
		const opaque = 'opaque+/=&{"installation":"not-provenance"}';
		const calls: ICustomizationMarketplaceQuery[] = [];
		const configuration = createConfiguration(['agentFinder']);
		const publicService = new class extends mock<ICustomizationMarketplaceService>() {
			override async query(options: ICustomizationMarketplaceQuery) {
				calls.push(options);
				return {
					items: [{
						sourceId: 'agentFinder', identifier: options.cursor ? 'second' : 'first', displayName: 'Mail', description: '',
						mediaType: CustomizationMarketplaceMediaType.McpServer, tags: [], capabilities: [], representativeQueries: [], score: 50,
					}],
					total: 2,
					nextCursor: options.cursor ? undefined : { token: opaque },
				};
			}
		}();
		const service = createService(configuration, publicService);
		const first = await service.query({ query: 'mail', pageSize: 1 }, CancellationToken.None);
		const second = await service.query({ query: 'mail', pageSize: 1, cursor: first.nextCursor }, CancellationToken.None);
		assert.deepStrictEqual({
			calls,
			items: [first, second].flatMap(page => page.items.map(item => [item.identifier, item.installation])),
			exposesBackendCursor: first.nextCursor?.token === opaque,
		}, {
			calls: [
				{ query: 'mail', mediaType: undefined, pageSize: 1, cursor: undefined, sourceIds: ['agentFinder'] },
				{ query: 'mail', mediaType: undefined, pageSize: 1, cursor: { token: opaque }, sourceIds: ['agentFinder'] },
			],
			items: [['first', undefined], ['second', undefined]],
			exposesBackendCursor: false,
		});
	});


	test('source toggles reject stale continuations and fresh queries do not touch the disabled source', async () => {
		const fixture = createMixedFixture(['agentFinder']);
		const first = await fixture.service.query({ query: 'mail', pageSize: 24 }, CancellationToken.None);
		await setEnabled(fixture.configuration, CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, false);
		await assert.rejects(fixture.service.query({ query: 'mail', pageSize: 24, cursor: first.nextCursor }, CancellationToken.None), isCancellationError);
		const callsBefore = fixture.nativeRequests.length;
		await assert.rejects(fixture.service.query({ query: 'mail', pageSize: 24 }, CancellationToken.None), isCancellationError);
		assert.deepStrictEqual({
			additionalNativeCalls: fixture.nativeRequests.length - callsBefore,
		}, { additionalNativeCalls: 0 });
	});


	test('effective source changes cancel the active transport, while unchanged settings preserve the request', async () => {
		const configuration = createConfiguration(['agentFinder']);
		const publicResponse = new DeferredPromise<ICustomizationMarketplacePage>();
		const tokens: CancellationToken[] = [];
		const publicService = new class extends mock<ICustomizationMarketplaceService>() {
			override query(_options: ICustomizationMarketplaceQuery, token: CancellationToken) {
				tokens.push(token);
				return publicResponse.p;
			}
		}();
		const service = createService(configuration, publicService);
		const pending = service.query({ query: 'mail' }, CancellationToken.None);
		const cancelled = assert.rejects(pending, isCancellationError);
		await setEnabled(configuration, CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, true);
		const beforeToggle = tokens.map(token => token.isCancellationRequested);
		await setEnabled(configuration, CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled, false);
		await cancelled;
		await publicResponse.complete({ items: [] });
		assert.deepStrictEqual({
			beforeToggle,
			afterToggle: tokens.map(token => token.isCancellationRequested),
			listening: configuration.onDidChangeConfigurationEmitter.hasListeners(),
		}, { beforeToggle: [false], afterToggle: [true], listening: false });
	});


	for (const partial of [false, true]) {
		test(`preserves ${partial ? 'partial' : 'empty'} public-feed failures across the nested IPC composition`, async () => {
			const configuration = createConfiguration(['agentFinder']);
			const server = new CustomizationMarketplaceChannel(() => new CustomizationMarketplaceService([{
				id: 'agentFinder',
				query: async options => {
					if (!partial || options.cursor) {
						throw new Error('Public feed unavailable');
					}
					return {
						items: [{
							identifier: 'public', displayName: 'Mail', description: '', score: 100,
							mediaType: CustomizationMarketplaceMediaType.McpServer, tags: [], capabilities: [], representativeQueries: [],
						}],
						nextCursor: 'next',
						total: 2,
					};
				},
			}]));
			const publicService = new CustomizationMarketplaceChannelClient({
				async call<T>(command: string, request?: ICustomizationMarketplaceRequest, token?: CancellationToken): Promise<T> {
					return JSON.parse(JSON.stringify(await server.call<ICustomizationMarketplacePage>('test', command, request, token)));
				},
				listen: () => Event.None,
			}, configuration);
			const page = await createService(configuration, publicService).query({ query: 'mail', pageSize: 24 }, CancellationToken.None);
			assert.deepStrictEqual({
				ids: page.items.map(item => item.identifier),
				errors: page.sourceErrors,
				total: page.total,
				next: page.nextCursor,
			}, {
				ids: partial ? ['public'] : [],
				errors: [{ sourceId: 'agentFinder', message: 'Public feed unavailable' }],
				total: undefined,
				next: undefined,
			});
		});
	}
});
