/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
import { browser as withBrowserDefaults } from '../shared.webpack.config.mjs';

.chat-disabled-claude-hooks-message {
	display: flex;
	align-items: center;
	gap: 8px;
	font-style: italic;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	opacity: 0.8;
}

.chat-disabled-claude-hooks-icon {
	font-size: var(--vscode-codiconFontSize-compact);
}
