/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integration test for ClaudeAgent.
 *
 * Wires together:
 *  - Real {@link ClaudeAgent} driving the materialize lifecycle on the
 *    native (BYOK) transport.
 *  - Minimal {@link ICopilotApiService} fake covering the session's
 *    shared CAPI surface (endpoint discovery, restricted-telemetry
 *    context, model listing).
 *  - Recording {@link IClaudeAgentSdkService} that captures the
 *    `Options` the agent hands to `startup()` and plays a scripted
 *    `queryMessages` sequence back through the `Query` — invoking the
 *    captured `Options.canUseTool` / `Options.onElicitation` closures
 *    exactly where the real subprocess would.
 *
 * The test does NOT fork the bundled `@anthropic-ai/claude-agent-sdk`
 * subprocess. That fork is exercised live by the smoke run
 * (`smoke.md`). What this test guarantees in CI is the callback surface
 * that crosses the materialize → SDK boundary:
 *  - `canUseTool` / `onElicitation` are both wired into the `Options`
 *    the SDK service receives from `_materializeProvisional`.
 *  - A one-tool turn produces the agent → mapper → progress-event
 *    ordering the workbench consumes (tool call cards,
 *    `pending_confirmation`, turn completion).
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { GetSessionMessagesOptions, Options, PermissionResult, Query, SDKControlInterruptResponse, SDKMessage, SDKResultSuccess, SDKSessionInfo, SDKSystemMessage, SDKUserMessage, SessionMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CCAModel } from '@vscode/copilot-api';
import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Schemas } from '../../../../base/common/network.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ServiceCollection } from '../../../instantiation/common/serviceCollection.js';
import { InstantiationService } from '../../../instantiation/common/instantiationService.js';
import { ILogService, NullLogService } from '../../../log/common/log.js';
import { IAgentHostStartupPerformance, NullAgentHostStartupPerformance } from '../../node/agentHostStartupPerformance.js';
import { FileService } from '../../../files/common/fileService.js';
import { IFileService } from '../../../files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../files/common/inMemoryFilesystemProvider.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import { AgentSession, type AgentSignal, type IAgentChatContext, type IAgentCreateSessionConfig, GITHUB_COPILOT_PROTECTED_RESOURCE } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { buildDefaultChatUri, ResponsePartKind, ToolResultContentType, ChatInputResponseKind, ChatInputAnswerState, ChatInputAnswerValueKind, type ChatInputRequest, type ClientPluginCustomization } from '../../common/state/sessionState.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import { IAgentHostOTelService } from '../../common/otel/agentHostOTelService.js';
import { AgentConfigurationService, IAgentConfigurationService } from '../../node/agentConfigurationService.js';
import { IAgentHostGitHubEndpointService } from '../../node/agentHostGitHubEndpointService.js';
import { createTestGitHubEndpointService } from './testGitHubEndpointService.js';
import { AgentHostStateManager, IAgentHostStateManager } from '../../node/agentHostStateManager.js';
import { AgentHostSessionTitleSignal, IAgentHostSessionTitleSignal } from '../../node/agentHostSessionTitleSignal.js';
import { IAgentHostGitService } from '../../common/agentHostGitService.js';
import { IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE } from '../../common/agentHostCheckpointService.js';
import { IAgentHostCustomizationEnablementService } from '../../node/agentHostCustomizationEnablementService.js';
import { createNoopCustomizationEnablementService } from './testCustomizationEnablementService.js';
import { IAgentHostAuthenticationService } from '../../node/agentHostAuthenticationService.js';
import { ClaudeAgent } from '../../node/claude/claudeAgent.js';
import { IClaudeAgentSdkService } from '../../node/claude/claudeAgentSdkService.js';
import { IAgentSdkDownloader } from '../../node/agentSdkDownloader.js';
import { IAgentPluginManager } from '../../common/agentPluginManager.js';
import { ICopilotApiService } from '../../node/shared/copilotApiService.js';
import { createNoopGitService, createSessionDataService } from '../common/sessionTestHelpers.js';
import { RecordingAgentSdkDownloader } from './testAgentSdkDownloader.js';
import {
	makeContentBlockStartText,
	makeContentBlockStartToolUse,
	makeContentBlockStop,
	makeInputJsonDelta,
	makeMessageStart,
	makeMessageStop,
	makeStreamEvent,
	makeTextDelta,
	makeUserToolResultMessage,
} from './claudeMapSessionEventsTestUtils.js';

