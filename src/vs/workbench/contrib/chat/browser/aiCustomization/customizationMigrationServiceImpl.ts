/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { extUriBiasedIgnorePathCase } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { isAgentHostSessionResource } from '../../common/chatSessionsService.js';
import { ICustomizationHarnessService, ICustomizationSourceFolder } from '../../common/customizationHarnessService.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { PromptHeaderAttributes } from '../../common/promptSyntax/promptFileParser.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { CustomizationMigration, CustomizationMigrationType, FileCustomizationMigration, FileCustomizationMigrationType, getCustomizationMigrationTargetType, ICustomizationMigrationHint, ICustomizationMigrationService, IMcpServerCustomizationMigrationCandidate, IMcpServerCustomizationMigrationResult, isConfiguredLocationMigrationCandidate, isPromptFileMigrationCandidate, isUserDataMigrationCandidate, McpServerCustomizationMigration, McpServerCustomizationMigrationFailureReason, MigratableConfiguration } from '../../common/promptSyntax/service/customizationMigrationService.js';
import { ChatConfiguration } from '../../common/constants.js';
import { IPromptsService, PromptsStorage } from '../../common/promptSyntax/service/promptsService.js';
import { IMcpService } from '../../../mcp/common/mcpTypes.js';

type CustomizationMigrationAssessmentCountProperty = 'nativeCount' | 'mappedCount' | 'unsupportedCount';
type CustomizationMigrationAssessmentType = PromptsType | CustomizationMigrationType.McpServers;
type CustomizationMigrationAssessmentSource = NonNullable<MigratableConfiguration['source']> | PromptsStorage | IAgentHostMcpServerSupport['source']['kind'];
type CustomizationMigrationAssessmentCount = {
	readonly customizationType: CustomizationMigrationAssessmentType;
	readonly source: CustomizationMigrationAssessmentSource;
	readonly nativeCount: number;
	readonly mappedCount: number;
	readonly unsupportedCount: number;
};
type McpServerCustomizationMigrationResult = {
	readonly migration: McpServerCustomizationMigration;
	readonly assessmentCounts: readonly CustomizationMigrationAssessmentCount[];
};

type CustomizationMigrationAssessmentEvent = CustomizationMigrationAssessmentCount & { readonly target: string };

type CustomizationMigrationAssessmentClassification = {
	target: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The target Agent Host harness for the assessment.' };
	customizationType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of customization in the assessment.' };
	source: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The bounded source category of customizations in the assessment.' };
	nativeCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of customizations consumed from a native location.' };
	mappedCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of customizations consumed through compatibility mapping.' };
	unsupportedCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of customizations not fully supported by the target.' };
	owner: 'digitarald';
	comment: 'Tracks aggregate customization migration assessments without collecting customization names, paths, IDs, or content.';
};

function incrementAssessmentCount(
	counts: Map<string, CustomizationMigrationAssessmentCount>,
	customizationType: CustomizationMigrationAssessmentType,
	source: CustomizationMigrationAssessmentSource,
	property: CustomizationMigrationAssessmentCountProperty,
): void {
	const key = `${customizationType}\0${source}`;
	const current = counts.get(key) ?? { customizationType, source, nativeCount: 0, mappedCount: 0, unsupportedCount: 0 };
	counts.set(key, { ...current, [property]: current[property] + 1 });
}

