/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../../workbench/services/path/common/pathService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { RemoteAgentHostsSettingId } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ChatConfiguration } from '../../../../workbench/contrib/chat/common/constants.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';
import { discoverCursorHarnessPluginRoots } from '../common/shidehHarnessPluginSync.js';

class ShidehHarnessContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehHarness';

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
	) {
		if (!isShidehAgentsFirstProduct(productService)) {
			return;
		}
		void this.applyHarnessDefaults();
	}

	private async applyHarnessDefaults(): Promise<void> {
		const harnesses = this.configurationService.getValue<{ cursorPlugin?: boolean; deepseek?: boolean }>('shideh.harnesses') ?? {};
		if (harnesses.cursorPlugin) {
			await this.ensureRemoteHost('cursor-plugin', 'Cursor Plugin', 'localhost:3100');
			await this.syncHarnessPluginLocations(true, false);
		}
		if (harnesses.deepseek) {
			await this.ensureRemoteHost('deepseek-harness', 'Deepseek Harness', 'localhost:3300');
			await this.syncHarnessPluginLocations(false, true);
		}
	}

	private async syncHarnessPluginLocations(cursor: boolean, deepseek: boolean): Promise<void> {
		const locations = { ...(this.configurationService.getValue<Record<string, boolean>>(ChatConfiguration.PluginLocations) ?? {}) };
		const userHome = await this.pathService.userHome();

		if (cursor) {
			const pluginsRoot = joinPath(userHome, '.cursor', 'plugins');
			for (const root of await discoverCursorHarnessPluginRoots(pluginsRoot, this.fileService)) {
				locations[root.fsPath] = true;
			}
		}

		if (deepseek) {
			const configured = this.configurationService.getValue<string[]>('shideh.plugins.deepseekPluginPaths') ?? [];
			for (const entry of configured) {
				const trimmed = entry.trim();
				if (!trimmed) {
					continue;
				}
				try {
					const uri = await this.pathService.fileURI(trimmed);
					locations[uri.fsPath] = true;
				} catch {
					// ignore invalid paths
				}
			}
		}

		await this.configurationService.updateValue(ChatConfiguration.PluginLocations, locations);
	}

	private async ensureRemoteHost(presetKey: string, name: string, address: string): Promise<void> {
		const presets = this.configurationService.getValue<Record<string, { name: string; address: string }>>('shideh.remoteAgents.presets') ?? {};
		if (!presets[presetKey]) {
			await this.configurationService.updateValue('shideh.remoteAgents.presets', {
				...presets,
				[presetKey]: { name, address },
			});
		}
		const hosts = [...(this.configurationService.getValue<{ address: string; name: string }[]>(RemoteAgentHostsSettingId) ?? [])];
		if (!hosts.some(h => h.address === address)) {
			hosts.push({ address, name });
			await this.configurationService.updateValue(RemoteAgentHostsSettingId, hosts);
		}
	}
}

registerWorkbenchContribution2(ShidehHarnessContribution.ID, ShidehHarnessContribution, WorkbenchPhase.BlockRestore);
