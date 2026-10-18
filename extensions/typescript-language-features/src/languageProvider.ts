/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, extname } from 'path';
import * as vscode from 'vscode';
import { CommandManager } from './commands/commandManager';
import { DocumentSelector } from './configuration/documentSelector';
import * as fileSchemes from './configuration/fileSchemes';
import { LanguageDescription } from './configuration/languageDescription';
import { Schemes } from './configuration/schemes';
import { DiagnosticKind } from './languageFeatures/diagnostics';
import FileConfigurationManager from './languageFeatures/fileConfigurationManager';
import { TelemetryReporter } from './logging/telemetry';
import { CachedResponse } from './tsServer/cachedResponse';
import { ClientCapability } from './typescriptService';
import TypeScriptServiceClient from './typescriptServiceClient';
import TypingsStatus from './ui/typingsStatus';
import { Disposable } from './utils/dispose';
import { UnifiedConfigValue } from './utils/configuration';
import { isWeb, isWebAndHasSharedArrayBuffers, supportsReadableByteStreams } from './utils/platform';


export default class LanguageProvider extends Disposable {

	// TEST CODE

	private readonly _classLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 70 });
	private readonly _interfaceLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 70 });
	private readonly _functionLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 50 });
	private readonly _methodLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 30 });

	private readonly _classFontSizeDecorationType1: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 60, fontWeight: 'bold', fontFamily: 'Arial' });
	private readonly _interfaceFontSizeDecorationType1: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 60, fontWeight: 'bold', fontFamily: 'Times New Roman' });
	private readonly _functionFontSizeDecorationType1: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 40, fontWeight: 'italic', fontFamily: 'Courier New' });
	private readonly _methodFontSizeDecorationType1: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 20, fontWeight: 'italic', fontFamily: 'Georgia' });

	private readonly _classFontSizeDecorationType2: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 60, fontWeight: 'italic', fontFamily: 'Georgia' });
	private readonly _interfaceFontSizeDecorationType2: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 60, fontWeight: 'italic', fontFamily: 'Arial' });
	private readonly _functionFontSizeDecorationType2: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 30, fontWeight: 'bold', fontFamily: 'Times New Roman' });
	private readonly _methodFontSizeDecorationType2: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 10, fontWeight: 'bold', fontFamily: 'Courier New' });

	// private readonly _classFontSizeDecorationTypeInjectedText: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ after: { contentText: 'AFTER CLASS', fontWeight: 'italic', fontFamily: 'Segoe' } });
	// private readonly _interfaceFontSizeDecorationTypeInjectedText: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ after: { contentText: 'AFTER INTERFACE', fontWeight: 'italic', fontFamily: 'Roboto' } });
	// private readonly _functionFontSizeDecorationTypeInjectedText: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ after: { contentText: 'AFTER FUNCTION', fontWeight: 'bold', fontFamily: 'Nunito' } });
	// private readonly _methodFontSizeDecorationTypeInjectedText: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ after: { contentText: 'AFTER METHOD', fontWeight: 'bold', fontFamily: 'Arial' } });

	// PROD CODE

	// private readonly _classLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 22 });
	// private readonly _interfaceLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 22 });
	// private readonly _functionLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 20 });
	// private readonly _methodLineHeightDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ lineHeight: 20 });

	// private readonly _classFontSizeDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 20 });
	// private readonly _interfaceFontSizeDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 20 });
	// private readonly _functionFontSizeDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 18 });
	// private readonly _methodFontSizeDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({ fontSize: 18 });

	constructor(
		private readonly client: TypeScriptServiceClient,
		private readonly description: LanguageDescription,
		private readonly commandManager: CommandManager,
		private readonly telemetryReporter: TelemetryReporter,
		private readonly typingsStatus: TypingsStatus,
		private readonly fileConfigurationManager: FileConfigurationManager,
		private readonly onCompletionAccepted: (item: vscode.CompletionItem) => void,
	) {
		super();

		const scope: vscode.ConfigurationScope = { languageId: this.description.languageIds[0] };

		const validateConfig = this._register(new UnifiedConfigValue<boolean>('validate.enabled', true, { scope, fallbackSection: this.id, fallbackSubSectionNameOverride: 'validate.enable' }));
		this.updateValidate(validateConfig.getValue());
		this._register(validateConfig.onDidChange(value => this.updateValidate(value)));

		const suggestionsConfig = this._register(new UnifiedConfigValue<boolean>('suggestionActions.enabled', true, { scope, fallbackSection: this.id }));
		this.updateSuggestionDiagnostics(suggestionsConfig.getValue());
		this._register(suggestionsConfig.onDidChange(value => this.updateSuggestionDiagnostics(value)));

		client.onReady(() => this.registerProviders());
	}

	private get documentSelector(): DocumentSelector {
		const semantic: vscode.DocumentFilter[] = [];
		const syntax: vscode.DocumentFilter[] = [];
		for (const language of this.description.languageIds) {
			syntax.push({ language });
			for (const scheme of fileSchemes.getSemanticSupportedSchemes()) {
				semantic.push({ language, scheme });
			}
		}

		return { semantic, syntax };
	}

	private async registerProviders(): Promise<void> {
		const selector = this.documentSelector;

		const cachedNavTreeResponse = new CachedResponse();

		await Promise.all([
			import('./languageFeatures/callHierarchy').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/codeLens/implementationsCodeLens').then(provider => this._register(provider.register(selector, this.description, this.client, cachedNavTreeResponse))),
			import('./languageFeatures/codeLens/referencesCodeLens').then(provider => this._register(provider.register(selector, this.description, this.client, cachedNavTreeResponse))),
			import('./languageFeatures/completions').then(provider => this._register(provider.register(selector, this.description, this.client, this.typingsStatus, this.fileConfigurationManager, this.commandManager, this.telemetryReporter, this.onCompletionAccepted))),
			import('./languageFeatures/copyPaste').then(provider => this._register(provider.register(selector, this.description, this.client, this.fileConfigurationManager))),
			import('./languageFeatures/definitions').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/directiveCommentCompletions').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/documentHighlight').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/documentSymbol').then(provider => this._register(provider.register(selector, this.client, cachedNavTreeResponse))),
			import('./languageFeatures/dropOrPasteResource').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/fileReferences').then(provider => this._register(provider.register(this.client, this.commandManager))),
			import('./languageFeatures/fixAll').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager, this.client.diagnosticsManager))),
			import('./languageFeatures/folding').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/formatting').then(provider => this._register(provider.register(selector, this.description, this.client, this.fileConfigurationManager))),
			import('./languageFeatures/hover').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager))),
			import('./languageFeatures/implementations').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/inlayHints').then(provider => this._register(provider.register(selector, this.description, this.client, this.fileConfigurationManager, this.telemetryReporter))),
			import('./languageFeatures/jsDocCompletions').then(provider => this._register(provider.register(selector, this.description, this.client, this.fileConfigurationManager))),
			import('./languageFeatures/linkedEditing').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/organizeImports').then(provider => this._register(provider.register(selector, this.client, this.commandManager, this.fileConfigurationManager, this.telemetryReporter))),
			import('./languageFeatures/quickFix').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager, this.commandManager, this.client.diagnosticsManager, this.telemetryReporter))),
			import('./languageFeatures/refactor').then(provider => this._register(provider.register(selector, this.client, cachedNavTreeResponse, this.fileConfigurationManager, this.commandManager, this.telemetryReporter))),
			import('./languageFeatures/references').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/rename').then(provider => this._register(provider.register(selector, this.description, this.client, this.fileConfigurationManager))),
			import('./languageFeatures/semanticTokens').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/signatureHelp').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/smartSelect').then(provider => this._register(provider.register(selector, this.client))),
			import('./languageFeatures/sourceDefinition').then(provider => this._register(provider.register(this.client, this.commandManager))),
			import('./languageFeatures/tagClosing').then(provider => this._register(provider.register(selector, this.description, this.client))),
			import('./languageFeatures/typeDefinitions').then(provider => this._register(provider.register(selector, this.client))),
		]);
	}

	public handlesUri(resource: vscode.Uri): boolean {
		const ext = extname(resource.path).slice(1).toLowerCase();
		return this.description.standardFileExtensions.includes(ext) || this.handlesConfigFile(resource);
	}

	public handlesDocument(doc: vscode.TextDocument): boolean {
		return this.description.languageIds.includes(doc.languageId) || this.handlesConfigFile(doc.uri);
	}

	private handlesConfigFile(resource: vscode.Uri) {
		const base = basename(resource.fsPath);
		return !!base && (!!this.description.configFilePattern && this.description.configFilePattern.test(base));
	}

	private get id(): string {
		return this.description.id;
	}

	public get diagnosticSource(): string {
		return this.description.diagnosticSource;
	}

	private updateValidate(value: boolean) {
		this.client.diagnosticsManager.setValidate(this._diagnosticLanguage, value);
	}

	private updateSuggestionDiagnostics(value: boolean) {
		this.client.diagnosticsManager.setEnableSuggestions(this._diagnosticLanguage, value);
	}

	public reInitialize(): void {
		this.client.diagnosticsManager.reInitialize();
	}

	public triggerAllDiagnostics(): void {
		this.client.bufferSyncSupport.requestAllDiagnostics();
	}

	public diagnosticsReceived(
		diagnosticsKind: DiagnosticKind,
		file: vscode.Uri,
		diagnostics: (vscode.Diagnostic & { reportUnnecessary: any; reportDeprecated: any })[],
		ranges: vscode.Range[] | undefined): void {
		if (diagnosticsKind !== DiagnosticKind.Syntax && !this.client.hasCapabilityForResource(file, ClientCapability.Semantic)) {
			return;
		}

		if (diagnosticsKind === DiagnosticKind.Semantic && isWeb()) {
			if (
				!isWebAndHasSharedArrayBuffers()
				|| !supportsReadableByteStreams() // No ata. Will result in lots of false positives
				|| this.client.configuration.webProjectWideIntellisenseSuppressSemanticErrors
				|| !this.client.configuration.webProjectWideIntellisenseEnabled
			) {
				return;
			}
		}

		// Disable semantic errors in notebooks until we have better notebook support
		if (diagnosticsKind === DiagnosticKind.Semantic && file.scheme === Schemes.notebookCell) {
			return;
		}

		this.client.diagnosticsManager.updateDiagnostics(file, this._diagnosticLanguage, diagnosticsKind, diagnostics, ranges);
	}

	public configFileDiagnosticsReceived(file: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
		this.client.diagnosticsManager.configFileDiagnosticsReceived(file, diagnostics);
	}

	private get _diagnosticLanguage() {
		return this.description.diagnosticLanguage;
	}
}
