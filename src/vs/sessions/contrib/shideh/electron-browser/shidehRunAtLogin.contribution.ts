/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from '../../../../base/parts/sandbox/electron-browser/globals.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';

class ShidehRunAtLoginContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehRunAtLogin';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		void this.syncFromConfiguration();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('shideh.runAtLogin')) {
				void this.syncFromConfiguration();
			}
		}));
	}

	private async syncFromConfiguration(): Promise<void> {
		const enabled = this.configurationService.getValue<boolean>('shideh.runAtLogin') === true;
		try {
			await ipcRenderer.invoke('vscode:shidehSetLoginItem', enabled);
		} catch {
			// Unsupported platform or main-process handler unavailable.
		}
	}
}

registerWorkbenchContribution2(ShidehRunAtLoginContribution.ID, ShidehRunAtLoginContribution, WorkbenchPhase.AfterRestored);
