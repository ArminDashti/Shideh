/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ITerminalSandboxService } from '../../common/terminalSandboxService.js';
import type { IOutputAnalyzer, IOutputAnalyzerOptions } from './outputAnalyzer.js';
import { TerminalChatAgentToolsSettingId } from '../../common/terminalChatAgentToolsConfiguration.js';
import { AgentNetworkDomainSettingId } from '../../../../../../platform/networkFilter/common/settings.js';
import { AgentSandboxSettingId } from '../../../../../../platform/sandbox/common/settings.js';

export class SandboxOutputAnalyzer extends Disposable implements IOutputAnalyzer {
	constructor(
		@ITerminalSandboxService private readonly _sandboxService: ITerminalSandboxService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	async analyze(options: IOutputAnalyzerOptions): Promise<string | undefined> {
		if (!options.isSandboxWrapped) {
			return undefined;
		}

		const knownFailure = options.exitCode !== undefined && options.exitCode !== 0;

		if (!knownFailure) {
			return undefined;
		}

		const os = await this._sandboxService.getOS();
		let fileSystemSetting: TerminalChatAgentToolsSettingId;
		switch (os) {
			case OperatingSystem.Linux:
				fileSystemSetting = TerminalChatAgentToolsSettingId.AgentSandboxLinuxFileSystem;
				break;
			case OperatingSystem.Windows:
				fileSystemSetting = TerminalChatAgentToolsSettingId.AgentSandboxWindowsFileSystem;
				break;
			default:
				fileSystemSetting = TerminalChatAgentToolsSettingId.AgentSandboxMacFileSystem;
				break;
		}

		const prefix = knownFailure
			? 'Command failed while running in sandboxed mode. If the command failed due to sandboxing:'
			: 'Command ran in sandboxed mode and may have been blocked by the sandbox. If the command failed due to sandboxing:';
		const retryWithAllowNetworkRequests = this._configurationService.getValue<boolean>(AgentSandboxSettingId.AgentSandboxRetryWithAllowNetworkRequests) === true;
		const networkRecovery = retryWithAllowNetworkRequests
			? '- If you determine from the output that the failure was caused by blocked network access, immediately retry the command with requestAllowNetwork=true and provide requestAllowNetworkReason. This keeps the command sandboxed with unrestricted network access and automatically shows a confirmation prompt to the user.\n- If it is not a network restriction, or the command still fails after retrying with requestAllowNetwork=true, immediately retry the command with requestUnsandboxedExecution=true and provide requestUnsandboxedExecutionReason. Do NOT ask the user - setting this flag automatically shows a confirmation prompt to the user.'
			: '- Sandboxed execution with unrestricted network access is disabled by chat.agent.sandbox.retryWithAllowNetworkRequests. Do not set requestAllowNetwork=true.\n- If the command cannot be made to work by updating sandbox rules, immediately retry it with requestUnsandboxedExecution=true and provide requestUnsandboxedExecutionReason. Do NOT ask the user - setting this flag automatically shows a confirmation prompt to the user.';
		return `${prefix}
- If it would be reasonable to extend the sandbox rules, work with the user to update allowWrite for file system access problems in ${fileSystemSetting}, or to add required domains to ${AgentNetworkDomainSettingId.AllowedNetworkDomains}.
- If the output contains 'No such file or directory', treat it as a sandbox access error and immediately retry the command with requestUnsandboxedExecution=true and provide requestUnsandboxedExecutionReason.
${networkRecovery}

Here is the output of the command:\n`;
	}

	private _withNpxRetrySuggestion(commandLine: string): string | undefined {
		const rewrittenCommandLine = this._rewriteNpxCommand(commandLine);
		if (!rewrittenCommandLine) {
			return undefined;
		}

		return localize(
			'runInTerminalTool.sandboxNpxRetrySuggestion',
			"Command failed while running in sandboxed mode. If this command uses npx in the sandbox, retry it as {0}.",
			`\`${rewrittenCommandLine}\``
		);
	}

	private _rewriteNpxCommand(commandLine: string): string | undefined {
		if (!/\bnpx\b/.test(commandLine)) {
			return undefined;
		}

		return commandLine.replace(/\bnpx\b/, 'node --import npx');
	}

	private async _askToAddDomain(domain: string, chatSessionResource: IOutputAnalyzerOptions['chatSessionResource'], chatRequestId: string | undefined, token: CancellationToken): Promise<boolean | undefined> {
		if (!chatSessionResource) {
			return undefined;
		}

		try {
			const result = await this._languageModelToolsService.invokeTool({
				callId: generateUuid(),
				toolId: AskQuestionsToolId,
				parameters: {
					questions: [{
						header: addDomainQuestionHeader,
						question: localize('runInTerminalTool.sandboxDomainQuestion', 'Add {0} to the terminal sandbox allowed domains?', domain),
						options: [{
							label: localize('runInTerminalTool.sandboxDomainQuestion.add', 'Add Domain'),
							recommended: true,
						}, {
							label: localize('runInTerminalTool.sandboxDomainQuestion.skip', 'Do Not Add'),
						}]
					}]
				},
				context: { sessionResource: chatSessionResource },
				chatRequestId,
			}, async () => 0, token);

			const answer = this._parseAskQuestionsAnswer(result, addDomainQuestionHeader);
			if (!answer || answer.skipped || !answer.selected.includes(localize('runInTerminalTool.sandboxDomainQuestion.add', 'Add Domain'))) {
				return false;
			}

			return this._sandboxService.addDomainToAllowedDomains(domain);
		} catch {
			return undefined;
		}
	}

	private async _askToAddPath(path: string, chatSessionResource: IOutputAnalyzerOptions['chatSessionResource'], chatRequestId: string | undefined, token: CancellationToken): Promise<boolean | undefined> {
		if (!chatSessionResource) {
			return undefined;
		}

		try {
			const result = await this._languageModelToolsService.invokeTool({
				callId: generateUuid(),
				toolId: AskQuestionsToolId,
				parameters: {
					questions: [{
						header: addPathQuestionHeader,
						question: localize('runInTerminalTool.sandboxPathQuestion', 'Add {0} to the terminal sandbox allowWrite list?', path),
						options: [{
							label: localize('runInTerminalTool.sandboxPathQuestion.add', 'Add Path'),
							recommended: true,
						}, {
							label: localize('runInTerminalTool.sandboxPathQuestion.skip', 'Do Not Add'),
						}]
					}]
				},
				context: { sessionResource: chatSessionResource },
				chatRequestId,
			}, async () => 0, token);

			const answer = this._parseAskQuestionsAnswer(result, addPathQuestionHeader);
			if (!answer || answer.skipped || !answer.selected.includes(localize('runInTerminalTool.sandboxPathQuestion.add', 'Add Path'))) {
				return false;
			}

			return this._sandboxService.addPathToAllowedWrite(path);
		} catch {
			return undefined;
		}
	}

	private _parseAskQuestionsAnswer(result: Awaited<ReturnType<ILanguageModelToolsService['invokeTool']>>, header: string): { selected: string[]; skipped: boolean } | undefined {
		const resultText = result.content.find(part => part.kind === 'text');
		if (!resultText) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(resultText.value) as { answers?: Record<string, { selected?: string[]; skipped?: boolean }> };
			const answer = parsed.answers?.[header];
			if (!answer) {
				return undefined;
			}

			return {
				selected: answer.selected ?? [],
				skipped: answer.skipped ?? false,
			};
		} catch {
			return undefined;
		}
	}