const noopOTelService: IAgentHostOTelService = {
	_serviceBrand: undefined,
	diagnosticsEnabled: false,
	emitTurnTiming: () => { },
	emitFirstResponse: () => { },
	emitUserInteraction: () => { },
	getSdkTelemetryConfig: async () => undefined,
	getNativeSdkTelemetryConfig: async () => undefined,
	getSessionTraceContext: () => undefined,
	setSessionComparisonMetadata: () => { },
	releaseSessionTraceContext: () => { },
	withTraceContext: <T>(_context: undefined, fn: () => T): T => fn(),
	getCurrentTraceContext: () => undefined,
	getSpansDbPath: () => undefined,
	emitSessionTitleChanged: () => { },
	flush: async () => { },
};

// #region Test fixtures

/**
 * The {@link IFileService} + {@link INativeEnvironmentService} pair the
 * Phase 16 customization disk scan / watcher needs at session construction
 * time. Nothing is seeded under `userHome`, so the scan is deterministically
 * empty — these only exist so `new ClaudeAgentSession` can read `userHome`
 * and start its watcher without throwing.
 */
function claudeFileEnvServices(disposables: Pick<DisposableStore, 'add'>): [typeof IFileService | typeof INativeEnvironmentService, IFileService | INativeEnvironmentService][] {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
	const env: Partial<INativeEnvironmentService> = { userHome: URI.file('/mock-home') };
	return [
		[IFileService, fileService],
		[INativeEnvironmentService, env as INativeEnvironmentService],
	];
}

function createTestAuthenticationService(): IAgentHostAuthenticationService {
	return {
		_serviceBrand: undefined,
		onDidChangeAuthToken: Event.None,
		getAuthAccount: () => undefined,
		getAuthToken: request => request.resource === GITHUB_COPILOT_PROTECTED_RESOURCE.resource ? 'gh-int-test-token' : undefined,
	};
}

const ANTHROPIC_MODEL: CCAModel = {
	id: 'claude-opus-4.6',
	name: 'Claude Opus 4.6',
	vendor: 'Anthropic',
	supported_endpoints: ['/v1/messages'],
	object: 'model',
	version: '4.6',
	is_chat_default: false,
	is_chat_fallback: false,
	model_picker_category: '',
	model_picker_enabled: true,
	preview: false,
	billing: { is_premium: false, multiplier: 1, restricted_to: [] },
	capabilities: {
		family: 'test',
		limits: { max_context_window_tokens: 200_000, max_output_tokens: 8192, max_prompt_tokens: 200_000 },
		object: 'model_capabilities',
		supports: { parallel_tool_calls: true, streaming: true, tool_calls: true, vision: false },
		tokenizer: 'o200k_base',
		type: 'chat',
	},
	policy: { state: 'enabled', terms: '' },
};

const TEST_UUID = '11111111-2222-3333-4444-555555555555';

