/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VsCodeTelemetryReporter from '@vscode/extension-telemetry';
import { basename, extname } from 'path';
import * as vscode from 'vscode';
import { Api, getExtensionApi } from './api';
import { CommandManager } from './commands/commandManager';
import { registerBaseCommands } from './commands/index';
import { TypeScriptServiceConfiguration } from './configuration/configuration';
import { BrowserServiceConfigurationProvider } from './configuration/configuration.browser';
import { ExperimentationTelemetryReporter, IExperimentationTelemetryReporter } from './experimentTelemetryReporter';
import { registerAtaSupport } from './filesystems/ata';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { Logger } from './logging/logger';
import RemoteRepositories from './remoteRepositories.browser';
import { API } from './tsServer/api';
import { noopRequestCancellerFactory } from './tsServer/cancellation';
import { noopLogDirectoryProvider } from './tsServer/logDirectoryProvider';
import { PluginManager } from './tsServer/plugins';
import { WorkerServerProcessFactory } from './tsServer/serverProcess.browser';
import { ITypeScriptVersionProvider, TypeScriptVersion, TypeScriptVersionSource } from './tsServer/versionProvider';
import { ActiveJsTsEditorTracker } from './ui/activeJsTsEditorTracker';
import { Disposable } from './utils/dispose';
import { getPackageInfo } from './utils/packageInfo';
import { isWebAndHasSharedArrayBuffers } from './utils/platform';

class StaticVersionProvider implements ITypeScriptVersionProvider {

	constructor(
		private readonly _version: TypeScriptVersion
	) { }

	updateConfiguration(_configuration: TypeScriptServiceConfiguration): void {
		// noop
	}

	get defaultVersion() { return this._version; }
	get bundledVersion() { return this._version; }

	readonly globalVersion = undefined;
	readonly localVersion = undefined;
	readonly localVersions = [];
}

export async function activate(context: vscode.ExtensionContext): Promise<Api> {
	const pluginManager = new PluginManager();
	context.subscriptions.push(pluginManager);

	const commandManager = new CommandManager();
	context.subscriptions.push(commandManager);

	const onCompletionAccepted = new vscode.EventEmitter<vscode.CompletionItem>();
	context.subscriptions.push(onCompletionAccepted);

	const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
	context.subscriptions.push(activeJsTsEditorTracker);

	const versionProvider = new StaticVersionProvider(
		new TypeScriptVersion(
			TypeScriptVersionSource.Bundled,
			vscode.Uri.joinPath(context.extensionUri, 'dist/browser/typescript/tsserver.web.js').toString(),
			API.fromSimpleString('5.9.0')));

	let experimentTelemetryReporter: IExperimentationTelemetryReporter | undefined;
	const packageInfo = getPackageInfo(context);
	if (packageInfo) {
		const { aiKey } = packageInfo;
		const vscTelemetryReporter = new VsCodeTelemetryReporter(aiKey);
		experimentTelemetryReporter = new ExperimentationTelemetryReporter(vscTelemetryReporter);
		context.subscriptions.push(experimentTelemetryReporter);
	}

	const logger = new Logger();

	const lazyClientHost = createLazyClientHost(context, false, {
		pluginManager,
		commandManager,
		logDirectoryProvider: noopLogDirectoryProvider,
		cancellerFactory: noopRequestCancellerFactory,
		versionProvider,
		processFactory: new WorkerServerProcessFactory(context.extensionUri, logger),
		activeJsTsEditorTracker,
		serviceConfigurationProvider: new BrowserServiceConfigurationProvider(),
		experimentTelemetryReporter,
		logger,
	}, item => {
		onCompletionAccepted.fire(item);
	});

	registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker);

	// context.subscriptions.push(task.register(lazyClientHost.map(x => x.serviceClient)));

	import('./languageFeatures/tsconfig').then(module => {
		context.subscriptions.push(module.register());
	});

	context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker, async () => {
		await startPreloadWorkspaceContentsIfNeeded(context, logger);
	}));
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('vscode-type-load', new MemFS(context.extensionUri), {
		isCaseSensitive: true,
		isReadonly: true,
	}));


	context.subscriptions.push(registerAtaSupport(logger));

	return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

async function startPreloadWorkspaceContentsIfNeeded(context: vscode.ExtensionContext, logger: Logger): Promise<void> {
	if (!isWebAndHasSharedArrayBuffers()) {
		return;
	}

	if (!vscode.workspace.workspaceFolders) {
		return;
	}

	await Promise.all(vscode.workspace.workspaceFolders.map(async folder => {
		const workspaceUri = folder.uri;
		if (workspaceUri.scheme !== 'vscode-vfs' || !workspaceUri.authority.startsWith('github')) {
			logger.info(`Skipped pre loading workspace contents for repository ${workspaceUri?.toString()}`);
			return;
		}

		const loader = new RemoteWorkspaceContentsPreloader(workspaceUri, logger);
		context.subscriptions.push(loader);
		try {
			await loader.triggerPreload();
		} catch (error) {
			console.error(error);
		}
	}));
}

