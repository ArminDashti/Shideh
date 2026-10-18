/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Tunnel } from '@microsoft/dev-tunnels-contracts';
import type { TunnelManagementHttpClient } from '@microsoft/dev-tunnels-management';
import type WebSocket from 'ws';
import { raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import {
	PendingGatewaySelection,
	TunnelAgentHostConnector,
	parseTunnelInfo,
	type ITunnelDescriptor,
	type ITunnelRelayClient,
	type ITunnelRelayClientFactory,
	type ITunnelRelayClientSession,
	type ITunnelSocketFactory,
} from '../common/tunnelAgentHostConnector.js';
import {
	ITunnelAgentHostMainService,
	TUNNEL_AGENT_HOST_PORT,
	TUNNEL_LAUNCHER_LABEL,
	type ITunnelConnectResult,
	type ITunnelGatewaySelection,
	type ITunnelGatewaySelectionSession,
	type ITunnelInfo,
	type ITunnelRelayMessage,
} from '../common/tunnelAgentHost.js';
import type { ITunnelDuplexStream, ITunnelMessageSocket, ITunnelSocketCloseEvent } from '../common/tunnelMessageSocket.js';

const LOG_PREFIX = '[TunnelAgentHost]';

export { PendingGatewaySelection, TUNNEL_STEP_TIMEOUT_MS, withTimeout } from '../common/tunnelAgentHostConnector.js';

export interface ITunnelManagementListOptions {
	readonly labels?: string[];
	readonly requireAllLabels?: boolean;
	readonly includePorts?: boolean;
	readonly tokenScopes?: string[];
	readonly limit?: number;
}

export interface ITunnelManagementClient {
	listTunnels(clusterId?: string, domain?: string, options?: ITunnelManagementListOptions, cancellationToken?: CancellationToken): Promise<readonly ITunnelDescriptor[]>;
}

export async function listAgentHostTunnels(
	client: ITunnelManagementClient,
	additionalTunnelNames: readonly string[] | undefined,
	logService: ILogService,
	cancellationToken: CancellationToken = CancellationToken.None,
): Promise<ITunnelInfo[]> {
	const results: ITunnelInfo[] = [];
	const seen = new Set<string>();
	const tunnels = await client.listTunnels(undefined, undefined, {
		labels: [TUNNEL_LAUNCHER_LABEL],
		requireAllLabels: true,
		includePorts: true,
		tokenScopes: ['connect'],
	}, cancellationToken);
	for (const tunnel of tunnels) {
		const info = parseTunnelInfo(tunnel);
		if (info && !seen.has(info.tunnelId)) {
			results.push(info);
			seen.add(info.tunnelId);
		}
	}

	for (const tunnelName of additionalTunnelNames ?? []) {
		const [tunnel] = await client.listTunnels(undefined, undefined, {
			labels: [tunnelName, TUNNEL_LAUNCHER_LABEL],
			requireAllLabels: true,
			includePorts: true,
			tokenScopes: ['connect'],
			limit: 1,
		}, cancellationToken);
		if (!tunnel) {
			continue;
		}
		const info = parseTunnelInfo(tunnel);
		if (info && !seen.has(info.tunnelId)) {
			results.push(info);
			seen.add(info.tunnelId);
		}
	}

	logService.info(`${LOG_PREFIX} Found ${results.length} tunnel(s) with agent host support`);
	return results;
}

interface INodeTunnelRelayClient {
	acceptLocalConnectionsForForwardedPorts: boolean;
	endpoints?: Tunnel['endpoints'];
	connect(tunnel: Tunnel, options?: undefined, cancellationToken?: CancellationToken): Promise<void>;
	waitForForwardedPort(port: number, cancellationToken?: CancellationToken): Promise<void>;
	connectToForwardedPort(port: number, cancellationToken?: CancellationToken): Promise<NodeJS.ReadWriteStream>;
	dispose(): void;
}

class NodeTunnelRelayClient implements ITunnelRelayClient {
	constructor(
		private readonly _relayClient: INodeTunnelRelayClient,
		private readonly _tunnel: Tunnel,
	) {
	}

	connect(cancellationToken?: CancellationToken): Promise<void> {
		return this._relayClient.connect(this._tunnel, undefined, cancellationToken);
	}

	waitForForwardedPort(port: number, cancellationToken?: CancellationToken): Promise<void> {
		return this._relayClient.waitForForwardedPort(port, cancellationToken);
	}

	async connectToForwardedPort(port: number, cancellationToken?: CancellationToken): Promise<ITunnelDuplexStream> {
		return await this._relayClient.connectToForwardedPort(port, cancellationToken) as unknown as ITunnelDuplexStream;
	}

	dispose(): void {
		this._relayClient.dispose();
	}
}

class NodeTunnelRelayClientFactory implements ITunnelRelayClientFactory {
	constructor(
		private readonly _createManagementClient: (token: string, authProvider: 'github' | 'microsoft') => Promise<TunnelManagementHttpClient>,
	) {
	}

	async getTunnel(tunnelId: string, clusterId: string, authProvider: 'github' | 'microsoft', token: string, cancellationToken: CancellationToken = CancellationToken.None): Promise<ITunnelRelayClientSession | undefined> {
		const managementClient = await raceCancellationError(this._createManagementClient(token, authProvider), cancellationToken);
		const resolved = await managementClient.getTunnel({ tunnelId, clusterId }, {
			includePorts: true,
			tokenScopes: ['connect'],
		}, cancellationToken);
		if (!resolved) {
			return undefined;
		}

		return {
			tunnel: resolved,
			createRelayClient: async () => {
				const { TunnelRelayTunnelClient } = await import('@microsoft/dev-tunnels-connections');
				const relayClient = new TunnelRelayTunnelClient(managementClient) as INodeTunnelRelayClient;
				relayClient.acceptLocalConnectionsForForwardedPorts = false;
				if (resolved.endpoints) {
					relayClient.endpoints = resolved.endpoints;
				}
				return new NodeTunnelRelayClient(relayClient, resolved);
			},
		};
	}
}

class NodeTunnelMessageSocket extends Disposable implements ITunnelMessageSocket {
	private readonly _onDidReceiveMessage = this._register(new Emitter<string>());
	readonly onDidReceiveMessage: Event<string> = this._onDidReceiveMessage.event;

	private readonly _onDidReceiveData = this._register(new Emitter<void>());
	readonly onDidReceiveData: Event<void> = this._onDidReceiveData.event;

	private readonly _onDidClose = this._register(new Emitter<ITunnelSocketCloseEvent>());
	readonly onDidClose: Event<ITunnelSocketCloseEvent> = this._onDidClose.event;

	constructor(private readonly _socket: WebSocket, stream: ITunnelDuplexStream) {
		super();
		const onMessage = (data: WebSocket.RawData) => this._onDidReceiveMessage.fire(rawGatewayDataToString(data));
		const onData = () => this._onDidReceiveData.fire();
		const onClose = (code: number, reason: Buffer) => this._onDidClose.fire({ code, reason: reason?.toString() || undefined });
		const onError = (error: Error) => this._onDidClose.fire({ error });
		this._socket.on('message', onMessage);
		// ws subscribed to 'data' before emitting 'open', so this runs after it fires any message the chunk completes.
		stream.on('data', onData);
		this._socket.on('close', onClose);
		this._socket.on('error', onError);
		this._register(toDisposable(() => {
			this._socket.off('message', onMessage);
			stream.removeListener('data', onData);
			this._socket.off('close', onClose);
			this._socket.off('error', onError);
		}));
	}

	async send(data: string): Promise<void> {
		if (this._socket.readyState !== this._socket.OPEN) {
			throw new Error(`WebSocket is not open (readyState ${this._socket.readyState})`);
		}
		await new Promise<void>((resolve, reject) => {
			this._socket.send(data, error => error ? reject(error) : resolve());
		});
	}

	close(): void {
		this._socket.close();
	}

	override dispose(): void {
		super.dispose();
	}
}

/** Opens `ws` WebSockets over dev tunnel relay streams. Exported for tests. */
export class NodeTunnelSocketFactory implements ITunnelSocketFactory {
	async open(stream: ITunnelDuplexStream, path: string): Promise<ITunnelMessageSocket> {
		const WS = await import('ws');
		return new Promise((resolve, reject) => {
			const url = `ws://localhost:${TUNNEL_AGENT_HOST_PORT}${path}`;
			const options = {
				createConnection: (() => stream) as unknown as WebSocket.ClientOptions['createConnection'],
			};
			const socket = this._createSocket?.(url, options) ?? new WS.WebSocket(url, options);
			let settled = false;
			let cancellationListener: IDisposable | undefined;
			const cleanupHandshake = () => {
				socket.off('open', onOpen);
				cancellationListener?.dispose();
				cancellationListener = undefined;
			};
			const cleanupTerminal = () => {
				cleanupHandshake();
				socket.off('error', onError);
				socket.off('close', onClose);
			};
			const onError = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanupHandshake();
				reject(error);
			};
			const onClose = () => {
				if (!settled) {
					settled = true;
					reject(new Error(`${LOG_PREFIX} WebSocket closed during handshake`));
				}
				cleanupTerminal();
			};
			const onOpen = () => {
				socket.off('error', onError);
				resolve(new NodeTunnelMessageSocket(socket, stream));
			};
			socket.once('open', onOpen);
			socket.on('error', onError);
			socket.once('close', onClose);
			cancellationListener = cancellationToken.onCancellationRequested(() => {
				if (settled) {
					return;
				}
				settled = true;
				cleanupHandshake();
				socket.terminate();
				reject(new CancellationError());
			});
		});
	}
}

