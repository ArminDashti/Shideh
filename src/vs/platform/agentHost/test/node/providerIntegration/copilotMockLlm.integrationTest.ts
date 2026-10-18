/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent Host integration tests using the real Copilot provider and a synthetic local LLM.
 */

import assert from 'assert';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { retry, timeout } from '../../../../../base/common/async.js';
import { join } from '../../../../../base/common/path.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { ActionType, type ChatResponsePartAction, type ChatToolCallCompleteAction, type ChatToolCallReadyAction, type ChatToolCallStartAction, type ChatTurnCompleteAction, type ChatTurnStartedAction } from '../../../common/state/sessionActions.js';
import { PROTOCOL_VERSION } from '../../../common/state/protocol/version/registry.js';
import { buildDefaultChatUri, MessageKind, PendingMessageKind, ResponsePartKind, ROOT_STATE_URI, SessionStatus, ToolCallContributorKind, ToolResultContentType, type ISessionWithDefaultChat, type ToolDefinition } from '../../../common/state/sessionState.js';
import type { DisposeSessionParams } from '../../../common/state/sessionProtocol.js';
import { ToolCallConfirmationReason } from '../../../common/state/protocol/channels-chat/state.js';
import { SessionConfigKey } from '../../../common/sessionConfigKeys.js';
import { AgentHostSessionReleaseRetryMsEnvVar, AgentHostSessionResidencyLimitEnvVar } from '../../../common/agentService.js';
import { readToolConfirmationId, withToolConfirmationId } from '../../../common/meta/agentToolConfirmationMeta.js';
import { createProviderSession, dispatchTurn, type IAgentHostProviderTestConfig } from '../providerIntegrationTestHelpers.js';
import { fetchSessionWithChat, getActionEnvelope, isActionNotification, IServerHandle, startRealServer, stopServer, TestProtocolClient } from '../serverIntegrationTestHelpers.js';

const COPILOT_CONFIG: IAgentHostProviderTestConfig = {
	provider: 'copilotcli',
	scheme: 'copilotcli',
	githubToken: 'not-a-real-token',
};
const CANVAS_COPILOT_CONFIG: IAgentHostProviderTestConfig = {
	...COPILOT_CONFIG,
	sessionConfig: { [SessionConfigKey.AutoApprove]: 'autoApprove' },
};

const DETACHED_SHELL_SCENARIO_ID = 'detached-shell-idle-release';
const ATTACHED_SHELL_SCENARIO_ID = 'attached-shell-foreground-completion';
const DETACHED_SHELL_DELAY_MS = 6000;
const STEERING_OWNER_SCENARIO_ID = 'steering-client-tool-owner';
const STEERING_RESPONSE_DELAY_MS = 10_000;
const CANVAS_SCENARIO_ID = 'model-opened-canvas';
const CANVAS_EXTENSION_TURN_SCENARIO_ID = 'canvas-extension-turn';

interface ITeamModelInput {
	readonly role?: string;
	readonly content?: string | readonly { readonly text?: string }[];
}

function teamInputText(input: readonly ITeamModelInput[]): string {
	return input.filter(item => item.role === 'user').map(item => typeof item.content === 'string' ? item.content : item.content?.map(part => part.text ?? '').join('') ?? '').join('\n');
}

function teamTarget(input: readonly ITeamModelInput[], role: string): string {
	const text = teamInputText(input);
	const match = text.match(new RegExp(`${role}: (?<link>agent-host-session://[^\\s]+)`, 'i'));
	assert.ok(match?.groups?.link, `Missing ${role} chat link in the real model request`);
	return match.groups.link;
}

function teamReportId(input: readonly ITeamModelInput[], role: string): string {
	return [...teamInputText(input).matchAll(new RegExp(`## ${role}\\nreportId: (?<id>[^\\s]+)`, 'g'))].at(-1)?.groups?.id ?? 'not-yet-delivered';
}

