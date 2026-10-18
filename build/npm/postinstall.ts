/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from 'child_process';
import { dirs } from './dirs.ts';
import { root, stateFile, stateContentsFile, computeState, computeContents, isUpToDate } from './installStateHash.ts';
import { ensureElectronTypes } from './electronTypes.ts';
import { ensureCopilotSdkCanvasPatch } from './copilotSdkCanvasPatch.ts';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootNpmrcConfigKeys = getNpmrcConfigKeys(path.join(root, '.npmrc'));

function log(dir: string, message: string) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function run(command: string, args: string[], opts: child_process.SpawnSyncOptions) {
	log(opts.cwd as string || '.', '$ ' + command + ' ' + args.join(' '));

	const result = child_process.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

function spawnAsync(command: string, args: string[], opts: child_process.SpawnOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = child_process.spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
		child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Process exited with code: ${code}\n${output}`));
			} else {
				resolve(output);
			}
		});
	});
}

async function npmInstallAsync(dir: string, opts?: child_process.SpawnOptions): Promise<void> {
	const finalOpts: child_process.SpawnOptions = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: path.join(root, dir),
		shell: true,
	};

	// When invoked via explicit `npm run postinstall`, npm_command is 'run-script'
	// but sub-directory installs always need 'install' (or 'ci' when propagated).
	const npmCommand = process.env['npm_command'];
	const command = (npmCommand && npmCommand !== 'run-script') ? npmCommand : 'install';

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const syncOpts: child_process.SpawnSyncOptions = {
			env: finalOpts.env,
			cwd: root,
			stdio: 'inherit',
			shell: true,
		};
		const userinfo = os.userInfo();
		log(dir, `Installing dependencies inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'vscodehub.azurecr.io/multiarch/qemu-user-static@sha256:fe60359c92e86a43cc87b3d906006245f77bfc0565676b80004cc666e4feb9f0', '--reset', '-p', 'yes'], syncOpts);
		}
		run('sudo', [
			'docker', 'run',
			'-e', 'GITHUB_TOKEN',
			'-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`,
			'-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.gitconfig-distro:/root/.gitconfig`,
			'-v', `${process.env['VSCODE_NPMRC_PATH']}:/root/.npmrc`,
			'-w', path.resolve('/root/vscode', dir),
			process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'],
			'sh', '-c', `\"chown -R root:root ${path.resolve('/root/vscode', dir)} && export PATH="/root/vscode/.build/nodejs-musl/usr/local/bin:$PATH" && npm i -g node-gyp-build && npm ci\"`
		], syncOpts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${path.resolve(root, dir)}`], syncOpts);
	} else {
		log(dir, 'Installing dependencies...');
		const output = await spawnAsync(npm, command.split(' '), finalOpts);
		if (output.trim()) {
			for (const line of output.trim().split('\n')) {
				log(dir, line);
			}
		}
	}
	removeParcelWatcherPrebuild(dir);
	runAllowedScripts(dir);
}

function setNpmrcConfig(dir: string, env: NodeJS.ProcessEnv) {
	const npmrcPath = path.join(root, dir, '.npmrc');
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const [key, value] = trimmedLine.split('=');
			env[`npm_config_${key}`] = value.replace(/^"(.*)"$/, '$1');
		}
	}

	// Use our bundled node-gyp version
	env.npm_config_node_gyp =
		process.platform === 'win32'
			? path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd')
			: path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp');

	// Force node-gyp to use process.config on macOS
	// which defines clang variable as expected. Otherwise we
	// run into compilation errors due to incorrect compiler
	// configuration.
	// NOTE: This means the process.config should contain
	// the correct clang variable. So keep the version check
	// in preinstall sync with this logic.
	// Change was first introduced in https://github.com/nodejs/node/commit/6e0a2bb54c5bbeff0e9e33e1a0c683ed980a8a0f
	if ((dir === 'remote' || dir === 'build') && process.platform === 'darwin') {
		env.npm_config_force_process_config = 'true';
	} else {
		delete env.npm_config_force_process_config;
	}

	if (dir === 'build') {
		// Temporarily lock the target version.
		// Node 24 V8 headers require C++20, but tree-sitter hard-pin "c++17" in their binding.gyp.
		// This is fixed in v0.25.1 however the version is not published to npm, refs
		// https://github.com/tree-sitter/node-tree-sitter/issues/268.
		// env['npm_config_target'] = process.versions.node;
		env.npm_config_arch = process.arch;
	}
}

function removeParcelWatcherPrebuild(dir: string) {
	const parcelModuleFolder = path.join(root, dir, 'node_modules', '@parcel');
	if (!fs.existsSync(parcelModuleFolder)) {
		return;
	}

	const parcelModules = fs.readdirSync(parcelModuleFolder);
	for (const moduleName of parcelModules) {
		if (moduleName.startsWith('watcher-')) {
			const modulePath = path.join(parcelModuleFolder, moduleName);
			fs.rmSync(modulePath, { recursive: true, force: true });
			log(dir, `Removed @parcel/watcher prebuilt module ${modulePath}`);
		}
	}
}

function removeManifestFolders(folder: string, dir: string) {
	if (!fs.existsSync(folder)) {
		return;
	}

	for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		const entryPath = path.join(folder, entry.name);
		if (entry.name === '_manifest') {
			fs.rmSync(entryPath, { recursive: true, force: true });
			log(dir || '.', `Removed _manifest folder ${entryPath}`);
			continue;
		}

		removeManifestFolders(entryPath, dir);
	}
}

function removeMxcManifestFolders(dir: string) {
	for (const folder of [
		path.join(root, dir, 'node_modules', '@github', 'copilot', 'mxc-bin'),
		path.join(root, dir, 'node_modules', '@microsoft', 'mxc-sdk', 'bin')
	]) {
		removeManifestFolders(folder, dir);
	}
}

function removeRootAndRemoteMxcManifestFolders() {
	removeMxcManifestFolders('');
	removeMxcManifestFolders('remote');
	removeMxcManifestFolders('.build/distro/npm');
	removeMxcManifestFolders('.build/distro/npm/remote');
}

function getNpmrcConfigKeys(npmrcPath: string): string[] {
	if (!fs.existsSync(npmrcPath)) {
		return [];
	}
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');
	const keys: string[] = [];
	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const eqIndex = trimmedLine.indexOf('=');
			if (eqIndex > 0) {
				keys.push(trimmedLine.substring(0, eqIndex).trim());
			}
		}
	}
	return keys;
}

function clearInheritedNpmrcConfig(dir: string, env: NodeJS.ProcessEnv): void {
	const dirNpmrcPath = path.join(root, dir, '.npmrc');
	if (fs.existsSync(dirNpmrcPath)) {
		return;
	}

	for (const key of rootNpmrcConfigKeys) {
		const envKey = `npm_config_${key.replace(/-/g, '_')}`;
		delete env[envKey];
	}
}

function ensureAgentHarnessLink(sourceRelativePath: string, linkPath: string): 'existing' | 'junction' | 'symlink' | 'hard link' {
	if (fs.existsSync(linkPath)) {
		return 'existing';
	}

	const sourcePath = path.resolve(path.dirname(linkPath), sourceRelativePath);
	const isDirectory = fs.statSync(sourcePath).isDirectory();

	try {
		if (process.platform === 'win32' && isDirectory) {
			fs.symlinkSync(sourcePath, linkPath, 'junction');
			return 'junction';
		}

		fs.symlinkSync(sourceRelativePath, linkPath, isDirectory ? 'dir' : 'file');
		return 'symlink';
	} catch (error) {
		if (process.platform === 'win32' && !isDirectory && (error as NodeJS.ErrnoException).code === 'EPERM') {
			fs.linkSync(sourcePath, linkPath);
			return 'hard link';
		}

		throw error;
	}
}

async function runWithConcurrency(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
	const errors: Error[] = [];
	let index = 0;

	async function worker() {
		while (index < tasks.length) {
			const i = index++;
			try {
				await tasks[i]();
			} catch (err) {
				errors.push(err as Error);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

	if (errors.length > 0) {
		for (const err of errors) {
			console.error(err.message);
		}
		process.exit(1);
	}
}

function runAllowedScripts(dir: string) {
	const allowScriptsBin = path.join(root, 'build', 'npm-allowscripts', 'target', 'release', 'allow-scripts');
	if (!fs.existsSync(allowScriptsBin)) {
		log(dir || '.', 'allow-scripts binary not found, skipping lifecycle script enforcement.');
		log(dir || '.', 'Build it with: cd build/npm-allowscripts && cargo build --release');
		return;
	}

	const cwd = path.join(root, dir);
	if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
		return;
	}

	log(dir || '.', 'Running allowed lifecycle scripts...');
	const result = child_process.spawnSync(allowScriptsBin, ['exec'], {
		cwd,
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		console.error(`ERR allow-scripts failed for ${dir || '.'}.`);
		process.exit(result.status ?? 1);
	}
}

async function main() {
	await ensureElectronTypes();

	if (!process.env['VSCODE_FORCE_INSTALL'] && isUpToDate()) {
		ensureCopilotSdkCanvasPatch(root);
		log('.', 'All dependencies up to date, skipping postinstall.');
		child_process.execSync('git config pull.rebase merges');
		child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
		return;
	}

	// Run approved lifecycle scripts for root node_modules (since .npmrc has
	// ignore-scripts=true, dependency lifecycle scripts don't run during
	// npm install — we run only the explicitly approved ones here).
	runAllowedScripts('');

	const _state = computeState();

	const nativeTasks: (() => Promise<void>)[] = [];
	const parallelTasks: (() => Promise<void>)[] = [];

	for (const dir of dirs) {
		if (dir === '') {
			removeParcelWatcherPrebuild(dir);
			continue; // already executed in root
		}

		if (dir === 'build') {
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
				if (process.env['CC']) { env.CC = 'gcc'; }
				if (process.env['CXX']) { env.CXX = 'g++'; }
				if (process.env['CXXFLAGS']) { env.CXXFLAGS = ''; }
				if (process.env['LDFLAGS']) { env.LDFLAGS = ''; }
				setNpmrcConfig('build', env);
				return npmInstallAsync('build', { env });
			});
			continue;
		}

		if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
			const remoteDir = dir;
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
				if (process.env['VSCODE_REMOTE_CC']) {
					env.CC = process.env['VSCODE_REMOTE_CC'];
				} else {
					delete env.CC;
				}
				if (process.env['VSCODE_REMOTE_CXX']) {
					env.CXX = process.env['VSCODE_REMOTE_CXX'];
				} else {
					delete env.CXX;
				}
				if (process.env['CXXFLAGS']) { delete env.CXXFLAGS; }
				if (process.env['CFLAGS']) { delete env.CFLAGS; }
				if (process.env['LDFLAGS']) { delete env.LDFLAGS; }
				if (process.env['VSCODE_REMOTE_CXXFLAGS']) { env.CXXFLAGS = process.env['VSCODE_REMOTE_CXXFLAGS']; }
				if (process.env['VSCODE_REMOTE_LDFLAGS']) { env.LDFLAGS = process.env['VSCODE_REMOTE_LDFLAGS']; }
				if (process.env['VSCODE_REMOTE_NODE_GYP']) { env.npm_config_node_gyp = process.env['VSCODE_REMOTE_NODE_GYP']; }
				setNpmrcConfig('remote', env);
				return npmInstallAsync(remoteDir, { env });
			});
			continue;
		}

		const taskDir = dir;
		parallelTasks.push(() => {
			const env = { ...process.env };
			clearInheritedNpmrcConfig(taskDir, env);
			return npmInstallAsync(taskDir, { env });
		});
	}

	// Native dirs (build, remote) run sequentially to avoid node-gyp conflicts
	for (const task of nativeTasks) {
		await task();
	}

	// JS-only dirs run in parallel
	const concurrency = Math.min(os.cpus().length, 8);
	log('.', `Running ${parallelTasks.length} npm installs with concurrency ${concurrency}...`);
	await runWithConcurrency(parallelTasks, concurrency);
	removeRootAndRemoteMxcManifestFolders();

	child_process.execSync('git config pull.rebase merges');
	child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');

	// Symlink .claude/ files to their canonical locations to test Claude agent harness
	const claudeDir = path.join(root, '.claude');
	fs.mkdirSync(claudeDir, { recursive: true });

	const claudeMdLink = path.join(claudeDir, 'CLAUDE.md');
	const claudeMdLinkType = ensureAgentHarnessLink(path.join('..', '.github', 'copilot-instructions.md'), claudeMdLink);
	if (claudeMdLinkType !== 'existing') {
		log('.', `Created ${claudeMdLinkType} .claude/CLAUDE.md -> .github/copilot-instructions.md`);
	}

	const claudeSkillsLink = path.join(claudeDir, 'skills');
	const claudeSkillsLinkType = ensureAgentHarnessLink(path.join('..', '.agents', 'skills'), claudeSkillsLink);
	if (claudeSkillsLinkType !== 'existing') {
		log('.', `Created ${claudeSkillsLinkType} .claude/skills -> .agents/skills`);
	}

	// foundry-local-sdk's libraryPath redirects its shared libraries but not its
	// two N-API addons. Packaged builds provision all native files together, so
	// patch the lazy loader to resolve the addons from libraryPath as well.
	for (const dir of ['', 'remote']) {
		const nativeLoaderFile = path.join(root, dir, 'node_modules', 'foundry-local-sdk', 'dist', 'detail', 'native.js');
		if (!fs.existsSync(nativeLoaderFile)) {
			continue;
		}
		const content = fs.readFileSync(nativeLoaderFile, 'utf8');
		const marker = '// VSCODE_PATCH:foundry-addons-from-library-path';
		if (content.includes(marker)) {
			continue;
		}
		const replacements: readonly [string, string][] = [
			[
				`const addonPath = resolve(prebuildDir, "foundry_local_node.node");\nconst preloadAddonPath = resolve(prebuildDir, "foundry_local_preload.node");`,
				`${marker}\nlet addonPath = resolve(prebuildDir, "foundry_local_node.node");\nlet preloadAddonPath = resolve(prebuildDir, "foundry_local_preload.node");`,
			],
			[
				`if (!existsSync(fullPath)) {\n        throw new Error(\`libraryPath does not contain \${expected}: \${libraryPath}\`);\n    }`,
				`if (!existsSync(fullPath)) {\n        throw new Error(\`libraryPath does not contain \${expected}: \${libraryPath}\`);\n    }\n    const configuredAddonPath = resolve(libraryPath, "foundry_local_node.node");\n    const configuredPreloadAddonPath = resolve(libraryPath, "foundry_local_preload.node");\n    if (!existsSync(configuredAddonPath) || !existsSync(configuredPreloadAddonPath)) {\n        throw new Error(\`libraryPath does not contain both Foundry Local addons: \${libraryPath}\`);\n    }\n    addonPath = configuredAddonPath;\n    preloadAddonPath = configuredPreloadAddonPath;`,
			],
		];
		let patched = content;
		for (const [needle, replacement] of replacements) {
			if (!patched.includes(needle)) {
				throw new Error(`Unexpected foundry-local-sdk native loader shape in ${nativeLoaderFile}`);
			}
			patched = patched.replace(needle, replacement);
		}
		fs.writeFileSync(nativeLoaderFile, patched);
		log(dir || '.', 'Patched foundry-local-sdk native loader (addons from libraryPath)');
	}

	fs.writeFileSync(stateFile, JSON.stringify(_state));
	fs.writeFileSync(stateContentsFile, JSON.stringify(computeContents()));
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
