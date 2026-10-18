/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { derived, observableFromEvent } from '../../../../../base/common/observable.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import {
	CustomizationHarnessServiceBase,
	ICustomizationEnablementHandler,
	ICustomizationHarnessService,
	IExternalCustomizationItemProvider,
	createVSCodeHarnessDescriptor,

} from '../../common/customizationHarnessService.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import { SessionType } from '../../common/chatSessionsService.js';
import { URI } from '../../../../../base/common/uri.js';

/**
 * Enablement provider backed by promptsService (StorageService).
 * Used by the VS Code (Local) harness to manage disabled customizations.
 */
function createPromptsServiceEnablementHandler(promptsService: IPromptsService): ICustomizationEnablementHandler {
	return {
		handleCustomizationEnablement(uri: URI, type: PromptsType, enabled: boolean, scope: 'global' | 'workspace'): void {
			const storageScope = scope === 'workspace' ? StorageScope.WORKSPACE : StorageScope.PROFILE;
			const disabled = promptsService.getDisabledPromptFilesForScope(type, storageScope);
			if (enabled) {
				disabled.delete(uri);
			} else {
				disabled.add(uri);
			}
			promptsService.setDisabledPromptFiles(type, disabled, storageScope);

			// When enabling, also remove from the other scope to fully re-enable
			if (enabled) {
				const otherScope = scope === 'workspace' ? StorageScope.PROFILE : StorageScope.WORKSPACE;
				const otherDisabled = promptsService.getDisabledPromptFilesForScope(type, otherScope);
				if (otherDisabled.delete(uri)) {
					promptsService.setDisabledPromptFiles(type, otherDisabled, otherScope);
				}
			}
		},
	};
}

/**
 * Core implementation of the customization harness service.
 *
 * Only the Local harness is registered statically. All other harnesses
 * (e.g. Copilot CLI) are contributed by extensions via the provider API.
 *
 * A {@link PromptsServiceCustomizationProvider} wraps IPromptsService
 * so the management editor uses the same provider-based code path for
 * Local items as it does for extension-contributed harnesses.
 *
 * The provider is created lazily via IInstantiationService to avoid
 * cyclic dependencies between ICustomizationHarnessService and
 * IPromptsService (which depends on the extension host).
 */
class CustomizationHarnessService extends CustomizationHarnessServiceBase {
	constructor(
		@IPromptsService promptsService: IPromptsService,
	) {
		super(
			[createVSCodeHarnessDescriptor()],
			SessionType.Local,
			promptsService,
		);

		this._register(disposable);
	}

	override getSessionResourceForHarness(sessionType: string): URI {
		// const lastUsedSession = this.agentSessionsService.model.sessions
		// 	.filter(session => session.providerType === sessionType)
		// 	.sort((a, b) => (b.timing.lastRequestEnded ?? b.timing.created) - (a.timing.lastRequestEnded ?? a.timing.created))
		// 	.at(0);

		// if (lastUsedSession) {
		// 	return lastUsedSession.resource;
		// }

		return super.getSessionResourceForHarness(sessionType);
	}
}

registerSingleton(ICustomizationHarnessService, CustomizationHarnessService, InstantiationType.Delayed);