suite('Agent Host Provider Integration - Enforced model teams', function () {
	let server: IServerHandle;
	let client: TestProtocolClient;
	let home: string;
	const sessions: string[] = [];

	async function startTeamServer() {
		server = await startRealServer({
			mockLlm: true, homeDir: home, userDataDir: join(home, 'user-data'),
			mockScenarios: [
				{
					id: 'enforced-team-lead',
					definition: {
						type: 'multi-turn',
						turns: [
							{
								kind: 'tool-calls',
								toolCalls: [{ toolNamePattern: /^bash$/, arguments: { command: `echo forbidden > ${quoteShellArgument(join(home, 'lead-before-handoff.txt'))}`, description: 'Attempt implementation before engineer hand-back' } }],
							},
							{ kind: 'content', chunks: [{ content: 'An early solo answer.', delayMs: 0 }] },
							{
								kind: 'tool-calls',
								toolCalls: ['worker', 'scout'].map(role => ({
									toolNamePattern: /^manage_team$/,
									arguments: { action: 'assign', role, objective: `${role} engineering`, deliverable: `${role} verified result` },
								})),
							},
							{
								kind: 'tool-calls',
								toolCalls: ['worker', 'scout'].map(role => ({
									toolNamePattern: /^send_message$/,
									arguments: (input: readonly ITeamModelInput[]) => ({
										session: teamTarget(input, role), message: `[scenario:enforced-team-${role}] Complete your assignment and report.`,
									}),
								})),
							},
							{ kind: 'content', chunks: [{ content: 'Assignments sent; waiting for results.', delayMs: 0 }] },
							...[0, 1].flatMap(() => [
								{
									kind: 'tool-calls',
									toolCalls: ['worker', 'scout'].map(role => ({
										toolNamePattern: /^manage_team$/,
										arguments: (input: readonly ITeamModelInput[]) => ({
											action: 'review', role, reportId: teamReportId(input, role), accept: true, feedback: `Verified ${role} evidence`,
										}),
									})),
								},
								{ kind: 'content', chunks: [{ content: 'Reviewed WORKER_RESULT_73 and SCOUT_RESULT_42 when available.', delayMs: 0 }] },
							]),
						],
					},
				},
				{
					id: 'team-manager-integration',
					definition: {
						type: 'multi-turn',
						turns: [
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^manage_team$/, arguments: { action: 'assign', role: 'worker', objective: 'Implement the component', deliverable: 'Verified component ready to integrate' } }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^send_message$/, arguments: (input: readonly ITeamModelInput[]) => ({ session: teamTarget(input, 'worker'), message: '[scenario:enforced-team-worker] Implement and verify the component.' }) }] },
							{ kind: 'content', chunks: [{ content: 'Waiting for the engineer.', delayMs: 0 }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^manage_team$/, arguments: (input: readonly ITeamModelInput[]) => ({ action: 'review', role: 'worker', reportId: teamReportId(input, 'worker'), accept: true, feedback: 'Verified the component and test report' }) }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^manage_team$/, arguments: { action: 'phase', phase: 'integration' } }] },
							{ kind: 'content', chunks: [{ content: 'Yielding for integration hand-back.', delayMs: 0 }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^create$/, arguments: { path: join(home, 'lead-integration.txt'), file_text: 'Integrated accepted work\n' } }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^manage_team$/, arguments: { action: 'phase', phase: 'manager' } }] },
							{ kind: 'content', chunks: [{ content: 'Returning to management.', delayMs: 0 }] },
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^create$/, arguments: { path: join(home, 'lead-after-integration.txt'), file_text: 'forbidden\n' } }] },
							{ kind: 'content', chunks: [{ content: 'Engineering accepted and integrated.', delayMs: 0 }] },
						],
					},
				},
				{
					id: 'team-normal-chat',
					definition: {
						type: 'multi-turn',
						turns: [
							{ kind: 'tool-calls', toolCalls: [{ toolNamePattern: /^bash$/, arguments: { command: `echo normal > ${quoteShellArgument(join(home, 'normal-chat-tools.txt'))}`, description: 'Verify normal chat tools' } }] },
							{ kind: 'content', chunks: [{ content: 'Normal chat completed.', delayMs: 0 }] },
						],
					},
				},
				{ id: 'enforced-team-worker', definition: [{ content: 'WORKER_RESULT_73', delayMs: 250 }] },
				{ id: 'enforced-team-scout', definition: [{ content: 'SCOUT_RESULT_42', delayMs: 500 }] },
				{ id: 'enforced-team-ignore', definition: [{ content: 'I will finish alone.', delayMs: 0 }] },
			],
		});
	}

	suiteSetup(async function () {
		this.timeout(120_000);
		home = await mkdtemp(join(tmpdir(), 'test-enforced-team-'));
		await startTeamServer();
	});

	suiteTeardown(async () => {
		await stopServer(server);
		await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});

	setup(async () => {
		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(async () => {
		for (const session of sessions.splice(0)) {
			await client.call('disposeSession', { session });
		}
		client.close();
	});

	async function createTeam(scenario: string, existingSession?: string, clientSeq = 1, withScout = true, leadModel = 'gpt-5.3-codex') {
		const session = existingSession ?? await createProviderSession(client, {
			...COPILOT_CONFIG,
			sessionConfig: {
				autoApprove: 'autoApprove',
				[CopilotModelTeamConfigKey]: { worker: { id: 'gpt-5.3-codex' }, ...(withScout ? { scout: { id: 'gpt-5.3-codex' } } : {}) },
			},
		}, scenario, sessions, URI.file(home));
		const leadChat = buildDefaultChatUri(session);
		const turnId = `${scenario}-turn-${clientSeq}`;
		client.dispatch({
			channel: leadChat, clientSeq, action: {
				type: ActionType.ChatTurnStarted, turnId, startedAt: new Date().toISOString(),
				message: { text: `[scenario:${scenario}] Solve this task as a team.`, origin: { kind: MessageKind.User }, model: { id: leadModel } },
			},
		});
		const end = await client.waitForNotification(notification => {
			if (!isActionNotification(notification, ActionType.ChatTurnComplete) && !isActionNotification(notification, ActionType.ChatError)) {
				return false;
			}
			const envelope = getActionEnvelope(notification);
			return envelope.channel === leadChat
				&& (envelope.action.type === ActionType.ChatTurnComplete || envelope.action.type === ActionType.ChatError)
				&& envelope.action.turnId === turnId;
		}, 60_000);
		const action = getActionEnvelope(end).action;
		const state = await client.call<IAgentHostPersistentTeamState>(GetPersistentTeamStateExtensionMethod, { session, leadChat });
		return { session, leadChat, turnId, action, state };
	}

	test('requires both assignments and delivers their final reports without teammate send_message calls', async function () {
		this.timeout(90_000);
		const { session, turnId, action, state } = await createTeam('enforced-team-lead');
		assert.strictEqual(action.type, ActionType.ChatTurnComplete, JSON.stringify(action));
		const transcript = await fetchSessionWithChat(client, session);
		const final = transcript.turns.find(turn => turn.id === turnId)?.responseParts.filter(part => part.kind === ResponsePartKind.Markdown).map(part => part.content).join('\n');
		const teammates = await Promise.all(state.members.map(async member => {
			const result = await client.call<SubscribeResult>('subscribe', { channel: member.chat });
			const chat = result.snapshot?.state as ChatState;
			return {
				role: member.role,
				turns: chat.turns.length,
				hasMessagingCall: chat.turns.some(turn => turn.responseParts.some(part => part.kind === ResponsePartKind.ToolCall && part.toolCall.toolName === 'send_message')),
			};
		}));
		assert.deepStrictEqual({
			state: state.task?.state,
			assignments: state.task?.assignments.map(assignment => ({ role: assignment.role, state: assignment.state, reviewed: assignment.reviewed })),
			workerReviewed: final?.includes('WORKER_RESULT_73'),
			scoutReviewed: final?.includes('SCOUT_RESULT_42'),
			queued: transcript.queuedMessages?.length ?? 0,
			leadEditedBeforeHandBack: existsSync(join(home, 'lead-before-handoff.txt')),
			teammates,
		}, {
			state: 'completed',
			assignments: [{ role: 'worker', state: 'reported', reviewed: true }, { role: 'scout', state: 'reported', reviewed: true }],
			workerReviewed: true, scoutReviewed: true, queued: 0, leadEditedBeforeHandBack: false,
			teammates: [{ role: 'worker', turns: 1, hasMessagingCall: false }, { role: 'scout', turns: 1, hasMessagingCall: false }],
		});
	});

	test('stock runtime allows integration edits only after hand-back and closes them before management resumes', async function () {
		this.timeout(90_000);
		const { action, state } = await createTeam('team-manager-integration', undefined, 1, false, 'claude-sonnet-4.5');
		assert.strictEqual(action.type, ActionType.ChatTurnComplete, JSON.stringify(action));
		assert.deepStrictEqual({
			integrated: existsSync(join(home, 'lead-integration.txt')) ? await readFile(join(home, 'lead-integration.txt'), 'utf8') : undefined,
			editedAfterHandBack: existsSync(join(home, 'lead-after-integration.txt')),
			state: state.task?.state,
			phase: state.task?.leadPhase,
			accepted: state.task?.assignments[0].reviewed,
		}, { integrated: 'Integrated accepted work\n', editedAfterHandBack: false, state: 'completed', phase: 'manager', accepted: true });
	});

	test('enabling and disabling Team refreshes tools on the same saved Lead chat', async function () {
		this.timeout(120_000);
		const session = await createProviderSession(client, {
			...COPILOT_CONFIG, sessionConfig: { autoApprove: 'autoApprove' },
		}, 'team-toggle-tools', sessions, URI.file(home));
		const runNormal = async (turnId: string, clientSeq: number) => {
			dispatchTurn(client, session, turnId, '[scenario:team-normal-chat] Verify normal tools.', clientSeq);
			await client.waitForNotification(notification => {
				if (!isActionNotification(notification, ActionType.ChatTurnComplete)) {
					return false;
				}
				const envelope = getActionEnvelope(notification);
				return envelope.channel === buildDefaultChatUri(session) && envelope.action.type === ActionType.ChatTurnComplete && envelope.action.turnId === turnId;
			}, 60_000);
			assert.strictEqual(await readFile(join(home, 'normal-chat-tools.txt'), 'utf8'), 'normal\n');
			await rm(join(home, 'normal-chat-tools.txt'));
		};
		await runNormal('normal-before-team', 1);
		client.dispatch({
			channel: session, clientSeq: 2, action: {
				type: ActionType.SessionConfigChanged, config: {
					[CopilotModelTeamConfigKey]: { worker: { id: 'gpt-5.3-codex' }, scout: { id: 'gpt-5.3-codex' } },
				}
			},
		});
		const enabled = await createTeam('enforced-team-lead', session, 3);
		assert.strictEqual(enabled.action.type, ActionType.ChatTurnComplete, JSON.stringify(enabled.action));
		client.dispatch({ channel: session, clientSeq: 4, action: { type: ActionType.SessionConfigChanged, config: { [CopilotModelTeamConfigKey]: {} } } });
		await runNormal('normal-after-team', 5);
	});

	test('a model that keeps ignoring Team is blocked instead of completing alone', async function () {
		this.timeout(90_000);
		const { action, state } = await createTeam('enforced-team-ignore');
		assert.deepStrictEqual({
			action: action.type,
			state: state.task?.state,
			unassigned: state.task?.assignments.map(assignment => assignment.state),
		}, { action: ActionType.ChatError, state: 'blocked', unassigned: ['unassigned', 'unassigned'] });
	});

	test('configuration refresh reuses the same teammates and cannot bypass host completion', async function () {
		this.timeout(120_000);
		const first = await createTeam('enforced-team-lead');
		assert.strictEqual(first.action.type, ActionType.ChatTurnComplete, JSON.stringify(first.action));
		client.dispatch({
			channel: first.session, clientSeq: 2,
			action: {
				type: ActionType.SessionActiveClientSet,
				activeClient: {
					clientId: 'enforced-team-lead', customizations: [],
					tools: [{ name: 'team_test_noop', description: 'Unused tool to refresh session configuration.', inputSchema: { type: 'object', properties: {} } }],
				},
			},
		});
		await client.waitForNotification(notification => isActionNotification(notification, ActionType.SessionActiveClientSet)
			&& getActionEnvelope(notification).channel === first.session);
		const second = await createTeam('enforced-team-lead', first.session, 3);
		assert.deepStrictEqual({
			action: second.action.type,
			error: second.action.type === ActionType.ChatError ? second.action.part.error?.message : undefined,
			members: second.state.members.map(member => member.chat),
			task: second.state.task?.state,
			reviewed: second.state.task?.assignments.map(assignment => assignment.reviewed),
		}, {
			action: ActionType.ChatTurnComplete, error: undefined,
			members: first.state.members.map(member => member.chat), task: 'completed', reviewed: [true, true],
		});
	});

	test('blocked tasks restore with durable turn identities and explicit retry', async function () {
		this.timeout(120_000);
		const first = await createTeam('enforced-team-ignore');
		client.close();
		await stopServer(server);
		await startTeamServer();
		client = new TestProtocolClient(server.port);
		await client.connect();
		await client.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'team-cold-restored' });
		await client.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: COPILOT_CONFIG.githubToken });
		const restored = await client.call<IAgentHostPersistentTeamState>(GetPersistentTeamStateExtensionMethod, { session: first.session, leadChat: first.leadChat });
		const snapshot = await fetchSessionWithChat(client, first.session);
		const turn = snapshot.turns.find(turn => turn.id === restored.task?.leadEventId);
		assert.ok(turn);
		assert.deepStrictEqual({
			turns: snapshot.turns.length,
			text: turn.message.text,
			state: turn.state,
			retryable: turn.responseParts.some(part => part.kind === ResponsePartKind.Error && part.resumable),
			members: restored.members.map(member => member.chat),
		}, {
			turns: 1,
			text: '[scenario:enforced-team-ignore] Solve this task as a team.',
			state: TurnState.Error,
			retryable: true,
			members: first.state.members.map(member => member.chat),
		});
		client.clearReceived();
		client.dispatch({ channel: first.leadChat, clientSeq: 1, action: { type: ActionType.ChatTurnResume, turnId: turn.id } });
		const outcome = await client.waitForNotification(notification => isActionNotification(notification, ActionType.ChatError)
			&& getActionEnvelope(notification).channel === first.leadChat, 60_000);
		const action = getActionEnvelope(outcome).action;
		assert.ok(action.type === ActionType.ChatError);
		assert.strictEqual(action.turnId, turn.id);
	});
});

