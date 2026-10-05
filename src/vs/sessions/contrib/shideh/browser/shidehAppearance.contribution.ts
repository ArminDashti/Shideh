/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shidehAppearance.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Color } from '../../../../base/common/color.js';
import { IWorkbenchThemeService } from '../../../../workbench/services/themes/common/workbenchThemeService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';

const STYLE_ELEMENT_ID = 'shideh-appearance-overrides';

class ShidehAppearanceContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shidehAppearance';
	private readonly paletteOverlay = this._register(new MutableDisposable());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
	) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('shideh.appearance')) {
				this.apply();
				this.registerPaletteOverlay();
			}
		}));
		this.registerPaletteOverlay();
		this.apply();
	}

	private registerPaletteOverlay(): void {
		this.paletteOverlay.value = this.themeService.registerColorThemeOverlay(theme => this.getSelectedPaletteColors(theme));
	}

	private getSelectedPaletteColors(theme: import('../../../../workbench/services/themes/common/workbenchThemeService.js').IWorkbenchColorTheme): import('../../../../workbench/services/themes/common/workbenchThemeService.js').IColorMap {
		const selected = this.configurationService.getValue<string>('shideh.appearance.popularTheme') ?? 'dark-modern';
		const palettes: Record<string, { background: string; panel: string; foreground: string; border: string; accent: string }> = {
			'dark-modern': { background: '#1f1f1f', panel: '#181818', foreground: '#cccccc', border: '#333333', accent: '#0078d4' },
			'dark-plus': { background: '#1e1e1e', panel: '#252526', foreground: '#cccccc', border: '#3c3c3c', accent: '#007acc' },
			abyss: { background: '#000c18', panel: '#001221', foreground: '#6688cc', border: '#0d2538', accent: '#0088ff' },
			monokai: { background: '#272822', panel: '#1e1f1c', foreground: '#f8f8f2', border: '#414339', accent: '#a6e22e' },
			'monokai-dimmed': { background: '#1e1e1e', panel: '#252526', foreground: '#c5c5c5', border: '#3a3a3a', accent: '#c586c0' },
			'solarized-dark': { background: '#002b36', panel: '#073642', foreground: '#839496', border: '#164b55', accent: '#2aa198' },
			'tomorrow-night-blue': { background: '#002451', panel: '#001b3d', foreground: '#ffffff', border: '#00346e', accent: '#bbdaff' },
			'kimbie-dark': { background: '#221a0f', panel: '#362712', foreground: '#d3af86', border: '#4a3518', accent: '#f06431' },
			'light-modern': { background: '#ffffff', panel: '#f8f8f8', foreground: '#3b3b3b', border: '#e5e5e5', accent: '#005fb8' },
			'quiet-light': { background: '#f5f5f5', panel: '#ffffff', foreground: '#333333', border: '#dedede', accent: '#4876d1' },
		};
		const palette = palettes[selected] ?? palettes['dark-modern'];
		return {
			'agents.background': Color.fromHex(palette.background),
			'agentsPanel.background': Color.fromHex(palette.panel),
			'agentsPanel.foreground': Color.fromHex(palette.foreground),
			'agentsPanel.border': Color.fromHex(palette.border),
			'agentsCard.border': Color.fromHex(palette.border),
			'agentsBottomPanel.border': Color.fromHex(palette.border),
			'agentsGradient.tintColor': Color.fromHex(palette.accent),
			'sideBar.background': Color.fromHex(palette.background),
			'sideBar.foreground': Color.fromHex(palette.foreground),
			'editor.background': theme.getColor('editor.background') ?? Color.fromHex(palette.background),
		};
	}

	private apply(): void {
		const doc = mainWindow.document;
		let style = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
		if (!style) {
			style = doc.createElement('style');
			style.id = STYLE_ELEMENT_ID;
			doc.head.appendChild(style);
		}
		const fontFamily = this.configurationService.getValue<string>('shideh.appearance.fontFamily')?.trim();
		const fontSize = this.configurationService.getValue<number>('shideh.appearance.fontSize');
		const foreground = this.configurationService.getValue<string>('shideh.appearance.foreground')?.trim();
		const sidebarBackground = this.configurationService.getValue<string>('shideh.appearance.sidebarBackground')?.trim();
		const activeSessionBackground = this.configurationService.getValue<string>('shideh.appearance.activeSessionBackground')?.trim();
		const chatInputBackground = this.configurationService.getValue<string>('shideh.appearance.chatInputBackground')?.trim();
		const theme = this.getSelectedPaletteColors(this.themeService.getBaseColorTheme());
		const shellBackground = theme['agents.background']?.toString();
		const panelBackground = theme['agentsPanel.background']?.toString();
		const panelForeground = theme['agentsPanel.foreground']?.toString();
		const panelBorder = theme['agentsPanel.border']?.toString();

		const rules: string[] = [];
		if (shellBackground) {
			rules.push(`--vscode-agents-background: ${shellBackground};`);
		}
		if (panelBackground) {
			rules.push(`--vscode-agentsPanel-background: ${panelBackground};`);
		}
		if (panelForeground) {
			rules.push(`--vscode-agentsPanel-foreground: ${panelForeground};`);
		}
		if (panelBorder) {
			rules.push(`--vscode-agentsPanel-border: ${panelBorder};`);
		}
		if (fontFamily) {
			rules.push(`--shideh-font-family: ${fontFamily};`);
		}
		if (fontSize && fontSize > 0) {
			rules.push(`--shideh-font-size: ${fontSize}px;`);
		}
		if (foreground) {
			rules.push(`--shideh-foreground: ${foreground};`);
		}
		if (sidebarBackground) {
			rules.push(`--shideh-sidebar-background: ${sidebarBackground};`);
		}
		if (activeSessionBackground) {
			rules.push(`--shideh-active-session-background: ${activeSessionBackground};`);
		}
		if (chatInputBackground) {
			rules.push(`--shideh-chat-input-background: ${chatInputBackground};`);
		}

		if (!rules.length) {
			style.textContent = '';
			return;
		}

		style.textContent = `.agent-sessions-workbench {\n${rules.join('\n')}\n}`;
	}
}

registerWorkbenchContribution2(ShidehAppearanceContribution.ID, ShidehAppearanceContribution, WorkbenchPhase.AfterRestored);
