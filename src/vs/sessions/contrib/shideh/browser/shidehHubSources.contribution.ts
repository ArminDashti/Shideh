/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';
import { CustomizationMarketplaceConfiguration } from '../../../../platform/customizationMarketplace/common/customizationMarketplaceSources.js';

class ShidehHubSourcesContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehHubSources';

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}
		const sources = productService.shidehHubSources;
		if (!sources?.length) {
			return;
		}
		const defaults: Record<string, unknown> = {
			[CustomizationMarketplaceConfiguration.MarketplaceEnabled]: true,
			[CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled]: true,
		};
		for (const [key, value] of Object.entries(defaults)) {
			if (configurationService.getValue(key) === undefined) {
				void configurationService.updateValue(key, value);
			}
		}
	}
}

registerWorkbenchContribution2(ShidehHubSourcesContribution.ID, ShidehHubSourcesContribution, WorkbenchPhase.BlockRestore);
