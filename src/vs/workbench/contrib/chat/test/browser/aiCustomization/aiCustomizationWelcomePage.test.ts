/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { CustomizationMarketplaceConfiguration, CustomizationMarketplaceSources, getVisibleCustomizationMarketplaceSources } from '../../../../../../platform/customizationMarketplace/common/customizationMarketplaceSources.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';

suite('AICustomizationWelcomePage', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Marketplace visibility is independent of public feed enablement', () => {
		const cases = [
			{ marketplace: false, publicFeed: false, discover: false },
			{ marketplace: false, publicFeed: true, discover: false },
			{ marketplace: true, publicFeed: false, discover: true },
			{ marketplace: true, publicFeed: true, discover: true },
		];
		assert.deepStrictEqual(cases.map(({ marketplace, publicFeed }) =>
			getVisibleCustomizationMarketplaceSources(new TestConfigurationService({
				[CustomizationMarketplaceConfiguration.MarketplaceEnabled]: marketplace,
				[CustomizationMarketplaceConfiguration.AgentFinderPublicFeedEnabled]: publicFeed,
			}), Object.values(CustomizationMarketplaceSources)).length > 0), cases.map(({ discover }) => discover));
	});
});
