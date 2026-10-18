/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vArray, vBoolean, vEnum, vNumber, vObj, vOptionalProp, vString, type ValidatorType } from '../../../base/common/validation.js';
import type { IDevContainerAgentHostConnectResult } from './devContainerAgentHost.js';
import type { IAgentPluginInstallResult, IAgentPluginMarketplaceSnapshot } from './agent.js';
import type { AgentHostDebugLogsArtifactKind, IAgentHostManagedSettingsDiagnostics, IAgentHostNetworkDiagnosticsInfo, IAgentHostNetworkFetchResult } from './agentService.js';
import type { InitializeResult } from './state/protocol/common/commands.js';
import type { McpAuthRequirement } from './state/protocol/channels-session/state.js';
import { AgentHostArtifactRemovalCapabilityMetaKey } from './meta/agentHostArtifactRemovalMeta.js';
import { AgentHostSessionImportCapabilityMetaKey } from './meta/agentHostSessionImportMeta.js';
import { AgentHostDevContainersCapabilityMetaKey } from './meta/agentHostDevContainersMeta.js';
import { AgentHostTimingCapabilityMetaKey, ChatUserInteractionCapability } from './meta/agentHostTimingMeta.js';
import type { IAgentHostFirstResponseDiagnostic } from './otel/agentHostTiming.js';
import type { IChatUserInteractionTiming } from '../../otel/common/chatUserInteraction.js';
import { AgentHostAutomationHistoryCapabilityMetaKey, AgentHostAutonomousAutomationsCapabilityMetaKey } from './meta/agentHostAutomationsMeta.js';
import { AgentHostCanvasesCapabilityMetaKey } from './meta/agentHostCanvasesMeta.js';

export { supportsAgentHostArtifactRemoval } from './meta/agentHostArtifactRemovalMeta.js';
export { supportsAgentHostCanvases } from './meta/agentHostCanvasesMeta.js';
export { supportsAgentHostDevContainers } from './meta/agentHostDevContainersMeta.js';
export { supportsAgentHostSessionPluginMarketplaces } from './meta/agentHostSessionPluginMarketplacesMeta.js';

export const DevContainerIsDockerAvailableExtensionMethod = 'vscode/devContainers/isDockerAvailable';
export const DevContainerConnectExtensionMethod = 'vscode/devContainers/connect';
export const DevContainerDisconnectExtensionMethod = 'vscode/devContainers/disconnect';
export const DevContainerStopExtensionMethod = 'vscode/devContainers/stop';
export const DevContainerRemoveExtensionMethod = 'vscode/devContainers/remove';
export const DevContainerRelaySendExtensionMethod = 'vscode/devContainers/relaySend';
export const DevContainerRelayMessageNotification = 'vscode/devContainers/relayMessage';
export const DevContainerRelayCloseNotification = 'vscode/devContainers/relayClose';
export const DevContainerCloseConnectionNotification = 'vscode/devContainers/closeConnection';
export const DevContainerOutputNotification = 'vscode/devContainers/output';

export const devContainerConnectionParamsValidator = vObj({ connectionId: vString() });
export const devContainerConnectParamsValidator = vObj({ connectionId: vString(), workspaceFolder: vString(), name: vString(), resume: vOptionalProp(vBoolean()) });
export const devContainerWorkspaceParamsValidator = vObj({ workspaceFolder: vString() });
export const devContainerRelayMessageValidator = vObj({ connectionId: vString(), data: vString() });
export const devContainerConnectResultValidator = vObj({
	connectionId: vString(),
	address: vString(),
	name: vString(),
	remoteWorkspaceFolder: vString(),
	hostWorkspaceFolder: vOptionalProp(vString()),
});

