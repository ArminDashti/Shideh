/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { IObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { IDisposable, IReference } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { IExtensionDescription } from '../../../../../../../platform/extensions/common/extensions.js';
import { PromptsType } from '../../../../common/promptSyntax/promptTypes.js';
import { ParsedPromptFile } from '../../../../common/promptSyntax/promptFileParser.js';
import { IAgentSkill, IChatPromptSlashCommand, ICustomAgent, IPromptDiscoveryInfo, IPromptFileContext, IPromptFileResource, IPromptPath, IPromptsService, IAgentInstructionFile, IInstructionFile, PromptsStorage } from '../../../../common/promptSyntax/service/promptsService.js';
import { ResourceSet } from '../../../../../../../base/common/map.js';

export class MockPromptsService implements IPromptsService {

	_serviceBrand: undefined;

	private readonly _onDidChangeCustomAgents = new Emitter<void>();
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;

	private readonly _onDidLogDiscovery = new Emitter<IPromptDiscoveryLogEntry>();
	readonly onDidLogDiscovery: Event<IPromptDiscoveryLogEntry> = this._onDidLogDiscovery.event;

	private _customModes: ICustomAgent[] = [];
	private readonly _customModesObservable = observableValue<readonly ICustomAgent[]>(this, []);
	private readonly _slashCommandsObservable = observableValue<readonly IChatPromptSlashCommand[]>(this, []);
	private readonly _instructionsObservable = observableValue<readonly IInstructionFile[]>(this, []);
	private readonly _skillsObservable = observableValue<readonly IAgentSkill[]>(this, []);

	setCustomModes(modes: ICustomAgent[]): void {
		this._customModes = modes;
		this._customModesObservable.set(modes, undefined);
		this._onDidChangeCustomAgents.fire();
	}

	async getCustomAgents(token: CancellationToken, sessionId?: string): Promise<readonly ICustomAgent[]> {
		return this._customModes;
	}

	getCustomAgentsObservable(): Promise<IReference<IObservable<readonly ICustomAgent[]>>> {
		return Promise.resolve({ object: this._customModesObservable, dispose: () => { } });
	}

	// Stub implementations for required interface methods
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSyntaxParserFor(_model: any): any { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	listPromptFiles(_type: any): Promise<readonly any[]> { throw new Error('Not implemented'); }
	listPromptFilesForStorage(type: PromptsType, storage: PromptsStorage, token: CancellationToken, root?: URI): Promise<readonly IPromptPath[]> { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSourceFolders(_type: any): Promise<readonly any[]> { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getResolvedSourceFolders(_type: any): Promise<readonly any[]> { throw new Error('Not implemented'); }
	isValidSlashCommandName(_command: string): boolean { return false; }
	hasPromptSlashCommand(_name: string): boolean { return false; }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	resolvePromptSlashCommand(command: string, _sessionType: string | undefined, _token: CancellationToken): Promise<any> { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getPromptSlashCommands(): Promise<any[]> { return Promise.resolve([]); }
	getPromptSlashCommandsObservable(): Promise<IReference<IObservable<readonly IChatPromptSlashCommand[]>>> { return Promise.resolve({ object: this._slashCommandsObservable, dispose: () => { } }); }
	getPromptSlashCommandName(uri: URI): Promise<string> { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	parse(_uri: URI, _type: any): Promise<any> { throw new Error('Not implemented'); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	parseNew(uri: URI, _token: CancellationToken): Promise<any> { return Promise.resolve({ uri }); }
	getParsedPromptFile(textModel: ITextModel): ParsedPromptFile { throw new Error('Not implemented'); }
	registerContributedFile(type: PromptsType, uri: URI, extension: IExtensionDescription, name: string | undefined, description: string | undefined, when?: string, sessionTypes?: readonly string[]): IDisposable { throw new Error('Not implemented'); }
	getPromptLocationLabel(promptPath: IPromptPath): string { throw new Error('Not implemented'); }
	listNestedAgentMDs(token: CancellationToken): Promise<IAgentInstructionFile[]> { throw new Error('Not implemented'); }
	listAgentInstructions(token: CancellationToken): Promise<IAgentInstructionFile[]> { throw new Error('Not implemented'); }
	getAgentFileURIFromModeFile(oldURI: URI): URI | undefined { throw new Error('Not implemented'); }
	getDisabledPromptFiles(type: PromptsType): ResourceSet { throw new Error('Method not implemented.'); }
	setDisabledPromptFiles(type: PromptsType, uris: ResourceSet, scope?: import('../../../../../../../platform/storage/common/storage.js').StorageScope): void { throw new Error('Method not implemented.'); }
	getDisabledPromptFilesForScope(type: PromptsType, scope: import('../../../../../../../platform/storage/common/storage.js').StorageScope): ResourceSet { throw new Error('Method not implemented.'); }
	registerPromptFileProvider(extension: IExtensionDescription, type: PromptsType, provider: { providePromptFiles: (context: IPromptFileContext, token: CancellationToken) => Promise<IPromptFileResource[] | undefined> }): IDisposable { throw new Error('Method not implemented.'); }
	findAgentSkills(_token: CancellationToken): Promise<IAgentSkill[] | undefined> { return Promise.resolve([]); }
	getSkillsObservable(): Promise<IReference<IObservable<readonly IAgentSkill[]>>> { return Promise.resolve({ object: this._skillsObservable, dispose: () => { } }); }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getHooks(_token: CancellationToken): Promise<any> { throw new Error('Method not implemented.'); }
	getInstructionFiles(_token: CancellationToken): Promise<readonly IInstructionFile[]> { return Promise.resolve([]); }
	getInstructionsObservable(): Promise<IReference<IObservable<readonly IInstructionFile[]>>> { return Promise.resolve({ object: this._instructionsObservable, dispose: () => { } }); }
	getDiscoveryInfo(_type: PromptsType, _token: CancellationToken): Promise<IPromptDiscoveryInfo> { throw new Error('Method not implemented.'); }
	async getVoiceInstructions(_token: CancellationToken): Promise<undefined> { return undefined; }
	async getDictationInstructions(_token: CancellationToken): Promise<undefined> { return undefined; }
	dispose(): void { }
	onDidChangeInstructions: Event<void> = Event.None;
	onDidChangeAgentInstructions: Event<void> = Event.None;
	onDidChangePromptFiles: Event<void> = Event.None;
	onDidChangeSkills: Event<void> = Event.None;
	onDidChangeHooks: Event<void> = Event.None;
	onDidChangeSlashCommands: Event<void> = Event.None;
}
