/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constObservable } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { AbstractCustomView } from '../../../services/customView/browser/customView.js';
import { ICustomViewService } from '../../../services/customView/browser/customViewService.js';
import { AGENTS_UNCAPPED_CONTENT_MAX_WIDTH } from '../../../common/layoutConstants.js';
import { SHIDEH_SETTINGS_CUSTOM_VIEW_ID } from '../common/shidehCommandIds.js';
import { ShidehSettingsContent } from './shidehSettingsContent.js';

class ShidehSettingsCustomView extends AbstractCustomView {

	readonly title = constObservable(localize('shidehSettingsCustomViewTitle', "Settings"));

	override readonly maxWidth = AGENTS_UNCAPPED_CONTENT_MAX_WIDTH;

	constructor(
		@ICustomViewService private readonly customViewService: ICustomViewService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	render(container: HTMLElement): void {
		container.classList.add('shideh-settings-custom-view-host');
		const content = this._register(this.instantiationService.createInstance(ShidehSettingsContent, {
			showTitle: false,
			onClose: () => this.customViewService.hideCustomView(),
		}));
		content.render(container);
	}

	layout(_width: number, _height: number): void { }
}

class ShidehSettingsCustomViewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehSettingsCustomView';

	constructor(
		@ICustomViewService customViewService: ICustomViewService,
	) {
		super();
		this._register(customViewService.registerCustomView({
			id: SHIDEH_SETTINGS_CUSTOM_VIEW_ID,
			ctor: new SyncDescriptor(ShidehSettingsCustomView),
		}, { restore: false }));
	}
}

registerWorkbenchContribution2(ShidehSettingsCustomViewContribution.ID, ShidehSettingsCustomViewContribution, WorkbenchPhase.BlockRestore);