export const CollectAgentHostDebugLogsExtensionMethod = 'vscode/collectAgentHostDebugLogs';
export const GetAgentHostSessionStateFileExtensionMethod = 'vscode/getAgentHostSessionStateFile';
export const CreateAgentHostDetachedWorktreeExtensionMethod = 'vscode/createAgentHostDetachedWorktree';
export const ClaimAgentHostDetachedWorktreeExtensionMethod = 'vscode/claimAgentHostDetachedWorktree';
export const DeleteAgentHostDetachedWorktreeExtensionMethod = 'vscode/deleteAgentHostDetachedWorktree';
export const ReconcileAgentHostDetachedWorktreesExtensionMethod = 'vscode/reconcileAgentHostDetachedWorktrees';
export const ReadAgentHostDebugLogsChunkExtensionMethod = 'vscode/readAgentHostDebugLogsChunk';
export const SetAgentHostDetachedWorktreeArchivedExtensionMethod = 'vscode/setAgentHostDetachedWorktreeArchived';
export const RequestAgentHostWorkspaceTrustExtensionMethod = 'vscode/requestWorkspaceTrust';
export const RequestAgentHostMcpAuthenticationExtensionMethod = 'vscode/requestMcpAuthentication';
export const RemoveSessionArtifactExtensionMethod = 'vscode/removeSessionArtifact';
export const ImportSessionExtensionMethod = 'vscode/importSession';
export const DeleteAutomationExtensionMethod = 'vscode/deleteAutomation';
export const ReportAgentHostFirstResponseExtensionMethod = 'vscode/reportAgentHostFirstResponse';
export const ReportChatUserInteractionExtensionMethod = 'vscode/reportChatUserInteraction';
export const AgentHostCanvasesChangedNotification = 'vscode/canvases/v1/changed';
export const ResolveAgentHostCanvasSourceExtensionMethod = 'vscode/canvases/v1/resolveSource';
export const AGENT_HOST_CANVAS_LIMIT = 8;

/**
 * Copilot host extension that toggles a session's approve-all permission mode.
 *
 * Unlike the `vscode/*` methods above this one is defined by the Copilot host
 * rather than by us, so the name keeps its `extensions/` vendor namespace
 * verbatim. Clients use it as a fallback for a host that declares no approvals
 * property in its session config: without such a property there is nothing for
 * `session/configChanged` to address, so approvals cannot be driven the way
 * they are for a host that declares one.
 *
 * Two limits are worth knowing before building on it. It carries a boolean, so
 * it can express only "ask" and "approve everything" — not the richer level set
 * a config property can. And the resulting state is not reported back in
 * session state, so a client that wants to display the current value must
 * remember what it last applied.
 */
export const SetSessionApproveAllExtensionMethod = 'extensions/setSessionApproveAll';

const AgentHostChatStateFileCapabilityMetaKey = 'vscode.getAgentHostSessionStateFile.chat';
const AgentHostDetachedWorktreeCapabilityMetaKey = 'vscode.detachedWorktrees';
const AgentHostLocalCanvasesCapabilityMetaKey = 'vscode.localCanvases';
const AgentHostLocalCanvasWorkspaceMetaKey = 'vscode.localCanvases.workspace';
const AgentHostCanvasPackagesMetaKey = 'vscode.localCanvasPackages';

/** Namespaced VS Code implementation capabilities carried alongside standardized AHP initialize capabilities. */
export interface IAgentHostExtensionInitializeResultMeta extends Record<string, unknown> {
	readonly [AgentHostArtifactIntegrationsCapabilityMetaKey]?: 1;
	readonly [AgentHostChatStateFileCapabilityMetaKey]?: true;
	readonly [AgentHostDetachedWorktreeCapabilityMetaKey]?: true;
	readonly [AgentHostArtifactRemovalCapabilityMetaKey]?: true;
	readonly [AgentHostSessionImportCapabilityMetaKey]?: true;
	readonly [AgentHostDevContainersCapabilityMetaKey]?: true;
	readonly [AgentHostSessionPluginMarketplacesCapabilityMetaKey]?: true;
	readonly [AgentHostTimingCapabilityMetaKey]?: true;
	readonly [ChatUserInteractionCapability]?: true;
	readonly [AgentHostCanvasesCapabilityMetaKey]?: true;
	/** Present when Automation execution does not require a client activation or migration handshake. */
	readonly [AgentHostAutonomousAutomationsCapabilityMetaKey]?: true;
	readonly [AgentHostAutomationHistoryCapabilityMetaKey]?: true;
}

