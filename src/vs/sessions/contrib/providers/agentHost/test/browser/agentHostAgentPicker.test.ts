/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { NullActionViewItemService } from '../../../../../../platform/actions/browser/actionViewItemService.js';
import { CustomizationType, type AgentCustomization } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import { agentHostAgentPickerStorageKey, resolveAgentHostAgent } from '../../../../../../platform/agentHost/common/customAgents.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../../platform/actions/common/actions.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { ChatContextKeys } from '../../../../../../workbench/contrib/chat/common/actions/chatContextKeys.js';
import { Menus } from '../../../../../browser/menus.js';
import { LOCAL_AGENT_HOST_PROVIDER_ID } from '../../../../../common/agentHostSessionsProvider.js';
import { IsPhoneLayoutContext, SessionAgentPickerInAttachContext, SessionProviderIdContext, SessionUsesCombinedConfigPickerContext } from '../../../../../common/contextkeys.js';
import { ISession } from '../../../../../services/sessions/common/session.js';
import { AgentPickerSelectionState } from '../../browser/agentHostAgentPicker.js';
import '../../browser/agentHostSessionConfigPicker.js';
import '../../browser/mobile/mobileChatInputConfigPicker.js';
import '../../../../chat/browser/modelPicker.js';

suite('agentHostAgentPicker', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const alpha: AgentCustomization = { type: CustomizationType.Agent, id: 'agent://a', uri: 'agent://a', name: 'alpha' };
	const beta: AgentCustomization = { type: CustomizationType.Agent, id: 'agent://b', uri: 'agent://b', name: 'beta', description: 'b desc' };
	const agents: readonly AgentCustomization[] = [alpha, beta];
	type SessionMode = { readonly id: string; readonly kind: string };

	interface ITestSession {
		readonly session: IActiveSession;
		readonly mode: ISettableObservable<SessionMode | undefined>;
		readonly status: ISettableObservable<SessionStatus>;
	}

	function createSession(id: string, providerId: string, resourceScheme: string, selectedAgentUri: string | undefined, status: SessionStatus): ITestSession {
		const mode = observableValue<SessionMode | undefined>(`mode-${id}`, selectedAgentUri ? { id: selectedAgentUri, kind: 'agent' } : undefined);
		const sessionStatus = observableValue(`status-${id}`, status);
		const session = new class extends mock<IActiveSession>() {
			override readonly sessionId = `${providerId}:${id}`;
			override readonly resource = URI.parse(`${resourceScheme}:/${id}`);
			override readonly providerId = providerId;
			override readonly mode = mode;
			override readonly status = sessionStatus;
		};
		return { session, mode, status: sessionStatus };
	}

	function createContributionHarness(
		providerId: string,
		initialSession: ITestSession | undefined,
		sessions: readonly ITestSession[],
		customAgents: Map<string, readonly AgentCustomization[]>,
		storedAgentUri?: string,
	) {
		const activeSession = observableValue<IActiveSession | undefined>('activeSession', initialSession?.session);
		const sessionsService = new class extends mock<ISessionsService>() {
			override readonly activeSession = activeSession;
		};
		const sessionById = new Map(sessions.map(state => [state.session.sessionId, state]));
		const customAgentsChanged = store.add(new Emitter<void>());
		const setAgentCalls: Array<{ readonly sessionId: string; readonly agentUri: string | undefined }> = [];
		const provider = new class extends mock<IAgentHostSessionsProvider>() {
			override readonly id = providerId;
			override readonly onDidChangeCustomAgents = customAgentsChanged.event;
			override getCustomAgents(sessionId: string): readonly AgentCustomization[] {
				return customAgents.get(sessionId) ?? [];
			}
			override setAgent(sessionId: string, agent: ISessionAgentRef | undefined): void {
				setAgentCalls.push({ sessionId, agentUri: agent?.uri });
				sessionById.get(sessionId)?.mode.set(agent ? { id: agent.uri, kind: 'agent' } : undefined, undefined);
			}
		};
		const sessionsProvidersService = new class extends mock<ISessionsProvidersService>() {
			override getProvider<T extends ISessionsProvider>(candidateId: string): T | undefined {
				return (candidateId === provider.id ? provider : undefined) as T | undefined;
			}
		};
		const chatService = new class extends mock<IChatService>() {
			override getSession() {
				return undefined;
			}
		};
		const chatWidgetService = new class extends mock<IChatWidgetService>() {
			override readonly onDidAddWidget = Event.None;
			override readonly onDidChangeFocusedSession = Event.None;
			override getWidgetBySessionResource() {
				return undefined;
			}
		};
		const storageService = store.add(new TestStorageService());
		if (storedAgentUri && initialSession) {
			storageService.store(agentHostAgentPickerStorageKey(initialSession.session.resource.scheme), storedAgentUri, StorageScope.PROFILE, StorageTarget.MACHINE);
		}

		store.add(new AgentHostAgentPickerContribution(
			new NullActionViewItemService(),
			sessionsService,
			sessionsProvidersService,
			chatService,
			chatWidgetService,
			storageService,
			new NullLogService(),
		));

		return {
			activeSession,
			customAgentsChanged,
			registerSession: (state: ITestSession) => sessionById.set(state.session.sessionId, state),
			setAgentCalls,
			storageService,
		};
	}

	test('places the new-session agent before mode without duplicating it in automations', () => {
		const context = disposables.add(new ContextKeyService(new TestConfigurationService()));
		SessionProviderIdContext.bindTo(context).set(LOCAL_AGENT_HOST_PROVIDER_ID);
		const phone = IsPhoneLayoutContext.bindTo(context);
		phone.set(false);
		const agentPickerInAttachContext = SessionAgentPickerInAttachContext.bindTo(context);
		const inDialog = ChatContextKeys.inAutomationsDialog.bindTo(context);
		const ids = ['sessions.agentHost.agentPicker', 'sessions.agentHost.newSessionModePicker', 'sessions.modelPicker'];
		const controls = (menu: MenuId) => MenuRegistry.getMenuItems(menu).filter(isIMenuItem)
			.filter(item => ids.includes(item.command.id) && context.contextMatchesRules(item.when))
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map(item => item.command.id);
		inDialog.set(false);
		const newSessionPrimary = controls(Menus.NewSessionConfig);
		const newSessionSecondary = controls(Menus.NewSessionControl);
		const attachContext = () => MenuRegistry.getMenuItems(Menus.NewSessionAttachContext)
			.filter(isIMenuItem)
			.filter(item => context.contextMatchesRules(item.when))
			.map(item => item.command.id);
		const attachContextBefore = attachContext();
		agentPickerInAttachContext.set(true);
		const attachContextAfter = attachContext();
		phone.set(true);
		const attachContextOnPhone = attachContext();
		phone.set(false);
		inDialog.set(true);
		assert.deepStrictEqual({ newSessionPrimary, newSessionSecondary, attachContextBefore, attachContextAfter, attachContextOnPhone }, {
			newSessionPrimary: ['sessions.modelPicker'],
			newSessionSecondary: ['sessions.agentHost.agentPicker', 'sessions.agentHost.newSessionModePicker'],
			attachContextBefore: [],
			attachContextAfter: ['sessions.agentHost.agentPicker'],
			attachContextOnPhone: [],
		});
	});

	test('orders the new-session agent before mode and model without duplicating it in automations', () => {
		const context = disposables.add(new ContextKeyService(new TestConfigurationService()));
		SessionProviderIdContext.bindTo(context).set(LOCAL_AGENT_HOST_PROVIDER_ID);
		IsPhoneLayoutContext.bindTo(context).set(false);
		const inDialog = ChatContextKeys.inAutomationsDialog.bindTo(context);
		const ids = ['sessions.agentHost.agentPicker', 'sessions.agentHost.newSessionModePicker', 'sessions.modelPicker'];
		const controls = () => [Menus.NewSessionControl, Menus.NewSessionConfig].flatMap(menu =>
			MenuRegistry.getMenuItems(menu).filter(isIMenuItem)
				.filter(item => ids.includes(item.command.id) && context.contextMatchesRules(item.when))
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
				.map(item => item.command.id));
		inDialog.set(false);
		const newSession = controls();
		inDialog.set(true);
		assert.deepStrictEqual({ newSession, automationSecondary: controls() }, {
			newSession: ids,
			automationSecondary: ['sessions.agentHost.newSessionModePicker', 'sessions.modelPicker'],
		});
	});

	test('uses the same desktop and phone agent controls in the automation prompt', () => {
		const context = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const enabled = ChatContextKeys.enabled.bindTo(context);
		const inDialog = ChatContextKeys.inAutomationsDialog.bindTo(context);
		const phone = IsPhoneLayoutContext.bindTo(context);
		SessionProviderIdContext.bindTo(context).set(LOCAL_AGENT_HOST_PROVIDER_ID);
		SessionUsesCombinedConfigPickerContext.bindTo(context).set(true);
		enabled.set(true);
		inDialog.set(true);
		phone.set(false);
		const visible = () => MenuRegistry.getMenuItems(Menus.AutomationsDialogInputToolbar)
			.filter(isIMenuItem)
			.filter(item => item.command.id.startsWith('sessions.agentHost.') && context.contextMatchesRules(item.when))
			.map(item => item.command.id);
		const desktop = visible();
		phone.set(true);
		const mobile = visible();
		enabled.set(false);
		const disabled = visible();
		enabled.set(true);
		inDialog.set(false);
		assert.deepStrictEqual({ desktop, mobile, disabled, outsideDialog: visible() }, {
			desktop: ['sessions.agentHost.agentPicker'],
			mobile: ['sessions.agentHost.mobileChatInputConfigPicker'],
			disabled: [],
			outsideDialog: [],
		});
	});

	test('preserves explicit selection when a draft session graduates', () => {
		const state = new AgentPickerSelectionState();
		const draft = upcastPartial<ISession>({ resource: URI.parse('agent-host-copilotcli://draft') });
		const committed = upcastPartial<ISession>({ resource: URI.parse('agent-host-copilotcli://committed') });
		state.mark(draft);
		const transferred = state.transfer(draft, committed);

		assert.deepStrictEqual({
			transferred,
			draft: state.has(draft),
			committed: state.has(committed),
		}, {
			transferred: true,
			draft: false,
			committed: true,
		});
	});

	suite('agentHostAgentPickerStorageKey', () => {
		test('builds a per-scheme storage key', () => {
			assert.strictEqual(
				agentHostAgentPickerStorageKey('agent-host-copilotcli'),
				'workbench.agentsession.agentHostAgentPicker.agent-host-copilotcli.selectedAgentUri',
			);
		});
	});

	suite('resolveAgentHostAgent', () => {
		test('returns the session-selected agent when its URI is in the list', () => {
			assert.deepStrictEqual(resolveAgentHostAgent(agents, 'agent://b', undefined), beta);
		});

		test('falls back to the stored URI when the session has no selection', () => {
			assert.strictEqual(resolveAgentHostAgent(agents, undefined, 'agent://a'), alpha);
		});

		test('returns undefined when neither session nor stored selection matches the list', () => {
			assert.strictEqual(resolveAgentHostAgent(agents, undefined, 'agent://missing'), undefined);
			assert.strictEqual(resolveAgentHostAgent(agents, 'agent://missing', undefined), undefined);
		});

		test('session selection wins over stored selection', () => {
			assert.deepStrictEqual(resolveAgentHostAgent(agents, 'agent://a', 'agent://b'), alpha);
		});

		test('falls through to stored URI when the session agent URI is not in the list', () => {
			// The session's recorded selection is no longer in the effective
			// agent list (e.g. the customization providing it was removed),
			// so the stored fallback is consulted.
			assert.deepStrictEqual(resolveAgentHostAgent(agents, 'agent://gone', 'agent://a'), alpha);
		});

		test('returns undefined for an empty agent list', () => {
			assert.strictEqual(resolveAgentHostAgent([], 'agent://a', 'agent://a'), undefined);
			assert.strictEqual(resolveAgentHostAgent([], undefined, undefined), undefined);
		});
	});

	// Round-trip coverage for "restore the last selected Custom Agent": a user
	// selects a custom agent in a Copilot Agent Host session, opens a NEW
	// (untitled) session, and the new session pre-selects that same agent. This
	// mirrors AgentHostAgentPickerContribution's write rule (`_setAgent`, which
	// persists the pick per session-resource scheme) and its new-session seed
	// (`_initAgent`, which for an untitled session with no session-level
	// selection resolves the stored URI against the session's available agents),
	// using a real in-memory storage service as the ledger.
	suite('restore last selected custom agent on a new session (round-trip)', () => {
		// `agent-host-copilotcli` is the Copilot Agent Host session-resource scheme.
		const SCHEME = 'agent-host-copilotcli';

		function createStorage(): InMemoryStorageService {
			return store.add(new InMemoryStorageService());
		}

		// Mirrors `_setAgent`: persist the user's pick per scheme, or clear it when
		// the default "Agent" (no custom agent) is chosen.
		function selectAgent(storage: InMemoryStorageService, scheme: string, agent: AgentCustomization | undefined): void {
			const key = agentHostAgentPickerStorageKey(scheme);
			if (agent) {
				storage.store(key, agent.uri, StorageScope.PROFILE, StorageTarget.MACHINE);
			} else {
				storage.remove(key, StorageScope.PROFILE);
			}
		}

		// Mirrors `_initAgent` for a NEW untitled session (no session-level
		// selection): the seeded agent is resolved from the stored URI against the
		// session's available agents.
		function seedNewUntitledSession(storage: InMemoryStorageService, scheme: string, sessionAgents: readonly AgentCustomization[]): AgentCustomization | undefined {
			const storedUri = storage.get(agentHostAgentPickerStorageKey(scheme), StorageScope.PROFILE);
			return resolveAgentHostAgent(sessionAgents, undefined, storedUri);
		}

		// Mirrors `_initAgent` for an ESTABLISHED (non-untitled) session: the
		// per-scheme stored seed is deliberately NOT consulted (`storedUri`
		// undefined), so the session keeps its own persisted agent rather than
		// inheriting the shared new-session default.
		function seedEstablishedSession(sessionAgents: readonly AgentCustomization[], sessionAgentUri: string | undefined): AgentCustomization | undefined {
			return resolveAgentHostAgent(sessionAgents, sessionAgentUri, undefined);
		}

		test('a new Copilot Agent Host session restores the last selected custom agent', () => {
			const storage = createStorage();
			selectAgent(storage, SCHEME, beta);
			assert.deepStrictEqual(seedNewUntitledSession(storage, SCHEME, agents), beta);
		});

		test('selecting the default Agent clears the stored custom agent', () => {
			const storage = createStorage();
			selectAgent(storage, SCHEME, beta);
			selectAgent(storage, SCHEME, undefined);
			assert.strictEqual(seedNewUntitledSession(storage, SCHEME, agents), undefined);
		});

		test('an established (non-untitled) session is not seeded from the stored agent', () => {
			const storage = createStorage();
			selectAgent(storage, SCHEME, beta);
			// The stored seed exists and WOULD apply to a new untitled session...
			assert.deepStrictEqual(seedNewUntitledSession(storage, SCHEME, agents), beta);
			// ...but an established session ignores it and keeps its own agent
			// (here: the default Agent, i.e. no session-level selection).
			assert.strictEqual(seedEstablishedSession(agents, undefined), undefined);
		});

		test('a stored agent that is no longer available is ignored', () => {
			const storage = createStorage();
			selectAgent(storage, SCHEME, beta);
			// `beta` was removed from the workspace; only `alpha` remains, so the new
			// session falls back to the default "Agent" rather than a stale pick.
			assert.strictEqual(seedNewUntitledSession(storage, SCHEME, [alpha]), undefined);
		});

		test('the stored custom agent is scoped per session-resource scheme', () => {
			const storage = createStorage();
			selectAgent(storage, SCHEME, beta);
			// A different agent-host provider (e.g. Claude) does not inherit the pick.
			assert.strictEqual(seedNewUntitledSession(storage, 'agent-host-claude', agents), undefined);
		});
	});
});
