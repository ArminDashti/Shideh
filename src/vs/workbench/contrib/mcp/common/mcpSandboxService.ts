/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { untildify } from '../../../../base/common/labels.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { dirname, posix, win32 } from '../../../../base/common/path.js';
import { OperatingSystem, OS } from '../../../../base/common/platform.js';
import { arch } from '../../../../base/common/process.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMcpResourceScannerService, McpResourceTarget } from '../../../../platform/mcp/common/mcpResourceScannerService.js';
import { IRemoteAgentEnvironment } from '../../../../platform/remote/common/remoteAgentEnvironment.js';
import { SandboxHelperChannelName, type ISandboxProcess, type ISandboxRuntimeConfig } from '../../../../platform/sandbox/common/sandboxHelperIpc.js';
import { ISandboxHelperService } from '../../../../platform/sandbox/common/sandboxHelperService.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IMcpSandboxConfiguration } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { IMcpPotentialSandboxBlock, McpServerDefinition, McpServerLaunch, McpServerTransportType } from './mcpTypes.js';


export const IMcpSandboxService = createDecorator<IMcpSandboxService>('mcpSandboxService');

export interface IMcpSandboxService {
	readonly _serviceBrand: undefined;
	launchInSandboxIfEnabled(serverDef: McpServerDefinition, launch: McpServerLaunch, remoteAuthority: string | undefined, configTarget: ConfigurationTarget): Promise<McpServerLaunch>;
	isEnabled(serverDef: McpServerDefinition, serverLabel?: string): Promise<boolean>;
	getSandboxConfigSuggestionMessage(serverLabel: string, potentialBlocks: readonly IMcpPotentialSandboxBlock[], existingSandboxConfig?: IMcpSandboxConfiguration): SandboxConfigSuggestionResult | undefined;
	applySandboxConfigSuggestion(serverDef: McpServerDefinition, mcpResource: URI, configTarget: ConfigurationTarget, potentialBlocks: readonly IMcpPotentialSandboxBlock[], suggestedSandboxConfig?: IMcpSandboxConfiguration): Promise<boolean>;
}

type SandboxConfigSuggestions = {
	allowWrite: readonly string[];
	allowedDomains: readonly string[];
};

type SandboxConfigSuggestionResult = {
	message: string;
	sandboxConfig: IMcpSandboxConfiguration;
};

type ISandboxHelperChannel = {
	wrapProcessWithSandbox(runtimeConfig: ISandboxRuntimeConfig, process: ISandboxProcess): Promise<ISandboxProcess>;
};