/** Standard AHP initialize response with typed VS Code-specific capability metadata. */
export interface IAgentHostExtensionInitializeResult extends InitializeResult {
	readonly _meta?: IAgentHostExtensionInitializeResultMeta;
}

export function getAgentHostExtensionInitializeResultMeta(artifactRemoval = true, devContainers = false, timing = false, sessionImport = false, canvases = false, automationHistory = false): IAgentHostExtensionInitializeResultMeta {
	return {
		[AgentHostChatStateFileCapabilityMetaKey]: true,
		[AgentHostDetachedWorktreeCapabilityMetaKey]: true,
		[AgentHostAutonomousAutomationsCapabilityMetaKey]: true,
		...(automationHistory ? { [AgentHostAutomationHistoryCapabilityMetaKey]: true as const } : {}),
		[AgentHostArtifactRemovalCapabilityMetaKey]: artifactRemoval ? true : undefined,
		...(sessionImport ? { [AgentHostSessionImportCapabilityMetaKey]: true as const } : {}),
		...(devContainers ? { [AgentHostDevContainersCapabilityMetaKey]: true as const } : {}),
		...(timing ? { [AgentHostTimingCapabilityMetaKey]: true as const } : {}),
		...(timing ? { [ChatUserInteractionCapability]: true as const } : {}),
		...(canvases ? { [AgentHostCanvasesCapabilityMetaKey]: true as const } : {}),
	};
}

export function supportsAgentHostLocalCanvases(result: IAgentHostExtensionInitializeResult | undefined): boolean {
	const meta = result?._meta;
	return meta?.[AgentHostLocalCanvasesCapabilityMetaKey] === true;
}

export function supportsAgentHostCanvasPackages(result: IAgentHostExtensionInitializeResult | undefined): boolean {
	const meta = result?._meta;
	return meta?.[AgentHostCanvasPackagesMetaKey] === true;
}

export function isCanvasPackageExtensionMethod(method: string): boolean {
	return method === ListCanvasPackagesExtensionMethod || method === PrepareCanvasPackageExtensionMethod
		|| method === ApproveCanvasPackageExtensionMethod || method === RevokeCanvasPackageExtensionMethod
		|| method === RemoveCanvasPackageExtensionMethod;
}

export const prepareCanvasPackageValidator = vObj({ source: vString() });
export const approveCanvasPackageValidator = vObj({ id: vString(), revision: vString(), workspace: vOptionalProp(vString()) });
export const canvasPackageIdValidator = vObj({ id: vString() });

export function readAgentHostLocalCanvasWorkspace(result: IAgentHostExtensionInitializeResult | undefined): URI | undefined {
	const meta = result?._meta;
	const value = meta?.[AgentHostLocalCanvasWorkspaceMetaKey];
	if (!supportsAgentHostLocalCanvases(result) || typeof value !== 'string') {
		return undefined;
	}
	const uri = URI.parse(value, true);
	if (uri.scheme !== Schemas.file || !uri.path.startsWith('/') || uri.query || uri.fragment) {
		throw new Error('The local canvas demo workspace must be an absolute file URI.');
	}
	return uri;
}

export function isAgentHostCanvasExtensionMethod(method: string): boolean {
	return method === GetAgentHostCanvasesExtensionMethod
		|| method === OpenAgentHostCanvasExtensionMethod
		|| method === InvokeAgentHostCanvasActionExtensionMethod
		|| method === CloseAgentHostCanvasExtensionMethod
		|| method === ReloadAgentHostCanvasesExtensionMethod;
}

export function supportsAgentHostChatStateFile(result: IAgentHostExtensionInitializeResult | undefined): boolean {
	const meta = result?._meta;
	return meta?.[AgentHostChatStateFileCapabilityMetaKey] === true;
}

export function supportsAgentHostDetachedWorktrees(result: IAgentHostExtensionInitializeResult | undefined): boolean {
	const meta = result?._meta;
	return meta?.[AgentHostDetachedWorktreeCapabilityMetaKey] === true;
}

export const agentHostCanvasValidator = vObj({
	instanceId: vString(),
	extensionId: vString(),
	extensionName: vOptionalProp(vString()),
	canvasId: vString(),
	title: vOptionalProp(vString()),
	status: vOptionalProp(vString()),
	revision: vNumber(),
	availability: vEnum('ready', 'unavailable'),
});

