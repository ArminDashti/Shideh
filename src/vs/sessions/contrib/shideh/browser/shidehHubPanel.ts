/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { AICustomizationManagementCommands, AICustomizationManagementSection } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagement.js';
import { IShidehHubDownloadSource, SHIDEH_HUB_MCP_SOURCES, SHIDEH_HUB_PLUGIN_SOURCES, SHIDEH_HUB_SKILL_SOURCES } from '../common/shidehHubCatalog.js';

export class ShidehHubPanel extends Disposable {

	constructor(
		parent: HTMLElement,
		@IOpenerService private readonly openerService: IOpenerService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		const root = DOM.append(parent, DOM.$('.shideh-hub-panel'));
		const intro = DOM.append(root, DOM.$('p.shideh-hub-intro'));
		intro.textContent = localize('shidehHubIntro', "Browse trusted catalogs for skills, MCP servers, and agent plugins (Cursor and DeepSeek Harness). Each link opens the publisher site; use Marketplace to install inside Shideh.");

		this.renderSubsection(root, localize('shidehHubSubsection.skills', "Skills"), SHIDEH_HUB_SKILL_SOURCES, AICustomizationManagementSection.Skills);
		this.renderSubsection(root, localize('shidehHubSubsection.mcp', "MCP"), SHIDEH_HUB_MCP_SOURCES, AICustomizationManagementSection.McpServers);
		this.renderSubsection(root, localize('shidehHubSubsection.plugins', "Plugins"), SHIDEH_HUB_PLUGIN_SOURCES, AICustomizationManagementSection.Plugins);
	}

	private renderSubsection(
		parent: HTMLElement,
		title: string,
		sources: readonly IShidehHubDownloadSource[],
		marketplaceSection: AICustomizationManagementSection,
	): void {
		const block = DOM.append(parent, DOM.$('.shideh-hub-subsection'));
		const heading = DOM.append(block, DOM.$('h3.shideh-hub-subsection-title'));
		heading.textContent = title;

		const list = DOM.append(block, DOM.$('ol.shideh-hub-source-list'));
		for (const [index, source] of sources.entries()) {
			const item = DOM.append(list, DOM.$('li.shideh-hub-source-item')) as HTMLLIElement;
			const rank = DOM.append(item, DOM.$('span.shideh-hub-source-rank'));
			rank.textContent = String(index + 1);
			rank.setAttribute('aria-hidden', 'true');

			const body = DOM.append(item, DOM.$('.shideh-hub-source-body'));
			const nameRow = DOM.append(body, DOM.$('.shideh-hub-source-name-row'));
			DOM.append(nameRow, DOM.$('span.shideh-hub-source-name')).textContent = source.name;
			DOM.append(body, DOM.$('p.shideh-hub-source-description')).textContent = source.description;

			const actions = DOM.append(item, DOM.$('.shideh-hub-source-actions'));
			const siteButton = DOM.append(actions, DOM.$('button.shideh-hub-source-button')) as HTMLButtonElement;
			siteButton.type = 'button';
			siteButton.textContent = localize('shidehHubOpenSource', "Open site");
			this._register(DOM.addDisposableListener(siteButton, 'click', () => {
				void this.openerService.open(URI.parse(source.url));
			}));

			const marketplaceButton = DOM.append(actions, DOM.$('button.shideh-hub-source-button.shideh-hub-source-button-secondary')) as HTMLButtonElement;
			marketplaceButton.type = 'button';
			marketplaceButton.textContent = localize('shidehHubOpenMarketplace', "Marketplace");
			this._register(DOM.addDisposableListener(marketplaceButton, 'click', () => {
				void this.commandService.executeCommand(AICustomizationManagementCommands.OpenMarketplace, marketplaceSection);
			}));
		}
	}
}