class RemoteWorkspaceContentsPreloader extends Disposable {

	private _preload: Promise<void> | undefined;

	constructor(
		private readonly workspaceUri: vscode.Uri,
		private readonly logger: Logger,
	) {
		super();

		const fsWatcher = this._register(vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceUri, '*')));
		this._register(fsWatcher.onDidChange(uri => {
			if (uri.toString() === workspaceUri.toString()) {
				this._preload = undefined;
				this.triggerPreload();
			}
		}));
	}

	async triggerPreload() {
		this._preload ??= this.doPreload();
		return this._preload;
	}

	private async doPreload(): Promise<void> {
		try {
			const remoteHubApi = await RemoteRepositories.getApi();
			if (await remoteHubApi.loadWorkspaceContents?.(this.workspaceUri)) {
				this.logger.info(`Successfully loaded workspace content for repository ${this.workspaceUri.toString()}`);
			} else {
				this.logger.info(`Failed to load workspace content for repository ${this.workspaceUri.toString()}`);
			}
		} catch (error) {
			this.logger.info(`Loading workspace content for repository ${this.workspaceUri.toString()} failed: ${error instanceof Error ? error.toString() : 'Unknown reason'}`);
			console.error(error);
		}
	}
}


class MemFS implements vscode.FileSystemProvider {

	private readonly statCache = new ResourceMap<Promise<vscode.FileStat | undefined>>(undefined, { onCaseInsensitiveFileSystem: false });

	constructor(
		_extensionUri: vscode.Uri
	) { }

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const requestUri = this.toExtensionUri(uri);
		if (!requestUri) {
			throw vscode.FileSystemError.FileNotFound();
		}

		let entry = this.statCache.get(requestUri);
		if (!entry) {
			entry = (async () => {
				const fullName = requestUri.toString();
				const r = await fetch(fullName, { method: 'HEAD', });
				if (!r.ok) {
					return undefined;
				}
				return { size: 0, type: extname(fullName) ? vscode.FileType.File : vscode.FileType.Directory, ctime: 0, mtime: 0 };
			})();
			this.statCache.set(requestUri, entry);
		}

		const result = await entry;
		if (!result) {
			throw vscode.FileSystemError.FileNotFound();
		}

		return result;
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const requestUri = this.toExtensionUri(uri);
		if (!requestUri) {
			throw vscode.FileSystemError.FileNotFound();
		}

		const file = await fetch(requestUri.toString());
		const json = await file.json();

		return json.map((fullName: string) => {
			const base = basename(fullName);
			return [base, fullName.endsWith('/') ? vscode.FileType.Directory : vscode.FileType.File];
		});
	}

	readFile(uri: vscode.Uri): Thenable<Uint8Array> {
		const requestUri = this.toExtensionUri(uri);
		if (!requestUri) {
			throw vscode.FileSystemError.FileNotFound();
		}

		return vscode.workspace.fs.readFile(requestUri);
	}

	writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
		throw new Error('not implemented');
	}

	rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
		throw new Error('not implemented');
	}

	delete(_uri: vscode.Uri): void {
		throw new Error('not implemented');
	}

	createDirectory(_uri: vscode.Uri): void {
		throw new Error('not implemented');
	}

	private toExtensionUri(incomingUri: vscode.Uri): vscode.Uri | undefined {
		// Incoming: vscode-type-load://ts-null-authority/node_modules/bla
		// Outgoing: https://bierner.vscode-unpkg.net/bierner/vscode-type-load/0.0.2/extension/node_modules/bla

		// TS generates a lot of non-sense fs requests. Try to filter those out before we make an actual network request

		// Only allow reading in node_modules
		if (!incomingUri.path.startsWith('/node_modules')) {
			return undefined;
		}

		// Only allow reading .json and .d.ts files (and directories)
		const ext = extname(incomingUri.path);
		if (ext) {
			const lowerPath = incomingUri.path.toLowerCase();
			if (!lowerPath.endsWith('.d.ts') && !lowerPath.endsWith('.json')) {
				return undefined;
			}
		}

		// Block /node_modules/file.d.ts and /node_modules/@types/file.d.ts
		if (
			/^\/node_modules\/[\w-_%]*\.[\w\.]*/i.test(incomingUri.path) ||
			/^\/node_modules\/@types\/[\w-_%]*\.[\w\.]*/i.test(incomingUri.path)
		) {
			return undefined;
		}

		return vscode.Uri.from({
			scheme: 'https',
			authority: 'bierner.vscode-unpkg.net',
			path: '/bierner/vscode-type-load/0.0.2/extension' + incomingUri.path
		});
	}

	// --- manage file events

	private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}
}