export const agentHostCanvasesChangedParamsValidator = vObj({
	chat: vString(),
	canvases: vArray(agentHostCanvasValidator),
});

export const resolveAgentHostCanvasSourceParamsValidator = vObj({
	chat: vString(),
	instanceId: vString(),
	revision: vNumber(),
});

export const resolveAgentHostCanvasSourceResultValidator = vObj({
	url: vString(),
});

export type IAgentHostCanvasesChangedParams = ValidatorType<typeof agentHostCanvasesChangedParamsValidator>;

export function isValidAgentHostCanvasesChangedParams(params: IAgentHostCanvasesChangedParams): boolean {
	if (!params.chat.trim() || params.canvases.length > AGENT_HOST_CANVAS_LIMIT) {
		return false;
	}
	const instanceIds = new Set<string>();
	for (const canvas of params.canvases) {
		if (!canvas.instanceId.trim()
			|| !canvas.extensionId.trim()
			|| !canvas.canvasId.trim()
			|| !Number.isSafeInteger(canvas.revision)
			|| canvas.revision <= 0
			|| instanceIds.has(canvas.instanceId)) {
			return false;
		}
		instanceIds.add(canvas.instanceId);
	}
	return true;
}

export const collectAgentHostDebugLogsParamsValidator = vObj({
	session: vOptionalProp(vString()),
	chat: vOptionalProp(vString()),
	kind: vEnum('archive', 'directory'),
});

export type CollectAgentHostDebugLogsParams = ValidatorType<typeof collectAgentHostDebugLogsParamsValidator>;

export const removeSessionArtifactParamsValidator = vObj({
	session: vString(),
	artifactId: vString(),
});

export const importSessionParamsValidator = vObj({ session: vString() });

export const deleteAutomationParamsValidator = vObj({
	automation: vString(),
	deleteHistory: vBoolean(),
	legacySessions: vOptionalProp(vArray(vString())),
});

