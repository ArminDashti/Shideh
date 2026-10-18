/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentSelector } from '../configuration/documentSelector';
import { LanguageDescription } from '../configuration/languageDescription';
import { API } from '../tsServer/api';
import protocol from '../tsServer/protocol/protocol';
import * as typeConverters from '../typeConverters';
import { ClientCapability, ITypeScriptServiceClient, ServerResponse } from '../typescriptService';
import { raceTimeout } from '../utils/async';
import { readUnifiedConfig } from '../utils/configuration';
import FileConfigurationManager from './fileConfigurationManager';
import { conditionalRegistration, requireGlobalUnifiedConfig, requireMinVersion, requireSomeCapability } from './util/dependentRegistration';

class CopyMetadata {

	static parse(data: string): CopyMetadata | undefined {
		try {

			const parsedData = JSON.parse(data);
			const resource = vscode.Uri.parse(parsedData.resource);
			const ranges = parsedData.ranges.map((range: any) => new vscode.Range(range.start, range.end));
			const copyOperation = parsedData.copyOperation ? Promise.resolve(parsedData.copyOperation) : undefined;
			return new CopyMetadata(resource, ranges, copyOperation);
		} catch (error) {
			return undefined;
		}
	}

	constructor(
		readonly resource: vscode.Uri,
		readonly ranges: readonly vscode.Range[],
	) { }

	toJSON() {
		return JSON.stringify({
			resource: this.resource.toJSON(),
			ranges: this.ranges,
		});
	}

	static fromJSON(str: string): CopyMetadata | undefined {
		try {
			const parsed = JSON.parse(str);
			return new CopyMetadata(
				vscode.Uri.from(parsed.resource),
				parsed.ranges.map((r: any) => new vscode.Range(r[0].line, r[0].character, r[1].line, r[1].character)));
		} catch {
			// ignore
		}
		return undefined;
	}
}

const enabledSettingId = 'updateImportsOnPaste.enabled' as const;

class DocumentPasteProvider implements vscode.DocumentPasteEditProvider {

	static readonly kind = vscode.DocumentDropOrPasteEditKind.TextUpdateImports.append('jsts');
	static readonly metadataMimeType = 'application/vnd.code.jsts.metadata';

	constructor(
		private readonly _modeId: string,
		private readonly _client: ITypeScriptServiceClient,
		private readonly fileConfigurationManager: FileConfigurationManager,
	) { }

	async prepareDocumentPaste(document: vscode.TextDocument, ranges: readonly vscode.Range[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
		if (!this.isEnabled(document)) {
			return;
		}

		const file = this._client.toOpenTsFilePath(document);
		if (!file) {
			return;
		}

		const response = await this._client.interruptGetErr(() => this._client.execute('preparePasteEdits', {
			file,
			copiedTextSpan: ranges.map(typeConverters.Range.toTextSpan),
		}, token));
		if (token.isCancellationRequested || response.type !== 'response' || !response.body) {
			return;
		}

		dataTransfer.set(DocumentPasteProvider.metadataMimeType,
			new vscode.DataTransferItem(new CopyMetadata(document.uri, ranges).toJSON()));
	}

	async provideDocumentPasteEdits(
		document: vscode.TextDocument,
		ranges: readonly vscode.Range[],
		dataTransfer: vscode.DataTransfer,
		_context: vscode.DocumentPasteEditContext,
		token: vscode.CancellationToken,
	): Promise<vscode.DocumentPasteEdit[] | undefined> {
		if (!this.isEnabled(document)) {
			return;
		}

		const file = this._client.toOpenTsFilePath(document);
		if (!file) {
			return;
		}

		const text = await dataTransfer.get('text/plain')?.asString();
		if (!text || token.isCancellationRequested) {
			return;
		}

		// Get optional metadata
		const metadata = await this.extractMetadata(dataTransfer, token);
		if (token.isCancellationRequested) {
			return;
		}

		let copiedFrom: {
			file: string;
			spans: protocol.TextSpan[];
		} | undefined;
		if (metadata) {
			const spans = metadata.ranges.map(typeConverters.Range.toTextSpan);
			const copyFile = this._client.toTsFilePath(metadata.resource);
			if (copyFile) {
				copiedFrom = { file: copyFile, spans };
			}
		}

		if (copiedFrom?.file === file) {
			return;
		}

		const response = await this._client.interruptGetErr(() => {
			this.fileConfigurationManager.ensureConfigurationForDocument(document, token);

			return this._client.execute('getPasteEdits', {
				file,
				// TODO: only supports a single paste for now
				pastedText: [text],
				pasteLocations: ranges.map(typeConverters.Range.toTextSpan),
				copiedFrom
			}, token);
		});
		if (response.type !== 'response' || !response.body?.edits.length || token.isCancellationRequested) {
			return;
		}

		const edit = new vscode.DocumentPasteEdit('', vscode.l10n.t("Paste with imports"), DocumentPasteProvider.kind);
		edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text.append('plain')];

		const additionalEdit = new vscode.WorkspaceEdit();
		for (const edit of response.body.edits) {
			additionalEdit.set(this._client.toResource(edit.fileName), edit.textChanges.map(typeConverters.TextEdit.fromCodeEdit));
		}
		edit.additionalEdit = additionalEdit;
		return [edit];
	}

	private async extractMetadata(dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<CopyMetadata | undefined> {
		const metadata = await dataTransfer.get(DocumentPasteProvider.metadataMimeType)?.asString();
		if (token.isCancellationRequested) {
			return undefined;
		}

		if (metadata instanceof CopyMetadata) {
			return metadata;
		}

		if (typeof metadata === 'string') {
			return CopyMetadata.parse(metadata);
		}

		return undefined;
	}

	private isEnabled(document: vscode.TextDocument) {
		return readUnifiedConfig<boolean>(enabledSettingId, true, { scope: document, fallbackSection: this._modeId });
	}
}

export function register(selector: DocumentSelector, language: LanguageDescription, client: ITypeScriptServiceClient, fileConfigurationManager: FileConfigurationManager) {
	return conditionalRegistration([
		requireSomeCapability(client, ClientCapability.Semantic),
		requireMinVersion(client, API.v570),
		requireGlobalUnifiedConfig(enabledSettingId, { fallbackSection: language.id }),
	], () => {
		return vscode.languages.registerDocumentPasteEditProvider(selector.semantic, new DocumentPasteProvider(language.id, client, fileConfigurationManager), {
			providedPasteEditKinds: [DocumentPasteProvider.kind],
			copyMimeTypes: [DocumentPasteProvider.metadataMimeType],
			pasteMimeTypes: [DocumentPasteProvider.metadataMimeType],
		});
	});
}
