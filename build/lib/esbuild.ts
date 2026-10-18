/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'path';
import type { DirString } from '../folders.ts';

const root = path.resolve(import.meta.dirname, '../..');

export type BuildTarget = 'desktop' | 'server' | 'server-web' | 'web';

export function getBootstrapEntryPointsForTarget(target: BuildTarget): string[] {
	switch (target) {
		case 'desktop':
			return ['main', 'mainImpl', 'cli', 'bootstrap-fork'];
		case 'server':
		case 'server-web':
			return ['server-main', 'server-cli', 'bootstrap-fork'];
		case 'web':
			return [];
		default:
			throw new Error(`Unknown target: ${target}`);
	}
}

export function runEsbuildTranspile(outDir: string, excludeTests: boolean): Promise<void> {
	const args = ['transpile', '--out', outDir];
	if (excludeTests) {
		args.push('--exclude-tests');
	}
	return runEsbuild(args);
}

export function runEsbuildNLS(outDir: string): Promise<void> {
	return runEsbuild(['nls', '--out', outDir]);
}

export function runEsbuildBundle(outDir: string, minify: boolean, nls: boolean, target: 'desktop' | 'server' | 'server-web' | 'web' = 'desktop', sourceMapBaseUrl?: string, nlsCatalog?: string): Promise<void> {
	const args = ['bundle', '--out', outDir, '--target', target];
	if (minify) {
		args.push('--minify');
		args.push('--mangle-privates');
	}
	if (nls) {
		args.push('--nls');
	}
	if (nlsCatalog) {
		args.push('--nls-catalog', nlsCatalog);
	}
	if (sourceMapBaseUrl) {
		args.push('--source-map-base-url', sourceMapBaseUrl);
	}
	return runEsbuild(args);
}

function runEsbuild(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = cp.spawn(process.execPath, [path.join(root, 'build/next/index.ts'), ...args], {
			cwd: root,
			stdio: 'inherit'
		});

		proc.on('error', reject);
		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`esbuild transpile failed with exit code ${code} (outDir: ${outDir.path})`));
			}
		});
	});
}

export function runEsbuildBundle(outDir: string, minify: boolean, nls: boolean, target: BuildTarget = 'desktop', sourceMapBaseUrl?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const scriptPath = path.join(root, 'build/next/index.ts');
		const args = [scriptPath, 'bundle', '--out', outDir.path, '--target', target];
		if (minify) {
			args.push('--minify');
			args.push('--mangle-privates');
		}
		if (nls) {
			args.push('--nls');
		}
		if (sourceMapBaseUrl) {
			args.push('--source-map-base-url', sourceMapBaseUrl);
		}

		const proc = cp.spawn(process.execPath, args, {
			cwd: root,
			stdio: 'inherit'
		});

		proc.on('error', reject);
		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`esbuild bundle failed with exit code ${code} (outDir: ${outDir.path}, minify: ${minify}, nls: ${nls}, target: ${target})`));
			}
		});
	});
}
