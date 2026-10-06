/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Extension id for `extensions/shideh-agent` (must match product built-in id). */
export const SHIDEH_AGENT_EXTENSION_ID = 'shideh.shideh-agent';

export function toShidehAgentSecretStorageKey(secretKey: string): string {
	return JSON.stringify({ extensionId: SHIDEH_AGENT_EXTENSION_ID, key: secretKey });
}
