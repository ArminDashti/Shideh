/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { delta as arrayDelta, mapArrayOrNot } from '../../../base/common/arrays.js';
import { AsyncIterableProducer, Barrier } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { AsyncEmitter, Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { Schemas } from '../../../base/common/network.js';
import { Counter } from '../../../base/common/numbers.js';
import { basename, basenameOrAuthority, dirname, ExtUri, relativePath } from '../../../base/common/resources.js';
import { compare } from '../../../base/common/strings.js';
import { isUriComponents, URI, UriComponents } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { FileSystemProviderCapabilities } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Severity } from '../../../platform/notification/common/notification.js';
import { EditSessionIdentityMatch } from '../../../platform/workspace/common/editSessions.js';
import { Workspace, WorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import { IExtHostFileSystemInfo } from './extHostFileSystemInfo.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { GlobPattern } from './extHostTypeConverters.js';
import { Range } from './extHostTypes.js';
import { IURITransformerService } from './extHostUriTransformerService.js';
import { IFileQueryBuilderOptions, ISearchPatternBuilder, ITextQueryBuilderOptions } from '../../services/search/common/queryBuilder.js';
import { IRawFileMatch2, ITextSearchResult, resultIsMatch } from '../../services/search/common/search.js';
import type * as vscode from 'vscode';
import { ExtHostWorkspaceShape, IRelativePatternDto, IWorkspaceData, MainContext, MainThreadMessageOptions, MainThreadMessageServiceShape, MainThreadTelemetryShape, MainThreadWorkspaceShape } from './extHost.protocol.js';
import { revive } from '../../../base/common/marshalling.js';
import { AuthInfo, Credentials } from '../../../platform/request/common/request.js';
import { ExcludeSettingOptions, TextSearchContext2, TextSearchMatch2 } from '../../services/search/common/searchExtTypes.js';
import { bufferToStream, readableToBuffer, VSBuffer } from '../../../base/common/buffer.js';
import { toDecodeStream, toEncodeReadable, UTF8 } from '../../services/textfile/common/encoding.js';
import { consumeStream } from '../../../base/common/stream.js';
import { stringToSnapshot } from '../../services/textfile/common/textfiles.js';
// Type-only import to avoid a runtime cycle with extHostConfiguration.ts.
import type { ExtHostConfigProvider } from './extHostConfiguration.js';

export interface IExtHostWorkspaceProvider {
	getWorkspaceFolder2(uri: vscode.Uri, resolveParent?: boolean): Promise<vscode.WorkspaceFolder | undefined>;
	resolveWorkspaceFolder(uri: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined>;
	getWorkspaceFolders2(): Promise<vscode.WorkspaceFolder[] | undefined>;
	resolveProxy(url: string): Promise<string | undefined>;
	lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined>;
	lookupKerberosAuthorization(url: string): Promise<string | undefined>;
	loadCertificates(): Promise<string[]>;
}

function isFolderEqual(folderA: URI, folderB: URI, extHostFileSystemInfo: IExtHostFileSystemInfo): boolean {
	return new ExtUri(uri => ignorePathCasing(uri, extHostFileSystemInfo)).isEqual(folderA, folderB);
}

function compareWorkspaceFolderByUri(a: vscode.WorkspaceFolder, b: vscode.WorkspaceFolder, extHostFileSystemInfo: IExtHostFileSystemInfo): number {
	return isFolderEqual(a.uri, b.uri, extHostFileSystemInfo) ? 0 : compare(a.uri.toString(), b.uri.toString());
}

function compareWorkspaceFolderByUriAndNameAndIndex(a: vscode.WorkspaceFolder, b: vscode.WorkspaceFolder, extHostFileSystemInfo: IExtHostFileSystemInfo): number {
	if (a.index !== b.index) {
		return a.index < b.index ? -1 : 1;
	}

	return isFolderEqual(a.uri, b.uri, extHostFileSystemInfo) ? compare(a.name, b.name) : compare(a.uri.toString(), b.uri.toString());
}

function delta(oldFolders: vscode.WorkspaceFolder[], newFolders: vscode.WorkspaceFolder[], compare: (a: vscode.WorkspaceFolder, b: vscode.WorkspaceFolder, extHostFileSystemInfo: IExtHostFileSystemInfo) => number, extHostFileSystemInfo: IExtHostFileSystemInfo): { removed: vscode.WorkspaceFolder[]; added: vscode.WorkspaceFolder[] } {
	const oldSortedFolders = oldFolders.slice(0).sort((a, b) => compare(a, b, extHostFileSystemInfo));
	const newSortedFolders = newFolders.slice(0).sort((a, b) => compare(a, b, extHostFileSystemInfo));

	return arrayDelta(oldSortedFolders, newSortedFolders, (a, b) => compare(a, b, extHostFileSystemInfo));
}

function ignorePathCasing(uri: URI, extHostFileSystemInfo: IExtHostFileSystemInfo): boolean {
	const capabilities = extHostFileSystemInfo.getCapabilities(uri.scheme);
	return !(capabilities && (capabilities & FileSystemProviderCapabilities.PathCaseSensitive));
}

interface MutableWorkspaceFolder extends vscode.WorkspaceFolder {
	name: string;
	index: number;
}

interface QueryOptions<T> {
	options: T;
	folder: URI | undefined;
}

type FindFilesApiKind = 'findFiles' | 'findFiles2';

interface FindFilesCallIntent {
	/** Value the extension explicitly passed for `useIgnoreFiles.local` (findFiles2); `undefined` if not specified or N/A for legacy `findFiles`. */
	readonly useIgnoreFilesLocal: boolean | undefined;
	/** Whether the extension passed `null` as the `exclude` argument to legacy `findFiles` (the documented escape hatch). Always `false` for findFiles2. */
	readonly excludeWasNull: boolean;
}

class ExtHostWorkspaceImpl extends Workspace {

	static toExtHostWorkspace(data: IWorkspaceData | null, previousConfirmedWorkspace: ExtHostWorkspaceImpl | undefined, previousUnconfirmedWorkspace: ExtHostWorkspaceImpl | undefined, extHostFileSystemInfo: IExtHostFileSystemInfo): { workspace: ExtHostWorkspaceImpl | null; added: vscode.WorkspaceFolder[]; removed: vscode.WorkspaceFolder[] } {
		if (!data) {
			return { workspace: null, added: [], removed: [] };
		}

		const { id, name, folders, configuration, transient, isUntitled, isAgentSessionsWorkspace } = data;
		const newWorkspaceFolders: vscode.WorkspaceFolder[] = [];

		// If we have an existing workspace, we try to find the folders that match our
		// data and update their properties. It could be that an extension stored them
		// for later use and we want to keep them "live" if they are still present.
		const oldWorkspace = previousConfirmedWorkspace;
		if (previousConfirmedWorkspace) {
			folders.forEach((folderData, index) => {
				const folderUri = URI.revive(folderData.uri);
				const existingFolder = ExtHostWorkspaceImpl._findFolder(previousUnconfirmedWorkspace || previousConfirmedWorkspace, folderUri, extHostFileSystemInfo);

				if (existingFolder) {
					existingFolder.name = folderData.name;
					existingFolder.index = folderData.index;

					newWorkspaceFolders.push(existingFolder);
				} else {
					newWorkspaceFolders.push({ uri: folderUri, name: folderData.name, index });
				}
			});
		} else {
			newWorkspaceFolders.push(...folders.map(({ uri, name, index }) => ({ uri: URI.revive(uri), name, index })));
		}

		// make sure to restore sort order based on index
		newWorkspaceFolders.sort((f1, f2) => f1.index < f2.index ? -1 : 1);

		const workspace = new ExtHostWorkspaceImpl(id, name, newWorkspaceFolders, !!transient, configuration ? URI.revive(configuration) : null, !!isUntitled, !!isAgentSessionsWorkspace, uri => ignorePathCasing(uri, extHostFileSystemInfo));
		const { added, removed } = delta(oldWorkspace ? oldWorkspace.workspaceFolders : [], workspace.workspaceFolders, compareWorkspaceFolderByUri, extHostFileSystemInfo);

		return { workspace, added, removed };
	}

	private static _findFolder(workspace: ExtHostWorkspaceImpl, folderUriToFind: URI, extHostFileSystemInfo: IExtHostFileSystemInfo): MutableWorkspaceFolder | undefined {
		for (let i = 0; i < workspace.folders.length; i++) {
			const folder = workspace.workspaceFolders[i];
			if (isFolderEqual(folder.uri, folderUriToFind, extHostFileSystemInfo)) {
				return folder;
			}
		}

		return undefined;
	}

	private readonly _workspaceFolders: vscode.WorkspaceFolder[] = [];
	private readonly _structure: TernarySearchTree<URI, vscode.WorkspaceFolder>;

	constructor(id: string, private _name: string, folders: vscode.WorkspaceFolder[], transient: boolean, configuration: URI | null, private _isUntitled: boolean, isAgentSessionsWorkspace: boolean, ignorePathCasing: (key: URI) => boolean) {
		super(id, folders.map(f => new WorkspaceFolder(f)), transient, configuration, ignorePathCasing, isAgentSessionsWorkspace);
		this._structure = TernarySearchTree.forUris<vscode.WorkspaceFolder>(ignorePathCasing, () => true);

		// setup the workspace folder data structure
		folders.forEach(folder => {
			this._workspaceFolders.push(folder);
			this._structure.set(folder.uri, folder);
		});
	}

	override get name(): string {
		return this._name;
	}

	get isUntitled(): boolean {
		return this._isUntitled;
	}

	get workspaceFolders(): vscode.WorkspaceFolder[] {
		return this._workspaceFolders.slice(0);
	}

	getWorkspaceFolder(uri: URI, resolveParent?: boolean): vscode.WorkspaceFolder | undefined {
		if (resolveParent && this._structure.get(uri)) {
			// `uri` is a workspace folder so we check for its parent
			uri = dirname(uri);
		}
		return this._structure.findSubstr(uri);
	}

	resolveWorkspaceFolder(uri: URI): vscode.WorkspaceFolder | undefined {
		return this._structure.get(uri);
	}
}

export class ExtHostWorkspace implements ExtHostWorkspaceShape, IExtHostWorkspaceProvider {

	readonly _serviceBrand: undefined;

	private readonly _onDidChangeWorkspace = new Emitter<vscode.WorkspaceFoldersChangeEvent>();
	readonly onDidChangeWorkspace: Event<vscode.WorkspaceFoldersChangeEvent> = this._onDidChangeWorkspace.event;

	private readonly _onDidGrantWorkspaceTrust = new Emitter<void>();
	readonly onDidGrantWorkspaceTrust: Event<void> = this._onDidGrantWorkspaceTrust.event;

	private readonly _onDidChangeWorkspaceTrustedFolders = new Emitter<void>();
	readonly onDidChangeWorkspaceTrustedFolders: Event<void> = this._onDidChangeWorkspaceTrustedFolders.event;

	private readonly _logService: ILogService;
	private readonly _requestIdProvider: Counter;
	private readonly _barrier: Barrier;

	private _confirmedWorkspace?: ExtHostWorkspaceImpl;
	private _unconfirmedWorkspace?: ExtHostWorkspaceImpl;

	private readonly _proxy: MainThreadWorkspaceShape;
	private readonly _messageService: MainThreadMessageServiceShape;
	private readonly _telemetryProxy: MainThreadTelemetryShape;
	private readonly _extHostFileSystemInfo: IExtHostFileSystemInfo;
	private readonly _uriTransformerService: IURITransformerService;

	private readonly _activeSearchCallbacks: ((match: IRawTextResultProgress) => any)[] = [];

	private _trusted: boolean = false;

	private readonly _editSessionIdentityProviders = new Map<string, vscode.EditSessionIdentityProvider>();

	// Pushed in by ExtHostConfiguration after init (see `$setConfigProvider`).
	private _configProvider?: ExtHostConfigProvider;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostFileSystemInfo extHostFileSystemInfo: IExtHostFileSystemInfo,
		@ILogService logService: ILogService,
		@IURITransformerService uriTransformerService: IURITransformerService,
	) {
		this._logService = logService;
		this._extHostFileSystemInfo = extHostFileSystemInfo;
		this._uriTransformerService = uriTransformerService;
		this._requestIdProvider = new Counter();
		this._barrier = new Barrier();

		this._proxy = extHostRpc.getProxy(MainContext.MainThreadWorkspace);
		this._messageService = extHostRpc.getProxy(MainContext.MainThreadMessageService);
		this._telemetryProxy = extHostRpc.getProxy(MainContext.MainThreadTelemetry);
		const data = initData.workspace;
		this._confirmedWorkspace = data ? new ExtHostWorkspaceImpl(data.id, data.name, [], !!data.transient, data.configuration ? URI.revive(data.configuration) : null, !!data.isUntitled, !!data.isAgentSessionsWorkspace, uri => ignorePathCasing(uri, extHostFileSystemInfo)) : undefined;
	}

	/**
	 * Receives the configuration provider from ExtHostConfiguration after init. We cannot inject
	 * IExtHostConfiguration directly because it creates a DI cycle (ExtHostConfiguration already
	 * depends on IExtHostWorkspace). Once set, settings reads in findFiles become synchronous.
	 */
	$setConfigProvider(provider: ExtHostConfigProvider): void {
		this._configProvider = provider;
	}

	private _useIgnoreFilesInFindFiles(): boolean {
		return this._configProvider?.getConfiguration('search').get<boolean>('experimental.useIgnoreFilesInFindFiles') ?? false;
	}

	private _userIgnoreFilesSetting(): boolean {
		// Default in `search.useIgnoreFiles` is `true`; mirror that here so telemetry computed against
		// an unset config still reflects the fallback the query builder will apply.
		return this._configProvider?.getConfiguration('search').get<boolean>('useIgnoreFiles') ?? true;
	}

	$initializeWorkspace(data: IWorkspaceData | null, trusted: boolean): void {
		this._trusted = trusted;
		this.$acceptWorkspaceData(data);
		this._barrier.open();
	}

	waitForInitializeCall(): Promise<boolean> {
		return this._barrier.wait();
	}

	// --- workspace ---

	get workspace(): Workspace | undefined {
		return this._actualWorkspace;
	}

	get name(): string | undefined {
		return this._actualWorkspace ? this._actualWorkspace.name : undefined;
	}

	get isAgentSessionsWorkspace(): boolean {
		return this._actualWorkspace?.isAgentSessionsWorkspace ?? false;
	}

	get workspaceFile(): vscode.Uri | undefined {
		if (this._actualWorkspace) {
			if (this._actualWorkspace.configuration) {
				if (this._actualWorkspace.isUntitled) {
					return URI.from({ scheme: Schemas.untitled, path: basename(dirname(this._actualWorkspace.configuration)) }); // Untitled Workspace: return untitled URI
				}

				return this._actualWorkspace.configuration; // Workspace: return the configuration location
			}
		}

		return undefined;
	}

	private get _actualWorkspace(): ExtHostWorkspaceImpl | undefined {
		return this._unconfirmedWorkspace || this._confirmedWorkspace;
	}

	getWorkspaceFolders(): vscode.WorkspaceFolder[] | undefined {
		if (!this._actualWorkspace) {
			return undefined;
		}
		return this._actualWorkspace.workspaceFolders.slice(0);
	}

	async getWorkspaceFolders2(): Promise<vscode.WorkspaceFolder[] | undefined> {
		await this._barrier.wait();
		if (!this._actualWorkspace) {
			return undefined;
		}
		return this._actualWorkspace.workspaceFolders.slice(0);
	}

	updateWorkspaceFolders(extension: IExtensionDescription, index: number, deleteCount: number, ...workspaceFoldersToAdd: { uri: vscode.Uri; name?: string }[]): boolean {
		const validatedDistinctWorkspaceFoldersToAdd: { uri: vscode.Uri; name?: string }[] = [];
		if (Array.isArray(workspaceFoldersToAdd)) {
			workspaceFoldersToAdd.forEach(folderToAdd => {
				if (URI.isUri(folderToAdd.uri) && !validatedDistinctWorkspaceFoldersToAdd.some(f => isFolderEqual(f.uri, folderToAdd.uri, this._extHostFileSystemInfo))) {
					validatedDistinctWorkspaceFoldersToAdd.push({ uri: folderToAdd.uri, name: folderToAdd.name || basenameOrAuthority(folderToAdd.uri) });
				}
			});
		}

		if (!!this._unconfirmedWorkspace) {
			return false; // prevent accumulated calls without a confirmed workspace
		}

		if ([index, deleteCount].some(i => typeof i !== 'number' || i < 0)) {
			return false; // validate numbers
		}

		if (deleteCount === 0 && validatedDistinctWorkspaceFoldersToAdd.length === 0) {
			return false; // nothing to delete or add
		}

		const currentWorkspaceFolders: MutableWorkspaceFolder[] = this._actualWorkspace ? this._actualWorkspace.workspaceFolders : [];
		if (index + deleteCount > currentWorkspaceFolders.length) {
			return false; // cannot delete more than we have
		}

		// Simulate the updateWorkspaceFolders method on our data to do more validation
		const newWorkspaceFolders = currentWorkspaceFolders.slice(0);
		newWorkspaceFolders.splice(index, deleteCount, ...validatedDistinctWorkspaceFoldersToAdd.map(f => ({ uri: f.uri, name: f.name || basenameOrAuthority(f.uri), index: undefined! /* fixed later */ })));

		for (let i = 0; i < newWorkspaceFolders.length; i++) {
			const folder = newWorkspaceFolders[i];
			if (newWorkspaceFolders.some((otherFolder, index) => index !== i && isFolderEqual(folder.uri, otherFolder.uri, this._extHostFileSystemInfo))) {
				return false; // cannot add the same folder multiple times
			}
		}

		newWorkspaceFolders.forEach((f, index) => f.index = index); // fix index
		const { added, removed } = delta(currentWorkspaceFolders, newWorkspaceFolders, compareWorkspaceFolderByUriAndNameAndIndex, this._extHostFileSystemInfo);
		if (added.length === 0 && removed.length === 0) {
			return false; // nothing actually changed
		}

		// Trigger on main side
		if (this._proxy) {
			const extName = extension.displayName || extension.name;
			this._proxy.$updateWorkspaceFolders(extName, index, deleteCount, validatedDistinctWorkspaceFoldersToAdd).then(undefined, error => {

				// in case of an error, make sure to clear out the unconfirmed workspace
				// because we cannot expect the acknowledgement from the main side for this
				this._unconfirmedWorkspace = undefined;

				// show error to user
				const options: MainThreadMessageOptions = { source: { identifier: extension.identifier, label: extension.displayName || extension.name } };
				this._messageService.$showMessage(Severity.Error, localize('updateerror', "Extension '{0}' failed to update workspace folders: {1}", extName, error.toString()), options, []);
			});
		}

		// Try to accept directly
		this.trySetWorkspaceFolders(newWorkspaceFolders);

		return true;
	}

	getWorkspaceFolder(uri: vscode.Uri, resolveParent?: boolean): vscode.WorkspaceFolder | undefined {
		if (!this._actualWorkspace) {
			return undefined;
		}
		return this._actualWorkspace.getWorkspaceFolder(uri, resolveParent);
	}

	async getWorkspaceFolder2(uri: vscode.Uri, resolveParent?: boolean): Promise<vscode.WorkspaceFolder | undefined> {
		await this._barrier.wait();
		if (!this._actualWorkspace) {
			return undefined;
		}
		return this._actualWorkspace.getWorkspaceFolder(uri, resolveParent);
	}

	async resolveWorkspaceFolder(uri: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
		await this._barrier.wait();
		if (!this._actualWorkspace) {
			return undefined;
		}
		return this._actualWorkspace.resolveWorkspaceFolder(uri);
	}

	getPath(): string | undefined {

		// this is legacy from the days before having
		// multi-root and we keep it only alive if there
		// is just one workspace folder.
		if (!this._actualWorkspace) {
			return undefined;
		}

		const { folders } = this._actualWorkspace;
		if (folders.length === 0) {
			return undefined;
		}
		// #54483 @Joh Why are we still using fsPath?
		return folders[0].uri.fsPath;
	}

	getRelativePath(pathOrUri: string | vscode.Uri, includeWorkspace?: boolean): string {

		let resource: URI | undefined;
		let path: string = '';
		if (typeof pathOrUri === 'string') {
			resource = URI.file(pathOrUri);
			path = pathOrUri;
		} else if (typeof pathOrUri !== 'undefined') {
			resource = pathOrUri;
			path = pathOrUri.fsPath;
		}

		if (!resource) {
			return path;
		}

		const folder = this.getWorkspaceFolder(
			resource,
			true
		);

		if (!folder) {
			return path;
		}

		if (typeof includeWorkspace === 'undefined' && this._actualWorkspace) {
			includeWorkspace = this._actualWorkspace.folders.length > 1;
		}

		let result = relativePath(folder.uri, resource);
		if (includeWorkspace && folder.name) {
			result = `${folder.name}/${result}`;
		}
		return result!;
	}

	private trySetWorkspaceFolders(folders: vscode.WorkspaceFolder[]): void {

		// Update directly here. The workspace is unconfirmed as long as we did not get an
		// acknowledgement from the main side (via $acceptWorkspaceData)
		if (this._actualWorkspace) {
			this._unconfirmedWorkspace = ExtHostWorkspaceImpl.toExtHostWorkspace({
				id: this._actualWorkspace.id,
				name: this._actualWorkspace.name,
				configuration: this._actualWorkspace.configuration,
				folders,
				isUntitled: this._actualWorkspace.isUntitled
			}, this._actualWorkspace, undefined, this._extHostFileSystemInfo).workspace || undefined;
		}
	}

	$acceptWorkspaceData(data: IWorkspaceData | null): void {

		const { workspace, added, removed } = ExtHostWorkspaceImpl.toExtHostWorkspace(data, this._confirmedWorkspace, this._unconfirmedWorkspace, this._extHostFileSystemInfo);

		// Update our workspace object. We have a confirmed workspace, so we drop our
		// unconfirmed workspace.
		this._confirmedWorkspace = workspace || undefined;
		this._unconfirmedWorkspace = undefined;

		// Events
		this._onDidChangeWorkspace.fire(Object.freeze({
			added,
			removed,
		}));
	}

	// --- search ---

	/**
	 * Note, null/undefined have different and important meanings for "exclude"
	 */
	findFiles(include: vscode.GlobPattern | undefined, exclude: vscode.GlobPattern | null | undefined, maxResults: number | undefined, extensionId: ExtensionIdentifier, token: vscode.CancellationToken = CancellationToken.None): Promise<vscode.Uri[]> {
		this._logService.trace(`extHostWorkspace#findFiles: fileSearch, extension: ${extensionId.value}, entryPoint: findFiles`);

		let excludeString: string = '';
		let useFileExcludes = true;
		if (exclude === null) {
			useFileExcludes = false;
		} else if (exclude !== undefined) {
			if (typeof exclude === 'string') {
				excludeString = exclude;
			} else {
				excludeString = exclude.pattern;
			}
		}

		const useIgnoreFilesOptIn = this._useIgnoreFilesInFindFiles();
		// `useIgnoreFiles.local` semantics: `false` means "do not respect local .gitignore" (--no-ignore to rg).
		// Default (PR #204845): hardcoded `false` for every legacy findFiles caller, regardless of `search.useIgnoreFiles`.
		// Opt-in (`search.experimental.useIgnoreFilesInFindFiles: true`): honor the user's `search.useIgnoreFiles`,
		// while keeping `exclude === null` as the documented escape hatch (no excludes => bypass .gitignore).
		const localIgnoreFiles = useIgnoreFilesOptIn && exclude !== null ? undefined : false;

		// todo: consider exclude baseURI if available
		return this._findFilesImpl({ type: 'include', value: include }, {
			exclude: [excludeString],
			maxResults,
			useExcludeSettings: useFileExcludes ? ExcludeSettingOptions.FilesExclude : ExcludeSettingOptions.None,
			useIgnoreFiles: {
				local: localIgnoreFiles
			}
		}, extensionId, 'findFiles', { useIgnoreFilesLocal: undefined, excludeWasNull: exclude === null }, token);
	}


	findFiles2(filePatterns: readonly vscode.GlobPattern[],
		options: vscode.FindFiles2Options = {},
		extensionId: ExtensionIdentifier,
		token: vscode.CancellationToken = CancellationToken.None): Promise<vscode.Uri[]> {
		this._logService.trace(`extHostWorkspace#findFiles2New: fileSearch, extension: ${extensionId.value}, entryPoint: findFiles2New`);
		return this._findFilesImpl({ type: 'filePatterns', value: filePatterns }, options, extensionId, 'findFiles2', { useIgnoreFilesLocal: options.useIgnoreFiles?.local, excludeWasNull: false }, token);
	}

	private _parseIgnoreFileSettings(options: vscode.FindFiles2Options): {
		disregardLocalIgnoreFiles: boolean | undefined; // in this case, undefined means to use the value from settings.
		disregardParentIgnoreFiles: boolean | undefined;
		disregardGlobalIgnoreFiles: boolean | undefined;
	} {

		let disregardLocalIgnoreFiles: boolean | undefined = undefined;
		let disregardParentIgnoreFiles: boolean | undefined = undefined;
		let disregardGlobalIgnoreFiles: boolean | undefined = undefined;

		if (options.ignoreFilesToUse) {
			switch (options.ignoreFilesToUse) {
				case SearchIgnoreOptions.none:
					disregardLocalIgnoreFiles = true;
					disregardParentIgnoreFiles = true;
					disregardGlobalIgnoreFiles = true;
					break;
				case SearchIgnoreOptions.localOnly:
					disregardLocalIgnoreFiles = false;
					disregardParentIgnoreFiles = true;
					disregardGlobalIgnoreFiles = true;
					break;
				case SearchIgnoreOptions.localAndFollowSettings:
					disregardLocalIgnoreFiles = false;
					break;
				case SearchIgnoreOptions.localAndParent:
					disregardLocalIgnoreFiles = false;
					disregardParentIgnoreFiles = false;
					disregardGlobalIgnoreFiles = true;
					break;
				case SearchIgnoreOptions.localAndGlobal:
					disregardLocalIgnoreFiles = false;
					disregardParentIgnoreFiles = true;
					disregardGlobalIgnoreFiles = false;
					break;
				case SearchIgnoreOptions.all:
					disregardLocalIgnoreFiles = false;
					disregardParentIgnoreFiles = false;
					disregardGlobalIgnoreFiles = false;
					break;
				default:
					// SearchIgnoreOptions.followSettings also follows this
					break;
			}
		} else {
			// todo: remove once copilot chat moves off of deprecated options for ~1 month
			disregardLocalIgnoreFiles = typeof options.useIgnoreFiles === 'boolean' ? !options.useIgnoreFiles : undefined;
			disregardGlobalIgnoreFiles = typeof options.useGlobalIgnoreFiles === 'boolean' ? !options.useGlobalIgnoreFiles : undefined;
			disregardParentIgnoreFiles = typeof options.useParentIgnoreFiles === 'boolean' ? !options.useParentIgnoreFiles : undefined;
		}

		return {
			disregardLocalIgnoreFiles,
			disregardParentIgnoreFiles,
			disregardGlobalIgnoreFiles
		};
	}

	private _parseShouldUseExcludeSetting(options: vscode.FindFiles2Options): {
		disregardExcludeSettings: boolean;
		disregardSearchExcludeSettings: boolean;
	} {

		let disregardExcludeSettings: boolean = false;
		let disregardSearchExcludeSettings: boolean = false;

		if (options.excludeSettings) {
			switch (options.excludeSettings) {
				case ExcludeSettingOptions.none:
					disregardExcludeSettings = true;
					disregardSearchExcludeSettings = true;
					break;
				case ExcludeSettingOptions.filesExclude:
					disregardSearchExcludeSettings = true;
					break;
				default:
					// includes the case for ExcludeSettingOptions.searchAndFilesExclude
					break;
			}
		} else {
			// todo: remove once copilot chat moves off of deprecated options for ~1 month
			disregardExcludeSettings = typeof options.useDefaultExcludes === 'boolean' ? !options.useDefaultExcludes : false;
			disregardSearchExcludeSettings = typeof options.useDefaultSearchExcludes === 'boolean' ? !options.useDefaultSearchExcludes : false;
		}

		return { disregardExcludeSettings, disregardSearchExcludeSettings };
	}

	private async _findFilesImpl(
		// the old `findFiles` used `include` to query, but the new `findFiles2` uses `filePattern` to query.
		// `filePattern` is the proper way to handle this, since it takes less precedence than the ignore files.
		query: { readonly type: 'include'; readonly value: vscode.GlobPattern | undefined } | { readonly type: 'filePatterns'; readonly value: readonly vscode.GlobPattern[] },
		options: vscode.FindFiles2Options,
		extensionId: ExtensionIdentifier,
		apiKind: FindFilesApiKind,
		intent: FindFilesCallIntent,
		token: vscode.CancellationToken
	): Promise<vscode.Uri[]> {
		const useIgnoreFilesLocalRequested: 'unspecified' | 'true' | 'false' =
			intent.useIgnoreFilesLocal === true ? 'true'
				: intent.useIgnoreFilesLocal === false ? 'false'
					: 'unspecified';
		const sw = new StopWatch(true);
		let queryCount = 0;
		let respectedIgnoreFiles = this._userIgnoreFilesSetting();
		let resultCount = 0;
		let cancelled = false;
		let errored = false;
		try {
			if (token.isCancellationRequested) {
				cancelled = true;
				return [];
			}

			const filePatternsToUse = query.type === 'include' ? [query.value] : query.value ?? [];
			if (!Array.isArray(filePatternsToUse)) {
				console.error('Invalid file pattern provided', filePatternsToUse);
				throw new Error(`Invalid file pattern provided ${JSON.stringify(filePatternsToUse)}`);
			}

			const queryOptions: QueryOptions<IFileQueryBuilderOptions>[] = filePatternsToUse.map(filePattern => {

				const excludePatterns = globsToISearchPatternBuilder(options.exclude);

				const fileQueries: IFileQueryBuilderOptions = {
					ignoreSymlinks: typeof options.followSymlinks === 'boolean' ? !options.followSymlinks : undefined,
					disregardIgnoreFiles: typeof options.useIgnoreFiles?.local === 'boolean' ? !options.useIgnoreFiles.local : undefined,
					disregardGlobalIgnoreFiles: typeof options.useIgnoreFiles?.global === 'boolean' ? !options.useIgnoreFiles.global : undefined,
					disregardParentIgnoreFiles: typeof options.useIgnoreFiles?.parent === 'boolean' ? !options.useIgnoreFiles.parent : undefined,
					disregardExcludeSettings: options.useExcludeSettings !== undefined && options.useExcludeSettings === ExcludeSettingOptions.None,
					disregardSearchExcludeSettings: options.useExcludeSettings !== undefined && (options.useExcludeSettings !== ExcludeSettingOptions.SearchAndFilesExclude),
					maxResults: options.maxResults,
					excludePattern: excludePatterns.length > 0 ? excludePatterns : undefined,
					ignoreGlobCase: options.caseInsensitive,
					_reason: 'startFileSearch',
					shouldGlobSearch: query.type === 'include' ? undefined : true,
				};

				const parseInclude = parseSearchExcludeInclude(GlobPattern.from(filePattern));
				const folderToUse = parseInclude?.folder;
				if (query.type === 'include') {
					fileQueries.includePattern = parseInclude?.pattern;
				} else {
					fileQueries.filePattern = parseInclude?.pattern;
				}

				return {
					folder: folderToUse,
					options: fileQueries
				};
			});

			queryCount = queryOptions.length;
			// Effective ignore-file behavior across all sub-queries: a call respected `.gitignore` only when every
			// sub-query is either explicitly honoring it or falls back to a user setting that honors it. When
			// `disregardIgnoreFiles` is `undefined` the query builder uses `search.useIgnoreFiles`, which we mirror here.
			const userHonorsIgnore = this._userIgnoreFilesSetting();
			respectedIgnoreFiles = queryOptions.every(q =>
				q.options.disregardIgnoreFiles === true ? false
					: q.options.disregardIgnoreFiles === false ? true
						: userHonorsIgnore);

			const result = await this._findFilesBase(queryOptions, token);
			resultCount = result.length;
			cancelled = token.isCancellationRequested;
			return result;
		} catch (err) {
			errored = true;
			cancelled = token.isCancellationRequested;
			throw err;
		} finally {
			this._reportFindFilesTelemetry({
				extensionId: extensionId.value,
				apiKind,
				respectedIgnoreFiles,
				useIgnoreFilesLocalRequested,
				excludeWasNull: intent.excludeWasNull,
				resultCount,
				durationMs: sw.elapsed(),
				queryCount,
				cancelled,
				errored,
			});
		}
	}

	private async _findFilesBase(
		queryOptions: QueryOptions<IFileQueryBuilderOptions>[] | undefined,
		token: CancellationToken
	): Promise<vscode.Uri[]> {
		// Ensure the token is recognized by the RPC protocol. Tokens from extension
		// bundles may use a different CancellationToken module and fail the instanceof
		// check in isCancellationToken(), causing them to be serialized (without
		// functions) rather than handled as cancellation signals.
		let tokenToUse = token;
		let linkedSource: CancellationTokenSource | undefined;
		if (!CancellationToken.isCancellationToken(token)) {
			linkedSource = new CancellationTokenSource();
			const foreignToken = token as unknown as Partial<CancellationToken>;
			if (typeof foreignToken.onCancellationRequested === 'function') {
				foreignToken.onCancellationRequested(() => linkedSource!.cancel());
			}
			tokenToUse = linkedSource.token;
		}

		const result = await Promise.all(queryOptions?.map(option => this._proxy.$startFileSearch(
			option.folder ?? null,
			option.options,
			tokenToUse).then(data => Array.isArray(data) ? data.map(d => URI.revive(d)) : [])
		) ?? []);

		const flatResult = result.flat();
		linkedSource?.dispose();

		// Dedupe entries in a flat array
		const extUri = new ExtUri(uri => ignorePathCasing(uri, this._extHostFileSystemInfo));
		const uriMap = new Map<string, vscode.Uri>();

		for (const uri of flatResult) {
			const key = extUri.getComparisonKey(uri);
			if (!uriMap.has(key)) {
				uriMap.set(key, uri);
			}
		}

		return Array.from(uriMap.values());
	}

	private _reportFindFilesTelemetry(event: {
		extensionId: string;
		apiKind: FindFilesApiKind;
		respectedIgnoreFiles: boolean;
		useIgnoreFilesLocalRequested: 'unspecified' | 'true' | 'false';
		excludeWasNull: boolean;
		resultCount: number;
		durationMs: number;
		queryCount: number;
		cancelled: boolean;
		errored: boolean;
	}): void {
		type FindFilesEvent = {
			extensionId: string;
			apiKind: string;
			respectedIgnoreFiles: boolean;
			useIgnoreFilesLocalRequested: string;
			excludeWasNull: boolean;
			resultCount: number;
			durationMs: number;
			queryCount: number;
			cancelled: boolean;
			errored: boolean;
		};
		type FindFilesEventClassification = {
			owner: 'osortega';
			comment: 'Telemetry for the extension API workspace.findFiles / findFiles2 calls. Used to assess the impact of flipping the default for search.experimental.useIgnoreFilesInFindFiles by comparing result counts and durations between calls that respected .gitignore and those that did not.';
			extensionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Id of the extension that issued the findFiles call.' };
			apiKind: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Which API entry point: findFiles (legacy) or findFiles2.' };
			respectedIgnoreFiles: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the underlying search respected local .gitignore for this call (effective value after applying the experimental setting and any escape hatches).' };
			useIgnoreFilesLocalRequested: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'What the extension explicitly passed for useIgnoreFiles.local (findFiles2 only): "true", "false", or "unspecified" (always "unspecified" for legacy findFiles since that API does not expose the option).' };
			excludeWasNull: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the extension passed null as the exclude argument to legacy findFiles (the documented escape hatch for unfiltered results). Always false for findFiles2.' };
			resultCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of unique results returned to the extension.' };
			durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Total wall-clock duration of the findFiles call in milliseconds.' };
			queryCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of underlying file-search queries dispatched (one per workspace folder/file pattern).' };
			cancelled: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the call was cancelled before completion.' };
			errored: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the call threw an error.' };
		};
		this._telemetryProxy.$publicLog2<FindFilesEvent, FindFilesEventClassification>('extHostFindFiles', event);
	}

	findTextInFiles2(query: vscode.TextSearchQuery2, options: vscode.FindTextInFilesOptions2 | undefined, extensionId: ExtensionIdentifier, token: vscode.CancellationToken = CancellationToken.None): vscode.FindTextInFilesResponse {
		this._logService.trace(`extHostWorkspace#findTextInFiles2: textSearch, extension: ${extensionId.value}, entryPoint: findTextInFiles2`);


		const getOptions = (include: vscode.GlobPattern | undefined): QueryOptions<ITextQueryBuilderOptions> => {
			if (!options) {
				return {
					folder: undefined,
					options: {}
				};
			}
			const parsedInclude = include ? parseSearchExcludeInclude(GlobPattern.from(include)) : undefined;

			const excludePatterns = options.exclude ? globsToISearchPatternBuilder(options.exclude) : undefined;

			return {
				options: {

					ignoreSymlinks: typeof options.followSymlinks === 'boolean' ? !options.followSymlinks : undefined,
					disregardIgnoreFiles: typeof options.useIgnoreFiles?.local === 'boolean' ? !options.useIgnoreFiles?.local : undefined,
					disregardGlobalIgnoreFiles: typeof options.useIgnoreFiles?.global === 'boolean' ? !options.useIgnoreFiles?.global : undefined,
					disregardParentIgnoreFiles: typeof options.useIgnoreFiles?.parent === 'boolean' ? !options.useIgnoreFiles?.parent : undefined,
					disregardExcludeSettings: options.useExcludeSettings !== undefined && options.useExcludeSettings === ExcludeSettingOptions.None,
					disregardSearchExcludeSettings: options.useExcludeSettings !== undefined && (options.useExcludeSettings !== ExcludeSettingOptions.SearchAndFilesExclude),
					fileEncoding: options.encoding,
					maxResults: options.maxResults,
					ignoreGlobCase: options.caseInsensitive,
					previewOptions: options.previewOptions ? {
						matchLines: options.previewOptions?.numMatchLines ?? 100,
						charsPerLine: options.previewOptions?.charsPerLine ?? 10000,
					} : undefined,
					surroundingContext: options.surroundingContext,

					includePattern: parsedInclude?.pattern,
					excludePattern: excludePatterns
				} satisfies ITextQueryBuilderOptions,
				folder: parsedInclude?.folder
			} satisfies QueryOptions<ITextQueryBuilderOptions>;
		};

		const queryOptionsRaw: (QueryOptions<ITextQueryBuilderOptions> | undefined)[] = ((options?.include?.map((include) =>
			getOptions(include)))) ?? [getOptions(undefined)];

		const queryOptions = queryOptionsRaw.filter((queryOps): queryOps is QueryOptions<ITextQueryBuilderOptions> => !!queryOps);

		const disposables = new DisposableStore();
		const progressEmitter = disposables.add(new Emitter<{ result: ITextSearchResult<URI>; uri: URI }>());
		const complete = this.findTextInFilesBase(
			query,
			queryOptions,
			(result, uri) => progressEmitter.fire({ result, uri }),
			token
		);
		const asyncIterable = new AsyncIterableProducer<vscode.TextSearchResult2>(async emitter => {
			disposables.add(progressEmitter.event(e => {
				const result = e.result;
				const uri = e.uri;
				if (resultIsMatch(result)) {
					emitter.emitOne(new TextSearchMatch2(
						uri,
						result.rangeLocations.map((range) => ({
							previewRange: new Range(range.preview.startLineNumber, range.preview.startColumn, range.preview.endLineNumber, range.preview.endColumn),
							sourceRange: new Range(range.source.startLineNumber, range.source.startColumn, range.source.endLineNumber, range.source.endColumn)
						})),
						result.previewText

					));
				} else {
					emitter.emitOne(new TextSearchContext2(
						uri,
						result.text,
						result.lineNumber
					));

				}
			}));
			await complete;
		});

		return {
			results: asyncIterable,
			complete: complete.then((e) => {
				disposables.dispose();
				return {
					limitHit: e?.limitHit ?? false
				};
			}),
		};
	}


	async findTextInFilesBase(query: vscode.TextSearchQuery, queryOptions: QueryOptions<ITextQueryBuilderOptions>[] | undefined, callback: (result: ITextSearchResult<URI>, uri: URI) => void, token: vscode.CancellationToken = CancellationToken.None): Promise<vscode.TextSearchComplete> {
		const requestId = this._requestIdProvider.getNext();

		let isCanceled = false;
		token.onCancellationRequested(_ => {
			isCanceled = true;
		});

		this._activeSearchCallbacks[requestId] = p => {
			if (isCanceled) {
				return;
			}
			if (isUserFacingProgress(p)) {
				// findTextInFiles does not need to know about progress items
				return;
			}

			const uri = URI.revive(p.resource);
			p.results!.forEach(rawResult => {
				const result: ITextSearchResult<URI> = revive(rawResult);
				callback(result, uri);
			});
		};

		if (token.isCancellationRequested) {
			return {};
		}

		try {
			const result = await Promise.all(queryOptions?.map(option =>
				this._proxy.$startTextSearch(
					query,
					option.folder ?? null,
					option.options,
					requestId,
					token) || {}
			) ?? []);
			delete this._activeSearchCallbacks[requestId];


			let acc: vscode.TextSearchComplete = { limitHit: false };
			for (const val of result) {
				const message = val?.message ? (Array.isArray(val.message) ? val.message : [val.message]) : [];

				acc = {
					limitHit: acc?.limitHit || (val?.limitHit ?? false),
					message,
				};
			}

			return acc;

		} catch (err) {
			delete this._activeSearchCallbacks[requestId];
			throw err;
		}
	}

	async findTextInFiles(query: vscode.TextSearchQuery, options: vscode.FindTextInFilesOptionsOld & { useSearchExclude?: boolean }, callback: (result: vscode.TextSearchResultOld) => void, extensionId: ExtensionIdentifier, token: vscode.CancellationToken = CancellationToken.None): Promise<vscode.TextSearchComplete> {
		this._logService.trace(`extHostWorkspace#findTextInFiles: textSearch, extension: ${extensionId.value}, entryPoint: findTextInFiles`);

		const previewOptions: vscode.TextSearchPreviewOptions = typeof options.previewOptions === 'undefined' ?
			{
				matchLines: 100,
				charsPerLine: 10000
			} :
			options.previewOptions;

		const parsedInclude = parseSearchExcludeInclude(GlobPattern.from(options.include));

		const excludePattern = (typeof options.exclude === 'string') ? options.exclude :
			options.exclude ? options.exclude.pattern : undefined;
		const queryOptions: ITextQueryBuilderOptions = {
			ignoreSymlinks: typeof options.followSymlinks === 'boolean' ? !options.followSymlinks : undefined,
			disregardIgnoreFiles: typeof options.useIgnoreFiles === 'boolean' ? !options.useIgnoreFiles : undefined,
			disregardGlobalIgnoreFiles: typeof options.useGlobalIgnoreFiles === 'boolean' ? !options.useGlobalIgnoreFiles : undefined,
			disregardParentIgnoreFiles: typeof options.useParentIgnoreFiles === 'boolean' ? !options.useParentIgnoreFiles : undefined,
			disregardExcludeSettings: typeof options.useDefaultExcludes === 'boolean' ? !options.useDefaultExcludes : true,
			disregardSearchExcludeSettings: typeof options.useSearchExclude === 'boolean' ? !options.useSearchExclude : true,
			fileEncoding: options.encoding,
			maxResults: options.maxResults,
			previewOptions,
			surroundingContext: options.afterContext, // TODO: remove ability to have before/after context separately

			includePattern: parsedInclude?.pattern,
			excludePattern: excludePattern ? [{ pattern: excludePattern }] : undefined,
		};

		const progress = (result: ITextSearchResult<URI>, uri: URI) => {
			if (resultIsMatch(result)) {
				callback({
					uri,
					preview: {
						text: result.previewText,
						matches: mapArrayOrNot(
							result.rangeLocations,
							m => new Range(m.preview.startLineNumber, m.preview.startColumn, m.preview.endLineNumber, m.preview.endColumn))
					},
					ranges: mapArrayOrNot(
						result.rangeLocations,
						r => new Range(r.source.startLineNumber, r.source.startColumn, r.source.endLineNumber, r.source.endColumn))
				} satisfies vscode.TextSearchMatchOld);
			} else {
				callback({
					uri,
					text: result.text,
					lineNumber: result.lineNumber
				} satisfies vscode.TextSearchContextOld);
			}
		};

		return this.findTextInFilesBase(query, [{ options: queryOptions, folder: parsedInclude?.folder }], progress, token);
	}

	$handleTextSearchResult(result: IRawFileMatch2, requestId: number): void {
		this._activeSearchCallbacks[requestId]?.(result);
	}

	async save(uri: URI): Promise<URI | undefined> {
		const result = await this._proxy.$save(uri, { saveAs: false });

		return URI.revive(result);
	}

	async saveAs(uri: URI): Promise<URI | undefined> {
		const result = await this._proxy.$save(uri, { saveAs: true });

		return URI.revive(result);
	}

	saveAll(includeUntitled?: boolean): Promise<boolean> {
		return this._proxy.$saveAll(includeUntitled);
	}

	resolveProxy(url: string): Promise<string | undefined> {
		return this._proxy.$resolveProxy(url);
	}

	lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined> {
		return this._proxy.$lookupAuthorization(authInfo);
	}

	lookupKerberosAuthorization(url: string): Promise<string | undefined> {
		return this._proxy.$lookupKerberosAuthorization(url);
	}

	loadCertificates(): Promise<string[]> {
		return this._proxy.$loadCertificates();
	}

	// --- trust ---

	get trusted(): boolean {
		return this._trusted;
	}

	requestResourceTrust(options: vscode.ResourceTrustRequestOptions): Promise<boolean | undefined> {
		return this._proxy.$requestResourceTrust(options);
	}

	requestWorkspaceTrust(options?: vscode.WorkspaceTrustRequestOptions): Promise<boolean | undefined> {
		return this._proxy.$requestWorkspaceTrust(options);
	}

	$onDidGrantWorkspaceTrust(): void {
		if (!this._trusted) {
			this._trusted = true;
			this._onDidGrantWorkspaceTrust.fire();
		}
	}

	$onDidChangeWorkspaceTrustedFolders(): void {
		this._onDidChangeWorkspaceTrustedFolders.fire();
	}

	isResourceTrusted(resource: vscode.Uri): Promise<boolean> {
		return this._proxy.$isResourceTrusted(resource);
	}

	// --- edit sessions ---

	private _providerHandlePool = 0;

	// called by ext host
	registerEditSessionIdentityProvider(scheme: string, provider: vscode.EditSessionIdentityProvider) {
		if (this._editSessionIdentityProviders.has(scheme)) {
			throw new Error(`A provider has already been registered for scheme ${scheme}`);
		}

		this._editSessionIdentityProviders.set(scheme, provider);
		const outgoingScheme = this._uriTransformerService.transformOutgoingScheme(scheme);
		const handle = this._providerHandlePool++;
		this._proxy.$registerEditSessionIdentityProvider(handle, outgoingScheme);

		return toDisposable(() => {
			this._editSessionIdentityProviders.delete(scheme);
			this._proxy.$unregisterEditSessionIdentityProvider(handle);
		});
	}

	// called by main thread
	async $getEditSessionIdentifier(workspaceFolder: UriComponents, cancellationToken: CancellationToken): Promise<string | undefined> {
		this._logService.info('Getting edit session identifier for workspaceFolder', workspaceFolder);
		const folder = await this.resolveWorkspaceFolder(URI.revive(workspaceFolder));
		if (!folder) {
			this._logService.warn('Unable to resolve workspace folder');
			return undefined;
		}

		this._logService.info('Invoking #provideEditSessionIdentity for workspaceFolder', folder);

		const provider = this._editSessionIdentityProviders.get(folder.uri.scheme);
		this._logService.info(`Provider for scheme ${folder.uri.scheme} is defined: `, !!provider);
		if (!provider) {
			return undefined;
		}

		const result = await provider.provideEditSessionIdentity(folder, cancellationToken);
		this._logService.info('Provider returned edit session identifier: ', result);
		if (!result) {
			return undefined;
		}

		return result;
	}

	async $provideEditSessionIdentityMatch(workspaceFolder: UriComponents, identity1: string, identity2: string, cancellationToken: CancellationToken): Promise<EditSessionIdentityMatch | undefined> {
		this._logService.info('Getting edit session identifier for workspaceFolder', workspaceFolder);
		const folder = await this.resolveWorkspaceFolder(URI.revive(workspaceFolder));
		if (!folder) {
			this._logService.warn('Unable to resolve workspace folder');
			return undefined;
		}

		this._logService.info('Invoking #provideEditSessionIdentity for workspaceFolder', folder);

		const provider = this._editSessionIdentityProviders.get(folder.uri.scheme);
		this._logService.info(`Provider for scheme ${folder.uri.scheme} is defined: `, !!provider);
		if (!provider) {
			return undefined;
		}

		const result = await provider.provideEditSessionIdentityMatch?.(identity1, identity2, cancellationToken);
		this._logService.info('Provider returned edit session identifier match result: ', result);
		if (!result) {
			return undefined;
		}

		return result;
	}

	private readonly _callbacks = new LinkedList<[Function, any, IExtensionDescription]>();
	private readonly _thresholds: { timeout: number; errors: number } = { timeout: 10000, errors: 3 };
	private readonly _badListeners = new WeakMap<Function, number>();

	getOnWillCreateEditSessionIdentityEvent(extension: IExtensionDescription): Event<vscode.EditSessionIdentityWillCreateEvent> {
		return (listener, thisArg, disposables) => {
			const remove = this._callbacks.push([listener, thisArg, extension]);
			const result = { dispose: remove };
			if (Array.isArray(disposables)) {
				disposables.push(result);
			}
			return result;
		};
	}

	// main thread calls this to trigger participants
	async $onWillCreateEditSessionIdentity(workspaceFolder: UriComponents) {
		const folder = await this.resolveWorkspaceFolder(URI.revive(workspaceFolder));

		let didTimeout = false;
		const didTimeoutHandle = setTimeout(() => didTimeout = true, this._thresholds.timeout);

		const results: boolean[] = [];
		try {
			for (const listener of [...this._callbacks]) { // copy to prevent concurrent modifications
				if (didTimeout) {
					// timeout - no more listeners
					break;
				}
				const success = await this._deliverEventAsyncAndBlameBadListeners(listener, <any>{ workspaceFolder: folder });
				results.push(success);
			}
		} finally {
			clearTimeout(didTimeoutHandle);
		}
		return results;
	}

	private _deliverEventAsyncAndBlameBadListeners([listener, thisArg, extension]: [Function, any, IExtensionDescription], stubEvent: vscode.EditSessionIdentityWillCreateEvent): Promise<any> {
		const errors = this._badListeners.get(listener);
		if (typeof errors === 'number' && errors > this._thresholds.errors) {
			// bad listener - ignore
			return Promise.resolve(false);
		}

		return this._deliverEventAsync(extension, listener, thisArg, stubEvent).then(() => {
			// don't send result across the wire
			return true;

		}, err => {

			this._logService.error(`onWillCreateEditSessionIdentity-listener from extension '${extension.identifier.value}' threw ERROR`);
			this._logService.error(err);

			if (!(err instanceof Error) || (<Error>err).message !== 'concurrent_edits') {
				const errors = this._badListeners.get(listener);
				this._badListeners.set(listener, !errors ? 1 : errors + 1);

				if (typeof errors === 'number' && errors > this._thresholds.errors) {
					this._logService.info(`onWillCreateEditSessionIdentity-listener from extension '${extension.identifier.value}' will now be IGNORED because of timeouts and/or errors`);
				}
			}
			return false;
		});
	}

	private _deliverEventAsync(extension: IExtensionDescription, listener: Function, thisArg: any, stubEvent: vscode.EditSessionIdentityWillCreateEvent): Promise<void> {

		const promises: Promise<void>[] = [];

		const t1 = Date.now();
		const { workspaceFolder, token } = stubEvent;

		const event = Object.freeze<vscode.EditSessionIdentityWillCreateEvent>({
			workspaceFolder,
			token,
			waitUntil(p: Promise<void>) {
				if (Object.isFrozen(promises)) {
					throw illegalState('waitUntil can not be called async');
				}
				promises.push(Promise.resolve(p));
			}
		});

		try {
			// fire event
			listener.apply(thisArg, [event]);
		} catch (err) {
			return Promise.reject(err);
		}

		// freeze promises after event call
		Object.freeze(promises);

		return new Promise<void>((resolve, reject) => {
			// join on all listener promises, reject after timeout
			const handle = setTimeout(() => reject(new Error('timeout')), this._thresholds.timeout);

			return Promise.all(promises).then(() => {
				this._logService.debug(`onWillCreateEditSessionIdentity-listener from extension '${extension.identifier.value}' finished after ${(Date.now() - t1)}ms`);
				clearTimeout(handle);
				resolve(undefined);
			}).catch(err => {
				clearTimeout(handle);
				reject(err);
			});

		}).then(() => {
			return Promise.reject(new Error('concurrent_edits'));
		});
	}

	// --- canonical uri identity ---

	private readonly _canonicalUriProviders = new Map<string, vscode.CanonicalUriProvider>();

	// called by ext host
	registerCanonicalUriProvider(scheme: string, provider: vscode.CanonicalUriProvider) {
		if (this._canonicalUriProviders.has(scheme)) {
			this._logService.error(`A canonical URI provider has already been registered for scheme ${scheme}`);
			return;
		}

		this._canonicalUriProviders.set(scheme, provider);
		const outgoingScheme = this._uriTransformerService.transformOutgoingScheme(scheme);
		const handle = this._providerHandlePool++;
		this._proxy.$registerCanonicalUriProvider(handle, outgoingScheme);

		return toDisposable(() => {
			this._canonicalUriProviders.delete(scheme);
			this._proxy.$unregisterCanonicalUriProvider(handle);
		});
	}

	async provideCanonicalUri(uri: URI, options: vscode.CanonicalUriRequestOptions, cancellationToken: CancellationToken): Promise<URI | undefined> {
		const provider = this._canonicalUriProviders.get(uri.scheme);
		if (!provider) {
			return undefined;
		}

		const result = await provider.provideCanonicalUri?.(URI.revive(uri), options, cancellationToken);
		if (!result) {
			return undefined;
		}

		return result;
	}

	// called by main thread
	async $provideCanonicalUri(uri: UriComponents, targetScheme: string, cancellationToken: CancellationToken): Promise<UriComponents | undefined> {
		return this.provideCanonicalUri(URI.revive(uri), { targetScheme }, cancellationToken);
	}

	// --- encodings ---

	async decode(content: Uint8Array, args?: { uri?: vscode.Uri; encoding?: string }): Promise<string> {
		const [uri, opts] = this.toEncodeDecodeParameters(args);
		const options = await this._proxy.$resolveDecoding(uri, opts);

		const stream = (await toDecodeStream(bufferToStream(VSBuffer.wrap(content)), {
			...options,
			acceptTextOnly: true,
			overwriteEncoding: detectedEncoding => {
				if (detectedEncoding === null || detectedEncoding === options.preferredEncoding) {
					// Prevent another roundtrip to the main thread
					// if the detected encoding is null or the same
					// as the preferred encoding
					return Promise.resolve(options.preferredEncoding);
				}

				return this._proxy.$validateDetectedEncoding(uri, detectedEncoding, opts);
			},
		})).stream;

		return consumeStream(stream, chunks => chunks.join(''));
	}

	async encode(content: string, args?: { uri?: vscode.Uri; encoding?: string }): Promise<Uint8Array> {
		const [uri, options] = this.toEncodeDecodeParameters(args);
		const { encoding, addBOM } = await this._proxy.$resolveEncoding(uri, options);

		// when encoding is standard skip encoding step
		if (encoding === UTF8 && !addBOM) {
			return VSBuffer.fromString(content).buffer;
		}

		// otherwise create encoded readable
		const res = await toEncodeReadable(stringToSnapshot(content), encoding, { addBOM });
		return readableToBuffer(res).buffer;
	}

	private toEncodeDecodeParameters(opts?: { uri?: vscode.Uri; encoding?: string }): [UriComponents | undefined, { encoding: string } | undefined] {
		const uri = isUriComponents(opts?.uri) ? opts.uri : undefined;
		const encoding = typeof opts?.encoding === 'string' ? opts.encoding : undefined;

		return [uri, encoding ? { encoding } : undefined];
	}
}

