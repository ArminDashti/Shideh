/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IReference } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import type { IPersistedTurnRecord, ISessionDatabase, ISessionDataService } from '../common/sessionDataService.js';
import type { Turn } from '../common/state/sessionState.js';

export const IAgentHostLocalTurns = createDecorator<IAgentHostLocalTurns>('agentHostLocalTurns');

type ILocalPersistedTurnRecord = IPersistedTurnRecord & { readonly kind: 'local'; readonly seq: number };

export interface IAgentHostLocalTurns {
	readonly _serviceBrand: undefined;

	/** Whether `turnId` is a known host-injected local turn in `chat`. */
	isLocal(chat: string, turnId: string): boolean;
	/**
	 * Resolves the anchor a host-injected turn must be recorded against: the
	 * nearest preceding turn in `chat` that the agent SDK actually owns.
	 */
	findAnchorTurnId(chat: string, turns: readonly Turn[], turnId: string): string | undefined;
	/** Records `turn` as a host-injected local turn anchored to `anchorTurnId`. */
	record(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): void;
	/** Records a local turn and rejects if it cannot be persisted. Updating a turn preserves its order. */
	recordAndWait(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): Promise<void>;
}

/**
 * Tracks host-injected ("local") turns — completed protocol turns the agent SDK
 * never saw, such as the `/rename` acknowledgement or a `!command` terminal run.
 *
 * These turns exist only in the agent host: they are never forwarded to the
 * agent SDK, so they are absent from the SDK transcript that
 * {@link AgentService} replays on restore. This registry persists them (so they
 * survive reload) and remembers, for each, the id of the preceding concrete
 * (SDK-backed) turn — the *anchor* — so that fork/truncate operations targeting
 * a local turn can be redirected to the concrete SDK message before it.
 *
 * Everything is scoped to a **chat** (its channel URI): a session's default
 * chat and each of its peer chats are handled identically. Persistence lives in
 * the owning session's database (one per session, shared across its chats),
 * discriminated by {@link IPersistedTurnRecord.chatUri}.
 */
export class AgentHostLocalTurns implements IAgentHostLocalTurns {
	declare readonly _serviceBrand: undefined;

	/** chat URI → (localTurnId → { anchorTurnId, seq, modelContext }). */
	private readonly _byChat = new Map<string, Map<string, { readonly anchorTurnId: string | undefined; readonly seq: number; readonly modelContext: string | undefined }>>();
	/** session URI → highest `seq` assigned so far (seq is session-global for stable ordering). */
	private readonly _seqBySession = new Map<string, number>();

	constructor(
		private readonly _sessionDataService: ISessionDataService,
		private readonly _logService: ILogService,
	) { }

	/** Whether `turnId` is a known host-injected local turn in `chat`. */
	isLocal(chat: string, turnId: string): boolean {
		return this._byChat.get(chat)?.has(turnId) ?? false;
	}

	/** All known local turn ids for `chat`. */
	getLocalTurnIds(chat: string): string[] {
		const map = this._byChat.get(chat);
		return map ? [...map.keys()] : [];
	}

	/**
	 * Resolves `turnId` to the concrete (SDK-backed) turn a fork/truncate should
	 * operate on within `chat`. For a local turn this is its anchor (the
	 * preceding real turn, or `undefined` when it precedes any real turn); for a
	 * concrete turn it is the turn itself.
	 */
	resolveConcreteTurnId(chat: string, turnId: string): string | undefined {
		const entry = this._byChat.get(chat)?.get(turnId);
		return entry ? entry.anchorTurnId : turnId;
	}

	/**
	 * Returns the model-facing context contributed by the local turn `turnId` in
	 * `chat`, or `undefined` when it is not a local turn or contributes nothing.
	 */
	getModelContext(chat: string, turnId: string): string | undefined {
		return this._byChat.get(chat)?.get(turnId)?.modelContext;
	}

	/**
	 * Collects the model-facing context of the *pending* local turns in `chat`:
	 * the trailing local turns in `turns` (the completed transcript), i.e. those
	 * recorded after the last concrete (SDK-backed) turn and not yet followed by
	 * a real message, so the model has not seen them. The in-flight real message
	 * being sent is not part of `turns` (it lives in the active turn), so the
	 * pending locals are exactly the trailing ones. Returned in chronological
	 * order so callers can prepend them to the next real message.
	 */
	collectPendingModelContext(chat: string, turns: readonly Turn[]): string[] {
		const map = this._byChat.get(chat);
		if (!map) {
			return [];
		}
		const contexts: string[] = [];
		for (let i = turns.length - 1; i >= 0; i--) {
			const entry = map.get(turns[i].id);
			if (!entry) {
				// Hit a concrete turn the model has already seen — stop.
				break;
			}
			if (entry.modelContext !== undefined) {
				contexts.unshift(entry.modelContext);
			}
		}
		return contexts;
	}

	/**
	 * Persist a local turn and remember it in memory. `anchorTurnId` is the id
	 * of the preceding concrete turn in `chat` (or `undefined` when there is
	 * none). `session` identifies the database to persist into. `modelContext`,
	 * when provided, is prepended to the next real message so the model learns
	 * what the user did out-of-band.
	 */
	record(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): void {
		void this.recordAndWait(session, chat, turn, anchorTurnId).catch(error => {
			this._logService.warn(`[AgentHostLocalTurns] Failed to persist local turn ${turn.id}`, error);
		});
	}