	private _findBlockedDomain(exitResult: string): string | undefined {
		const lines = exitResult.split(/\r?\n/);
		for (const line of lines) {
			if (!networkLinePattern.test(line)) {
				continue;
			}

			const domain = this._extractDomainCandidate(line);
			if (domain) {
				return domain;
			}
		}

		if (!networkIssuePattern.test(exitResult)) {
			return undefined;
		}

		return this._extractDomainCandidate(exitResult);
	}

	private _findBlockedFileSystemPath(exitResult: string): string | undefined {
		const lines = exitResult.split(/\r?\n/);
		for (const line of lines) {
			const blockedPath = this._extractFileSystemPathCandidate(line);
			if (blockedPath) {
				return blockedPath;
			}
		}
		return this._extractFileSystemPathCandidate(exitResult);
	}

	private _extractDomainCandidate(text: string): string | undefined {
		for (const match of text.matchAll(domainCandidatePattern)) {
			const candidate = match.groups?.urlHost ?? match.groups?.host;
			const normalized = this._normalizeDomain(candidate);
			if (normalized) {
				return normalized;
			}
		}

		return undefined;
	}

	private _extractFileSystemPathCandidate(text: string): string | undefined {
		for (const match of text.matchAll(filesystemPathCandidatePattern)) {
			const candidate = this._normalizePath(match.groups?.path);
			if (!candidate) {
				continue;
			}

			const permissionPath = this._toPermissionPath(candidate, text);
			if (permissionPath) {
				return permissionPath;
			}
		}

		return undefined;
	}

	private _normalizeDomain(domain: string | undefined): string | undefined {
		if (!domain) {
			return undefined;
		}

		return domain.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '').replace(/:\d+$/, '') || undefined;
	}

	private _toPermissionPath(path: string, line: string): string | undefined {
		if (path === '/' || path === '.' || path === '..' || path.endsWith('/')) {
			return path;
		}

		if (/(writing to|reading from|open|opening|mkdir|create directory|creating directory|touch|redirect|permission denied|operation not permitted|read-only file system)/i.test(line)) {
			const parent = posixDirname(path);
			return parent === '.' && !path.startsWith('.') ? path : parent;
		}

		return path;
	}

	private _normalizePath(path: string | undefined): string | undefined {
		if (!path) {
			return undefined;
		}

		const trimmedPath = path.trim().replace(/^['"`]+|['"`]+$/g, '');
		if (!trimmedPath) {
			return undefined;
		}

		const normalizedPath = posix.normalize(trimmedPath.replace(/\\/g, '/'));
		if (normalizedPath === '/') {
			return normalizedPath;
		}

		return normalizedPath.replace(/\/+$/, '') || undefined;
	}
}

/**
 * Checks whether the command output contains strings that typically indicate
 * the sandbox blocked the operation. The output may contain newlines inserted
 * by terminal wrapping, so we strip them before testing.
 */
export function outputLooksSandboxBlocked(output: string): boolean {
	const normalized = output.replace(/\n/g, ' ');
	return /Operation not permitted|Permission denied|Read-only file system|sandbox-exec|bwrap|sandbox_violation|No such file or directory/i.test(normalized);
}

/**
 * Checks whether output clearly suggests a network failure. This is used only
 * to select automatic allow-network retries and prevent automatic unsandboxing.
 */
export function outputLooksSandboxNetworkBlocked(output: string): boolean {
	const normalized = output.replace(/\n/g, ' ');
	return /Could not resolve host|Temporary failure in name resolution|Name or service not known|EAI_AGAIN|ENETUNREACH|Network is unreachable|Received HTTP code 403 from proxy after CONNECT|network (?:access )?(?:blocked|disabled)|(?:connect|socket).*(?:Operation not permitted|Permission denied)|(?:Operation not permitted|Permission denied).*(?:connect|socket)/i.test(normalized);
}
