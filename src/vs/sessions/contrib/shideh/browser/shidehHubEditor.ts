/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ShidehHubPanel } from './shidehHubPanel.js';
import './media/shidehHub.css';

export class ShidehHubEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.shidehHub';

	static readonly RESOURCE = URI.from({ scheme: Schemas.internal, path: '/shideh/hub' });

	override get typeId(): string {
		return ShidehHubEditorInput.ID;
	}

	override getName(): string {
		return localize('shidehHubEditorName', "Hub");
	}

	override get resource(): URI {
		return ShidehHubEditorInput.RESOURCE;
	}
}

export class ShidehHubEditor extends EditorPane {

	static readonly ID = 'workbench.editor.shidehHub';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ShidehHubEditorInput.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const root = DOM.append(parent, DOM.$('.shideh-hub-editor'));
		const title = DOM.append(root, DOM.$('h1.shideh-hub-editor-title'));
		title.textContent = localize('shidehHubEditorTitle', "Hub");
		this._register(this.instantiationService.createInstance(ShidehHubPanel, root));
	}
}
