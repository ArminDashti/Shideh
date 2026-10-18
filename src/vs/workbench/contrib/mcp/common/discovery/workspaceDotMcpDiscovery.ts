/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { isEqual, joinPath } from '../../../../../base/common/resources.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { parseWorkspaceRootMcpConfiguration, WORKSPACE_ROOT_MCP_COLLECTION_ID_PREFIX, WORKSPACE_ROOT_MCP_CONFIG_FILE } from '../../../../../platform/mcp/common/mcpWorkspaceConfiguration.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { IMcpRegistry } from '../mcpRegistryTypes.js';
import { McpCollectionProvenance, McpCollectionSortOrder, McpServerDefinition, McpServerTrust } from '../mcpTypes.js';
import { IMcpDiscovery } from './mcpDiscovery.js';
import { claudeConfigToServerDefinition } from './nativeMcpDiscoveryAdapters.js';

/** Discovers workspace-root `.mcp.json` files, which inherit workspace trust. */
export class WorkspaceDotMcpDiscovery extends Disposable implements IMcpDiscovery {
	readonly fromGallery = false;

	private readonly _collections = this._register(new DisposableMap<string, IDisposable>());
	private readonly _telemetryByFolder = new Map<string, IMcpDiscoveryTelemetrySnapshot | undefined>();
	private readonly _folderGenerations = new Map<string, number>();
	private readonly _telemetrySnapshot = observableValue<IMcpDiscoveryTelemetrySnapshot | undefined>(this, undefined);
	readonly telemetrySnapshot = this._telemetrySnapshot;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IMcpRegistry private readonly _mcpRegistry: IMcpRegistry,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
	) {
		super();
	}

	start(): void {
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(e => {
			for (const removed of [...e.removed, ...e.changed]) {
				this._collections.deleteAndDispose(removed.uri.toString());
			}
			for (const added of e.added) {
				this._watchFolder(added);
			}
			for (const changed of e.changed) {
				const current = this._workspaceContextService.getWorkspace().folders.find(folder => isEqual(folder.uri, changed.uri));
				if (current) {
					this._watchFolder(current);
				}
			}
		}));

		for (const folder of this._workspaceContextService.getWorkspace().folders) {
			this._watchFolder(folder);
		}
		if (this._workspaceContextService.getWorkspace().folders.length === 0) {
			this._telemetrySnapshot.set({ candidates: [], configurations: [] }, undefined);
		}
	}

	private _watchFolder(folder: IWorkspaceFolder) {
		const configFile = joinPath(folder.uri, WORKSPACE_ROOT_MCP_CONFIG_FILE);
		const collectionId = `${WORKSPACE_ROOT_MCP_COLLECTION_ID_PREFIX}${folder.index}`;
		const serverDefinitions = observableValue<readonly McpServerDefinition[]>(this, []);

		const collection = {
			id: collectionId,
			provenance: McpCollectionProvenance.WorkspaceDotMcp,
			label: `${folder.name}/.mcp.json`,
			remoteAuthority: this._remoteAgentService.getConnection()?.remoteAuthority || null,
			scope: StorageScope.WORKSPACE,
			trustBehavior: McpServerTrust.Kind.Trusted as const,
			serverDefinitions,
			configTarget: ConfigurationTarget.WORKSPACE_FOLDER,
			order: McpCollectionSortOrder.WorkspaceFolder + 1,
			discovery: {
				source: McpDiscoverySource.WorkspaceDotMcp,
				format: McpDiscoveryFormat.ClaudeMcpServers,
				scope: McpDiscoveryScope.WorkspaceFolder,
				host: mcpHost(this._remoteAgentService.getConnection()?.remoteAuthority),
			},
			presentation: {
				origin: configFile,
			},
		};

		const store = new DisposableStore();
		const collectionRegistration = store.add(new MutableDisposable());
		let updateSequence = 0;
		let isLazyCollection = true;

		const updateFile = async () => {
			const sequence = updateSequence;
			let definitions: McpServerDefinition[] = [];
			let configurationPresent = 0;
			let parseErrorCount = 0;
			let unreadableCount = 0;
			try {
				const contents = await this._fileService.readFile(configFile);
				const { servers } = parseWorkspaceRootMcpConfiguration(contents.value.toString());
				const defs = await claudeConfigToServerDefinition(collectionId, VSBuffer.fromString(JSON.stringify({ mcpServers: servers })), { defaultCwd: folder.uri });
				if (defs) {
					for (const d of defs) {
						d.roots = [folder.uri];
					}
					definitions = defs;
				}
			}
			if (!isCurrent()) {
				return;
			}
			const host = mcpHost(this._remoteAgentService.getConnection()?.remoteAuthority);
			this._telemetryByFolder.set(telemetryKey, {
				candidates: definitions.map(() => mcpCandidate(McpDiscoverySource.WorkspaceDotMcp, McpDiscoveryFormat.ClaudeMcpServers, McpDiscoveryScope.WorkspaceFolder, host, 'loaded')).concat(
					parseErrorCount ? [mcpCandidate(McpDiscoverySource.WorkspaceDotMcp, McpDiscoveryFormat.ClaudeMcpServers, McpDiscoveryScope.WorkspaceFolder, host, 'parseError')] : [],
					unreadableCount ? [mcpCandidate(McpDiscoverySource.WorkspaceDotMcp, McpDiscoveryFormat.ClaudeMcpServers, McpDiscoveryScope.WorkspaceFolder, host, 'unreadable')] : [],
				),
				configurations: [{
					source: McpDiscoverySource.WorkspaceDotMcp,
					format: McpDiscoveryFormat.ClaudeMcpServers,
					scope: McpDiscoveryScope.WorkspaceFolder,
					host,
					configurationPresent,
					configuredEntryCount: definitions.length,
					parseErrorCount,
					unreadableCount,
				}],
			});
			this._publishTelemetry();

			if (sequence !== updateSequence || store.isDisposed) {
				return;
			}
			if (!definitions.length) {
				collectionRegistration.clear();
			} else {
				serverDefinitions.set(definitions, undefined);
				if (isLazyCollection || !collectionRegistration.value) {
					isLazyCollection = false;
					collectionRegistration.value = this._mcpRegistry.registerCollection(collection);
				}
			}
		};

		const throttler = store.add(new RunOnceScheduler(updateFile, 500));
		const watcher = store.add(this._fileService.createWatcher(configFile, { recursive: false, excludes: [] }));
		store.add(watcher.onDidChange(() => {
			updateSequence++;
			throttler.schedule();
		}));
		let initialUpdate: Promise<void> | undefined;
		const loadInitial = () => initialUpdate ??= updateFile();
		collectionRegistration.value = this._mcpRegistry.registerCollection({
			...collection,
			lazy: {
				isCached: false,
				load: loadInitial,
			},
		});
		void loadInitial();

		this._collections.set(folder.uri.toString(), store);
	}

	private _publishTelemetry(): void {
		const snapshots = [...this._telemetryByFolder.values()];
		if (snapshots.some(snapshot => snapshot === undefined)) {
			return;
		}
		this._telemetrySnapshot.set({
			candidates: snapshots.flatMap(snapshot => snapshot?.candidates ?? []),
			configurations: snapshots.flatMap(snapshot => snapshot?.configurations ?? []),
		}, undefined);
	}
}