export interface IAgentHostExtensionCommandMap {
	[DeleteAutomationExtensionMethod]: { params: ValidatorType<typeof deleteAutomationParamsValidator>; result: void };
	[ImportSessionExtensionMethod]: { params: ValidatorType<typeof importSessionParamsValidator>; result: void };
	[ReportAgentHostFirstResponseExtensionMethod]: { params: IAgentHostFirstResponseDiagnostic; result: void };
	[ReportChatUserInteractionExtensionMethod]: { params: IChatUserInteractionTiming; result: void };
	[ArtifactIntegrationExtensionMethod]: { params: ArtifactIntegrationRequest; result: ArtifactIntegrationResponse };
	[DevContainerIsDockerAvailableExtensionMethod]: { params: undefined; result: boolean };
	[DevContainerConnectExtensionMethod]: { params: ValidatorType<typeof devContainerConnectParamsValidator>; result: IDevContainerAgentHostConnectResult };
	[DevContainerDisconnectExtensionMethod]: { params: ValidatorType<typeof devContainerConnectionParamsValidator>; result: void };
	[DevContainerStopExtensionMethod]: { params: ValidatorType<typeof devContainerWorkspaceParamsValidator>; result: boolean };
	[DevContainerRemoveExtensionMethod]: { params: ValidatorType<typeof devContainerWorkspaceParamsValidator>; result: boolean };
	[DevContainerRelaySendExtensionMethod]: { params: ValidatorType<typeof devContainerRelayMessageValidator>; result: void };
	[RemoveSessionArtifactExtensionMethod]: {
		params: ValidatorType<typeof removeSessionArtifactParamsValidator>;
		result: void;
	};
	[GetSessionPluginMarketplaceSnapshotExtensionMethod]: {
		params: ValidatorType<typeof getSessionPluginMarketplaceSnapshotParamsValidator>;
		result: IAgentPluginMarketplaceSnapshot;
	};
	[RefreshSessionPluginMarketplacesExtensionMethod]: {
		params: ValidatorType<typeof refreshSessionPluginMarketplacesParamsValidator>;
		result: IAgentPluginMarketplaceSnapshot;
	};
	[InstallSessionPluginExtensionMethod]: {
		params: ValidatorType<typeof installSessionPluginParamsValidator>;
		result: IAgentPluginInstallResult;
	};
	'shutdown': { params: undefined; result: void };
	'getNetworkDiagnosticsInfo': { params: undefined; result: IAgentHostNetworkDiagnosticsInfo };
	'getManagedSettingsDiagnostics': { params: undefined; result: readonly IAgentHostManagedSettingsDiagnostics[] };
	'diagnosticsFetch': { params: { url: string }; result: IAgentHostNetworkFetchResult };
	[GetAgentHostSessionStateFileExtensionMethod]: {
		params: { session: string; chat?: string };
		result: { resource?: string };
	};
	[CreateAgentHostDetachedWorktreeExtensionMethod]: {
		params: { session: string; prompt: string };
		result: { handle: string; resource: string };
	};
	[ClaimAgentHostDetachedWorktreeExtensionMethod]: {
		params: { handle: string };
		result: void;
	};
	[SetAgentHostDetachedWorktreeArchivedExtensionMethod]: {
		params: { handle: string; archived: boolean };
		result: void;
	};
	[SetSessionApproveAllExtensionMethod]: {
		params: { channel: string; enabled: boolean };
		result: void;
	};
	[DeleteAgentHostDetachedWorktreeExtensionMethod]: {
		params: { handle: string };
		result: void;
	};
	[ReconcileAgentHostDetachedWorktreesExtensionMethod]: {
		params: { scope: string; activeHandles: string[] };
		result: void;
	};
	[CollectAgentHostDebugLogsExtensionMethod]: {
		params: CollectAgentHostDebugLogsParams;
		result: { kind: AgentHostDebugLogsArtifactKind; resource: string; providerLogsIncluded: boolean; size: number; uncompressedSize: number; entries: readonly { path: string; size: number }[] };
	};
	[ReadAgentHostDebugLogsChunkExtensionMethod]: {
		params: { resource: string; position: number };
		/** `data` is base64; at most `AGENT_HOST_DEBUG_LOGS_CHUNK_BYTES` decoded bytes. */
		result: { data: string; eof: boolean };
	};
	[ResolveAgentHostCanvasSourceExtensionMethod]: {
		params: ValidatorType<typeof resolveAgentHostCanvasSourceParamsValidator>;
		result: ValidatorType<typeof resolveAgentHostCanvasSourceResultValidator>;
	};
}

export interface IAgentHostExtensionNotificationMap {
	[ArtifactIntegrationUpdateNotification]: ArtifactIntegrationUpdate;
	[DevContainerRelayMessageNotification]: ValidatorType<typeof devContainerRelayMessageValidator>;
	[DevContainerRelayCloseNotification]: ValidatorType<typeof devContainerConnectionParamsValidator>;
	[DevContainerCloseConnectionNotification]: ValidatorType<typeof devContainerConnectionParamsValidator>;
	[DevContainerOutputNotification]: ValidatorType<typeof devContainerRelayMessageValidator>;
}

export interface IAgentHostCanvasExtensionNotificationMap {
	[AgentHostCanvasesChangedNotification]: IAgentHostCanvasesChangedParams;
}

export interface IAgentHostWorkspaceTrustRequest {
	readonly workspace: string;
	readonly trustedParent?: string;
}

/**
 * Asks a client to silently supply a token for an MCP server challenge raised
 * in a session no client is attending, such as an automation run. Clients
 * MUST NOT prompt; they push any token they already hold through the regular
 * `authenticate` command before responding.
 */
export interface IAgentHostMcpAuthenticationRequest {
	readonly serverName: string;
	readonly auth: McpAuthRequirement;
}

export interface IAgentHostExtensionServerCommandMap {
	[RequestAgentHostWorkspaceTrustExtensionMethod]: {
		params: IAgentHostWorkspaceTrustRequest;
		result: { trusted: boolean };
	};
	[RequestAgentHostMcpAuthenticationExtensionMethod]: {
		params: IAgentHostMcpAuthenticationRequest;
		result: { authenticated: boolean };
	};
}
