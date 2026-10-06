/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { asText, IRequestService, isSuccess } from '../../../../platform/request/common/request.js';
import { SHIDEH_TEST_NETWORK_COMMAND_ID } from '../common/shidehCommandIds.js';

registerAction2(class ShidehTestNetworkAction extends Action2 {
	constructor() {
		super({
			id: SHIDEH_TEST_NETWORK_COMMAND_ID,
			title: localize2('shidehTestNetwork', "Test network"),
			category: localize2('shidehCategory', "Shideh"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const requestService = accessor.get(IRequestService);
		const notificationService = accessor.get(INotificationService);
		const configurationService = accessor.get(IConfigurationService);

		const baseUrl = String(configurationService.getValue<string>('shideh.openaiCompatible.baseUrl') ?? 'http://127.0.0.1:8080/v1').trim().replace(/\/+$/, '');
		const modelsUrl = `${baseUrl}/models`;
		const started = Date.now();

		try {
			const response = await requestService.request({
				type: 'GET',
				url: modelsUrl,
				timeout: 12_000,
			}, CancellationToken.None);

			const elapsed = Date.now() - started;
			if (isSuccess(response)) {
				const body = await asText(response);
				const preview = body ? body.slice(0, 120).replace(/\s+/g, ' ') : '';
				notificationService.notify({
					severity: Severity.Info,
					message: localize('shidehTestNetworkOk', "Network OK ({0} ms, HTTP {1}). OpenAI-compatible endpoint responded at {2}.{3}", elapsed, response.res.statusCode, modelsUrl, preview ? ` ${preview}` : ''),
				});
				return;
			}

			notificationService.notify({
				severity: Severity.Warning,
				message: localize('shidehTestNetworkHttpFail', "Reachable host but request failed ({0} ms, HTTP {1}) for {2}.", elapsed, response.res.statusCode, modelsUrl),
			});
		} catch (err) {
			const elapsed = Date.now() - started;
			const detail = err instanceof Error ? err.message : String(err);
			notificationService.notify({
				severity: Severity.Error,
				message: localize('shidehTestNetworkError', "Network test failed ({0} ms) for {1}: {2}", elapsed, modelsUrl, detail),
			});
		}
	}
});