function makeSystemInitMessage(sessionId: string): SDKSystemMessage {
	return {
		type: 'system',
		subtype: 'init',
		apiKeySource: 'user',
		claude_code_version: '0.0.0-test',
		cwd: '/workspace',
		tools: [],
		mcp_servers: [],
		model: 'claude-test',
		permissionMode: 'default',
		slash_commands: [],
		output_style: 'default',
		skills: [],
		plugins: [],
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

function makeResultSuccess(sessionId: string): SDKResultSuccess {
	return {
		type: 'result',
		subtype: 'success',
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: false,
		num_turns: 1,
		result: '',
		stop_reason: 'end_turn',
		total_cost_usd: 0,
		usage: {
			cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			inference_geo: 'unknown',
			input_tokens: 0,
			iterations: [],
			output_tokens: 0,
			server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
			service_tier: 'standard',
			speed: 'standard',
		},
		modelUsage: {},
		permission_denials: [],
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

// #endregion

// #region Stubbed CAPI

class StubCopilotApiService implements ICopilotApiService {
	declare readonly _serviceBrand: undefined;

	availableModels: CCAModel[] = [ANTHROPIC_MODEL];

	async resolveRestrictedTelemetryContext() { return { restrictedTelemetryEnabled: false, trackingId: undefined, telemetryEndpoint: undefined }; }
	async resolveApiEndpoint() { return undefined; }

	async countTokens(): Promise<Anthropic.MessageTokensCount> {
		throw new Error('countTokens not used in integration test');
	}

	async models(): Promise<CCAModel[]> {
		return this.availableModels;
	}

	async utilityChatCompletion(): Promise<never> {
		throw new Error('utilityChatCompletion not used in Claude integration tests');
	}
}

// #endregion

// #region Recording SDK service

/**
 * Marker entry the test can interleave inside
 * {@link RecordingSdkService.queryMessages} between SDK messages.
 * When {@link RecordingQuery.next} encounters a marker, it invokes the
 * captured {@link Options.canUseTool} closure and waits for it to
 * resolve before proceeding to the next entry, mirroring the real SDK
 * subprocess's behaviour around an assistant `tool_use` → synthetic
 * user `tool_result` round-trip.
 */
interface CanUseToolMarker {
	readonly kind: 'canUseTool';
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly toolUseID: string;
}

interface ElicitationMarker {
	readonly kind: 'elicitation';
	readonly request: Parameters<NonNullable<Options['onElicitation']>>[0];
}

type QueryStreamItem = SDKMessage | CanUseToolMarker | ElicitationMarker;

function isCanUseToolMarker(item: QueryStreamItem): item is CanUseToolMarker {
	return (item as CanUseToolMarker).kind === 'canUseTool';
}

function isElicitationMarker(item: QueryStreamItem): item is ElicitationMarker {
	return (item as ElicitationMarker).kind === 'elicitation';
}

/**
 * Test double for {@link IClaudeAgentSdkService}. Records the
 * `Options` each `startup()` receives and serves the scripted
 * {@link queryMessages} sequence through the produced WarmQuery,
 * standing in for the SDK subprocess without forking
 * `@anthropic-ai/claude-agent-sdk`'s bundled CLI.
 */
class RecordingSdkService implements IClaudeAgentSdkService {
	declare readonly _serviceBrand: undefined;

	readonly capturedStartupOptions: Options[] = [];

	/**
	 * Items the produced WarmQuery's Query will yield in order. SDK
	 * messages flow through unchanged; {@link CanUseToolMarker} entries
	 * pause the iterator and invoke the captured
	 * `Options.canUseTool` closure (mirroring what the real SDK
	 * subprocess does between assistant `tool_use` and the synthetic
	 * `user` `tool_result` it follows up with).
	 */
	queryMessages: QueryStreamItem[] = [];

	/** Records the {@link PermissionResult} returned by each `canUseTool` invocation in {@link queryMessages} order. */
	readonly canUseToolResults: (PermissionResult | null)[] = [];
	readonly elicitationResults: Awaited<ReturnType<NonNullable<Options['onElicitation']>>>[] = [];

	readonly warmQueries: RecordingWarmQuery[] = [];

	async listSessions(): Promise<readonly SDKSessionInfo[]> {
		return [];
	}

	async canLoadWithoutDownload(): Promise<boolean> {
		return true;
	}

	async ensureAvailable(): Promise<void> { }

	async getSessionInfo(_sessionId: string): Promise<SDKSessionInfo | undefined> {
		return undefined;
	}

	async getSessionMessages(_sessionId: string, _options?: GetSessionMessagesOptions): Promise<readonly SessionMessage[]> {
		return [];
	}

	async listSubagents(_sessionId: string): Promise<readonly string[]> {
		return [];
	}

	async getSubagentMessages(_sessionId: string, _agentId: string): Promise<readonly SessionMessage[]> {
		return [];
	}

	async forkSession(sessionId: string): Promise<{ sessionId: string }> {
		return { sessionId: `forked-${sessionId}` };
	}

	async deleteSession(): Promise<void> { /* not exercised by these tests */ }

	async createSdkMcpServer(): Promise<never> { throw new Error('not implemented in integration test fake'); }
	async tool(): Promise<never> { throw new Error('not implemented in integration test fake'); }

	async query(_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Promise<Query> { throw new Error('query not used in the integration test'); }

	async startup(params: { options: Options; initializeTimeoutMs?: number }): Promise<WarmQuery> {
		this.capturedStartupOptions.push(params.options);
		const warm = new RecordingWarmQuery(this);
		this.warmQueries.push(warm);
		return warm;
	}
}

class RecordingWarmQuery implements WarmQuery {
	asyncDisposeCount = 0;
	closeCount = 0;

	constructor(private readonly _sdk: RecordingSdkService) { }

	query(prompt: string | AsyncIterable<SDKUserMessage>): Query {
		if (typeof prompt === 'string') {
			throw new Error('integration test: agent host always passes an AsyncIterable');
		}
		return new RecordingQuery(prompt, this._sdk);
	}

	close(): void {
		this.closeCount++;
	}

	async [Symbol.asyncDispose](): Promise<void> {
		this.asyncDisposeCount++;
	}
}

class RecordingQuery implements AsyncGenerator<SDKMessage, void> {
	private _index = 0;
	private readonly _drainer: Promise<void>;

	constructor(prompt: AsyncIterable<SDKUserMessage>, private readonly _sdk: RecordingSdkService) {
		// Drain the prompt iterable in the background so the agent's
		// `_pendingPromptDeferred.complete()` actually pumps the queue.
		const it = prompt[Symbol.asyncIterator]();
		this._drainer = (async () => {
			while (true) {
				const r = await it.next();
				if (r.done) {
					return;
				}
			}
		})();
	}

	[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
		return this;
	}

	async next(): Promise<IteratorResult<SDKMessage, void>> {
		while (this._index < this._sdk.queryMessages.length) {
			const item = this._sdk.queryMessages[this._index++];
			if (isCanUseToolMarker(item)) {
				const startup = this._sdk.capturedStartupOptions[0];
				if (!startup?.canUseTool) {
					throw new Error('integration test: canUseTool marker but Options.canUseTool not wired');
				}
				const result = await startup.canUseTool(item.toolName, item.input, {
					signal: new AbortController().signal,
					toolUseID: item.toolUseID,
					requestId: item.toolUseID,
				});
				this._sdk.canUseToolResults.push(result);
				continue;
			}
			if (isElicitationMarker(item)) {
				const startup = this._sdk.capturedStartupOptions[0];
				if (!startup?.onElicitation) {
					throw new Error('integration test: elicitation marker but Options.onElicitation not wired');
				}
				const result = await startup.onElicitation(item.request, { signal: new AbortController().signal, requestId: 'integration-elicitation' });
				this._sdk.elicitationResults.push(result);
				continue;
			}
			return { done: false, value: item };
		}
		await this._drainer;
		return { done: true, value: undefined };
	}

	async return(): Promise<IteratorResult<SDKMessage, void>> {
		return { done: true, value: undefined };
	}

	async throw(err: unknown): Promise<IteratorResult<SDKMessage, void>> {
		throw err;
	}

	async interrupt(): Promise<SDKControlInterruptResponse | undefined> { return undefined; }

	setPermissionMode(): never { throw new Error('not modeled'); }
	setMcpPermissionModeOverride(): never { throw new Error('not modeled'); }
	setModel(): never { throw new Error('not modeled'); }
	setMaxThinkingTokens(): never { throw new Error('not modeled'); }
	applyFlagSettings(): never { throw new Error('not modeled'); }
	updateSettings(): never { throw new Error('not modeled'); }
	initializationResult(): never { throw new Error('not modeled'); }
	reinitialize(): never { throw new Error('not modeled'); }
	supportedCommands(): never { throw new Error('not modeled'); }
	supportedModels(): never { throw new Error('not modeled'); }
	supportedAgents(): never { throw new Error('not modeled'); }
	mcpServerStatus(): never { throw new Error('not modeled'); }
	getContextUsage(): never { throw new Error('not modeled'); }
	usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): never { throw new Error('not modeled'); }
	reloadPlugins(): never { throw new Error('not modeled'); }
	accountInfo(): never { throw new Error('not modeled'); }
	rewindFiles(): never { throw new Error('not modeled'); }
	readFile(): never { throw new Error('not modeled'); }
	readMcpResource(): never { throw new Error('not modeled'); }
	seedReadState(): never { throw new Error('not modeled'); }
	reconnectMcpServer(): never { throw new Error('not modeled'); }
	toggleMcpServer(): never { throw new Error('not modeled'); }
	setMcpServers(): never { throw new Error('not modeled'); }
	streamInput(): never { throw new Error('not modeled'); }
	stopTask(): never { throw new Error('not modeled'); }
	reloadSkills(): never { throw new Error('not modeled'); }
	reloadOutputStyles(): never { throw new Error('not modeled'); }
	backgroundTasks(): never { throw new Error('not modeled'); }
	close(): void { /* no-op */ }
	[Symbol.asyncDispose](): Promise<void> { return Promise.resolve(); }
}

// #endregion

// #region Session helpers

/**
 * Provisions a session the way Agent Host does: the host mints both the session
 * URI and the chat URI it starts the session with, and creates them together
 * through the single `IAgentChats.createChat` seam with the session's create
 * config flattened onto the creation options. Returns the chat URI plus the SDK
 * conversation id the provider bound to it — independent of the AH session id —
 * which these tests need to stage the fake SDK transcript.
 */
async function createSession(agent: ClaudeAgent, config: IAgentCreateSessionConfig): Promise<{ session: URI; chat: URI; sessionId: string }> {
	const session = AgentSession.uri('claude', generateUuid());
	const chat = URI.parse(buildDefaultChatUri(session));
	const created = await agent.chats.createChat(chat, chatContext(chat, session), {
		model: config.model,
		agent: config.agent,
		workingDirectories: config.workingDirectories,
		config: config.config,
		activeClient: config.activeClient,
		deferBacking: !config.importConversation,
		importConversation: config.importConversation,
	});
	if (!created?.backingSession) {
		throw new Error('Expected chat backing metadata');
	}
	return { session, chat, sessionId: AgentSession.id(created.backingSession) };
}

/**
 * The host-owned {@link IAgentChatContext} Agent Host stamps on every addressed
 * chat operation. A session-backed default chat is scoped to the session
 * resource, mirroring the orchestrator's own context builder.
 */
function chatContext(chat: URI, session: URI): IAgentChatContext {
	return { configurationResource: session, resource: session };
}

// #endregion

// #region Suite

suite('ClaudeAgent integration', function () {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('Phase 7 §5.3 — canUseTool / onElicitation closures wired through to Options on materialize', async () => {
		// Phase 7 §5.3. This test pins the callback surface —
		// `canUseTool` and `onElicitation` must both be present in the
		// Options the SDK service receives from `_materializeProvisional`
		// and behave per §3.4 / §3.7. We don't need a full SDK message
		// stream with tool_use blocks to validate the wiring — the unit
		// suites in `claudeAgent.test.ts` cover the in-process tool
		// round-trip exhaustively. What this integration adds: the
		// closures survive the materialize → SDK boundary intact.
		const capi = new StubCopilotApiService();
		const sdk = new RecordingSdkService();
		const logService = new NullLogService();
		const stateManager = disposables.add(new AgentHostStateManager(logService));
		const configService = disposables.add(new AgentConfigurationService(stateManager, logService));

		const services = new ServiceCollection(
			[ILogService, logService],
			[IAgentHostStartupPerformance, NullAgentHostStartupPerformance],
			[ICopilotApiService, capi],
			[ISessionDataService, createSessionDataService()],
			[IClaudeAgentSdkService, sdk],
			[IAgentSdkDownloader, new RecordingAgentSdkDownloader()],
			[IAgentPluginManager, {
				_serviceBrand: undefined,
				basePath: URI.from({ scheme: 'inmemory', path: '/agentPlugins' }),
				async syncCustomizations(_clientId: string, _customizations: ClientPluginCustomization[]) { return []; },
			}],
			[IAgentConfigurationService, configService],
			[IAgentHostOTelService, noopOTelService],
			[IAgentHostStateManager, stateManager],
			[IAgentHostSessionTitleSignal, disposables.add(new AgentHostSessionTitleSignal(stateManager))],
			[IAgentHostGitHubEndpointService, createTestGitHubEndpointService()],
			[IAgentHostGitService, createNoopGitService()],
			[IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE],
			[IAgentHostCustomizationEnablementService, createNoopCustomizationEnablementService()],
			[IAgentHostAuthenticationService, createTestAuthenticationService()],
			...claudeFileEnvServices(disposables),
		);
		const instantiationService = disposables.add(new InstantiationService(services));
		const agent = disposables.add(instantiationService.createInstance(ClaudeAgent));

		await agent.authenticate(GITHUB_COPILOT_PROTECTED_RESOURCE.resource, 'gh-int-test-token');
		const created = await createSession(agent, { workingDirectories: [URI.file('/integration-cwd')] });
		const sessionId = created.sessionId;
		sdk.queryMessages = [
			makeSystemInitMessage(sessionId),
			{
				kind: 'elicitation',
				request: { serverName: 'mcp-test', message: 'pick a side', mode: 'form', requestedSchema: { type: 'object', properties: { side: { type: 'string' } } } },
			},
			makeResultSuccess(sessionId),
		];

		const inputRequested = new DeferredPromise<ChatInputRequest>();
		disposables.add(agent.onDidChatProgress(s => {
			if (s.kind === 'action' && s.action.type === ActionType.ChatInputRequested) {
				inputRequested.complete(s.action.request);
			}
		}));

		const sendPromise = agent.chats.sendMessage(created.chat, 'hi', undefined, undefined, 'turn-1', undefined, undefined, chatContext(created.chat, created.session));
		const inputRequest = await inputRequested.p;

		const startup = sdk.capturedStartupOptions[0];
		assert.ok(typeof startup.canUseTool === 'function', 'canUseTool was wired into Options');
		assert.ok(typeof startup.onElicitation === 'function', 'onElicitation was wired into Options');

		agent.respondToUserInputRequest(inputRequest.id, ChatInputResponseKind.Accept, {
			side: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.Text, value: 'left' } },
		});
		await sendPromise;

		assert.deepStrictEqual({
			elicitResult: sdk.elicitationResults[0],
			permissionMode: startup.permissionMode,
		}, {
			elicitResult: { action: 'accept', content: { side: 'left' } },
			permissionMode: 'default',
		});
	});

	test('Phase 7 §5.3 — Read tool round-trip: SDK tool_use → pending_confirmation → respondToPermissionRequest(true) → tool_result → continuation', async () => {
		// §5.3 of the Phase-7 plan: drive a one-tool round-trip end-to-end
		// through a materialized agent. Unit
		// tests in `claudeAgent.test.ts` already cover the in-process
		// `_handleCanUseTool` mechanics; what this test pins is the
		// agent → mapper → progress-event ordering when the SDK fixture
		// invokes the captured `Options.canUseTool` mid-stream the same
		// way the real subprocess would.
		const capi = new StubCopilotApiService();
		const sdk = new RecordingSdkService();
		const logService = new NullLogService();
		const stateManager = disposables.add(new AgentHostStateManager(logService));
		const configService = disposables.add(new AgentConfigurationService(stateManager, logService));

		const services = new ServiceCollection(
			[ILogService, logService],
			[IAgentHostStartupPerformance, NullAgentHostStartupPerformance],
			[ICopilotApiService, capi],
			[ISessionDataService, createSessionDataService()],
			[IClaudeAgentSdkService, sdk],
			[IAgentSdkDownloader, new RecordingAgentSdkDownloader()],
			[IAgentPluginManager, {
				_serviceBrand: undefined,
				basePath: URI.from({ scheme: 'inmemory', path: '/agentPlugins' }),
				async syncCustomizations(_clientId: string, _customizations: ClientPluginCustomization[]) { return []; },
			}],
			[IAgentConfigurationService, configService],
			[IAgentHostOTelService, noopOTelService],
			[IAgentHostStateManager, stateManager],
			[IAgentHostSessionTitleSignal, disposables.add(new AgentHostSessionTitleSignal(stateManager))],
			[IAgentHostGitHubEndpointService, createTestGitHubEndpointService()],
			[IAgentHostGitService, createNoopGitService()],
			[IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE],
			[IAgentHostCustomizationEnablementService, createNoopCustomizationEnablementService()],
			[IAgentHostAuthenticationService, createTestAuthenticationService()],
			...claudeFileEnvServices(disposables),
		);
		const instantiationService = disposables.add(new InstantiationService(services));
		const agent = disposables.add(instantiationService.createInstance(ClaudeAgent));

		await agent.authenticate(GITHUB_COPILOT_PROTECTED_RESOURCE.resource, 'gh-int-test-token');
		const created = await createSession(agent, { workingDirectories: [URI.file('/integration-cwd')] });
		const sessionId = created.sessionId;

		// Canned turn: assistant says "reading", calls `Read`, the SDK
		// invokes `canUseTool`, then a synthetic user `tool_result`
		// arrives followed by an assistant continuation and `result`.
		const TOOL_USE_ID = 'tu_int_read_1';
		sdk.queryMessages = [
			makeSystemInitMessage(sessionId),
			makeStreamEvent(sessionId, makeMessageStart('msg_int_1')),
			makeStreamEvent(sessionId, makeContentBlockStartText(0)),
			makeStreamEvent(sessionId, makeTextDelta(0, 'reading')),
			makeStreamEvent(sessionId, makeContentBlockStop(0)),
			makeStreamEvent(sessionId, makeContentBlockStartToolUse(1, TOOL_USE_ID, 'Read')),
			makeStreamEvent(sessionId, makeInputJsonDelta(1, '{"file_path":"/tmp/x"}')),
			makeStreamEvent(sessionId, makeContentBlockStop(1)),
			makeStreamEvent(sessionId, makeMessageStop()),
			{ kind: 'canUseTool', toolName: 'Read', input: { file_path: '/tmp/x' }, toolUseID: TOOL_USE_ID },
			makeUserToolResultMessage(sessionId, TOOL_USE_ID, 'file contents'),
			makeStreamEvent(sessionId, makeMessageStart('msg_int_2')),
			makeStreamEvent(sessionId, makeContentBlockStartText(0)),
			makeStreamEvent(sessionId, makeTextDelta(0, 'done')),
			makeStreamEvent(sessionId, makeContentBlockStop(0)),
			makeStreamEvent(sessionId, makeMessageStop()),
			makeResultSuccess(sessionId),
		];

		const signals: AgentSignal[] = [];
		disposables.add(agent.onDidChatProgress(s => {
			signals.push(s);
			if (s.kind === 'pending_confirmation' && s.state.toolCallId === TOOL_USE_ID) {
				agent.respondToPermissionRequest(TOOL_USE_ID, true);
			}
		}));

		await agent.chats.sendMessage(created.chat, 'please read /tmp/x', undefined, undefined, 'turn-1', undefined, undefined, chatContext(created.chat, created.session));

		// Snapshot the agent-side emission stream as a single shape so
		// the failure surface is the whole pipeline.
		const summary = signals.map(s => {
			if (s.kind === 'pending_confirmation') {
				return {
					kind: s.kind,
					toolCallId: s.state.toolCallId,
					toolName: s.state.toolName,
					permissionKind: s.permissionKind,
					permissionPath: s.permissionPath,
				};
			}
			if (s.kind === 'action') {
				const a = s.action;
				switch (a.type) {
					case ActionType.ChatResponsePart:
						return { kind: 'action', type: a.type, partKind: a.part.kind, content: a.part.kind === ResponsePartKind.Markdown ? a.part.content : undefined };
					case ActionType.ChatDelta:
						return { kind: 'action', type: a.type, content: a.content };
					case ActionType.ChatToolCallStart:
						return { kind: 'action', type: a.type, toolCallId: a.toolCallId, toolName: a.toolName };
					case ActionType.ChatToolCallDelta:
						return { kind: 'action', type: a.type, toolCallId: a.toolCallId, content: a.content };
					case ActionType.ChatToolCallComplete:
						return { kind: 'action', type: a.type, toolCallId: a.toolCallId, success: a.result.success, content: a.result.content };
					case ActionType.ChatUsage:
						return { kind: 'action', type: a.type };
					case ActionType.ChatTurnComplete:
						return { kind: 'action', type: a.type };
					default:
						return { kind: 'action', type: a.type };
				}
			}
			return { kind: s.kind };
		});

		assert.deepStrictEqual({
			summary,
			canUseToolResults: sdk.canUseToolResults,
		}, {
			summary: [
				{ kind: 'action', type: ActionType.ChatResponsePart, partKind: ResponsePartKind.Markdown, content: '' },
				{ kind: 'action', type: ActionType.ChatDelta, content: 'reading' },
				{ kind: 'action', type: ActionType.ChatToolCallStart, toolCallId: TOOL_USE_ID, toolName: 'Read' },
				{ kind: 'action', type: ActionType.ChatToolCallDelta, toolCallId: TOOL_USE_ID, content: '{"file_path":"/tmp/x"}' },
				// Phase 8.5 — mapper emits `ChatToolCallReady` at
				// `content_block_stop` so auto-allowed tools transition out of
				// `Streaming`; `sessionPermissions` then emits a second Ready
				// for the pending_confirmation card below.
				{ kind: 'action', type: ActionType.ChatToolCallReady },
				{ kind: 'pending_confirmation', toolCallId: TOOL_USE_ID, toolName: 'Read', permissionKind: 'read', permissionPath: '/tmp/x' },
				{ kind: 'action', type: ActionType.ChatToolCallComplete, toolCallId: TOOL_USE_ID, success: true, content: [{ type: ToolResultContentType.Text, text: 'file contents' }] },
				{ kind: 'action', type: ActionType.ChatResponsePart, partKind: ResponsePartKind.Markdown, content: '' },
				{ kind: 'action', type: ActionType.ChatDelta, content: 'done' },
				{ kind: 'action', type: ActionType.ChatUsage },
				{ kind: 'action', type: ActionType.ChatTurnComplete },
			],
			canUseToolResults: [
				{ behavior: 'allow', updatedInput: { file_path: '/tmp/x' } },
			],
		});
	});
});

// #endregion
