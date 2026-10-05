/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';
import { IUserDataProfileService } from '../../../../workbench/services/userDataProfile/common/userDataProfile.js';
import { IMcpResourceScannerService } from '../../../../platform/mcp/common/mcpResourceScannerService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { McpResourceFormat } from '../../../../platform/mcp/common/mcpWorkspaceConfiguration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { SHIDEH_DEFAULT_MCP_SERVER_DEFINITIONS } from '../common/shidehDefaultMcpServers.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';

const SHIDEH_DEFAULT_MCP_SEEDED_KEY = 'shideh.defaultMcpServersSeeded';

class ShidehDefaultMcpContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehDefaultMcp';

	constructor(
		@IProductService productService: IProductService,
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IMcpResourceScannerService mcpResourceScannerService: IMcpResourceScannerService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}
		if (storageService.getBoolean(SHIDEH_DEFAULT_MCP_SEEDED_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		if (configurationService.getValue<boolean>('shideh.mcp.seedDefaults') === false) {
			return;
		}
		void this.seed(mcpResourceScannerService, userDataProfileService, storageService).catch(onUnexpectedError);
	}

	private async seed(
		mcpResourceScannerService: IMcpResourceScannerService,
		userDataProfileService: IUserDataProfileService,
		storageService: IStorageService,
	): Promise<void> {
		const mcpResource = userDataProfileService.currentProfile.mcpResource;
		const existing = await mcpResourceScannerService.scanMcpServers(mcpResource, ConfigurationTarget.USER, McpResourceFormat.Vscode);
		const toAdd = Object.entries(SHIDEH_DEFAULT_MCP_SERVER_DEFINITIONS)
			.filter(([name]) => !existing.servers?.[name])
			.map(([name, config]) => ({ name, config }));
		if (toAdd.length) {
			await mcpResourceScannerService.addMcpServers(toAdd, mcpResource, ConfigurationTarget.USER, McpResourceFormat.Vscode);
		}
		storageService.store(SHIDEH_DEFAULT_MCP_SEEDED_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

registerWorkbenchContribution2(ShidehDefaultMcpContribution.ID, ShidehDefaultMcpContribution, WorkbenchPhase.Eventually);
