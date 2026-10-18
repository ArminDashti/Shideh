/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import { paths } from '../folders.ts';

/**
 * Complete list of workspace directories.
 *
 * NOTE: With pnpm workspaces, dependency installation is handled by a single
 * `pnpm install` at the repo root (driven by `pnpm-workspace.yaml`). This list
 * is kept for build scripts that need to enumerate workspace directories
 * (e.g., distro mixin, extension enumeration).
 */
export const dirs = [
	'',
	'build',
	'build/rspack',
	'build/vite',
	'extensions',
	'extensions/codamente',
	'extensions/configuration-editing',
	'extensions/css-language-features',
	'extensions/css-language-features/server',
	'extensions/debug-auto-launch',
	'extensions/debug-server-ready',
	'extensions/emmet',
	'extensions/extension-editing',
	'extensions/git',
	'extensions/git-base',
	'extensions/github',
	'extensions/github-authentication',
	'extensions/grunt',
	'extensions/gulp',
	'extensions/hello-version',
	'extensions/html-language-features',
	'extensions/html-language-features/server',
	'extensions/ipynb',
	'extensions/jake',
	'extensions/json-language-features',
	'extensions/json-language-features/server',
	'extensions/laya-decision',
	'extensions/markdown-language-features',
	'extensions/markdown-math',
	'extensions/media-preview',
	'extensions/merge-conflict',
	'extensions/mermaid-markdown-features',
	'extensions/microsoft-authentication',
	'extensions/notebook-renderers',
	'extensions/npm',
	'extensions/php-language-features',
	'extensions/raku',
	'extensions/references-view',
	'extensions/search-result',
	'extensions/simple-browser',
	'extensions/tunnel-forwarding',
	'extensions/terminal-suggest',
	'extensions/typescript-language-features',
	'extensions/vscode-api-tests',
	'extensions/vscode-colorize-tests',
	'extensions/vscode-colorize-perf-tests',
	'extensions/vscode-test-resolver',
	'remote',
	'remote/web',
	'test/automation',
	'test/integration/browser',
	'test/monaco',
	'test/smoke',
	'test/scenario',
	'test/mcp',
	'.vscode/extensions/vscode-selfhost-import-aid',
	'.vscode/extensions/vscode-selfhost-test-provider',
	'.vscode/extensions/vscode-extras',
	'.vscode/extensions/vscode-pr-pinger',
];

if (existsSync(paths.dotBuild.distro.npm.absPath)) {
	dirs.push(paths.dotBuild.distro.npm.rootRelPath);
	dirs.push(paths.dotBuild.distro.npm.remote.rootRelPath);
	dirs.push(paths.dotBuild.distro.npm.remote.web.rootRelPath);
}

/**
 * Directories installed as standalone pnpm projects (NOT part of the root
 * workspace). These build native modules against the Node runtime (rather than
 * the Electron runtime used by the workspace) and therefore each get their own
 * `.npmrc`, `node_modules` and `pnpm-lock.yaml`. Installed by
 * `build/npm/postinstall.ts` after the root workspace install completes.
 */
export const standaloneDirs = [
	'build',
	'remote',
	'remote/web',
];

if (existsSync(`${import.meta.dirname}/../../.build/distro/npm`)) {
	standaloneDirs.push('.build/distro/npm');
	standaloneDirs.push('.build/distro/npm/remote');
	standaloneDirs.push('.build/distro/npm/remote/web');
}
