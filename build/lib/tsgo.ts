/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import es from 'event-stream';
import fancyLog from 'fancy-log';
import { createRequire } from 'module';
import * as path from 'path';
import { createReporter } from './reporter.ts';

const root = path.dirname(path.dirname(import.meta.dirname));
const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * Absolute path to the TypeScript 7 (native) compiler entrypoint. TS7 is
 * installed under the `@typescript/native` alias, a package name that only
 * exists at the repository root and never collides with the `typescript`
 * (<= 6.x) that individual extensions install locally. Resolving it explicitly
 * and invoking it via `node` guarantees we always run TS7, regardless of the
 * node_modules layout of the project being compiled.
 */
const ts7TscPath = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');

export function spawnTsgo(projectPath: string, config: { taskName: string; noEmit?: boolean }, onComplete?: () => Promise<void> | void): Promise<void> {
	function runReporter(output: string) {
		const lines = (output || '').split('\n');
		const errors: ITsgoError[] = [];
		for (const line of lines) {
			const m = errorLineRegex.exec(line);
			if (!m) {
				continue;
			}
			errors.push({
				file: m[1],
				line: Number(m[2]),
				column: Number(m[3]),
				code: m[4],
				message: m[5],
			});
		}
		fancyLog(`Finished ${ansiColors.green(config.taskName)} ${projectPath} with ${errors.length} errors.`);
		for (const line of lines.filter(l => /error \w+:/.test(l))) {
			fancyLog(line);
		}
		config.onResult?.({ errors });
	}

	const args = [ts7TscPath, '--project', projectPath, '--pretty', 'false', '--incremental'];
	if (config.noEmit) {
		// Emitting builds delete their build info before compiling, so concurrent type checks need a separate cache.
		const tsBuildInfoFile = path.join(path.dirname(projectPath), `${path.basename(projectPath, '.json')}.typecheck.tsbuildinfo`);
		args.push('--noEmit', '--tsBuildInfoFile', tsBuildInfoFile);
	} else {
		args.push('--sourceMap', '--inlineSources');
	}
	const child = cp.spawn(process.execPath, args, {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let buffer = '';
	const handleLine = (line: string) => {
		const trimmed = line.replace(ansiRegex, '').trim();
		if (!trimmed) {
			return;
		}
		if (/Starting compilation|File change detected/i.test(trimmed)) {
			beginReport(false);
			return;
		}
		if (/Compilation complete/i.test(trimmed)) {
			endReport();
			return;
		}

		const match = /(.*\(\d+,\d+\): )(.*: )(.*)/.exec(trimmed);

		if (match) {
			const fullpath = path.isAbsolute(match[1]) ? match[1] : path.join(root, match[1]);
			const message = match[3];
			reporter(fullpath + message);
		} else {
			reporter(trimmed);
		}
	};

	const handleData = (data: Buffer) => {
		buffer += data.toString('utf8');
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			handleLine(line);
		}
	};

	child.stdout?.on('data', handleData);
	child.stderr?.on('data', handleData);

	return new Promise<void>((resolve, reject) => {
		child.on('exit', code => {
			if (buffer.trim()) {
				handleLine(buffer);
				buffer = '';
			}
			endReport();
			if (code === 0) {
				Promise.resolve(onComplete?.()).then(() => resolve(), reject);
			} else {
				reject(new Error(`tsgo exited with code ${code ?? 'unknown'}`));
			}
		});

		child.on('error', err => {
			endReport();
			reject(err);
		});
	});
}

export function createTsgoStream(projectPath: string, config: ITsgoConfig, onComplete?: () => Promise<void> | void): NodeJS.ReadWriteStream {
	const stream = es.through();

	spawnTsgo(projectPath, config, onComplete).then(() => {
		stream.emit('end');
	}).catch(() => {
		// Errors are already reported by spawnTsgo via the reporter.
		// Don't emit 'error' on the stream as that would exit the watch process.
		stream.emit('end');
	});

	return stream;
}
