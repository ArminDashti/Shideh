/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { RemoteAgentHostsSettingId } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { isShidehAgentsFirstProduct } from '../common/shidehProduct.js';

class ShidehHarnessContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehHarness';

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
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
		}
		if (harnesses.deepseek) {
			await this.ensureRemoteHost('deepseek-harness', 'Deepseek Harness', 'localhost:3300');
		}
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
