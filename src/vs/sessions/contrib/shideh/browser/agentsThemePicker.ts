/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Event } from '../../../../base/common/event.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';

const POPULAR_THEMES = [
	{ id: 'dark-modern', label: 'Dark Modern', scheme: 'dark', background: '#1f1f1f', panel: '#181818', foreground: '#cccccc', border: '#333333', accent: '#0078d4' },
	{ id: 'dark-plus', label: 'Dark+', scheme: 'dark', background: '#1e1e1e', panel: '#252526', foreground: '#cccccc', border: '#3c3c3c', accent: '#007acc' },
	{ id: 'abyss', label: 'Abyss', scheme: 'dark', background: '#000c18', panel: '#001221', foreground: '#6688cc', border: '#0d2538', accent: '#0088ff' },
	{ id: 'monokai', label: 'Monokai', scheme: 'dark', background: '#272822', panel: '#1e1f1c', foreground: '#f8f8f2', border: '#414339', accent: '#a6e22e' },
	{ id: 'monokai-dimmed', label: 'Monokai Dimmed', scheme: 'dark', background: '#1e1e1e', panel: '#252526', foreground: '#c5c5c5', border: '#3a3a3a', accent: '#c586c0' },
	{ id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark', background: '#002b36', panel: '#073642', foreground: '#839496', border: '#164b55', accent: '#2aa198' },
	{ id: 'tomorrow-night-blue', label: 'Tomorrow Night Blue', scheme: 'dark', background: '#002451', panel: '#001b3d', foreground: '#ffffff', border: '#00346e', accent: '#bbdaff' },
	{ id: 'kimbie-dark', label: 'Kimbie Dark', scheme: 'dark', background: '#221a0f', panel: '#362712', foreground: '#d3af86', border: '#4a3518', accent: '#f06431' },
	{ id: 'light-modern', label: 'Light Modern', scheme: 'light', background: '#ffffff', panel: '#f8f8f8', foreground: '#3b3b3b', border: '#e5e5e5', accent: '#005fb8' },
	{ id: 'quiet-light', label: 'Quiet Light', scheme: 'light', background: '#f5f5f5', panel: '#ffffff', foreground: '#333333', border: '#dedede', accent: '#4876d1' },
] as const;

const $ = DOM.$;

/** Ten curated window-local themes: eight dark and two light. */
export class AgentsThemePicker extends Disposable {

	constructor(parent: HTMLElement, @IConfigurationService private readonly configurationService: IConfigurationService) {
		super();
		const root = DOM.append(parent, $('.agents-theme-picker'));
		const heading = DOM.append(root, $('h2'));
		heading.textContent = localize('agentsPopularThemes', 'Popular Themes');
		const description = DOM.append(root, $('p'));
		description.textContent = localize('agentsPopularThemesDescription', 'Choose from eight dark themes and two light themes for this Agents window.');
		const grid = DOM.append(root, $('.agents-theme-picker-grid'));
		const buttons = POPULAR_THEMES.map(theme => {
			const button = DOM.append(grid, $('button.agents-theme-picker-option') as HTMLButtonElement);
			button.type = 'button';
			button.setAttribute('aria-label', theme.label);
			const swatch = DOM.append(button, $('.agents-theme-picker-swatch'));
			const dot = DOM.append(swatch, $('.agents-theme-picker-swatch-dot'));
			dot.style.backgroundColor = theme.accent;
			dot.style.boxShadow = `0 0 0 1px ${theme.border}`;
			const check = DOM.append(swatch, $('.agents-theme-picker-check'));
			check.appendChild(renderIcon(Codicon.check));
			DOM.append(button, $('.agents-theme-picker-label')).textContent = theme.label;
			this._register(DOM.addDisposableListener(button, 'click', () => {
				void this.configurationService.updateValue('shideh.appearance.popularTheme', theme.id, ConfigurationTarget.USER);
			}));
			return { theme, button };
		});
		const updateSelection = () => {
			const selectedTheme = this.configurationService.getValue<string>('shideh.appearance.popularTheme') ?? 'dark-modern';
			for (const { theme, button } of buttons) {
				const selected = selectedTheme === theme.id;
				button.classList.toggle('selected', selected);
				button.setAttribute('aria-pressed', String(selected));
			}
		};
		updateSelection();
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, event => event.affectsConfiguration('shideh.appearance.popularTheme'))(() => updateSelection()));
	}
}
