/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';

const cursorPluginManifestSuffix = '/.cursor-plugin/plugin.json';

/**
 * Finds plugin roots installed by Cursor under `~/.cursor/plugins` (cache and local).
 */
export async function discoverCursorHarnessPluginRoots(pluginsRoot: URI, fileService: IFileService, maxDepth = 8): Promise<URI[]> {
	const roots: URI[] = [];
	const seen = new Set<string>();
	await walkForCursorPlugins(pluginsRoot, fileService, 0, maxDepth, roots, seen);
	return roots;
}

async function walkForCursorPlugins(
	dir: URI,
	fileService: IFileService,
	depth: number,
	maxDepth: number,
	roots: URI[],
	seen: Set<string>,
): Promise<void> {
	if (depth > maxDepth) {
		return;
	}
	let children;
	try {
		const stat = await fileService.resolve(dir);
		if (!stat.isDirectory) {
			return;
		}
		children = stat.children ?? [];
	} catch {
		return;
	}

	const manifestUri = joinPath(dir, '.cursor-plugin', 'plugin.json');
	try {
		const manifestStat = await fileService.stat(manifestUri);
		if (!manifestStat.isDirectory) {
			const key = dir.toString();
			if (!seen.has(key)) {
				seen.add(key);
				roots.push(dir);
			}
			return;
		}
	} catch {
		// not a plugin root at this level
	}

	for (const child of children) {
		if (!child.isDirectory) {
			continue;
		}
		if (child.name === 'node_modules' || child.name.startsWith('.')) {
			continue;
		}
		await walkForCursorPlugins(child.resource, fileService, depth + 1, maxDepth, roots, seen);
	}
}

export function isCursorPluginManifestPath(path: string): boolean {
	return path.endsWith(cursorPluginManifestSuffix) || path === '.cursor-plugin/plugin.json';
}