export const IExtHostWorkspace = createDecorator<IExtHostWorkspace>('IExtHostWorkspace');
export interface IExtHostWorkspace extends ExtHostWorkspace, ExtHostWorkspaceShape, IExtHostWorkspaceProvider { }

function parseSearchExcludeInclude(include: string | IRelativePatternDto | undefined | null): { pattern: string; folder?: URI } | undefined {
	let pattern: string | undefined;
	let includeFolder: URI | undefined;
	if (include) {
		if (typeof include === 'string') {
			pattern = include;
		} else {
			pattern = include.pattern;
			includeFolder = URI.revive(include.baseUri);
		}

		return {
			pattern,
			folder: includeFolder
		};
	}
	return undefined;
}

interface IExtensionListener<E> {
	extension: IExtensionDescription;
	(e: E): any;
}

function globsToISearchPatternBuilder(excludes: vscode.GlobPattern[] | undefined): ISearchPatternBuilder<URI>[] {
	return (
		excludes?.map((exclude): ISearchPatternBuilder<URI> | undefined => {
			if (typeof exclude === 'string') {
				if (exclude === '') {
					return undefined;
				}
				return {
					pattern: exclude,
					uri: undefined
				} satisfies ISearchPatternBuilder<URI>;
			} else {
				const parsedExclude = parseSearchExcludeInclude(exclude);
				if (!parsedExclude) {
					return undefined;
				}
				return {
					pattern: parsedExclude.pattern,
					uri: parsedExclude.folder
				} satisfies ISearchPatternBuilder<URI>;
			}
		}) ?? []
	).filter((e): e is ISearchPatternBuilder<URI> => !!e);
}