export class CustomizationMigrationService extends Disposable implements ICustomizationMigrationService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeCustomizations: Event<void>;

	constructor(
		@IPromptsService private readonly promptsService: IPromptsService,
		@ICustomizationHarnessService private readonly customizationHarnessService: ICustomizationHarnessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMcpService mcpService: IMcpService,
	) {
		super();
		this.onDidChangeCustomizations = Event.any(
			promptsService.onDidChangeSlashCommands,
			promptsService.onDidChangeInstructions,
			promptsService.onDidChangeAgentInstructions,
			promptsService.onDidChangeSkills,
			customizationHarnessService.onDidChangeCustomAgents,
			Event.fromObservableLight(mcpService.servers),
		);
	}

	computeMigration(sessionResource: URI, type: FileCustomizationMigrationType, token?: CancellationToken): Promise<FileCustomizationMigration>;
	computeMigration(sessionResource: URI, type: CustomizationMigrationType.McpServers, token?: CancellationToken): Promise<McpServerCustomizationMigration>;
	async computeMigration(sessionResource: URI, type: CustomizationMigrationType, token = CancellationToken.None): Promise<CustomizationMigration> {
		if (!isAgentHostSessionResource(sessionResource)) {
			return type === CustomizationMigrationType.McpServers
				? this.emptyMcpServerMigration().migration
				: { type, files: [], candidates: [] };
		}
		if (!this.isMigrationEnabled()) {
			return type === CustomizationMigrationType.McpServers
				? this.emptyMcpServerMigration()
				: { type, files: [], candidates: [] };
		}

		switch (type) {
			case CustomizationMigrationType.UserData: {
				const customizations = (await Promise.all([
					this.promptsService.listPromptFiles(PromptsType.agent, token),
					this.promptsService.listPromptFiles(PromptsType.instructions, token),
				])).flat();
				return this.createFileMigration(sessionResource, type, customizations.filter(isUserDataMigrationCandidate), token);
			}
			case CustomizationMigrationType.PromptFiles: {
				const customizations = await this.promptsService.listPromptFiles(PromptsType.prompt, token);
				return this.createFileMigration(sessionResource, type, customizations.filter(isPromptFileMigrationCandidate), token);
			}
			case CustomizationMigrationType.AgentFiles: {
				const agentFiles = await this.promptsService.listPromptFiles(PromptsType.agent, token);
				const parsedAgentFiles = await Promise.all(agentFiles
					.filter(file => file.storage === PromptsStorage.local || file.storage === PromptsStorage.user)
					.map(async file => {
						try {
							return {
								file,
								parsed: await this.promptsService.parseNew(file.uri, token),
							};
						} catch (error) {
							if (isCancellationError(error)) {
								throw error;
							}
							this.logService.error(`[Customization Migration] Failed to parse agent file: ${file.uri.toString()}`, error);
							return undefined;
						}
					}));
				const candidates = parsedAgentFiles
					.filter(candidate => candidate !== undefined)
					.filter(({ parsed }) => parsed.header?.getAttribute(PromptHeaderAttributes.handOffs) !== undefined)
					.map(({ file }) => ({ ...file, hasLocalHandoffs: true }));
				return { type, files: candidates.map(candidate => candidate.uri), candidates };
			}
			case CustomizationMigrationType.ConfiguredLocations: {
				const customizations = (await Promise.all([
					this.promptsService.listPromptFiles(PromptsType.agent, token),
					this.promptsService.listPromptFiles(PromptsType.instructions, token),
					this.promptsService.listPromptFiles(PromptsType.skill, token),
				])).flat();
				return this.createFileMigration(sessionResource, type, customizations.filter(isConfiguredLocationMigrationCandidate), token, true);
			}
			case CustomizationMigrationType.McpServers: {
				const provider = this.customizationHarnessService.findHarnessById(getChatSessionType(sessionResource))?.mcpServerMigrationProvider;
				return provider?.computeMigration(sessionResource, token) ?? this.emptyMcpServerMigration();
			}
		}
	}

	async computeMigrations(sessionResource: URI, token = CancellationToken.None): Promise<CustomizationMigration[]> {
		return Promise.all([
			this.computeMigration(sessionResource, CustomizationMigrationType.UserData, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.PromptFiles, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.AgentFiles, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.ConfiguredLocations, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.McpServers, token),
		]);
	}

	async migrateMcpServers(sessionResource: URI, requestedCandidates: readonly IMcpServerCustomizationMigrationCandidate[]): Promise<IMcpServerCustomizationMigrationResult> {
		if (requestedCandidates.length === 0) {
			return { migratedCount: 0, failures: [] };
		}
		const provider = this.customizationHarnessService.findHarnessById(getChatSessionType(sessionResource))?.mcpServerMigrationProvider;
		return provider?.migrate(sessionResource, requestedCandidates) ?? {
			migratedCount: 0,
			failures: requestedCandidates.map(candidate => ({
				storage: candidate.storage,
				id: candidate.id,
				name: candidate.name,
				sourceUri: candidate.sourceUri,
				targetUri: candidate.targetUri,
				reason: McpServerCustomizationMigrationFailureReason.NoLongerEligible,
			})),
		};
	}

	async computeMigrationHint(sessionResource: URI, token = CancellationToken.None): Promise<ICustomizationMigrationHint | undefined> {
		const harness = this.customizationHarnessService.findHarnessById(getChatSessionType(sessionResource));
		if (!harness) {
			return undefined;
		}

		const mcpMigrationEnabled = this.isMigrationEnabled();
		const [userDataMigration, promptFilesMigration, configuredLocationsMigration, mcpServerMigration] = await Promise.all([
			this.computeMigration(sessionResource, CustomizationMigrationType.UserData, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.PromptFiles, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.AgentFiles, token),
			this.computeMigration(sessionResource, CustomizationMigrationType.ConfiguredLocations, token),
			mcpMigrationEnabled ? this.computeMigration(sessionResource, CustomizationMigrationType.McpServers, token) : Promise.resolve(this.emptyMcpServerMigration()),
		]);
		const fileCandidates = [userDataMigration, promptFilesMigration, configuredLocationsMigration]
			.filter(() => this.isMigrationEnabled())
			.flatMap(migration => migration.candidates);
		const migratableMcpServerCount = mcpServerMigration.candidates.length;
		const workspaceCount = fileCandidates.filter(candidate => candidate.storage === PromptsStorage.local).length
			+ mcpServerMigration.candidates.filter(candidate => candidate.storage === PromptsStorage.local).length;
		const userCount = fileCandidates.filter(candidate => candidate.storage === PromptsStorage.user).length
			+ mcpServerMigration.candidates.filter(candidate => candidate.storage === PromptsStorage.user).length;
		return workspaceCount + userCount > 0 ? {
			migrationFlowId: this.generateMigrationFlowId(),
			message: this.getMigrationHintMessage(workspaceCount, userCount),
			counts: [
				{ type: CustomizationMigrationType.UserData, count: userDataMigration.files.length },
				{ type: CustomizationMigrationType.PromptFiles, count: promptFilesMigration.files.length },
				{ type: CustomizationMigrationType.AgentFiles, count: agentFilesMigration.files.length },
				{ type: CustomizationMigrationType.ConfiguredLocations, count: configuredLocationsMigration.files.length },
				{ type: CustomizationMigrationType.McpServers, count: migratableMcpServerCount },
			].filter(({ count }) => count > 0),
		} : undefined;
	}

	private getMigrationHintMessage(workspaceCount: number, userCount: number): string {
		if (userCount === 0) {
			return workspaceCount === 1
				? localize('customizationMigrationHintWorkspaceCountSingular', "{0} workspace customization needs an update to keep working.", workspaceCount)
				: localize('customizationMigrationHintWorkspaceCountPlural', "{0} workspace customizations need an update to keep working.", workspaceCount);
		}
		if (workspaceCount === 0) {
			return userCount === 1
				? localize('customizationMigrationHintUserCountSingular', "{0} user customization needs an update to keep working.", userCount)
				: localize('customizationMigrationHintUserCountPlural', "{0} user customizations need an update to keep working.", userCount);
		}
		return localize('customizationMigrationHintCounts', "{0} workspace and {1} user customizations need an update to keep working.", workspaceCount, userCount);
	}

	private async createFileMigration(sessionResource: URI, type: FileCustomizationMigrationType, candidates: readonly MigratableConfiguration[], token: CancellationToken, excludeSupportedLocations = false): Promise<FileCustomizationMigration> {
		const sourceFolders = await this.getSourceFolders(sessionResource, candidates, token);
		return this.createFileMigrationFromSourceFolders(type, candidates, sourceFolders, excludeSupportedLocations);
	}

	private async getSourceFolders(sessionResource: URI, customizations: readonly MigratableConfiguration[], token: CancellationToken): Promise<Map<PromptsType, readonly ICustomizationSourceFolder[]>> {
		const provider = this.customizationHarnessService.findHarnessById(getChatSessionType(sessionResource))?.itemProvider;
		const targetTypes = new Set(customizations.map(getCustomizationMigrationTargetType));
		const sourceFolders = new Map<PromptsType, readonly ICustomizationSourceFolder[]>();
		if (!provider?.provideSourceFolders) {
			return sourceFolders;
		}
		for (const targetType of targetTypes) {
			const folders = await provider.provideSourceFolders(sessionResource, targetType, token);
			sourceFolders.set(targetType, folders ?? []);
		}
		const filteredCandidates = candidates.flatMap(customization => {
			const targetType = getCustomizationMigrationTargetType(customization);
			const compatibleFolders = sourceFolders.get(targetType)?.filter(folder => folder.source === customization.storage) ?? [];
			if (compatibleFolders.length === 0
				|| excludeSupportedLocations && compatibleFolders.some(folder => extUriBiasedIgnorePathCase.isEqualOrParent(customization.uri, folder.uri))
			) {
				return [];
			}
			return [{
				...customization,
				workspaceGroupId: provider.getWorkspaceGroupId?.(sessionResource, customization.uri),
			}];
		});
		return { type, files: filteredCandidates.map(customization => customization.uri), candidates: filteredCandidates };
	}

	private emptyMcpServerMigration(): McpServerCustomizationMigration {
		return {
			type: CustomizationMigrationType.McpServers,
			servers: [],
			candidates: [],
			exclusions: [],
			discoveryComplete: true,
			coverage: {
				restrictedByMcpAccess: false,
				restrictedByCustomizationPolicy: false,
			},
		};
		return { migration, assessmentCounts: [] };
	}

	private computeMcpServerAssessmentCounts(servers: readonly IAgentHostMcpServerSupport[]): readonly CustomizationMigrationAssessmentCount[] {
		const counts = new Map<string, CustomizationMigrationAssessmentCount>();
		for (const server of servers) {
			if (!server.enablement.enabled || server.applicability === AgentHostMcpServerApplicability.OutsideCurrentScope) {
				continue;
			}
			const property = server.compatibility.kind !== 'supported'
				|| server.delivery === AgentHostMcpServerDelivery.NotDelivered
				|| server.delivery === AgentHostMcpServerDelivery.Unknown
				? 'unsupportedCount'
				: server.delivery === AgentHostMcpServerDelivery.ClientForwarded
					? 'mappedCount'
					: 'nativeCount';
			incrementAssessmentCount(counts, CustomizationMigrationType.McpServers, server.source.kind, property);
		}
		return [...counts.values()];
	}

	private isMigrationEnabled(): boolean {
		return this.configurationService.getValue<boolean>(ChatConfiguration.ChatCustomizationsMigrationEnabled) === true;
	}

	protected generateMigrationFlowId(): string {
		return generateUuid();
	}
}
