/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { autorun } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../workbench/common/editor.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { IMcpService } from '../../../../workbench/contrib/mcp/common/mcpTypes.js';
import { ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { SHIDEH_MEMORY_FRAMEWORKS } from '../common/shidehMemoryFrameworks.js';
import { SHIDEH_DEFAULT_MCP_SERVER_NAMES } from '../common/shidehDefaultMcpServers.js';

export class ShidehStatsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.shidehStats';

	static readonly RESOURCE = URI.from({ scheme: Schemas.internal, path: '/shideh/stats' });

	override get typeId(): string {
		return ShidehStatsEditorInput.ID;
	}

	override getName(): string {
		return localize('shidehStatsEditorName', "Shideh Stats");
	}

	override get resource(): URI {
		return ShidehStatsEditorInput.RESOURCE;
	}
}

export class ShidehStatsEditor extends EditorPane {

	static readonly ID = 'workbench.editor.shidehStats';

	private root!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IMcpService private readonly mcpService: IMcpService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super(ShidehStatsEditorInput.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.shideh-stats-editor'));
		this.root.style.padding = '24px';
		this.root.style.display = 'flex';
		this.root.style.flexDirection = 'column';
		this.root.style.gap = '8px';
		this.root.style.maxWidth = '560px';
		this._register(this.sessionsManagementService.onDidChangeSessions(() => this.render()));
		this._register(this.languageModelsService.onDidChangePinnedModels(() => this.render()));
		this._register(autorun(reader => {
			this.mcpService.servers.read(reader);
			this.render();
		}));
		this.render();
	}

	private render(): void {
		if (!this.root) {
			return;
		}
		DOM.clearNode(this.root);
		const title = DOM.append(this.root, DOM.$('h2'));
		title.textContent = localize('shidehStatsTitle', "Shideh Stats");
		const sessions = this.sessionsManagementService.getSessions().length;
		const mcpCount = this.mcpService.servers.get().length;
		const favorites = (this.configurationService.getValue<string[]>('shideh.favoriteModels') ?? []).length;
		const frameworkId = this.configurationService.getValue<string>('shideh.memory.framework') ?? 'mem0';
		const framework = SHIDEH_MEMORY_FRAMEWORKS.find(f => f.id === frameworkId)?.displayName ?? frameworkId;
		const harnesses = this.configurationService.getValue<{ cursorPlugin?: boolean; deepseek?: boolean }>('shideh.harnesses') ?? {};
		const enabledHarnesses = [
			harnesses.cursorPlugin ? 'Cursor Plugin' : undefined,
			harnesses.deepseek ? 'Deepseek Harness' : undefined,
		].filter(Boolean).join(', ') || localize('shidehStatsHarnessNone', "None");

		const rows: [string, string][] = [
			[localize('shidehStatsProduct', "Product"), `${this.productService.nameLong} ${this.productService.version ?? ''}`.trim()],
			[localize('shidehStatsSessions', "Agent sessions"), String(sessions)],
			[localize('shidehStatsMcp', "MCP servers (registered)"), String(mcpCount)],
			[localize('shidehStatsMcpBundled', "Bundled MCP defaults"), SHIDEH_DEFAULT_MCP_SERVER_NAMES.join(', ')],
			[localize('shidehStatsMemory', "Memory framework"), framework],
			[localize('shidehStatsFavorites', "Bookmarked models"), String(favorites)],
			[localize('shidehStatsHarnesses', "Harnesses"), enabledHarnesses],
			[localize('shidehStatsPinned', "Pinned models (picker)"), String(this.languageModelsService.getPinnedModelIds().length)],
		];
		for (const [label, value] of rows) {
			const row = DOM.append(this.root, DOM.$('div'));
			row.style.display = 'flex';
			row.style.justifyContent = 'space-between';
			row.style.gap = '16px';
			const labelEl = DOM.append(row, DOM.$('span'));
			labelEl.textContent = label;
			labelEl.style.opacity = '0.85';
			const valueEl = DOM.append(row, DOM.$('span'));
			valueEl.textContent = value;
			valueEl.style.fontWeight = '600';
			valueEl.style.textAlign = 'right';
		}
	}

	override async setInput(input: EditorInput, options: IEditorOpenContext | undefined): Promise<void> {
		await super.setInput(input, options);
		this.render();
	}
}
