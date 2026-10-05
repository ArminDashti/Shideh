/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import type { ShidehMemoryFrameworkId } from '../common/shidehMemoryFrameworks.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';

export function getShidehMemoryStoreUri(
	framework: ShidehMemoryFrameworkId,
	environmentService: INativeEnvironmentService,
	productService: IProductService,
): URI {
	const dataFolder = productService.dataFolderName || '.sauronharness';
	return URI.joinPath(environmentService.userHome, dataFolder, 'memory', framework, 'active.json');
}

export function getShidehMemoryStoreResource(framework: ShidehMemoryFrameworkId): URI {
	return URI.from({ scheme: Schemas.internal, path: `/shideh/memory/${framework}` });
}
