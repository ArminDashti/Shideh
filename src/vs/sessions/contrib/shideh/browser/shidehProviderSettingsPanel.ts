/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IContextViewService, IOpenContextView } from '../../../../platform/contextview/browser/contextView.js';
import { ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { getShidehLmProvider, IShidehLmProviderDefinition, SHIDEH_LM_PROVIDERS, SHIDEH_SELECTED_PROVIDER_KEY, SHIDEH_STARRED_PROVIDERS_KEY, ShidehLmProviderId } from '../common/shidehLmProviderCatalog.js';
import { toShidehAgentSecretStorageKey } from '../common/shidehExtensionSecrets.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { SHIDEH_PROVIDER_LOGO_DATA_URL } from '../common/shidehProviderLogos.js';

const $ = DOM.$;

export function appendProviderLogo(parent: HTMLElement, provider: IShidehLmProviderDefinition, size = 18): void {
	const logo = DOM.append(parent, $('.shideh-provider-logo'));
	logo.style.width = `${size}px`;
	logo.style.height = `${size}px`;
	logo.setAttribute('aria-hidden', 'true');
	const logoUrl = SHIDEH_PROVIDER_LOGO_DATA_URL[provider.id];
	if (logoUrl) {
		logo.classList.add('shideh-provider-logo--image');
		logo.style.backgroundImage = `url("${logoUrl}")`;
	} else {
		logo.style.setProperty('--shideh-provider-color', provider.brandColor);
		const letter = provider.displayName.charAt(0).toUpperCase();
		logo.textContent = letter;
	}
}

export class ShidehProviderSettingsPanel extends Disposable {

	private trigger!: HTMLButtonElement;
	private fieldsHost!: HTMLElement;
	private menuHost: HTMLElement | undefined;
	private openMenu: IOpenContextView | undefined;
	private selectedId: ShidehLmProviderId;

	constructor(
		parent: HTMLElement,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super();
		const stored = this.configurationService.getValue<string>(SHIDEH_SELECTED_PROVIDER_KEY);
		this.selectedId = (getShidehLmProvider(stored)?.id ?? 'openai') as ShidehLmProviderId;

		const root = DOM.append(parent, $('.shideh-provider-settings'));
		const intro = DOM.append(root, $('p.shideh-provider-settings-intro'));
		intro.textContent = localize('shidehProviderSettingsIntro', "Choose a vendor and connect with an API key or base URL. Available models appear below after a successful connection.");

		const pickerRow = DOM.append(root, $('.shideh-provider-picker-row'));
		const pickerLabel = DOM.append(pickerRow, $('span.shideh-provider-picker-label'));
		pickerLabel.textContent = localize('shidehProviderPickerLabel', "Provider");

		this.trigger = DOM.append(pickerRow, $('button.shideh-provider-picker-trigger')) as HTMLButtonElement;
		this.trigger.type = 'button';
		this.trigger.setAttribute('aria-haspopup', 'listbox');
		this._register(DOM.addDisposableListener(this.trigger, 'click', () => this.toggleMenu()));
		this._register(DOM.addDisposableListener(this.trigger, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.showMenu();
			}
		}));

		this.fieldsHost = DOM.append(root, $('.shideh-provider-fields'));
		this.updateTriggerLabel();
		void this.renderFields();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SHIDEH_STARRED_PROVIDERS_KEY) || e.affectsConfiguration(SHIDEH_SELECTED_PROVIDER_KEY)) {
				this.updateTriggerLabel();
			}
		}));
	}

	private getStarred(): Set<string> {
		const list = this.configurationService.getValue<string[]>(SHIDEH_STARRED_PROVIDERS_KEY) ?? [];
		return new Set(list);
	}

	private async setStarred(vendor: ShidehLmProviderId, starred: boolean): Promise<void> {
		const next = new Set(this.getStarred());
		if (starred) {
			next.add(vendor);
		} else {
			next.delete(vendor);
		}
		await this.configurationService.updateValue(SHIDEH_STARRED_PROVIDERS_KEY, [...next]);
	}

	private updateTriggerLabel(): void {
		const provider = getShidehLmProvider(this.selectedId)!;
		this.trigger.replaceChildren();
		appendProviderLogo(this.trigger, provider, 20);
		const name = DOM.append(this.trigger, $('span.shideh-provider-picker-name'));
		name.textContent = provider.displayName;
		const chevron = DOM.append(this.trigger, $('span.shideh-provider-picker-chevron'));
		chevron.appendChild(renderIcon(Codicon.chevronDown));
	}

	private closeMenu(): void {
		this.openMenu?.close();
	}

	private toggleMenu(): void {
		if (this.openMenu) {
			this.closeMenu();
			return;
		}
		this.showMenu();
	}

	private showMenu(): void {
		if (this.openMenu) {
			return;
		}
		const starred = this.getStarred();
		this.openMenu = this.contextViewService.showContextView({
			getAnchor: () => this.trigger,
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			layer: 30,
			onDOMEvent: e => {
				const eventType = e.browserEvent?.type ?? e.type;
				if (eventType === DOM.EventType.KEY_DOWN && e.keyCode === KeyCode.Escape) {
					e.preventDefault();
					e.stopPropagation();
					this.closeMenu();
					this.trigger.focus();
					return;
				}
				if (eventType === DOM.EventType.CLICK) {
					const target = e.target;
					if (DOM.isHTMLElement(target)
						&& !DOM.isAncestor(target, this.contextViewService.getContextViewElement())
						&& !DOM.isAncestor(target, this.trigger)) {
						this.closeMenu();
					}
				}
			},
			render: container => {
				const menuDisposables = new DisposableStore();
				this.menuHost = container;
				container.classList.add('monaco-menu-container', 'shideh-provider-menu');
				const list = DOM.append(container, $('ul.shideh-provider-menu-list'));
				list.setAttribute('role', 'listbox');
				list.setAttribute('aria-label', localize('shidehProviderMenuAria', "Language model providers"));

				for (const provider of SHIDEH_LM_PROVIDERS) {
					const item = DOM.append(list, $('li.shideh-provider-menu-item')) as HTMLLIElement;
					item.setAttribute('role', 'option');
					item.tabIndex = 0;
					item.classList.toggle('selected', provider.id === this.selectedId);

					const selectBtn = DOM.append(item, $('button.shideh-provider-menu-select')) as HTMLButtonElement;
					selectBtn.type = 'button';
					appendProviderLogo(selectBtn, provider);
					const label = DOM.append(selectBtn, $('span'));
					label.textContent = provider.displayName;
					if (starred.has(provider.id)) {
						DOM.append(selectBtn, $('span.shideh-provider-star-indicator')).appendChild(renderIcon(Codicon.starFull));
					}

					menuDisposables.add(DOM.addDisposableListener(selectBtn, 'click', e => {
						e.stopPropagation();
						void this.selectProvider(provider.id);
						this.closeMenu();
					}));

					const star = DOM.append(item, $('button.shideh-provider-menu-star')) as HTMLButtonElement;
					star.type = 'button';
					star.setAttribute('aria-label', starred.has(provider.id)
						? localize('shidehProviderUnstar', "Remove {0} from starred providers", provider.displayName)
						: localize('shidehProviderStar', "Star {0} in the model picker", provider.displayName));
					star.classList.toggle('starred', starred.has(provider.id));
					star.appendChild(renderIcon(starred.has(provider.id) ? Codicon.starFull : Codicon.starEmpty));
					menuDisposables.add(DOM.addDisposableListener(star, 'click', e => {
						e.stopPropagation();
						void this.setStarred(provider.id, !starred.has(provider.id)).then(() => {
							this.closeMenu();
							this.showMenu();
						});
					}));
				}
				return {
					dispose: () => {
						menuDisposables.dispose();
						this.menuHost = undefined;
					},
					focus: () => list.focus(),
				};
			},
			onHide: () => {
				this.openMenu = undefined;
			},
		});
	}

	private async selectProvider(id: ShidehLmProviderId): Promise<void> {
		this.selectedId = id;
		await this.configurationService.updateValue(SHIDEH_SELECTED_PROVIDER_KEY, id);
		this.updateTriggerLabel();
		await this.renderFields();
		void this.refreshModelsForSelection();
	}

	private async renderFields(): Promise<void> {
		const provider = getShidehLmProvider(this.selectedId)!;
		this.fieldsHost.replaceChildren();

		const heading = DOM.append(this.fieldsHost, $('h3.shideh-provider-fields-title'));
		heading.textContent = provider.displayName;

		await this.renderApiKeyField(provider);
		this.renderBaseUrlField(provider);
		if (provider.id === 'openai-compatible') {
			this.renderExtraHeadersField();
		}

		if (provider.envVar) {
			const envNote = DOM.append(this.fieldsHost, $('p.shideh-provider-env-note'));
			envNote.textContent = localize('shidehProviderEnvNote', "Environment variable {0} overrides the stored key when set.", provider.envVar);
		}

		void this.refreshModelsForSelection();
	}

	private refreshModelsForSelection(): Promise<void> {
		return this.languageModelsService.selectLanguageModels({ vendor: this.selectedId });
	}

	private async renderApiKeyField(provider: IShidehLmProviderDefinition): Promise<void> {
		const row = DOM.append(this.fieldsHost, $('.shideh-provider-field-row'));
		const label = DOM.append(row, $('label.shideh-provider-field-label'));
		const labelText = provider.apiKeyRequired
			? localize('shidehProviderApiKey', "API key")
			: localize('shidehProviderApiKeyOptional', "API key (optional)");
		label.textContent = labelText;

		const input = DOM.append(row, $('input.shideh-provider-field-input')) as HTMLInputElement;
		input.type = 'password';
		input.autocomplete = 'off';
		input.placeholder = provider.apiKeyHint ?? localize('shidehProviderApiKeyPlaceholder', "Paste API key");
		input.setAttribute('aria-label', labelText);

		const storageKey = toShidehAgentSecretStorageKey(provider.secretKey);
		const stored = await this.secretStorageService.get(storageKey);
		if (stored) {
			input.value = stored;
		}

		const save = DOM.addDisposableListener(input, 'change', () => {
			void this.persistApiKey(provider, input.value.trim());
		});
		this._register(save);
		this._register(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter) {
				void this.persistApiKey(provider, input.value.trim());
			}
		}));
	}

	private async persistApiKey(provider: IShidehLmProviderDefinition, value: string): Promise<void> {
		const storageKey = toShidehAgentSecretStorageKey(provider.secretKey);
		if (!value) {
			await this.secretStorageService.delete(storageKey);
		} else {
			await this.secretStorageService.set(storageKey, value);
		}
		if (provider.id === this.selectedId) {
			await this.refreshModelsForSelection();
		}
	}

	private renderExtraHeadersField(): void {
		const row = DOM.append(this.fieldsHost, $('.shideh-provider-field-row.shideh-provider-field-row-multiline'));
		const label = DOM.append(row, $('label.shideh-provider-field-label'));
		label.textContent = localize('shidehProviderExtraHeaders', "Extra HTTP headers");

		const hint = DOM.append(row, $('p.shideh-provider-field-hint'));
		hint.textContent = localize('shidehProviderExtraHeadersHint', "One header per line, formatted as Name: value. Appended to every OpenAI-compatible request.");

		const textarea = DOM.append(row, $('textarea.shideh-provider-field-textarea')) as HTMLTextAreaElement;
		textarea.rows = 4;
		textarea.spellcheck = false;
		textarea.value = String(this.configurationService.getValue<string>('shideh.openaiCompatible.extraHeaders') ?? '');
		textarea.setAttribute('aria-label', localize('shidehProviderExtraHeaders', "Extra HTTP headers"));

		const commit = () => {
			void this.configurationService.updateValue('shideh.openaiCompatible.extraHeaders', textarea.value).then(() => {
				if (this.selectedId === 'openai-compatible') {
					void this.refreshModelsForSelection();
				}
			});
		};
		this._register(DOM.addDisposableListener(textarea, 'change', commit));
		this._register(DOM.addDisposableListener(textarea, 'blur', commit));
	}

	private renderBaseUrlField(provider: IShidehLmProviderDefinition): void {
		const row = DOM.append(this.fieldsHost, $('.shideh-provider-field-row'));
		const label = DOM.append(row, $('label.shideh-provider-field-label'));
		label.textContent = localize('shidehProviderBaseUrl', "Base URL");

		const input = DOM.append(row, $('input.shideh-provider-field-input')) as HTMLInputElement;
		input.type = 'url';
		input.autocomplete = 'off';
		const current = String(this.configurationService.getValue<string>(provider.baseUrlConfigKey) ?? provider.defaultBaseUrl);
		input.value = current;
		input.setAttribute('aria-label', localize('shidehProviderBaseUrl', "Base URL"));

		const commit = () => {
			const trimmed = input.value.trim() || provider.defaultBaseUrl;
			void this.configurationService.updateValue(provider.baseUrlConfigKey, trimmed).then(() => {
				if (provider.id === this.selectedId) {
					void this.refreshModelsForSelection();
				}
			});
		};
		this._register(DOM.addDisposableListener(input, 'change', commit));
		this._register(DOM.addDisposableListener(input, 'blur', commit));
	}

	override dispose(): void {
		this.closeMenu();
		super.dispose();
	}
}
