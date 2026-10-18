/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import { unlinkSync, writeFileSync } from 'fs';
import { mkdir, readFile, unlink } from 'fs/promises';
import { release, tmpdir } from 'os';
import { localize } from '../../../nls.js';
import { Delayer, ProcessTimeRunOnceScheduler, timeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { isCancellationError } from '../../../base/common/errors.js';
import { hash } from '../../../base/common/hash.js';
import * as path from '../../../base/common/path.js';
import { basename } from '../../../base/common/path.js';
import { endsWithIgnoreCase, equalsIgnoreCase, startsWithIgnoreCase } from '../../../base/common/strings.js';
import { transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { checksum } from '../../../base/node/crypto.js';
import * as pfs from '../../../base/node/pfs.js';
import { getWindowsRelease } from '../../../base/node/windowsVersion.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, DisablementReason, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, getUpdateRequestHeaders, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { getRelaunchArguments } from './updateRelaunchArguments.js';
import { getWin32UpdateType } from './win32UpdateType.js';
import { Win32UpdateAttempt } from './win32UpdateAttempt.js';
import { Win32UpdateProcess } from './win32UpdateProcess.js';

interface IAvailableUpdate {
	packagePath: string;
	updateAttempt?: Win32UpdateAttempt;
}

const RELAUNCH_ARGUMENTS_FILE_PREFIX = 'relaunch-args-';

export class Win32UpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private availableUpdate: IAvailableUpdate | undefined;
	private readonly updateType = getWin32UpdateType();
	/** Cancels an in-flight check/download chain (e.g. when updates are disabled at runtime). */
	private checkCancellationTokenSource: CancellationTokenSource | undefined;
	/** Settles when the in-flight check/download chain has fully unwound; used by the cancel path. */
	private checkPromise: Promise<unknown> | undefined;

	private readonly readyMutexName: string;
	private readonly updatingMutexName: string;
	private readonly setupMutexName: string;

	private get cachePathSync(): string {
		return path.join(tmpdir(), `vscode-${this.productService.quality}-${this.productService.target}-${process.arch}`);
	}

	@memoize
	get cachePath(): Promise<string> {
		const result = this.cachePathSync;
		return mkdir(result, { recursive: true }).then(() => result);
	}

	@memoize
	protected get mutex(): Promise<IWindowsMutex> {
		return import('@vscode/windows-mutex');
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, true);

		this.readyMutexName = `${productService.win32MutexName}-ready`;
		this.updatingMutexName = `${productService.win32MutexName}-updating`;
		this.setupMutexName = `${productService.win32MutexName}setup`;

		lifecycleMainService.setRelaunchHandler(this);

		// Step 3.1: When VS Code shuts down while an update is still being
		// installed (Updating state), stop the polling loop so the process
		// can exit cleanly. We do NOT cancel or kill the Inno Setup process
		// because it was spawned detached and should complete the update
		// after VS Code exits — that's the designed background update flow.
		// See https://github.com/microsoft/vscode/issues/62476
		lifecycleMainService.onWillShutdown(() => {
			this.updateCancellationTokenSource?.dispose(true);
			this.updateCancellationTokenSource = undefined;
		});
	}

	/**
	 * Returns whether background updates can be applied for a system/admin install.
	 * This is true when UAC is disabled and the process is already running elevated,
	 * meaning the spawned Inno Setup installer inherits admin privileges and can
	 * write to Program Files without a UAC prompt.
	 */
	private canBackgroundUpdateAdminInstall(): Promise<boolean> {
		if (!this._canBackgroundUpdateAdminInstall) {
			this._canBackgroundUpdateAdminInstall = (async () => {
				if (this.productService.target === 'user') {
					return false;
				}
				try {
					const [isAdmin, elevationPromptDisabled] = await Promise.all([
						this.nativeHostMainService.isAdmin(undefined),
						isElevationPromptDisabled()
					]);
					return isAdmin && elevationPromptDisabled;
				} catch (error) {
					this.logService.warn('update#canBackgroundUpdateAdminInstall(): failed to determine admin/UAC state, falling back to false', error);
					return false;
				}
			})();
		}
		return this._canBackgroundUpdateAdminInstall;
	}

	private isBackgroundUpdateEnabled(): Promise<boolean> {
		return this.configurationService.getValue<boolean>('update.enableWindowsBackgroundUpdates') && this.productService.target === 'user';
	}


	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		if (this.productService.win32VersionedUpdate) {
			const cachePath = await this.cachePath;
			electron.app.setPath('appUpdate', cachePath);
			await this.unlink(path.join(cachePath, 'session-ending.flag'));
		}

		// Send telemetry
		type WindowsUpdateInitEvent = {
			osRelease: string;
			osNodeRelease: string;
			enableLUA: boolean;
			consentPromptBehaviorAdmin: number;
		};
		type WindowsUpdateInitClassification = {
			osRelease: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The Windows OS release version from registry.' };
			osNodeRelease: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The Windows OS release version from os.release().' };
			enableLUA: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The EnableLUA registry value which controls whether UAC is enabled.' };
			consentPromptBehaviorAdmin: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ConsentPromptBehaviorAdmin registry value which controls UAC prompt behavior for admins.' };
			owner: 'dmitriv';
			comment: 'Tracks Windows OS release information during update initialization.';
		};
		const uacInfo = await getUACInfo();
		this.telemetryService.publicLog2<WindowsUpdateInitEvent, WindowsUpdateInitClassification>('windowsUpdateInit', {
			osRelease: await getWindowsRelease(),
			osNodeRelease: release(),
			enableLUA: uacInfo.enableLUA,
			consentPromptBehaviorAdmin: uacInfo.consentPromptBehaviorAdmin
		});

		if (this.productService.target === 'user' && await this.nativeHostMainService.isAdmin(undefined) && !await isUACDisabled()) {
			this.setState(State.Disabled(DisablementReason.RunningAsAdmin));
			this.logService.info('update#ctor - updates are disabled due to running as Admin in user setup');
			return;
		}

		// Remove old installation
		if (this.productService.target === 'user') {
			await this.gc();
		}

		await super.initialize();
	}

	protected override async postInitialize(): Promise<void> {
		if (!this.productService.win32VersionedUpdate) {
			return;
		}
		// Check for pending update from previous session
		// This can happen if the app is quit right after the update has been
		// downloaded and before the update has been applied.
		const exePath = electron.app.getPath('exe');
		const exeDir = path.dirname(exePath);
		const updatingVersionPath = path.join(exeDir, 'updating_version');
		if (await pfs.Promises.exists(updatingVersionPath)) {
			try {
				const updatingVersion = (await readFile(updatingVersionPath, 'utf8')).trim();
				this.logService.info(`update#doCheckForUpdates - application was updating to version ${updatingVersion}`);
				const updatePackagePath = await this.getUpdatePackagePath(updatingVersion);
				if (await pfs.Promises.exists(updatePackagePath)) {
					await this._applySpecificUpdate(updatePackagePath, updatingVersion);
					this.logService.info(`update#doCheckForUpdates - successfully applied update to version ${updatingVersion}`);
				}
			} catch (e) {
				this.logService.error(`update#doCheckForUpdates - could not read ${updatingVersionPath}`, e);
			} finally {
				// updatingVersionPath will be deleted by inno setup.
			}
		} else {
			await this.collectGarbage();
		}
	}

	private async collectGarbage(): Promise<void> {
		if (!this.productService.win32VersionedUpdate) {
			return;
		}

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		// GC for background updates in system setup happens via inno_setup since it requires elevated permissions.
		if (!fastUpdatesEnabled || this.productService.target !== 'user' || !this.productService.commit) {
			return;
		}

		const exePath = electron.app.getPath('exe');
		const exeDir = path.dirname(exePath);
		const versionedResourcesFolder = this.productService.commit.substring(0, 10);
		const innoUpdater = path.join(exeDir, versionedResourcesFolder, 'tools', 'inno_updater.exe');
		const exeName = basename(exePath);
		await new Promise<void>(resolve => {
			const child = spawn(innoUpdater, ['--gc', exePath, versionedResourcesFolder, exeName], {
				stdio: ['ignore', 'ignore', 'ignore'],
				windowsHide: true,
				timeout: 2 * 60 * 1000
			});
			// Resolve on 'error' too (missing inno_updater / permission denied) so the awaited promise always settles.
			child.once('error', err => {
				this.logService.error('update#collectGarbage - failed to spawn inno_updater', err);
				resolve();
			});
			child.once('exit', () => resolve());
		});
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string | undefined {
		let platform = `win32-${process.arch}`;

		if (this.getUpdateType() === UpdateType.Archive) {
			platform += '-archive';
		} else if (this.productService.target === 'user') {
			platform += '-user';
		}

		return createUpdateURL(this.productService.updateUrl!, platform, quality, commit, options);
	}

	protected doCheckForUpdates(explicit: boolean, pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, pendingCommit ?? this.productService.commit!, { background, internalOrg });

		// Only set CheckingForUpdates if we're not already in Overwriting state
		if (this.state.type !== StateType.Overwriting) {
			this.setState(State.CheckingForUpdates(explicit));
		}

		// Track this check/download chain so it can be cancelled if updates are disabled at runtime.
		this.checkCancellationTokenSource?.dispose(true);
		const cts = this.checkCancellationTokenSource = new CancellationTokenSource();
		const token = cts.token;

		const headers = getUpdateRequestHeaders(this.productService.version);
		const promise = this.requestService.request({ url, headers, callSite: 'updateService.win32.checkForUpdates' }, token)
			.then<IUpdate | null>(asJson)
			.then(update => {
				const updateType = this.getUpdateType();

				if (token.isCancellationRequested) {
					return Promise.resolve(null);
				}

				if (!update || !update.url || !update.version || !update.productVersion) {
					// If we were checking for an overwrite update and found nothing newer,
					// restore the Ready state with the pending update
					if (this.state.type === StateType.Overwriting) {
						this._overwrite = false;
						this.setState(State.Ready(this.state.update, this.state.explicit, false));
					} else {
						this.setState(State.Idle(updateType, undefined, explicit || undefined));
					}
					return Promise.resolve(null);
				}

				if (updateType === UpdateType.Archive) {
					this.setState(State.AvailableForDownload(update));
					return Promise.resolve(null);
				}

				if (this.deferAutomaticDownload(update, explicit)) {
					return Promise.resolve(null);
				}

				const startTime = Date.now();
				this.setState(State.Downloading(update, explicit, this._overwrite, 0, undefined, startTime));

				return this.cleanupObsoleteUpdatePackages(update.version).then(() => {
					return this.getUpdatePackagePath(update.version).then(updatePackagePath => {
						return pfs.Promises.exists(updatePackagePath).then(exists => {
							if (exists) {
								return Promise.resolve(updatePackagePath);
							}

							if (this.deferAutomaticDownload(update, explicit)) {
								return undefined;
							}

							const downloadPath = `${updatePackagePath}.tmp`;

							return this.requestService.request({ url: update.url, callSite: 'updateService.win32.downloadUpdate' }, token)
								.then(context => {
									// Get total size from Content-Length header
									const contentLengthHeader = context.res.headers['content-length'];
									const contentLength = typeof contentLengthHeader === 'string' ? contentLengthHeader : undefined;
									const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

									// Track downloaded bytes and update state periodically using Delayer
									let downloadedBytes = 0;
									const progressDelayer = new Delayer<void>(500);
									const progressStream = transform<VSBuffer, VSBuffer>(
										context.stream,
										{
											data: data => {
												downloadedBytes += data.byteLength;
												progressDelayer.trigger(() => {
													this.setState(State.Downloading(update, explicit, this._overwrite, downloadedBytes, totalBytes, startTime));
												});
												return data;
											}
										},
										chunks => VSBuffer.concat(chunks)
									);

									return this.fileService.writeFile(URI.file(downloadPath), progressStream)
										.finally(() => progressDelayer.dispose());
								})
								.then(update.sha256hash ? () => checksum(downloadPath, update.sha256hash) : () => undefined)
								.then(() => pfs.Promises.rename(downloadPath, updatePackagePath, false /* no retry */))
								.then(() => updatePackagePath);
						});
					}).then(packagePath => {
						if (!packagePath || token.isCancellationRequested) {
							return;
						}

						this.availableUpdate = { packagePath };
						this.saveUpdateMetadata(update);
						this.setState(State.Downloaded(update, explicit, this._overwrite));

						if (await this.isBackgroundUpdateEnabled()) {
							this.doApplyUpdate();
						} else {
							this.setState(State.Ready(update, explicit, this._overwrite));
						}
					});
				});
			})
			.then(undefined, err => {
				// The chain was cancelled because updates are being disabled; leave state to the disable flow.
				if (token.isCancellationRequested || isCancellationError(err)) {
					return;
				}

				this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
				this.logService.error(err);

				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;

				// If we were checking for an overwrite update and it failed,
				// restore the Ready state with the pending update
				if (this.state.type === StateType.Overwriting) {
					this._overwrite = false;
					this.setState(State.Ready(this.state.update, this.state.explicit, false));
				} else {
					this.setState(State.Idle(this.getUpdateType(), message));
				}
			});

		this.checkPromise = promise;

		promise.finally(() => {
			if (this.checkCancellationTokenSource === cts) {
				this.checkCancellationTokenSource = undefined;
			}
			if (this.checkPromise === promise) {
				this.checkPromise = undefined;
			}
			cts.dispose();
		});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}
		this.setState(State.Idle(this.getUpdateType()));
	}

	protected override resumeDeferredDownload(): void {
		this.setState(State.Idle(this.getUpdateType()));
		void this.checkForUpdates(false);
	}

	private async getUpdatePackagePath(version: string): Promise<string> {
		const cachePath = await this.cachePath;
		return path.join(cachePath, `CodeSetup-${this.productService.quality}-${version}.exe`);
	}

	private async cleanup(exceptVersion: string | null = null): Promise<void> {
		const relaunchArgumentsFileName = exceptVersion ? `${RELAUNCH_ARGUMENTS_FILE_PREFIX}${exceptVersion}` : undefined;
		const filter = exceptVersion
			? (one: string) => one !== relaunchArgumentsFileName && !(new RegExp(`${this.productService.quality}-${exceptVersion}\\.exe$`).test(one))
			: () => true;

		const cachePath = await this.cachePath;
		const fileNames = await pfs.Promises.readdir(cachePath);
		const currentPackageName = `CodeSetup-${this.productService.quality}-${currentVersion}.exe`;
		const obsoletePackageNames = fileNames.filter(fileName =>
			!equalsIgnoreCase(fileName, currentPackageName)
			&& startsWithIgnoreCase(fileName, 'CodeSetup-')
			&& (endsWithIgnoreCase(fileName, '.exe') || endsWithIgnoreCase(fileName, '.exe.tmp'))
		);
		const promises = obsoletePackageNames.map(fileName => this.unlink(path.join(cachePath, fileName)));
		await Promise.all(promises);
	}

	private async getWindowsMutex(context: string): Promise<IWindowsMutexModule | undefined> {
		try {
			return await import('@vscode/windows-mutex');
		} catch (error) {
			this.logService.error(`update#${context}: failed to import windows mutex module`, error);
			this.logApplyBreadcrumb('mutex_import_failed');
			return undefined;
		}
	}

	private isInstallerMutexActive(mutex: IWindowsMutexModule): boolean {
		if (!this.productService.win32MutexName) {
			return false;
		}

		const setupMutexName = `${this.productService.win32MutexName}setup`;
		const updatingMutexName = `${this.productService.win32MutexName}-updating`;
		return mutex.isActive(setupMutexName) || mutex.isActive(updatingMutexName);
	}

	private isReadyMutexActive(mutex: IWindowsMutexModule): boolean {
		if (!this.productService.win32MutexName) {
			return false;
		}

		const readyMutexName = `${this.productService.win32MutexName}-ready`;
		return mutex.isActive(readyMutexName);
	}

	private logApplyBreadcrumb(reason: 'mutex_import_failed' | 'installer_already_running' | 'resume_installer_missing' | 'poll_timeout' | 'recovery_with_active_installer'): void {
		this.telemetryService.publicLog2<{ reason: string }, IUpdateWin32ApplyBreadcrumbClassification>('update:win32ApplyBreadcrumb', { reason });
	}

	protected override async doApplyUpdate(): Promise<void> {
		if (this.state.type !== StateType.Downloaded) {
			return Promise.resolve(undefined);
		}

		const availableUpdate = this.availableUpdate;
		if (!availableUpdate) {
			return Promise.resolve(undefined);
		}

		const update = this.state.update;
		const explicit = this.state.explicit;
		this.setState(State.Updating(update, explicit));

		const mutex = await this.getWindowsMutex('doApplyUpdate');
		if (!mutex) {
			this.setState(State.Idle(getUpdateType(), 'Unable to coordinate update setup state'));
			return;
		}

		const installerAlreadyRunning = this.isInstallerMutexActive(mutex);
		if (installerAlreadyRunning) {
			this.logService.info('update#doApplyUpdate: installer already running, skipping setup spawn');
			this.logApplyBreadcrumb('installer_already_running');
		}

		// Step 1.1: Check if another setup is already running before spawning a new one.
		// This prevents the "Setup has detected that Setup is currently running" dialog
		// from Inno Setup when a second installer is spawned while the first holds the mutex.
		// See https://github.com/microsoft/vscode/issues/62476
		const setupMutexName = `${this.productService.win32MutexName}setup`;
		try {
			const mutex = await import('@vscode/windows-mutex');
			if (mutex.isActive(setupMutexName)) {
				this.logService.info('update#doApplyUpdate: another setup is already running, polling for its completion instead of spawning a new one');
				this.pollForReadyMutex(update, explicit);
				return;
			}
		} catch (error) {
			this.logService.warn('update#doApplyUpdate: failed to check setup mutex, proceeding with spawn', error);
		}

		const cachePath = await this.cachePath;
		if (!this.isApplyingUpdate(availableUpdate)) {
			return;
		}

		const mutex = await this.mutex;
		if (!this.isApplyingUpdate(availableUpdate)) {
			return;
		}

		const updateAttempt = availableUpdate.updateAttempt = new Win32UpdateAttempt(cachePath, availableUpdate.packagePath, this.productService.quality!, update.version, generateUuid(), this.logService);
		const token = updateAttempt.cancellationTokenSource.token;
		const skippedSpawn = this.isInstallerActive(mutex);

		// Skip the spawn if another Inno Setup is already running for this product (background update or a manual installer);
		// otherwise Inno's "Setup is already running" modal pops up. The `-ready` mutex poll below still advances our state when it finishes.
		if (skippedSpawn) {
			try {
				await updateAttempt.resolveForeignUpdateFiles();
			} catch (error) {
				this.failUpdateAttempt(availableUpdate, updateAttempt, error instanceof Error ? error : new Error(String(error)));
				return;
			}

			if (!this.isCurrentUpdateAttempt(availableUpdate, updateAttempt)) {
				updateAttempt.complete();
				await updateAttempt.cleanup();
				return;
			}

			this.logService.info('update#doApplyUpdate: another instance is already running setup, waiting for it to finish');
		} else {
			try {
				await updateAttempt.prepare();
			} catch (error) {
				this.failUpdateAttempt(availableUpdate, updateAttempt, error instanceof Error ? error : new Error(String(error)));
				return;
			}

			const installerArgs = [
				'/verysilent',
				'/log',
				`/update="${this.availableUpdate.updateFilePath}"`,
				`/sessionend="${sessionEndFlagPath}"`,
				`/cancel="${cancelFilePath}"`,
				'/nocloseapplications',
				'/mergetasks=runcode,!desktopicon,!quicklaunchicon'
			];

			// The restarting instance populates this file immediately before releasing the installer.
			const relaunchArgsFilePath = this.getRelaunchArgumentsFilePath(cachePath, update.version);
			installerArgs.push(`/relaunchargs="${relaunchArgsFilePath}"`);

			const child = spawn(this.availableUpdate.packagePath,
				installerArgs,
				{
					detached: true,
					stdio: ['ignore', 'ignore', 'ignore'],
					windowsVerbatimArguments: true,
					env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' }
				}

				if (!mutex.isActive(this.readyMutexName)) {
					await timeout(500);
				}

			child.once('exit', () => {
				this.availableUpdate = undefined;
				this.setState(State.Idle(this.getUpdateType()));
			});
		}

		const poll = async () => {
			// If we skipped the spawn, the foreign installer was active when we started; treat that as having seen it run
			// so a quick exit (cancel/fail) before the first poll iteration still drops us to Idle.
			let seenRunning = skippedSpawn;
			while (this.isCurrentUpdateAttempt(availableUpdate, updateAttempt)) {
				if (mutex.isActive(this.readyMutexName)) {
					this.completeUpdateAttempt(availableUpdate, updateAttempt, update, explicit);
					return;
				}

				// Inno gone without `-ready` => install cancelled/failed; drop to Idle.
				if (this.isInstallerActive(mutex)) {
					seenRunning = true;
				} else if (seenRunning) {
					if (!this.availableUpdate?.updateProcess) {
						this.availableUpdate = undefined;
						this.setState(State.Idle(this.getUpdateType()));
					}
					return;
				}

				const progress = await updateAttempt.readProgress();
				if (!token.isCancellationRequested && progress && this.state.type === StateType.Updating) {
					if (this.state.currentProgress !== progress.current || this.state.maxProgress !== progress.total) {
						this.setState(State.Updating(update, explicit, progress.current, progress.total));
					}
				}

				await timeout(500);
			}
		};

		const cancelTimeout = new ProcessTimeRunOnceScheduler(() => {
			this.logService.warn('update#doApplyUpdate: polling timed out waiting for update to be ready');
			this.setState(State.Idle(this.getUpdateType(), 'Update did not complete within expected time'));
		}, 60 * 60 * 1000);

		// Poll for progress and ready mutex for 1 hour.
		cancelTimeout.schedule();
		poll().finally(() => {
			cancelTimeout.dispose();
			if (!this.isCurrentUpdateAttempt(availableUpdate, updateAttempt)) {
				updateAttempt.complete();
			}
		});
	}

	private isCurrentUpdateAttempt(availableUpdate: IAvailableUpdate, updateAttempt: Win32UpdateAttempt): boolean {
		return this.isApplyingUpdate(availableUpdate)
			&& availableUpdate.updateAttempt === updateAttempt
			&& updateAttempt.isActive;
	}

	private isApplyingUpdate(availableUpdate: IAvailableUpdate): boolean {
		return this.availableUpdate === availableUpdate && this.state.type === StateType.Updating;
	}

	private completeUpdateAttempt(availableUpdate: IAvailableUpdate, updateAttempt: Win32UpdateAttempt, update: IUpdate, explicit: boolean): void {
		if (!this.isCurrentUpdateAttempt(availableUpdate, updateAttempt)) {
			return;
		}

		updateAttempt.complete();
		this.setState(State.Ready(update, explicit, this._overwrite));
	}

	private failUpdateAttempt(availableUpdate: IAvailableUpdate, updateAttempt: Win32UpdateAttempt, error: Error, stopProcess = false): void {
		if (!this.isCurrentUpdateAttempt(availableUpdate, updateAttempt)) {
			updateAttempt.complete();
			return;
		}

		updateAttempt.complete();
		this.doFailUpdateAttempt(availableUpdate, error, stopProcess).catch(stopError => {
			this.logService.error('update#doApplyUpdate: failed to stop update installer after failure', stopError);
		});
	}

	private async doFailUpdateAttempt(availableUpdate: IAvailableUpdate, error: Error, stopProcess: boolean): Promise<void> {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(error))) });
		this.logService.error('update#doApplyUpdate: update installation failed', error);

		try {
			if (stopProcess) {
				await availableUpdate.updateAttempt?.stopProcess();
			}
		} finally {
			if (this.availableUpdate === availableUpdate) {
				this.availableUpdate = undefined;
			}

			await availableUpdate.updateAttempt?.cleanup(true);

			if (!this.availableUpdate && this.state.type === StateType.Updating) {
				this.setState(State.Idle(this.updateType, localize('updateInstallFailed', "Update installation failed. Please try again.")));
			}
		}
	}

	protected override async cancelUpdate(): Promise<void> {
		// Abort an in-flight check/download so it never reaches the background installer.
		const hadInFlightCheck = !!this.checkCancellationTokenSource;
		const hadPendingUpdate = !!this.availableUpdate;
		this.checkCancellationTokenSource?.dispose(true);
		this.checkCancellationTokenSource = undefined;

		// Only clean up if a check/download was in flight; avoids creating the cache dir when just disabled.
		if (hadInFlightCheck) {
			try {
				await this.checkPromise;
			} catch {
				// the chain swallows its own errors; ignore
			}
			await this.cleanupTempFiles();
		}

		// Tear down any pending (downloaded/applying) update.
		await this.cancelPendingUpdate();

		// Reclaim a partial versioned-resource folder a cancelled update may leave; only after real teardown.
		if (hadInFlightCheck || hadPendingUpdate) {
			this.collectGarbage().catch(err => this.logService.error('update#collectGarbage - failed to collect garbage', err));
		}
	}

	private async cleanupTempFiles(): Promise<void> {
		try {
			const cachePath = await this.cachePath;
			const files = await pfs.Promises.readdir(cachePath);
			await Promise.all(files.filter(file => endsWithIgnoreCase(file, '.tmp')).map(file => this.unlink(path.join(cachePath, file))));
		} catch (err) {
			this.logService.warn('update#cleanupTempFiles: failed to remove temporary download files', err);
		}
	}

	protected override async cancelPendingUpdate(): Promise<void> {
		const availableUpdate = this.availableUpdate;
		if (!availableUpdate) {
			return;
		}

		const updateAttempt = availableUpdate.updateAttempt;

		// Another instance owns the installer: abort if it's still running so we don't start a new
		// update cycle on top of it; keep `availableUpdate` so quit-and-install can still complete.
		if (!updateAttempt?.isProcessRunning && this.isInstallerActive(await this.mutex)) {
			throw new Error('Cannot cancel pending update: another instance is still running setup');
		}

		updateAttempt?.complete();

		if (updateAttempt?.isProcessRunning) {
			this.logService.trace('update#cancelPendingUpdate: cancelling pending update');

			// Remove all listeners to prevent the exit handler from changing state
			updateProcess.removeAllListeners();
			const exitPromise = new Promise<boolean>(resolve => updateProcess.once('exit', () => resolve(true)));

			// Write the cancel file to signal Inno Setup to exit gracefully
			if (cancelFilePath) {
				try {
					await pfs.Promises.writeFile(cancelFilePath, 'cancel');
				} catch (err) {
					this.logService.warn('update#cancelPendingUpdate: failed to write cancel file', err);
				}
			}

			// Wait for the process to exit gracefully, then force-kill if needed
			const pid = updateProcess.pid;
			const exited = await Promise.race([exitPromise, timeout(30 * 1000).then(() => false)]);
			if (pid && !exited) {
				this.logService.trace('update#cancelPendingUpdate: process did not exit gracefully, killing process tree');
				await killTree(pid, true);
			}
		} else if (!updateProcess) {
			if (cancelFilePath) {
				try {
					await pfs.Promises.writeFile(cancelFilePath, 'cancel');
				} catch (err) {
					this.logService.warn('update#cancelPendingUpdate: failed to write cancel file', err);
				}
			}

			const mutex = await import('@vscode/windows-mutex');
			const setupMutexName = `${this.productService.win32MutexName}setup`;
			let retries = 30;
			while (mutex.isActive(setupMutexName) && retries > 0) {
				await timeout(1000);
				retries--;
			}
		}

		await updateAttempt?.cleanup();

		if (this.availableUpdate === availableUpdate) {
			this.availableUpdate = undefined;
		}
	}

	protected override doQuitAndInstall(): void {
		if ((this.state.type !== StateType.Ready && this.state.type !== StateType.Restarting) || !this.availableUpdate) {
			return;
		}

		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');

		if (this.availableUpdate.updateFilePath) {
			this.writeRelaunchArgumentsFile(this.cachePathSync, this.state.update.version);
			try {
				unlinkSync(this.availableUpdate.updateFilePath);
			} catch {
				// ignore
			}
		} else {
			const installerArgs = ['/silent', '/log', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'];

			// Preserve session defining arguments (e.g. --extensions-dir) across the installer relaunch (see #322663).
			const relaunchArgsFilePath = this.writeRelaunchArgumentsFile(this.cachePathSync, this.state.update.version);
			if (relaunchArgsFilePath) {
				installerArgs.push(`/relaunchargs="${relaunchArgsFilePath}"`);
			}

			spawn(this.availableUpdate.packagePath, installerArgs, {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				windowsVerbatimArguments: true,
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' }
			});
		}
	}

	private getRelaunchArgumentsFilePath(cachePath: string, version: string): string {
		return path.join(cachePath, `${RELAUNCH_ARGUMENTS_FILE_PREFIX}${version}`);
	}

	/**
	 * Writes the arguments from {@link getRelaunchArguments} to a file in the update cache and returns its path (or
	 * `undefined` when there is nothing to carry forward). The installer reads it and passes the arguments to `Shideh.exe`.
	 */
	private writeRelaunchArgumentsFile(cachePath: string, version: string): string | undefined {
		const relaunchArguments = getRelaunchArguments(this.environmentMainService.args, process.argv);
		const relaunchArgsFilePath = this.getRelaunchArgumentsFilePath(cachePath, version);

		if (!relaunchArguments) {
			try {
				unlinkSync(relaunchArgsFilePath); // remove any stale file from a previous relaunch
			} catch {
				// ignore
			}
			return undefined;
		}

		try {
			writeFileSync(relaunchArgsFilePath, relaunchArguments);
			return relaunchArgsFilePath;
		} catch (err) {
			this.logService.error('update#writeRelaunchArgumentsFile: failed to write relaunch arguments', err);
			return undefined;
		}
	}

	private async saveUpdateMetadata(update: IUpdate): Promise<void> {
		try {
			const cachePath = await this.cachePath;
			const metadataPath = path.join(cachePath, 'update-metadata.json');
			await pfs.Promises.writeFile(metadataPath, JSON.stringify(update));
		} catch (e) {
			this.logService.error('update#saveUpdateMetadata: failed to save', e);
		}
	}

	private async loadUpdateMetadata(): Promise<IUpdate | undefined> {
		try {
			const cachePath = await this.cachePath;
			const metadataPath = path.join(cachePath, 'update-metadata.json');
			if (await pfs.Promises.exists(metadataPath)) {
				const content = await readFile(metadataPath, 'utf8');
				return JSON.parse(content);
			}
		} catch (e) {
			this.logService.error('update#loadUpdateMetadata: failed to load', e);
		}
		return undefined;
	}

	protected override getUpdateType(): UpdateType {
		return getWin32UpdateType(this.productService.target);
	}

	override async _applySpecificUpdate(packagePath: string, commit?: string): Promise<void> {
		if (this.state.type !== StateType.Idle) {
			return;
		}

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		const update: IUpdate = await this.loadUpdateMetadata() ?? { version: commit ?? 'unknown', productVersion: 'unknown' };

		this.setState(State.Downloading(update, true, false));
		this.availableUpdate = { packagePath };
		this.setState(State.Downloaded(update, true, false));

		const mutex = await this.getWindowsMutex('_applySpecificUpdate');
		if (mutex && this.isInstallerMutexActive(mutex)) {
			this.logService.info('update#_applySpecificUpdate: installer already running during recovery, not spawning a second setup');
			this.logApplyBreadcrumb('recovery_with_active_installer');
		}

		if (fastUpdatesEnabled && this.productService.target === 'user') {
			this.doApplyUpdate();
		} else {
			this.setState(State.Ready(update, true, false));
		}
	}

	private isInstallerActive(mutex: IWindowsMutex): boolean {
		return mutex.isActive(this.updatingMutexName) || mutex.isActive(this.setupMutexName);
	}

	private async unlink(path: string | undefined): Promise<void> {
		if (path) {
			try {
				await unlink(path);
			} catch (err) {
				const error = err as NodeJS.ErrnoException;
				if (error && error.code === 'ENOENT') {
					return;
				} else {
					this.logService.warn(`update#unlink: failed to unlink ${basename(path)}`, err);
				}
			}
		}
	}

	private async gc(): Promise<void> {
		try {
			// 1) Use app.getPath('exe') to get the path to current executable file and store the basename of the exe file
			const exePath = app.getPath('exe');
			const exeBasename = path.basename(exePath);
			const exeBasenameWithoutExt = path.basename(exePath, '.exe');
			const appInstallPath = path.dirname(exePath);
			this.logService.trace(`update#gc - exe path: ${exePath}, basename: ${exeBasename}, app install path: ${appInstallPath}`);

			// 2) Get current commit via this.productService.commit and store only first 10char in a variable
			const commitShort = this.productService.commit?.substring(0, 10);
			if (!commitShort) {
				this.logService.trace('update#gc - no commit hash available, skipping gc');
				return;
			}
			this.logService.trace('update#gc - commit short:', commitShort);

			// 3) If there is a file called `old_{exe basename}` in the app install folder then perform the following
			const oldExeFile = path.join(appInstallPath, `old_${exeBasename}`);
			const oldExeExists = await pfs.Promises.exists(oldExeFile);

			if (!oldExeExists) {
				this.logService.trace('update#gc - old exe file does not exist, skipping gc');
				return;
			}

			this.logService.trace('update#gc - old exe file found, performing cleanup');

			// 4) Delete all files and folders except for the following
			const entries = await pfs.Promises.readdir(appInstallPath, { withFileTypes: true });
			const entriesToRemove = new Set<string>();

			for (const entry of entries) {
				const entryPath = path.join(appInstallPath, entry.name);
				let shouldKeep = false;

				// a) current exe file
				if (entry.isFile() && entry.name === exeBasename) {
					shouldKeep = true;
				}
				// b) bin folder under app install directory (but clean old_ files inside it)
				else if (entry.isDirectory() && entry.name === 'bin') {
					shouldKeep = true;
					// Clean old_ files from bin folder
					try {
						const binEntries = await pfs.Promises.readdir(entryPath, { withFileTypes: true });
						for (const binEntry of binEntries) {
							if (binEntry.isFile() && binEntry.name.startsWith('old_')) {
								const binEntryPath = path.join(entryPath, binEntry.name);
								entriesToRemove.add(binEntryPath);
							}
						}
					} catch (err) {
						this.logService.warn('update#gc - failed to read bin directory:', err);
					}
				}
				// c) {Exe basename}.VisualElementsManifest.xml
				else if (entry.isFile() && entry.name === `${exeBasenameWithoutExt}.VisualElementsManifest.xml`) {
					shouldKeep = true;
				}
				// d) unins*.* files
				else if (entry.isFile() && entry.name.startsWith('unins')) {
					shouldKeep = true;
				}
				// e) directory whose name matches the commit value from 4)
				else if (entry.isDirectory() && entry.name === commitShort) {
					shouldKeep = true;
				}

				if (!shouldKeep) {
					entriesToRemove.add(entryPath);
				}
			}

			// Remove collected entries
			for (const entryPath of entriesToRemove) {
				this.logService.trace('update#gc - removing:', entryPath);
				try {
					await pfs.Promises.rm(entryPath, pfs.RimRafMode.MOVE);
					this.logService.trace('update#gc - removed:', entryPath);
				} catch (err) {
					this.logService.warn('update#gc - failed to remove:', entryPath, err);
				}
			}

			this.logService.info('update#gc - garbage collection completed successfully');
		} catch (error) {
			this.logService.error('update#gc - garbage collection failed:', error);
		}
	}
}