export function mcpDefaultCwdToFsPath(resource: URI, os: OperatingSystem): string {
	let value = resource.scheme === Schemas.file && resource.authority ? `//${resource.authority}${resource.path}` : resource.path;
	if (os === OperatingSystem.Windows) {
		if (/^\/[a-zA-Z]:/.test(value)) {
			value = value.slice(1);
		}
		value = value.replace(/\//g, '\\');
	}
	return value;
}

export function resolveMcpServerSandboxWorkingDirectory(cwd: string | undefined, defaultCwd: URI | undefined, userHome: URI | undefined, os: OperatingSystem): string | undefined {
	const targetDefaultCwd = defaultCwd ? mcpDefaultCwdToFsPath(defaultCwd, os) : undefined;
	if (!cwd) {
		return targetDefaultCwd;
	}
	const targetUserHome = userHome ? mcpDefaultCwdToFsPath(userHome, os) : undefined;
	const expandedCwd = targetUserHome ? untildify(cwd, targetUserHome) : cwd;
	const path = os === OperatingSystem.Windows ? win32 : posix;
	const base = targetDefaultCwd ?? targetUserHome;
	return base && !path.isAbsolute(expandedCwd) ? path.join(base, expandedCwd) : expandedCwd;
}

export class McpSandboxService extends Disposable implements IMcpSandboxService {
	readonly _serviceBrand: undefined;

	private _remoteEnvDetailsPromise: Promise<IRemoteAgentEnvironment | null>;
	private readonly _defaultAllowedDomains: readonly string[] = ['registry.npmjs.org']; // Default allowed domains that are commonly needed for MCP servers, even if the user doesn't specify them in their sandbox config
	private _defaultAllowWritePaths: string[] = ['~/.npm'];

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IMcpResourceScannerService private readonly _mcpResourceScannerService: IMcpResourceScannerService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@ISandboxHelperService private readonly _localSandboxHelperService: ISandboxHelperService,
	) {
		super();
		this._remoteEnvDetailsPromise = this._remoteAgentService.getEnvironment();
	}

	public async isEnabled(serverDef: McpServerDefinition, remoteAuthority?: string): Promise<boolean> {
		const os = await this._getOperatingSystem(remoteAuthority);
		if (os === OperatingSystem.Windows) {
			return false;
		}
		return !!serverDef.sandboxEnabled;
	}

	public async launchInSandboxIfEnabled(serverDef: McpServerDefinition, launch: McpServerLaunch, remoteAuthority: string | undefined, _configTarget: ConfigurationTarget): Promise<McpServerLaunch> {
		if (launch.type !== McpServerTransportType.Stdio) {
			return launch;
		}
		if (await this.isEnabled(serverDef, remoteAuthority)) {
			this._logService.trace(`McpSandboxService: Launching with config target ${configTarget}`);
			const launchCwd = resolveMcpServerSandboxWorkingDirectory(
				launch.cwd,
				serverDef.defaultCwd,
				await this._getUserHome(remoteAuthority),
				await this._getOperatingSystem(remoteAuthority),
			);
			const launchDetails = await this._resolveSandboxLaunchDetails(configTarget, remoteAuthority, launch.sandbox, launchCwd);
			const quotedCommand = this._quoteShellArgument(launch.command);
			const quotedArgs = launch.args.map(arg => this._quoteShellArgument(arg));
			const sandboxArgs = this._getSandboxCommandArgs(quotedCommand, quotedArgs, launchDetails.sandboxConfigPath);
			const sandboxEnv = await this._getSandboxEnvVariables(launch.env, launchDetails.tempDir, launchDetails.rgPath, remoteAuthority);
			if (launchDetails.srtPath) {
				if (launchDetails.execPath) {
					return {
						...launch,
						command: launchDetails.execPath,
						args: [launchDetails.srtPath, ...sandboxArgs],
						env: sandboxEnv,
						type: McpServerTransportType.Stdio,
					};
				} else {
					return {
						...launch,
						command: launchDetails.srtPath,
						args: sandboxArgs,
						env: sandboxEnv,
						type: McpServerTransportType.Stdio,
					};
				}
			}
		}
		return launch;
	}

	public getSandboxConfigSuggestionMessage(serverLabel: string, potentialBlocks: readonly IMcpPotentialSandboxBlock[], existingSandboxConfig?: IMcpSandboxConfiguration): SandboxConfigSuggestionResult | undefined {
		const suggestions = this._getSandboxConfigSuggestions(potentialBlocks, existingSandboxConfig);
		if (!suggestions) {
			return undefined;
		}

		const allowWriteList = suggestions.allowWrite;
		const allowedDomainsList = suggestions.allowedDomains;
		const suggestionLines: string[] = [];

		if (allowedDomainsList.length) {
			const shown = allowedDomainsList.map(domain => `"${domain}"`).join(', ');
			suggestionLines.push(localize('mcpSandboxSuggestion.allowedDomains', "Add to `sandbox.network.allowedDomains`: {0}", shown));
		}

		if (allowWriteList.length) {
			const shown = allowWriteList.map(path => `"${path}"`).join(', ');
			suggestionLines.push(localize('mcpSandboxSuggestion.allowWrite', "Add to `sandbox.filesystem.allowWrite`: {0}", shown));
		}

		const sandboxConfig: IMcpSandboxConfiguration = {};
		if (allowedDomainsList.length) {
			sandboxConfig.network = { allowedDomains: [...allowedDomainsList] };
		}
		if (allowWriteList.length) {
			sandboxConfig.filesystem = { allowWrite: [...allowWriteList] };
		}

		return {
			message: localize(
				'mcpSandboxSuggestion.message',
				"The MCP server {0} reported potential sandbox blocks. VS Code found possible sandbox configuration updates:\n{1}",
				serverLabel,
				suggestionLines.join('\n')
			),
			sandboxConfig,
		};
	}

	public async applySandboxConfigSuggestion(serverDef: McpServerDefinition, mcpResource: URI, configTarget: ConfigurationTarget, potentialBlocks: readonly IMcpPotentialSandboxBlock[], suggestedSandboxConfig?: IMcpSandboxConfiguration): Promise<boolean> {
		const scanTarget = this._toMcpResourceTarget(configTarget);
		let didChange = false;
		const existingSandbox = serverDef.launch.type === McpServerTransportType.Stdio ? serverDef.launch.sandbox : undefined;

		await this._mcpResourceScannerService.updateSandboxConfig(serverDef.label, currentSandbox => {
			const effectiveSandbox = currentSandbox ?? existingSandbox;
			const suggestedAllowedDomains = suggestedSandboxConfig?.network?.allowedDomains ?? [];
			const suggestedAllowWrite = suggestedSandboxConfig?.filesystem?.allowWrite ?? [];

			const currentAllowedDomains = new Set(effectiveSandbox?.network?.allowedDomains ?? []);
			for (const domain of suggestedAllowedDomains) {
				if (domain && !currentAllowedDomains.has(domain)) {
					currentAllowedDomains.add(domain);
				}
			}

			const currentAllowWrite = new Set(effectiveSandbox?.filesystem?.allowWrite ?? []);
			for (const path of suggestedAllowWrite) {
				if (path && !currentAllowWrite.has(path)) {
					currentAllowWrite.add(path);
				}
			}

			if (suggestedAllowedDomains.length === 0 && suggestedAllowWrite.length === 0) {
				return currentSandbox;
			}

			didChange = true;
			const nextSandboxConfig: IMcpSandboxConfiguration = {};
			if (currentAllowedDomains.size > 0) {
				nextSandboxConfig.network = {
					...effectiveSandbox?.network,
					allowedDomains: [...currentAllowedDomains]
				};
			}
			if (currentAllowWrite.size > 0) {
				nextSandboxConfig.filesystem = {
					...effectiveSandbox?.filesystem,
					allowWrite: [...currentAllowWrite],
				};
			}
			return nextSandboxConfig;
		}, mcpResource, scanTarget);

		return didChange;
	}

	private _getSandboxConfigSuggestions(potentialBlocks: readonly IMcpPotentialSandboxBlock[], existingSandboxConfig?: IMcpSandboxConfiguration): SandboxConfigSuggestions | undefined {
		if (!potentialBlocks.length) {
			return undefined;
		}

		const allowWrite = new Set<string>();
		const allowedDomains = new Set<string>();
		const existingAllowWrite = new Set(existingSandboxConfig?.filesystem?.allowWrite ?? []);
		const existingAllowedDomains = new Set(existingSandboxConfig?.network?.allowedDomains ?? []);

		for (const block of potentialBlocks) {
			if (block.kind === 'network' && block.host && !existingAllowedDomains.has(block.host)) {
				allowedDomains.add(block.host);
			}

			if (block.kind === 'filesystem' && block.path && !existingAllowWrite.has(block.path)) {
				allowWrite.add(block.path);
			}
		}

		if (!allowWrite.size && !allowedDomains.size) {
			return undefined;
		}

		return {
			allowWrite: [...allowWrite],
			allowedDomains: [...allowedDomains],
		};
	}

	private _toMcpResourceTarget(configTarget: ConfigurationTarget): McpResourceTarget {
		switch (configTarget) {
			case ConfigurationTarget.USER:
			case ConfigurationTarget.USER_LOCAL:
			case ConfigurationTarget.USER_REMOTE:
				return ConfigurationTarget.USER;
			case ConfigurationTarget.WORKSPACE:
				return ConfigurationTarget.WORKSPACE;
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return ConfigurationTarget.WORKSPACE_FOLDER;
			default:
				return ConfigurationTarget.USER;
		}
	}

	private async _resolveSandboxLaunchDetails(configTarget: ConfigurationTarget, remoteAuthority?: string, sandboxConfig?: IMcpSandboxConfiguration, launchCwd?: string): Promise<SandboxLaunchDetails> {
		const os = await this._getOperatingSystem(remoteAuthority);
		if (os === OperatingSystem.Windows) {
			return { execPath: undefined, srtPath: undefined, rgPath: undefined, sandboxConfigPath: undefined, tempDir: undefined };
		}

		const appRoot = await this._getAppRoot(remoteAuthority);
		const execPath = await this._getExecPath(os, appRoot, remoteAuthority);
		const tempDir = await this._getTempDir(remoteAuthority);
		const srtPath = this._pathJoin(os, appRoot, 'node_modules', '@vscode', 'sandbox-runtime', 'dist', 'cli.js');
		// @vscode/ripgrep-universal ships per-platform-arch binaries under bin/{platform}-{arch}/{rg|rg.exe}
		// Windows is handled by the early return above, so os is narrowed to Mac/Linux here.
		const rgPlatform = os === OperatingSystem.Macintosh ? 'darwin' : 'linux';
		const rgPath = this._pathJoin(os, appRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', `${rgPlatform}-${arch}`, 'rg');
		const sandboxConfigPath = tempDir ? await this._updateSandboxConfig(tempDir, configTarget, sandboxConfig, launchCwd) : undefined;
		this._logService.debug(`McpSandboxService: Updated sandbox config path: ${sandboxConfigPath}`);
		return { execPath, srtPath, rgPath, sandboxConfigPath, tempDir };
	}

	private async _getExecPath(os: OperatingSystem, appRoot: string, remoteAuthority?: string): Promise<string | undefined> {
		if (remoteAuthority) {
			return this._pathJoin(os, appRoot, 'node');
		}
		return undefined; // Use Electron executable as the default exec path for local development, which will run the sandbox runtime wrapper with Electron in node mode. For remote, we need to specify the node executable to ensure it runs with Node.js.
	}

	private async _getSandboxEnvVariables(baseEnv: McpServerTransportStdio['env'], tempDir: URI | undefined, rgPath: string | undefined, remoteAuthority?: string): Promise<McpServerTransportStdio['env']> {
		let env: McpServerTransportStdio['env'] = { ...baseEnv };
		if (tempDir) {
			env = { ...env, TMPDIR: tempDir.path, SRT_DEBUG: 'true', NODE_USE_ENV_PROXY: '1' };
		}
		if (rgPath) {
			env = { ...env, PATH: env['PATH'] ? `${env['PATH']}${await this._getPathDelimiter(remoteAuthority)}${dirname(rgPath)}` : dirname(rgPath) };
		}
		if (!remoteAuthority) {
			// Add any remote-specific environment variables here
			env = { ...env, ELECTRON_RUN_AS_NODE: '1' };
		}
		// Ensure VSCODE_INSPECTOR_OPTIONS is not inherited by the sandboxed process, as it can cause issues with sandboxing.
		env['VSCODE_INSPECTOR_OPTIONS'] = null;
		return env;
	}

	private _getSandboxCommandArgs(command: string, args: readonly string[], sandboxConfigPath: string | undefined): string[] {
		const result: string[] = [];
		if (sandboxConfigPath) {
			result.push('--settings', sandboxConfigPath);
			result.push('--');
		}
		result.push(command, ...args);
		return result;
	}

	private async _getRemoteEnv(remoteAuthority?: string): Promise<IRemoteAgentEnvironment | null> {
		if (!remoteAuthority) {
			return null;
		}
		return this._remoteEnvDetailsPromise;
	}

	private async _getUserHome(remoteAuthority?: string): Promise<URI | undefined> {
		const remoteEnv = await this._getRemoteEnv(remoteAuthority);
		if (remoteEnv) {
			return remoteEnv.userHome;
		}
		const nativeEnv = this._environmentService as IEnvironmentService & { userHome?: URI };
		return nativeEnv.userHome;
	}

	private async _getOperatingSystem(remoteAuthority?: string): Promise<OperatingSystem> {
		const remoteEnv = await this._getRemoteEnv(remoteAuthority);
		if (remoteEnv) {
			return remoteEnv.os;
		}
		return OS;
	}

	// this method merges the default allowWrite paths and allowedDomains with the ones provided in the sandbox config, to ensure that the default necessary paths and domains are always included in the sandbox config used for launching,
	//  even if they are not explicitly specified in the config provided by the user or the MCP server config.
	private _withDefaultSandboxConfig(sandboxConfig?: IMcpSandboxConfiguration, launchCwd?: string): IMcpSandboxConfiguration {
		const mergedAllowWrite = new Set(sandboxConfig?.filesystem?.allowWrite ?? []);
		for (const defaultAllowWrite of this._getDefaultAllowWrite(launchCwd ? [launchCwd] : undefined)) {
			if (defaultAllowWrite) {
				mergedAllowWrite.add(defaultAllowWrite);
			}
		}

		const mergedAllowedDomains = new Set(sandboxConfig?.network?.allowedDomains ?? []);
		for (const defaultAllowedDomain of this._defaultAllowedDomains) {
			if (defaultAllowedDomain) {
				mergedAllowedDomains.add(defaultAllowedDomain);
			}
		}

		return {
			...sandboxConfig,
			network: {
				allowedDomains: [...mergedAllowedDomains],
				deniedDomains: sandboxConfig?.network?.deniedDomains ?? [],
			},
			filesystem: {
				allowWrite: [...mergedAllowWrite],
				denyRead: sandboxConfig?.filesystem?.denyRead ?? [],
				denyWrite: sandboxConfig?.filesystem?.denyWrite ?? [],
			},
		};
	}

	private _getDefaultAllowWrite(directories?: string[]): readonly string[] {
		for (const launchCwd of directories ?? []) {
			const trimmed = launchCwd.trim();
			if (trimmed) {
				this._defaultAllowWritePaths.push(trimmed);
			}
		}
		return this._defaultAllowWritePaths;
	}

	private _getSandboxHelperService(remoteAuthority?: string): ISandboxHelperChannel {
		const connection = this._remoteAgentService.getConnection();
		return remoteAuthority && connection
			? ProxyChannel.toService<ISandboxHelperChannel>(connection.getChannel(SandboxHelperChannelName))
			: this._localSandboxHelperService;
	}

}