	async recordAndWait(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): Promise<void> {
		const seq = this._byChat.get(chat)?.get(turn.id)?.seq ?? (this._seqBySession.get(session) ?? 0) + 1;
		this._noteInMemory(session, chat, turn.id, anchorTurnId, seq);
		const record: IPersistedTurnRecord = { kind: 'local', turnId: turn.id, chatUri: chat, anchorTurnId, seq, payload: JSON.stringify(turn) };
		let ref: IReference<ISessionDatabase>;
		try {
			await ref.object.insertLocalTurn(record);
		} finally {
			ref.dispose();
		}
		ref.object.insertPersistedTurn(record).catch(err => {
			this._logService.warn(`[AgentHostLocalTurns] Failed to persist local turn ${turn.id}`, err);
		}).finally(() => ref.dispose());
	}

	/**
	 * Resolves the anchor a host-injected turn must be recorded against: the
	 * nearest preceding turn in `chat` that the agent SDK actually owns, or
	 * `undefined` when the turn precedes every concrete turn.
	 */
	findAnchorTurnId(chat: string, turns: readonly Turn[], turnId: string): string | undefined {
		for (let i = turns.findIndex(turn => turn.id === turnId) - 1; i >= 0; i--) {
			if (!this.isLocal(chat, turns[i].id)) {
				return turns[i].id;
			}
		}
		return undefined;
	}

	/**
	 * Loads persisted local turns for `session`, populating the in-memory index
	 * (keyed by each record's chat), and returns the records for `chat` in
	 * `seq` order so the caller can interleave them into that chat's SDK-derived
	 * turns during restore.
	 */
	async loadForChat(session: string, chat: string): Promise<ILocalPersistedTurnRecord[]> {
		const records = await this._load(session);
		return records.filter(r => r.chatUri === chat);
	}

	/** Delete the given local turns from memory and the session database. */
	deleteLocals(session: string, turnIds: readonly string[]): void {
		if (turnIds.length === 0) {
			return;
		}
		const idSet = new Set(turnIds);
		for (const map of this._byChat.values()) {
			for (const id of idSet) {
				map.delete(id);
			}
		}
		let ref: IReference<ISessionDatabase>;
		try {
			ref = this._sessionDataService.openDatabase(URI.parse(session));
		} catch (err) {
			this._logService.warn(`[AgentHostLocalTurns] Failed to open database to delete local turns for ${session}`, err);
			return;
		}
		ref.object.deletePersistedTurns(turnIds).catch(err => {
			this._logService.warn(`[AgentHostLocalTurns] Failed to delete local turns for ${session}`, err);
		}).finally(() => ref.dispose());
	}

	/** Drop all in-memory state for a chat. */
	forgetChat(chat: string): void {
		this._byChat.delete(chat);
	}

	private async _load(session: string): Promise<ILocalPersistedTurnRecord[]> {
		const ref = this._sessionDataService.tryOpenDatabase?.(URI.parse(session));
		if (!ref) {
			return [];
		}
		try {
			const db = await ref;
			if (!db) {
				return [];
			}
			try {
				const persisted = await db.object.getPersistedTurns();
				for (const record of persisted) {
					this._seqBySession.set(session, Math.max(this._seqBySession.get(session) ?? 0, record.seq));
					if (record.kind === 'local') {
						this._noteInMemory(session, record.chatUri, record.turnId, record.anchorTurnId, record.seq);
					}
				}
				return persisted.filter((record): record is ILocalPersistedTurnRecord => record.kind === 'local');
			} finally {
				db.dispose();
			}
		} catch (err) {
			this._logService.warn(`[AgentHostLocalTurns] Failed to load local turns for ${session}`, err);
			return [];
		}
	}

	private _noteInMemory(session: string, chat: string, turnId: string, anchorTurnId: string | undefined, seq: number, modelContext: string | undefined): void {
		let map = this._byChat.get(chat);
		if (!map) {
			map = new Map();
			this._byChat.set(chat, map);
		}
		map.set(turnId, { anchorTurnId, seq, modelContext });
		this._seqBySession.set(session, Math.max(this._seqBySession.get(session) ?? 0, seq));
	}
}

/** Deserializes a host-persisted turn while preserving its complete payload. */
export function parsePersistedTurn(record: IPersistedTurnRecord, logService: ILogService, source: string): Turn | undefined {
	let value: unknown;
	try {
		value = JSON.parse(record.payload);
	} catch (error) {
		logService.warn(`[${source}] Ignoring unreadable persisted turn ${record.turnId}`, error);
		return undefined;
	}
	if (!isPersistedTurn(value) || value.id !== record.turnId) {
		logService.warn(`[${source}] Ignoring malformed persisted turn ${record.turnId}`);
		return undefined;
	}
	return value;
}

function isPersistedTurn(value: unknown): value is Turn {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& isRecord(value.message)
		&& typeof value.message.text === 'string'
		&& isRecord(value.message.origin)
		&& typeof value.message.origin.kind === 'string'
		&& Array.isArray(value.responseParts)
		&& typeof value.state === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
