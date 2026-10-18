/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { create } from 'tar';
import { ensureCopilotPlatformPackage, getCopilotRuntimePrebuildFiles, getMxcExcludeFilter } from '../platformPackages.ts';

suite('copilot', () => {
	test('keeps the SDK runtime package include list scoped to the selected platform', () => {
		const files = getCopilotRuntimePrebuildFiles('linux', 'x64');

		assert.deepStrictEqual(files, [
			'node_modules/@github/copilot-sdk-linux-x64/**',
			'!node_modules/@github/copilot-sdk-linux-x64/builtin/**',
			'!node_modules/@github/copilot-sdk-linux-x64/builtin-skills/**',
			'!node_modules/@github/copilot-sdk-linux-x64/clipboard/**',
			'!node_modules/@github/copilot-sdk-linux-x64/foundry-local-sdk/**',
			'!node_modules/@github/copilot-sdk-linux-x64/mxc-bin/**',
			'!node_modules/@github/copilot-sdk-linux-x64/pvrecorder/**',
			'!node_modules/@github/copilot-sdk-linux-x64/webview/**',
			'!node_modules/@github/copilot-sdk-linux-x64/plugins/computer-use/**',
			'!node_modules/@github/copilot-sdk-linux-x64/prebuilds/*/computer.node',
			'!node_modules/@github/copilot-sdk-linux-x64/prebuilds/*/keytar.node',
			'!node_modules/@github/copilot-sdk-linux-x64/prebuilds/*/mediaremote-adapter/**',
		]);
		assertCopilotPlatformPackageIncludes(files, 'node_modules/@github/copilot-sdk-linux-x64', [
			'prebuilds/linux-x64/runtime.node',
			'prebuilds/linux-x64/copilot-runtime',
			'copilot-sdk/index.js',
			'definitions/task.agent.yaml',
			'ripgrep/bin/linux-x64/rg',
			'tgrep/bin/linux-x64/tgrep',
		]);
		assertOptionalCopilotNativeDependenciesExcluded(files, 'node_modules/@github/copilot-sdk-linux-x64');
	});

	test('uses the linuxmusl package runtime for alpine builds', () => {
		const files = getCopilotRuntimePrebuildFiles('alpine', 'x64');

		assert.deepStrictEqual(files, [
			'node_modules/@github/copilot-sdk-linuxmusl-x64/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/builtin/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/builtin-skills/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/clipboard/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/foundry-local-sdk/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/mxc-bin/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/pvrecorder/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/webview/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/plugins/computer-use/**',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/prebuilds/*/computer.node',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/prebuilds/*/keytar.node',
			'!node_modules/@github/copilot-sdk-linuxmusl-x64/prebuilds/*/mediaremote-adapter/**',
		]);
		assertCopilotPlatformPackageIncludes(files, 'node_modules/@github/copilot-sdk-linuxmusl-x64', [
			'prebuilds/linuxmusl-x64/runtime.node',
			'prebuilds/linuxmusl-x64/copilot-runtime',
			'copilot-sdk/index.js',
		]);
		assertOptionalCopilotNativeDependenciesExcluded(files, 'node_modules/@github/copilot-sdk-linuxmusl-x64');
	});

	test('uses the .exe package runtime for windows builds', () => {
		assert.deepStrictEqual(getCopilotRuntimePrebuildFiles('win32', 'x64'), [
			'node_modules/@github/copilot-sdk-win32-x64/**',
			'!node_modules/@github/copilot-sdk-win32-x64/builtin/**',
			'!node_modules/@github/copilot-sdk-win32-x64/builtin-skills/**',
			'!node_modules/@github/copilot-sdk-win32-x64/clipboard/**',
			'!node_modules/@github/copilot-sdk-win32-x64/foundry-local-sdk/**',
			'!node_modules/@github/copilot-sdk-win32-x64/mxc-bin/**',
			'!node_modules/@github/copilot-sdk-win32-x64/pvrecorder/**',
			'!node_modules/@github/copilot-sdk-win32-x64/webview/**',
			'!node_modules/@github/copilot-sdk-win32-x64/plugins/computer-use/**',
			'!node_modules/@github/copilot-sdk-win32-x64/prebuilds/*/computer.node',
			'!node_modules/@github/copilot-sdk-win32-x64/prebuilds/*/keytar.node',
			'!node_modules/@github/copilot-sdk-win32-x64/prebuilds/*/mediaremote-adapter/**',
		]);
		assertCopilotPlatformPackageIncludes(getCopilotRuntimePrebuildFiles('win32', 'x64'), 'node_modules/@github/copilot-sdk-win32-x64', [
			'prebuilds/win32-x64/runtime.node',
			'prebuilds/win32-x64/copilot-runtime.exe',
			'copilot-sdk/index.js',
		]);
		assertOptionalCopilotNativeDependenciesExcluded(getCopilotRuntimePrebuildFiles('win32', 'x64'), 'node_modules/@github/copilot-sdk-win32-x64');
	});

	test('keeps macOS runtime prebuilds in the selected platform package', () => {
		const files = getCopilotRuntimePrebuildFiles('darwin', 'arm64');

		assertCopilotPlatformPackageIncludes(files, 'node_modules/@github/copilot-sdk-darwin-arm64', [
			'copilot-sdk/index.js',
			'prebuilds/darwin-arm64/runtime.node',
			'prebuilds/darwin-arm64/copilot-runtime',
		]);
		assertOptionalCopilotNativeDependenciesExcluded(files, 'node_modules/@github/copilot-sdk-darwin-arm64');
	});

	for (const { platform, arch, packagePlatformArch } of [
		{ platform: 'darwin', arch: 'arm64', packagePlatformArch: 'darwin-arm64' },
		{ platform: 'darwin', arch: 'x64', packagePlatformArch: 'darwin-x64' },
		{ platform: 'linux', arch: 'arm64', packagePlatformArch: 'linux-arm64' },
		{ platform: 'linux', arch: 'x64', packagePlatformArch: 'linux-x64' },
		{ platform: 'alpine', arch: 'arm64', packagePlatformArch: 'linuxmusl-arm64' },
		{ platform: 'alpine', arch: 'x64', packagePlatformArch: 'linuxmusl-x64' },
		{ platform: 'linux', arch: 'alpine', packagePlatformArch: 'linuxmusl-x64' },
		{ platform: 'win32', arch: 'arm64', packagePlatformArch: 'win32-arm64' },
		{ platform: 'win32', arch: 'x64', packagePlatformArch: 'win32-x64' },
	]) {
		test(`keeps the SDK runtime in desktop and remote packages for ${platform}-${arch}`, () => {
			for (const nodeModulesRoot of ['node_modules', 'remote/node_modules']) {
				const sdkPackageDir = `${nodeModulesRoot}/@github/copilot-sdk-${packagePlatformArch}`;
				const executable = `${sdkPackageDir}/prebuilds/${packagePlatformArch}/${platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime'}`;
				const sdk = `${sdkPackageDir}/copilot-sdk/index.js`;
				assert.deepStrictEqual({
					runtimeExecutable: matchesGlob(executable, getCopilotRuntimePrebuildFiles(platform, arch, nodeModulesRoot)),
					runtimeSdk: matchesGlob(sdk, getCopilotRuntimePrebuildFiles(platform, arch, nodeModulesRoot)),
				}, {
					runtimeExecutable: true,
					runtimeSdk: true,
				}, sdkPackageDir);
			}
		});
	}

	test('materializes missing target platform packages from the lockfile', () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-copilot-platform-test-'));
		const nodeModulesRoot = path.join(repoRoot, 'node_modules');
		try {
			fs.mkdirSync(nodeModulesRoot, { recursive: true });
			fs.writeFileSync(path.join(repoRoot, 'package-lock.json'), JSON.stringify({
				packages: {
					'node_modules/@github/copilot-sdk-darwin-x64': {
						version: '1.0.64-1',
					}
				}
			}));

			ensureCopilotPlatformPackage('darwin', 'x64', nodeModulesRoot, {
				packPackage: (packageName, _version, tempDir) => {
					assert.strictEqual(packageName, '@github/copilot-sdk-darwin-x64');
					const packageRoot = path.join(tempDir, 'package');
					fs.mkdirSync(path.join(packageRoot, 'prebuilds', 'darwin-x64'), { recursive: true });
					fs.mkdirSync(path.join(packageRoot, 'copilot-sdk'), { recursive: true });
					fs.writeFileSync(path.join(packageRoot, 'copilot-sdk', 'index.js'), '');
					fs.writeFileSync(path.join(packageRoot, 'prebuilds', 'darwin-x64', 'copilot-runtime'), '');
					fs.writeFileSync(path.join(packageRoot, 'prebuilds', 'darwin-x64', 'runtime.node'), '');
					const tarball = path.join(tempDir, 'copilot-sdk-darwin-x64.tgz');
					create({ file: tarball, cwd: tempDir, gzip: true, sync: true }, ['package']);
					return tarball;
				}
			});

			assert.deepStrictEqual({
				sdk: fs.existsSync(path.join(nodeModulesRoot, '@github', 'copilot-sdk-darwin-x64', 'copilot-sdk', 'index.js')),
				runtime: fs.existsSync(path.join(nodeModulesRoot, '@github', 'copilot-sdk-darwin-x64', 'prebuilds', 'darwin-x64', 'copilot-runtime')),
				native: fs.existsSync(path.join(nodeModulesRoot, '@github', 'copilot-sdk-darwin-x64', 'prebuilds', 'darwin-x64', 'runtime.node')),
			}, {
				sdk: true,
				runtime: true,
				native: true,
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	test('rejects a target SDK platform package with missing runtime files', () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-copilot-runtime-test-'));
		const nodeModulesRoot = path.join(repoRoot, 'node_modules');
		try {
			fs.mkdirSync(nodeModulesRoot, { recursive: true });
			fs.writeFileSync(path.join(repoRoot, 'package-lock.json'), JSON.stringify({
				packages: {
					'node_modules/@github/copilot-sdk-darwin-x64': {
						version: '1.0.14',
					}
				}
			}));

			assert.throws(() => ensureCopilotPlatformPackage('darwin', 'x64', nodeModulesRoot, {
				packPackage: (_packageName, _version, tempDir) => {
					const packageRoot = path.join(tempDir, 'package');
					fs.mkdirSync(packageRoot, { recursive: true });
					fs.writeFileSync(path.join(packageRoot, 'package.json'), '{}');
					const tarball = path.join(tempDir, 'copilot-sdk-darwin-x64.tgz');
					create({ file: tarball, cwd: tempDir, gzip: true, sync: true }, ['package']);
					return tarball;
				}
			}), /is missing SDK runtime files/);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	test('keeps only the target architecture of @microsoft/mxc-sdk', () => {
		assert.deepStrictEqual(
			getMxcExcludeFilter('x64'),
			[
				'**',
				'!**/node_modules/@microsoft/mxc-sdk/bin/arm64/**',
			]
		);
		assert.deepStrictEqual(
			getMxcExcludeFilter('arm64'),
			[
				'**',
				'!**/node_modules/@microsoft/mxc-sdk/bin/x64/**',
			]
		);
	});

	test('strips every @microsoft/mxc-sdk architecture for unsupported armhf builds', () => {
		assert.deepStrictEqual(
			getMxcExcludeFilter('armhf'),
			[
				'**',
				'!**/node_modules/@microsoft/mxc-sdk/bin/x64/**',
				'!**/node_modules/@microsoft/mxc-sdk/bin/arm64/**',
			]
		);
	});
});

function assertCopilotPlatformPackageIncludes(patterns: string[], packageDir: string, relativeFiles: string[]): void {
	assert(patterns.includes(`${packageDir}/**`));
	for (const relativeFile of relativeFiles) {
		assert(matchesGlob(`${packageDir}/${relativeFile}`, patterns), relativeFile);
	}
}

function assertOptionalCopilotNativeDependenciesExcluded(patterns: string[], packageDir: string): void {
	for (const dir of ['clipboard', 'foundry-local-sdk', 'mxc-bin', 'pvrecorder', 'webview']) {
		assert(patterns.includes(`!${packageDir}/${dir}/**`), dir);
		assert(!matchesGlob(`${packageDir}/${dir}/index.js`, patterns), dir);
	}
	assert(patterns.includes(`!${packageDir}/plugins/computer-use/**`), 'plugins/computer-use');
	assert(!matchesGlob(`${packageDir}/plugins/computer-use/computer-use-mcp.exe`, patterns), 'plugins/computer-use-mcp.exe');
	assert(!matchesGlob(`${packageDir}/plugins/computer-use/CopilotComputerUse.exe`, patterns), 'plugins/CopilotComputerUse.exe');
	assert(!matchesGlob(`${packageDir}/plugins/computer-use/Copilot Computer Use.app/Contents/MacOS/Copilot Computer Use`, patterns), 'plugins/Copilot Computer Use.app');
	assert(patterns.includes(`!${packageDir}/prebuilds/*/computer.node`), 'computer.node');
	assert(!matchesGlob(`${packageDir}/prebuilds/linux-x64/computer.node`, patterns), 'computer.node');
	assert(patterns.includes(`!${packageDir}/prebuilds/*/keytar.node`), 'keytar.node');
	assert(!matchesGlob(`${packageDir}/prebuilds/linux-x64/keytar.node`, patterns), 'keytar.node');
	assert(patterns.includes(`!${packageDir}/prebuilds/*/mediaremote-adapter/**`), 'mediaremote-adapter');
	assert(!matchesGlob(`${packageDir}/prebuilds/darwin-arm64/mediaremote-adapter/MediaRemoteAdapter.framework/MediaRemoteAdapter`, patterns), 'mediaremote-adapter');
}

function matchesGlob(file: string, patterns: string[]): boolean {
	let included = false;
	for (const pattern of patterns) {
		const isExclude = pattern.startsWith('!');
		const glob = isExclude ? pattern.slice(1) : pattern;
		if (matchesPattern(file, glob)) {
			included = !isExclude;
		}
	}
	return included;
}

function matchesPattern(file: string, pattern: string): boolean {
	if (pattern.endsWith('/**') && !pattern.slice(0, -3).includes('*')) {
		return file.startsWith(pattern.slice(0, -2));
	}

	if (pattern.includes('*')) {
		const regex = new RegExp(`^${pattern.split('**').map(part => part.split('*').map(escapeRegExp).join('[^/]+')).join('.*')}$`);
		return regex.test(file);
	}

	return file === pattern;
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

suite('copilot universal packaging', () => {
	// Bundle-relative paths for at least one darwin binary in every location the
	// macOS universal merger has to reconcile. Each must be covered by an arch or
	// skip glob, or `makeUniversalApp` aborts the build. New bump? Add the new
	// binary's location here and to copilotDarwinUniversalArchGlobs together.
	const bundlePrefix = 'Contents/Resources/app';
	const coveredDarwinBinaries = [
		// @github/copilot-{arch} platform package (app node_modules).
		`${bundlePrefix}/node_modules/@github/copilot-darwin-x64/copilot`,
		`${bundlePrefix}/node_modules/@github/copilot-darwin-arm64/prebuilds/darwin-arm64/runtime.node`,
		// Raw @github/copilot prebuilds (app node_modules) — flat + nested payloads.
		`${bundlePrefix}/node_modules/@github/copilot/prebuilds/darwin-arm64/runtime.node`,
		`${bundlePrefix}/node_modules/@github/copilot/prebuilds/darwin-arm64/Copilot Computer Use.app/Contents/MacOS/Copilot Computer Use`,
		// tgrep, both the package root and the sdk subpackage (app node_modules).
		`${bundlePrefix}/node_modules/@github/copilot/tgrep/bin/darwin-x64/tgrep`,
		`${bundlePrefix}/node_modules/@github/copilot/sdk/tgrep/bin/darwin-x64/tgrep`,
		// asar.unpacked mirror of the app node_modules trees.
		`${bundlePrefix}/node_modules.asar.unpacked/@github/copilot/prebuilds/darwin-x64/runtime.node`,
		// Built-in copilot extension SDK (prebuilds, ripgrep shim, tgrep).
		`${bundlePrefix}/extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/darwin-arm64/runtime.node`,
		`${bundlePrefix}/extensions/copilot/node_modules/@github/copilot/sdk/ripgrep/bin/darwin-arm64/rg`,
		`${bundlePrefix}/extensions/copilot/node_modules/@github/copilot/sdk/tgrep/bin/darwin-arm64/tgrep`,
		`${bundlePrefix}/extensions/copilot/node_modules/@github/copilot/tgrep/bin/darwin-arm64/tgrep`,
		// @vscode/ripgrep-universal and @microsoft/mxc-sdk native trees.
		`${bundlePrefix}/node_modules/@vscode/ripgrep-universal/bin/darwin-arm64/rg`,
		`${bundlePrefix}/node_modules/@microsoft/mxc-sdk/bin/arm64/mxc.node`,
	];

	test('every current darwin native binary location is covered by the universal globs', () => {
		const uncovered = findUncoveredCopilotDarwinBinaries(coveredDarwinBinaries);
		assert.deepStrictEqual(uncovered, [], `These darwin binaries are not covered by the macOS universal globs and would break the universal merge:\n${uncovered.join('\n')}`);
	});

	test('a newly added darwin native binary in an unknown location is flagged', () => {
		// Simulates a Copilot CLI SDK bump that introduces a native binary under a
		// path none of the existing globs match — the exact failure that today only
		// surfaces in the macOS pipeline stage.
		const newBinary = `${bundlePrefix}/extensions/copilot/node_modules/@github/copilot/newpayload/darwin-arm64/newbin.node`;
		const uncovered = findUncoveredCopilotDarwinBinaries([...coveredDarwinBinaries, newBinary]);
		assert.deepStrictEqual(uncovered, [newBinary]);
	});

	test('paths are matched regardless of separator style', () => {
		const windowsStyle = coveredDarwinBinaries[0].split('/').join('\\');
		assert.deepStrictEqual(findUncoveredCopilotDarwinBinaries([windowsStyle]), []);
	});

	test('source-tree paths (no app bundle prefix) are also covered', () => {
		const sourceTreePath = 'extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/darwin-arm64/runtime.node';
		assert.deepStrictEqual(findUncoveredCopilotDarwinBinaries([sourceTreePath]), []);
	});

	test('arch and skip glob sets are non-empty and free of duplicates', () => {
		for (const [name, globs] of [['arch', copilotDarwinUniversalArchGlobs], ['skip', copilotDarwinUniversalSkipGlobs]] as const) {
			assert.ok(globs.length > 0, `${name} globs must not be empty`);
			assert.strictEqual(new Set(globs).size, globs.length, `${name} globs contain duplicates`);
			for (const glob of globs) {
				assert.ok(glob.includes('darwin') || glob.includes('mxc-sdk'), `${name} glob '${glob}' does not target a darwin/mxc native tree`);
			}
		}
	});
});

suite('copilot version consistency', () => {
	// The @github/copilot CLI SDK version is pinned independently in three
	// manifests; a bump that updates one and forgets another ships a split-brain
	// build that only surfaces at install/runtime. These checks catch that drift
	// at `cd build && npm test` time. See build/lib/copilot.ts for the packaging
	// machinery these versions feed.
	const repoRoot = path.join(import.meta.dirname, '..', '..', '..');
	const manifests = {
		root: path.join(repoRoot, 'package.json'),
		remote: path.join(repoRoot, 'remote', 'package.json'),
		extension: path.join(repoRoot, 'extensions', 'copilot', 'package.json'),
	};

	function readDep(manifestPath: string, dep: string): string | undefined {
		const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
			const version = pkg[section]?.[dep];
			if (version !== undefined) {
				return version;
			}
		}
		return undefined;
	}

	test('@github/copilot is pinned to the same version in all three manifests', () => {
		const versions = {
			root: readDep(manifests.root, '@github/copilot'),
			remote: readDep(manifests.remote, '@github/copilot'),
			extension: readDep(manifests.extension, '@github/copilot'),
		};
		for (const [name, version] of Object.entries(versions)) {
			assert.ok(version, `@github/copilot is missing from the ${name} manifest (${manifests[name as keyof typeof manifests]})`);
		}
		assert.strictEqual(
			new Set(Object.values(versions)).size,
			1,
			`@github/copilot version drift across manifests: ${JSON.stringify(versions)}. Bump all three together.`,
		);
	});

	test('@github/copilot-sdk matches between the root and remote manifests', () => {
		// The extension manifest intentionally does not depend on @github/copilot-sdk.
		const root = readDep(manifests.root, '@github/copilot-sdk');
		const remote = readDep(manifests.remote, '@github/copilot-sdk');
		assert.ok(root, 'expected @github/copilot-sdk in the root manifest');
		assert.ok(remote, 'expected @github/copilot-sdk in the remote manifest');
		assert.strictEqual(root, remote, `@github/copilot-sdk version drift: root=${root} remote=${remote}. Bump both together.`);
	});
});