function quoteShellArgument(value: string): string {
	return isWindows ? `'${value.replace(/'/g, '\'\'')}'` : `'${value.replace(/'/g, `'\\''`)}'`;
}

suite('Agent Host Provider Integration — Copilot with Mock LLM', function () {

	let server: IServerHandle;
	let client: TestProtocolClient;
	let suiteHome: string;
	const createdSessions: string[] = [];
	const tempDirs: string[] = [];

	suiteSetup(async function () {
		this.timeout(120_000);
		suiteHome = await mkdtemp(`${tmpdir()}/test-mock-copilot-home-`);
		server = await startRealServer({
			mockLlm: true,
			homeDir: suiteHome,
			userDataDir: join(suiteHome, 'user-data'),
			mockScenarios: [{
				id: STEERING_OWNER_SCENARIO_ID,
				definition: {
					type: 'multi-turn',
					turns: [
						{
							kind: 'content',
							chunks: [
								{ content: 'Initial response started.', delayMs: 0 },
								{ content: ' Initial response finished.', delayMs: STEERING_RESPONSE_DELAY_MS },
							],
						},
						{
							kind: 'tool-calls',
							toolCalls: [{
								toolNamePattern: /^route_probe$/,
								arguments: {},
							}],
						},
						{ kind: 'content', chunks: [{ content: 'STEERING_CLIENT_RESULT', delayMs: 0 }] },
					],
				},
			}, {
				id: CANVAS_SCENARIO_ID,
				definition: {
					type: 'multi-turn',
					turns: [
						{
							kind: 'tool-calls',
							toolCalls: [{
								toolNamePattern: /^open_canvas$/,
								arguments: {
									canvasId: 'proof-canvas',
									instanceId: 'proof-instance',
									input: { source: 'integration-test' },
								},
							}],
						},
						{ kind: 'content', chunks: [{ content: 'Canvas opened.', delayMs: 0 }] },
					],
				},
			}, {
				id: CANVAS_EXTENSION_TURN_SCENARIO_ID,
				definition: {
					type: 'multi-turn',
					turns: [{ kind: 'content', chunks: [{ content: 'Canvas-originated request completed.', delayMs: 0 }] }],
				},
			}],
		});
	});

	suiteTeardown(async function () {
		await stopServer(server);
		await rm(suiteHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});

	setup(async function () {
		this.timeout(120_000);
		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(async function () {
		for (const session of createdSessions) {
			try {
				await client.call('disposeSession', { channel: session } satisfies DisposeSessionParams, 5000);
			} catch { /* best-effort */ }
		}
		createdSessions.length = 0;
		client.close();

		for (const dir of tempDirs) {
			try {
				await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch { /* best-effort */ }
		}
		tempDirs.length = 0;
	});

	test('returns a hello response via mock LLM', async function () {
		this.timeout(180_000);

		const probeToken = 'MOCK_REQUEST_PROBE_12345';
		const workspaceDir = await mkdtemp(`${tmpdir()}/test-mock-hello`);
		tempDirs.push(workspaceDir);
		const sessionUri = await createProviderSession(client, COPILOT_CONFIG, 'real-sdk-mock-hello', createdSessions, URI.file(workspaceDir));
		dispatchTurn(client, sessionUri, 'turn-mock-hello', `Reply with exactly: ${probeToken}`, 1);
		try {
			await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'), 90_000);
		} catch (err) {
			console.error(`Failed to receive chat/turnComplete notification within timeout: ${err}, receivedNotifications: ${JSON.stringify(client.receivedNotifications())}, logMessages: ${server.mockLlm?.logMessages.join('\n') ?? 'no mockllm server'}`);
			throw new Error(`Failed to receive chat/turnComplete notification within timeout: ${err}, receivedNotifications: ${JSON.stringify(client.receivedNotifications())}, logMessages: ${server.mockLlm?.logMessages.join('\n') ?? 'no mockllm server'}`);
		}

		assert.ok((server.mockLlm?.requestCount() ?? 0) >= 1, 'expected at least one request to the mock LLM');

		const state = await fetchSessionWithChat(client, sessionUri);

		const turn = state.turns.find(t => t.id === 'turn-mock-hello');
		const markdownText = turn?.responseParts.map(p => p.kind === ResponsePartKind.Markdown ? p.content : '').join('\n') ?? ``;
		assert.ok(markdownText.trim().length > 0, `expected non-empty assistant markdown; got: ${JSON.stringify(markdownText)}`);
		assert.match(markdownText, new RegExp(`\\b${probeToken}\\b`, 'i'), `expected probe token in assistant markdown; got: ${JSON.stringify(markdownText)}`);
	});

	test('loads a project extension through the client-resolved SDK before the model opens its canvas and projects extension-started turns', async function () {
		this.timeout(180_000);
		const workspaceDir = await mkdtemp(`${tmpdir()}/test-mock-canvas`);
		tempDirs.push(workspaceDir);
		const extensionDir = join(workspaceDir, '.github', 'extensions', 'proof-canvas');
		await mkdir(extensionDir, { recursive: true });
		await writeFile(join(extensionDir, 'extension.mjs'), `
import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
let session;
let requestedAgent = false;
session = await joinSession({
	canvases: [createCanvas({
		id: 'proof-canvas',
		displayName: 'Proof canvas',
		description: 'Integration-test canvas.',
		open: ({ instanceId }) => {
			const dispose = session.on(event => {
				if (requestedAgent || event.agentId || event.type !== 'session.idle') {
					return;
				}
				requestedAgent = true;
				dispose();
				void session.send({
					prompt: '[scenario:${CANVAS_EXTENSION_TURN_SCENARIO_ID}] Report that the canvas request completed.',
					mode: 'enqueue'
				}).catch(error => console.error(error));
			});
			return {
				url: \`http://127.0.0.1:43119/\${instanceId}\`,
				title: 'Proof canvas',
				status: 'ready'
			};
		}
	})]
});
`, 'utf8');

		const sessionUri = await createProviderSession(
			client,
			CANVAS_COPILOT_CONFIG,
			'real-sdk-mock-canvas',
			createdSessions,
			URI.file(workspaceDir),
		);
		dispatchTurn(client, sessionUri, 'turn-mock-canvas', `[scenario:${CANVAS_SCENARIO_ID}] Open the available proof canvas.`, 2);
		const startNotification = await client.waitForNotification(n =>
			isActionNotification(n, ActionType.ChatToolCallStart)
			&& (getActionEnvelope(n).action as ChatToolCallStartAction).toolName === 'open_canvas',
			90_000,
		);
		const openCanvasStart = getActionEnvelope(startNotification).action as ChatToolCallStartAction;
		const openCanvasCompleteNotification = await client.waitForNotification(n =>
			isActionNotification(n, ActionType.ChatToolCallComplete)
			&& (getActionEnvelope(n).action as ChatToolCallCompleteAction).toolCallId === openCanvasStart.toolCallId,
			90_000,
		);
		const openCanvasComplete = getActionEnvelope(openCanvasCompleteNotification).action as ChatToolCallCompleteAction;
		await client.waitForNotification(n =>
			isActionNotification(n, ActionType.ChatTurnComplete)
			&& (getActionEnvelope(n).action as ChatTurnCompleteAction).turnId === 'turn-mock-canvas',
			90_000,
		);
		const providerTurnStartedNotification = await client.waitForNotification(n => {
			if (!isActionNotification(n, ActionType.ChatTurnStarted)) {
				return false;
			}
			const action = getActionEnvelope(n).action as ChatTurnStartedAction;
			return action.turnId !== 'turn-mock-canvas'
				&& action.message.text.includes(`[scenario:${CANVAS_EXTENSION_TURN_SCENARIO_ID}]`);
		}, 90_000);
		const providerTurnStarted = getActionEnvelope(providerTurnStartedNotification).action as ChatTurnStartedAction;
		const providerResponseNotification = await client.waitForNotification(n => {
			if (!isActionNotification(n, ActionType.ChatResponsePart)) {
				return false;
			}
			const action = getActionEnvelope(n).action as ChatResponsePartAction;
			return action.turnId === providerTurnStarted.turnId
				&& action.part.kind === ResponsePartKind.Markdown
				&& action.part.content.includes('Canvas-originated request completed.');
		}, 90_000);
		const providerResponse = getActionEnvelope(providerResponseNotification).action as ChatResponsePartAction;
		await client.waitForNotification(n =>
			isActionNotification(n, ActionType.ChatTurnComplete)
			&& (getActionEnvelope(n).action as ChatTurnCompleteAction).turnId === providerTurnStarted.turnId,
			90_000,
		);

		assert.deepStrictEqual({
			openCanvasSucceeded: openCanvasComplete.result.success,
			providerTurn: {
				message: providerTurnStarted.message,
				response: providerResponse.part.kind === ResponsePartKind.Markdown ? providerResponse.part.content : undefined,
			},
		}, {
			openCanvasSucceeded: true,
			providerTurn: {
				message: {
					text: `[scenario:${CANVAS_EXTENSION_TURN_SCENARIO_ID}] Report that the canvas request completed.`,
					origin: { kind: MessageKind.User },
				},
				response: 'Canvas-originated request completed.',
			},
		});
	});

	test('routes a client tool after steering to the client that sent the steering message', async function () {
		this.timeout(180_000);
		const originalClientId = 'steering-original-client';
		const steeringClientId = 'steering-sender-client';
		const workspaceDir = await mkdtemp(`${tmpdir()}/test-mock-steering-owner`);
		tempDirs.push(workspaceDir);
		const sessionUri = await createProviderSession(client, COPILOT_CONFIG, originalClientId, createdSessions, URI.file(workspaceDir));
		const chatUri = buildDefaultChatUri(sessionUri);
		const steeringClient = new TestProtocolClient(server.port);
		const tools: ToolDefinition[] = [{
			name: 'route_probe',
			description: 'Returns the steering owner marker.',
			inputSchema: { type: 'object', properties: {} },
		}];
		await steeringClient.connect();
		try {
			await steeringClient.call('initialize', {
				channel: ROOT_STATE_URI,
				protocolVersions: [PROTOCOL_VERSION],
				clientId: steeringClientId,
			});
			await steeringClient.call('subscribe', { channel: sessionUri });
			await steeringClient.call('subscribe', { channel: chatUri });

			for (const [owner, clientId] of [[client, originalClientId], [steeringClient, steeringClientId]] as const) {
				owner.dispatch({
					channel: sessionUri,
					clientSeq: 1,
					action: {
						type: ActionType.SessionActiveClientSet,
						activeClient: { clientId, tools },
					},
				});
				await client.waitForNotification(n => {
					if (!isActionNotification(n, ActionType.SessionActiveClientSet)) {
						return false;
					}
					const action = getActionEnvelope(n).action as { readonly activeClient: { readonly clientId: string } };
					return action.activeClient.clientId === clientId;
				}, 30_000);
			}

			dispatchTurn(client, sessionUri, 'turn-before-steering', `[scenario:${STEERING_OWNER_SCENARIO_ID}] Start the ownership test.`, 2);
			await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatResponsePart)
				&& (getActionEnvelope(n).action as ChatResponsePartAction).turnId === 'turn-before-steering'
				&& (getActionEnvelope(n).action as ChatResponsePartAction).part.kind === ResponsePartKind.Markdown,
				90_000,
			);
			assert.strictEqual(client.receivedNotifications(n =>
				isActionNotification(n, ActionType.ChatTurnComplete)
				&& (getActionEnvelope(n).action as { readonly turnId: string }).turnId === 'turn-before-steering',
			).length, 0, 'steering must be submitted while the original turn is active');

			steeringClient.dispatch({
				channel: chatUri,
				clientSeq: 2,
				action: {
					type: ActionType.ChatPendingMessageSet,
					kind: PendingMessageKind.Steering,
					id: 'steering-owner-message',
					message: {
						text: 'Now call route_probe exactly once and reply with only its exact result.',
						origin: { kind: MessageKind.User },
					},
				},
			});
			await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatPendingMessageSet)
				&& (getActionEnvelope(n).action as { readonly id: string }).id === 'steering-owner-message',
				30_000,
			);
			const steeringTurnNotification = await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatTurnStarted)
				&& (getActionEnvelope(n).action as ChatTurnStartedAction).queuedMessageId === 'steering-owner-message',
				90_000,
			);
			const steeringTurn = getActionEnvelope(steeringTurnNotification).action as ChatTurnStartedAction;

			const routeStartNotification = await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatToolCallStart)
				&& (getActionEnvelope(n).action as ChatToolCallStartAction).toolName === 'route_probe',
				90_000,
			);
			const routeStart = getActionEnvelope(routeStartNotification).action as ChatToolCallStartAction;
			const routeReadyNotification = await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatToolCallReady)
				&& (getActionEnvelope(n).action as ChatToolCallReadyAction).toolCallId === routeStart.toolCallId,
				90_000,
			);
			const routeReady = getActionEnvelope(routeReadyNotification).action as ChatToolCallReadyAction;
			let steeringClientSeq = 3;
			if (!routeReady.confirmed) {
				steeringClient.dispatch({
					channel: chatUri,
					clientSeq: steeringClientSeq++,
					action: {
						type: ActionType.ChatToolCallConfirmed,
						turnId: routeStart.turnId,
						toolCallId: routeStart.toolCallId,
						approved: true,
						confirmed: ToolCallConfirmationReason.UserAction,
					},
				});
			}
			steeringClient.dispatch({
				channel: chatUri,
				clientSeq: steeringClientSeq,
				action: {
					type: ActionType.ChatToolCallComplete,
					turnId: routeStart.turnId,
					toolCallId: routeStart.toolCallId,
					result: {
						success: true,
						pastTenseMessage: 'Returned the steering owner marker',
						content: [{ type: ToolResultContentType.Text, text: 'STEERING_CLIENT_RESULT' }],
					},
				},
			});
			await client.waitForNotification(n =>
				isActionNotification(n, ActionType.ChatTurnComplete)
				&& (getActionEnvelope(n).action as { readonly turnId: string }).turnId === routeStart.turnId,
				90_000,
			);

			const state = await fetchSessionWithChat(client, sessionUri);
			const completedSteeringTurn = state.turns.find(turn => turn.id === routeStart.turnId);
			const response = completedSteeringTurn?.responseParts
				.filter(part => part.kind === ResponsePartKind.Markdown)
				.map(part => part.content)
				.join('') ?? '';
			assert.deepStrictEqual({
				steeringContributor: routeStart.contributor,
				steeringTurnId: steeringTurn.turnId,
				routeTurnId: routeStart.turnId,
				response: response.trim(),
			}, {
				steeringContributor: { kind: ToolCallContributorKind.Client, clientId: steeringClientId },
				steeringTurnId: routeStart.turnId,
				routeTurnId: routeStart.turnId,
				response: 'STEERING_CLIENT_RESULT',
			});
		} finally {
			steeringClient.close();
		}
	});
});

