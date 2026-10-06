/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { isShidehAgentsFirstProduct, isShidehNavigationIntegratedSidebar } from '../common/shidehProduct.js';
import { ShidehNavigationIntegratedContext } from '../common/shidehContextKeys.js';

const SHIDEH_NAVIGATION_SIDEBAR_CLASS = 'shideh-navigation-sidebar';
const SHIDEH_SIMPLIFIED_CHAT_CHROME_CLASS = 'shideh-simplified-chat-chrome';

class ShidehNavigationContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehNavigation';

	constructor(
		@IProductService productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		const integrated = isShidehNavigationIntegratedSidebar(productService);
		ShidehNavigationIntegratedContext.bindTo(contextKeyService).set(integrated);
		mainWindow.document.body.classList.toggle(SHIDEH_NAVIGATION_SIDEBAR_CLASS, integrated);
		mainWindow.document.body.classList.toggle(SHIDEH_SIMPLIFIED_CHAT_CHROME_CLASS, isShidehAgentsFirstProduct(productService));
	}
}

registerWorkbenchContribution2(ShidehNavigationContribution.ID, ShidehNavigationContribution, WorkbenchPhase.BlockStartup);
