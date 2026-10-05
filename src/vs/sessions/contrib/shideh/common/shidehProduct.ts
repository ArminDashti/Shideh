/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from '../../../../platform/product/common/productService.js';

export function isShidehNavigationIntegratedSidebar(productService: IProductService): boolean {
	return productService.sessionsSidebarLayout === 'navigation-integrated';
}

export function isShidehAgentsFirstProduct(productService: IProductService): boolean {
	return productService.defaultAgentsWindowOnStartup === true;
}
