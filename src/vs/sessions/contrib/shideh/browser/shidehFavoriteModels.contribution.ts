/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';

import { SHIDEH_MANAGE_FAVORITE_MODELS_COMMAND_ID } from '../common/shidehCommandIds.js';

function syncFavoriteModelsToPins(configurationService: IConfigurationService, languageModelsService: ILanguageModelsService): void {
	const favorites = configurationService.getValue<string[]>('shideh.favoriteModels') ?? [];
	for (const id of favorites) {
		if (!languageModelsService.isModelPinned(id)) {
			languageModelsService.pinModel(id);
		}
	}
}

class ShidehFavoriteModelsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehFavoriteModels';

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super();
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}
		syncFavoriteModelsToPins(this.configurationService, this.languageModelsService);
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('shideh.favoriteModels')) {
				syncFavoriteModelsToPins(this.configurationService, this.languageModelsService);
			}
		}));
		this._register(this.languageModelsService.onDidChangePinnedModels(() => {
			const pinned = this.languageModelsService.getPinnedModelIds();
			const current = this.configurationService.getValue<string[]>('shideh.favoriteModels') ?? [];
			if (pinned.join('\0') !== current.join('\0')) {
				void this.configurationService.updateValue('shideh.favoriteModels', pinned).catch(onUnexpectedError);
			}
		}));
	}
}

registerWorkbenchContribution2(ShidehFavoriteModelsContribution.ID, ShidehFavoriteModelsContribution, WorkbenchPhase.Eventually);

registerAction2(class ShidehManageFavoriteModelsAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_MANAGE_FAVORITE_MODELS_COMMAND_ID,
			title: localize2('shidehManageFavoriteModels', "Bookmark Favorite Models"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const languageModelsService = accessor.get(ILanguageModelsService);
		const configurationService = accessor.get(IConfigurationService);
		const models = languageModelsService.getLanguageModelIds();
		const favorites = new Set(configurationService.getValue<string[]>('shideh.favoriteModels') ?? []);
		const picks = models.map(id => ({
			label: languageModelsService.lookupLanguageModel(id)?.name ?? id,
			description: id,
			picked: favorites.has(id),
			modelId: id,
		}));
		const selected = await quickInputService.pick(picks, {
			canPickMany: true,
			placeHolder: localize('shidehFavoriteModelsPick', "Select models to bookmark (pinned in the model picker)"),
		});
		if (!selected) {
			return;
		}
		const next = selected.map(item => item.modelId);
		await configurationService.updateValue('shideh.favoriteModels', next);
		syncFavoriteModelsToPins(configurationService, languageModelsService);
		for (const id of models) {
			if (!next.includes(id) && languageModelsService.isModelPinned(id)) {
				languageModelsService.unpinModel(id);
			}
		}
	}
});
