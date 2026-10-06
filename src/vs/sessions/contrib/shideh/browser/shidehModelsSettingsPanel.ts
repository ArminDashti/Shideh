/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ILanguageModelsService, getLanguageModelProviderDisplayName } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { getShidehLmProvider, SHIDEH_SELECTED_PROVIDER_KEY, ShidehLmProviderId } from '../common/shidehLmProviderCatalog.js';
import { toShidehAgentSecretStorageKey } from '../common/shidehExtensionSecrets.js';
import { appendProviderLogo } from './shidehProviderSettingsPanel.js';

const $ = DOM.$;

export class ShidehModelsSettingsPanel extends Disposable {

	private listHost!: HTMLElement;
	private statusHost!: HTMLElement;
	private loading = false;

	constructor(
		parent: HTMLElement,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super();
		const root = DOM.append(parent, $('.shideh-models-settings'));
		const heading = DOM.append(root, $('h3.shideh-models-settings-heading'));
		heading.textContent = localize('shidehModelsSettingsHeading', "Available models");

		this.statusHost = DOM.append(root, $('p.shideh-models-settings-status'));
		this.listHost = DOM.append(root, $('.shideh-models-settings-list'));

		void this.connectAndRefresh();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SHIDEH_SELECTED_PROVIDER_KEY)
				|| e.affectsConfiguration('shideh.ollama.baseUrl')
				|| e.affectsConfiguration('shideh.anthropic.baseUrl')
				|| e.affectsConfiguration('shideh.openai.baseUrl')
				|| e.affectsConfiguration('shideh.openrouter.baseUrl')
				|| e.affectsConfiguration('shideh.opencodeGo.baseUrl')
				|| e.affectsConfiguration('shideh.opencodeZen.baseUrl')
				|| e.affectsConfiguration('shideh.openaiCompatible.baseUrl')
				|| e.affectsConfiguration('shideh.openaiCompatible.extraHeaders')) {
				void this.connectAndRefresh();
			}
		}));
		this._register(this.languageModelsService.onDidChangeLanguageModels(() => this.refresh()));
		this._register(this.secretStorageService.onDidChangeSecret(key => {
			const provider = this.getSelectedProvider();
			if (provider && key === toShidehAgentSecretStorageKey(provider.secretKey)) {
				void this.connectAndRefresh();
			}
		}));
	}

	private getSelectedProvider() {
		const stored = this.configurationService.getValue<string>(SHIDEH_SELECTED_PROVIDER_KEY);
		return getShidehLmProvider(stored) ?? getShidehLmProvider('openai');
	}

	private getSelectedVendorId(): ShidehLmProviderId {
		return this.getSelectedProvider()!.id;
	}

	async connectAndRefresh(): Promise<void> {
		const provider = this.getSelectedProvider()!;
		const vendorId = provider.id;
		this.loading = true;
		this.renderStatus(localize('shidehModelsSettingsLoading', "Loading models for {0}…", provider.displayName));
		this.listHost.replaceChildren();

		try {
			await this.languageModelsService.selectLanguageModels({ vendor: vendorId });
		} finally {
			this.loading = false;
			this.refresh();
		}
	}

	private renderStatus(message: string): void {
		this.statusHost.textContent = message;
		this.statusHost.hidden = !message;
	}

	private refresh(): void {
		if (this.loading) {
			return;
		}

		const provider = this.getSelectedProvider()!;
		const vendorId = provider.id;
		this.listHost.replaceChildren();

		const groups = this.languageModelsService.getLanguageModelGroups(vendorId);
		const errorStatus = groups.find(group => group.status?.message)?.status;
		if (errorStatus?.message) {
			this.renderStatus(errorStatus.message);
		} else {
			this.renderStatus('');
		}

		const section = DOM.append(this.listHost, $('.shideh-models-provider-group'));
		const header = DOM.append(section, $('.shideh-models-provider-header'));
		appendProviderLogo(header, provider);
		const title = DOM.append(header, $('span.shideh-models-provider-title'));
		title.textContent = provider.displayName;

		const models = this.languageModelsService.getLanguageModelIds()
			.map(id => ({ id, meta: this.languageModelsService.lookupLanguageModel(id) }))
			.filter(entry => entry.meta?.vendor === vendorId);

		if (models.length === 0) {
			const none = DOM.append(section, $('p.shideh-models-provider-empty'));
			none.textContent = errorStatus?.message
				? localize('shidehModelsProviderLoadFailed', "Could not load models. Check the API key and base URL above, then save again.")
				: localize('shidehModelsProviderEmpty', "No models yet. Enter credentials above and save to connect.");
			return;
		}

		const ul = DOM.append(section, $('ul.shideh-models-provider-models'));
		for (const { id, meta } of models) {
			const li = DOM.append(ul, $('li'));
			const name = meta?.name ?? id;
			const vendorLabel = getLanguageModelProviderDisplayName(this.languageModelsService, meta?.vendor ?? vendorId);
			li.textContent = `${name} — ${vendorLabel}`;
			li.title = id;
		}
	}
}
