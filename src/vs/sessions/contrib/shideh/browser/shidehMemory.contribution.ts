/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';
import { DEFAULT_SHIDEH_MEMORY_FRAMEWORK, isShidehMemoryFrameworkId } from '../common/shidehMemoryFrameworks.js';
import { getShidehMemoryStoreUri } from './shidehMemoryPaths.js';

interface IShidehMemoryDocument {
	readonly framework: string;
	readonly entries: readonly { readonly text: string; readonly createdAt: string }[];
}

class ShidehMemoryContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehMemory';

	constructor(
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
	) {
		super();
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}
		void this.ensureStore().catch(onUnexpectedError);
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('shideh.memory.framework')) {
				void this.ensureStore().catch(onUnexpectedError);
			}
		}));
	}

	private async ensureStore(): Promise<void> {
		if (this.configurationService.getValue<boolean>('shideh.memory.enabled') === false) {
			return;
		}
		const configured = this.configurationService.getValue<string>('shideh.memory.framework') ?? DEFAULT_SHIDEH_MEMORY_FRAMEWORK;
		const framework = isShidehMemoryFrameworkId(configured) ? configured : DEFAULT_SHIDEH_MEMORY_FRAMEWORK;
		const uri = getShidehMemoryStoreUri(framework, this.environmentService, this.productService);
		const folderUri = uri.with({ path: uri.path.replace(/\/[^/]+$/, '') });
		try {
			if (await this.fileService.exists(uri)) {
				return;
			}
		} catch {
			// create below
		}
		await this.fileService.createFolder(folderUri);
		const doc: IShidehMemoryDocument = { framework, entries: [] };
		await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(doc, null, 2)));
	}
}

registerWorkbenchContribution2(ShidehMemoryContribution.ID, ShidehMemoryContribution, WorkbenchPhase.Eventually);
