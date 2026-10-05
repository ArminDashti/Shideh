/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/** Popular agent-memory frameworks Shideh can target with a unified local store. */
export type ShidehMemoryFrameworkId = 'mem0' | 'zep' | 'langmem' | 'cognee' | 'graphiti';

export interface IShidehMemoryFramework {
	readonly id: ShidehMemoryFrameworkId;
	readonly displayName: string;
	readonly description: string;
}

export const SHIDEH_MEMORY_FRAMEWORKS: readonly IShidehMemoryFramework[] = [
	{
		id: 'mem0',
		displayName: 'Mem0',
		description: localize('shideh.memory.mem0', "Mem0-style episodic memory with deduplicated facts."),
	},
	{
		id: 'zep',
		displayName: 'Zep',
		description: localize('shideh.memory.zep', "Zep-style session summaries and long-term user memory."),
	},
	{
		id: 'langmem',
		displayName: 'LangMem',
		description: localize('shideh.memory.langmem', "LangMem-style structured memory blocks for agents."),
	},
	{
		id: 'cognee',
		displayName: 'Cognee',
		description: localize('shideh.memory.cognee', "Cognee-style knowledge-graph memory layers."),
	},
	{
		id: 'graphiti',
		displayName: 'Graphiti',
		description: localize('shideh.memory.graphiti', "Graphiti-style temporal knowledge graphs."),
	},
];

export const DEFAULT_SHIDEH_MEMORY_FRAMEWORK: ShidehMemoryFrameworkId = 'mem0';

export function isShidehMemoryFrameworkId(value: string): value is ShidehMemoryFrameworkId {
	return SHIDEH_MEMORY_FRAMEWORKS.some(framework => framework.id === value);
}
