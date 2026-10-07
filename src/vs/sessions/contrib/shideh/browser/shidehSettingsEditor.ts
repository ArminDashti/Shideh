/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IEditorOptions } from '../../../../workbench/common/editor.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ShidehSettingsContent } from './shidehSettingsContent.js';
import './media/shidehSettings.css';

export class ShidehSettingsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.shidehSettings';

	static readonly RESOURCE = URI.from({ scheme: Schemas.internal, path: '/shideh/settings' });

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton | EditorInputCapabilities.ForceReveal;
	}

	override get typeId(): string {
		return ShidehSettingsEditorInput.ID;
	}

	override getName(): string {
		return localize('shidehSettingsEditorName', "Settings");
	}

	override get resource(): URI {
		return ShidehSettingsEditorInput.RESOURCE;
	}
}

export class ShidehSettingsEditor extends EditorPane {

	static readonly ID = 'workbench.editor.shidehSettings';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ShidehSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const content = this._register(this.instantiationService.createInstance(ShidehSettingsContent, {
			showTitle: false,
			onClose: () => { void this.editorService.closeEditor(this.input); },
		}));
		content.render(parent);
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
	}
}