function rawGatewayDataToString(data: WebSocket.RawData): string {
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString();
	} else if (data instanceof ArrayBuffer) {
		return Buffer.from(new Uint8Array(data)).toString();
	}
	return data.toString();
}

export class TunnelAgentHostMainService extends Disposable implements ITunnelAgentHostMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _connector: TunnelAgentHostConnector;

	readonly onDidRelayMessage: Event<ITunnelRelayMessage>;
	readonly onDidRelayActivity: Event<string>;
	readonly onDidRelayClose: Event<string>;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._connector = this._register(new TunnelAgentHostConnector(
			new NodeTunnelRelayClientFactory((token, authProvider) => this._createManagementClient(token, authProvider)),
			new NodeTunnelSocketFactory(),
			this._logService,
		));
		this.onDidRelayMessage = this._connector.onDidRelayMessage;
		this.onDidRelayActivity = this._connector.onDidRelayActivity;
		this.onDidRelayClose = this._connector.onDidRelayClose;
	}

	async listTunnels(token: string, authProvider: 'github' | 'microsoft', additionalTunnelNames?: string[], cancellationToken: CancellationToken = CancellationToken.None): Promise<ITunnelInfo[]> {
		const client = await raceCancellationError(this._createManagementClient(token, authProvider), cancellationToken);
		return listAgentHostTunnels(client, additionalTunnelNames, this._logService, cancellationToken);
	}

	async deleteTunnel(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string, cancellationToken: CancellationToken = CancellationToken.None): Promise<void> {
		const client = await raceCancellationError(this._createManagementClient(token, authProvider), cancellationToken);
		this._logService.info(`${LOG_PREFIX} Deleting tunnel ${tunnelId} in cluster ${clusterId}...`);
		await client.deleteTunnel({ tunnelId, clusterId }, undefined, cancellationToken);
		this._connector.closeTunnelConnections(tunnelId, 'deleting');
		this._logService.info(`${LOG_PREFIX} Deleted tunnel ${tunnelId}`);
	}

	connect(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string, cancellationToken: CancellationToken = CancellationToken.None): Promise<ITunnelConnectResult> {
		return this._connector.connect(token, authProvider, tunnelId, clusterId, cancellationToken);
	}

	prepareSelection(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string, cancellationToken: CancellationToken = CancellationToken.None): Promise<ITunnelGatewaySelectionSession | undefined> {
		return this._connector.prepareSelection(token, authProvider, tunnelId, clusterId, cancellationToken);
	}

	completeSelection(selectionId: string, selection: ITunnelGatewaySelection, cancellationToken: CancellationToken = CancellationToken.None): Promise<ITunnelConnectResult> {
		return this._connector.completeSelection(selectionId, selection, cancellationToken);
	}

	cancelSelection(selectionId: string): Promise<void> {
		return this._connector.cancelSelection(selectionId);
	}

	relaySend(connectionId: string, message: string): Promise<void> {
		return this._connector.relaySend(connectionId, message);
	}

	disconnect(connectionId: string): Promise<void> {
		return this._connector.disconnect(connectionId);
	}

	private async _createManagementClient(token: string, authProvider: 'github' | 'microsoft'): Promise<TunnelManagementHttpClient> {
		const management = await import('@microsoft/dev-tunnels-management');
		const authHeader = authProvider === 'github' ? `github ${token}` : `Bearer ${token}`;
		return new management.TunnelManagementHttpClient(
			'vscode-sessions',
			management.ManagementApiVersions.Version20230927preview,
			async () => authHeader,
		);
	}
}

/**
 * Registers a pending gateway selection directly for node service tests.
 */
export function setPendingGatewaySelectionForTests(
	service: TunnelAgentHostMainService,
	selectionId: string,
	pending: PendingGatewaySelection,
): void {
	(service as unknown as { _connector: TunnelAgentHostConnector })._connector.setPendingGatewaySelectionForTests(selectionId, pending);
}

/**
 * Removes and disposes a pending gateway selection directly for node service tests.
 */
export function deletePendingGatewaySelectionForTests(
	service: TunnelAgentHostMainService,
	selectionId: string,
): void {
	(service as unknown as { _connector: TunnelAgentHostConnector })._connector.deletePendingGatewaySelectionForTests(selectionId);
}