/**
 * Idle-session release exercised against the real Copilot SDK and a mock LLM.
 * The dedicated server uses a zero residency cap and short provider-veto retry
 * so release is deterministic without changing production policy.
 */
suite('Agent Host Provider Integration — Copilot Idle Release', function () {

	// Short enough that a post-unsubscribe wait reliably outlasts it, long
	// enough that the intra-test subscribe calls in createProviderSession don't race it.
	const RELEASE_RETRY_MS = 500;

	let server: IServerHandle;
	let client: TestProtocolClient;
	let suiteHome: string;
	let detachedCompletionMarker: string;
	let attachedStartedMarker: string;
	let attachedReleaseMarker: string;
	let attachedCompletionMarker: string;
	const createdSessions: string[] = [];
	const tempDirs: string[] = [];

	suiteSetup(async function () {
		this.timeout(120_000);
		suiteHome = await mkdtemp(`${tmpdir()}/test-mock-idle-release-home`);
		detachedCompletionMarker = join(suiteHome, 'detached-shell-complete');
		const detachedScript = join(suiteHome, 'detached-shell.js');
		await writeFile(detachedScript, `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(detachedCompletionMarker)}, 'done'), ${DETACHED_SHELL_DELAY_MS});`);
		const command = `node ${quoteShellArgument(detachedScript)}`;
		attachedStartedMarker = join(suiteHome, 'attached-shell-started');
		attachedReleaseMarker = join(suiteHome, 'attached-shell-release');
		attachedCompletionMarker = join(suiteHome, 'attached-shell-complete');
		const attachedScript = join(suiteHome, 'attached-shell.js');
		await writeFile(attachedScript, `
			const fs = require('fs');
			fs.writeFileSync(${JSON.stringify(attachedStartedMarker)}, 'ready');
			const timer = setInterval(() => {
				if (fs.existsSync(${JSON.stringify(attachedReleaseMarker)})) {
					clearInterval(timer);
					fs.writeFileSync(${JSON.stringify(attachedCompletionMarker)}, 'done');
				}
			}, 50);
		`);
		server = await startRealServer({
			mockLlm: true,
			homeDir: suiteHome,
			userDataDir: join(suiteHome, 'user-data'),
			env: {
				[AgentHostSessionResidencyLimitEnvVar]: '0',
				[AgentHostSessionReleaseRetryMsEnvVar]: String(RELEASE_RETRY_MS),
			},
			mockScenarios: [{
				id: DETACHED_SHELL_SCENARIO_ID,
				definition: {
					type: 'multi-turn',
					turns: [
						{
							kind: 'tool-calls',
							toolCalls: [{
								toolNamePattern: /^(bash|powershell)$/,
								arguments: {
									command,
									description: 'Run detached shell release probe',
									mode: 'async',
									detach: true,
									initial_wait: 30,
								},
							}],
						},
						{ kind: 'content', chunks: [{ content: 'Waiting for detached shell completion.', delayMs: 0 }] },
					],
				},
			}, {
				id: ATTACHED_SHELL_SCENARIO_ID,
				definition: {
					type: 'multi-turn',
					turns: [
						{
							kind: 'tool-calls',
							toolCalls: [{
								toolNamePattern: /^(bash|powershell)$/,
								arguments: {
									command: `node ${quoteShellArgument(attachedScript)}`,
									description: 'Run attached shell completion probe',
									mode: 'async',
									initial_wait: 30,
								},
							}],
						},
						{ kind: 'content', chunks: [{ content: 'The background shell is ready.', delayMs: 0 }] },
					],
				},
			}],
		});
	});

	suiteTeardown(async function () {
		await stopServer(server);
		await rm(suiteHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});

	setup(async function () {
		this.timeout(120_000);
		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(async function () {
		for (const session of createdSessions) {
			try {
				await client.call('disposeSession', { channel: session } satisfies DisposeSessionParams, 5000);
			} catch { /* best-effort */ }
		}
		createdSessions.length = 0;
		client.close();

		for (const dir of tempDirs) {
			try {
				await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch { /* best-effort */ }
		}
		tempDirs.length = 0;
	});

	for (const attachmentMode of ['attached', 'detached'] as const) {
		test(`keeps ${attachmentMode === 'attached' ? 'an attached' : 'a detached'} shell running after an idle session loses all subscribers (mock LLM)`, async function () {
			this.timeout(180_000);

			const workspaceDir = await mkdtemp(`${tmpdir()}/test-mock-${attachmentMode}-release`);
			tempDirs.push(workspaceDir);
			const sessionUri = await createProviderSession(client, COPILOT_CONFIG, `real-sdk-mock-${attachmentMode}-release`, createdSessions, URI.file(workspaceDir));
			const turnId = `turn-${attachmentMode}-release`;
			const scenarioId = attachmentMode === 'attached' ? ATTACHED_SHELL_SCENARIO_ID : DETACHED_SHELL_SCENARIO_ID;

			try {
				dispatchTurn(client, sessionUri, turnId, `[scenario:${scenarioId}] Start the ${attachmentMode} shell.`, 1);
				const readyNotification = await client.waitForNotification(n => {
					if (!isActionNotification(n, 'chat/toolCallReady')) {
						return false;
					}
					return !(getActionEnvelope(n).action as ChatToolCallReadyAction).confirmed;
				}, 90_000);
				const readyEnvelope = getActionEnvelope(readyNotification);
				const readyAction = readyEnvelope.action as ChatToolCallReadyAction;
				client.dispatch({
					channel: readyEnvelope.channel,
					clientSeq: 2,
					action: {
						type: ActionType.ChatToolCallConfirmed,
						turnId: readyAction.turnId,
						toolCallId: readyAction.toolCallId,
						approved: true,
						confirmed: ToolCallConfirmationReason.UserAction,
					},
				});
				const completeNotification = await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallComplete'), 90_000);
				const completeAction = getActionEnvelope(completeNotification).action as ChatToolCallCompleteAction;
				assert.strictEqual(completeAction.result.success, true, JSON.stringify(completeAction.result));
				assert.match(JSON.stringify(completeAction.result), attachmentMode === 'detached' ? /detached background/ : /background/);
				await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'), 90_000);

				if (attachmentMode === 'attached') {
					assert.strictEqual(await retry(() => readFile(attachedStartedMarker, 'utf8'), 100, 150), 'ready');
					assert.strictEqual(existsSync(attachedCompletionMarker), false, 'The foreground must complete before the attached shell exits');
				}
				const idle = await fetchSessionWithChat(client, sessionUri);
				assert.deepStrictEqual({
					activeTurn: idle.activeTurn,
					inProgress: (idle.status & SessionStatus.InProgress) !== 0,
				}, {
					activeTurn: undefined,
					inProgress: false,
				});

				for (const channel of [buildDefaultChatUri(sessionUri), sessionUri]) {
					client.notify('unsubscribe', { channel });
				}
				await timeout(RELEASE_RETRY_MS + 1000);
			} finally {
				if (attachmentMode === 'attached') {
					await writeFile(attachedReleaseMarker, 'release');
				}
			}
			return !(getActionEnvelope(n).action as ChatToolCallReadyAction).confirmed;
		}, 90_000);
		const readyEnvelope = getActionEnvelope(readyNotification);
		const readyAction = readyEnvelope.action as ChatToolCallReadyAction;
		client.dispatch({
			channel: readyEnvelope.channel,
			clientSeq: 2,
			action: {
				type: ActionType.ChatToolCallConfirmed,
				_meta: withToolConfirmationId({}, readToolConfirmationId(readyAction))._meta,
				turnId: readyAction.turnId,
				toolCallId: readyAction.toolCallId,
				approved: true,
				confirmed: ToolCallConfirmationReason.UserAction,
			},
		});
	}

	test('releases an idle session and resumes it losslessly on re-subscribe (mock LLM)', async function () {
		this.timeout(180_000);

		const assistantMarkdown = (turns: ISessionWithDefaultChat['turns'], turnId: string): string =>
			turns.find(t => t.id === turnId)?.responseParts.map(p => p.kind === ResponsePartKind.Markdown ? p.content : '').join('\n') ?? '';
		// Project each turn onto its durable transcript content: the user message
		// and the assistant's rendered markdown. Live-only or reconstructed fields
		// (regenerated response-part ids, the internal turn id which is rebuilt
		// from the SDK event log on restore, per-turn `usage` token telemetry that
		// is not persisted) legitimately do not survive a restore-from-disk, so
		// "lossless" is asserted over the transcript the user sees.
		const transcript = (turns: ISessionWithDefaultChat['turns']) =>
			turns.map(t => ({ message: t.message.text, markdown: assistantMarkdown(turns, t.id) }));

		const workspaceDir = await mkdtemp(`${tmpdir()}/test-mock-release-resume`);
		tempDirs.push(workspaceDir);
		const sessionUri = await createProviderSession(client, COPILOT_CONFIG, 'real-sdk-mock-release', createdSessions, URI.file(workspaceDir));

		// Drive one turn so the session has durable SDK state (a persisted event
		// log) backed by a live SDK session that owns real per-session resources.
		const firstProbe = 'MOCK_RELEASE_PROBE_1';
		dispatchTurn(client, sessionUri, 'turn-release-1', `Reply with exactly: ${firstProbe}`, 1);
		const firstResult = await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') || isActionNotification(n, 'chat/error'), 90_000);
		assert.strictEqual(getActionEnvelope(firstResult).action.type, ActionType.ChatTurnComplete, JSON.stringify(getActionEnvelope(firstResult).action));

		const before = await fetchSessionWithChat(client, sessionUri);
		assert.match(assistantMarkdown(before.turns, 'turn-release-1'), new RegExp(`\\b${firstProbe}\\b`, 'i'), 'first turn should have completed before release');

		// Drop every subscriber. The zero-capacity server drops cached protocol
		// state and releases the live SDK session while preserving its event log.
		for (const channel of [buildDefaultChatUri(sessionUri), sessionUri]) {
			client.notify('unsubscribe', { channel });
		}
		await timeout(RELEASE_RETRY_MS + 2000);

		// Re-subscribe: the server restores the session from disk and the provider
		// resumes the SDK session on demand. The restored transcript must match
		// the pre-release view.
		const after = await fetchSessionWithChat(client, sessionUri);
		assert.deepStrictEqual(transcript(after.turns), transcript(before.turns), 'restored transcript must match the pre-release state');

		// Drive a SECOND turn after the release/resume cycle. This is the key
		// assertion: it proves the SDK session resumed cleanly rather than wedging
		// the runtime — the exact failure mode idle release could introduce.
		client.clearReceived();
		const secondProbe = 'MOCK_RELEASE_PROBE_2';
		dispatchTurn(client, sessionUri, 'turn-release-2', `Reply with exactly: ${secondProbe}`, 2);
		const secondResult = await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') || isActionNotification(n, 'chat/error'), 90_000);
		assert.strictEqual(getActionEnvelope(secondResult).action.type, ActionType.ChatTurnComplete, JSON.stringify(getActionEnvelope(secondResult).action));

		const final = await fetchSessionWithChat(client, sessionUri);
		assert.match(assistantMarkdown(final.turns, 'turn-release-2'), new RegExp(`\\b${secondProbe}\\b`, 'i'), 'a follow-up turn must complete after the release/resume cycle');
	});
});
