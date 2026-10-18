/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dirs } from '../../npm/dirs.ts';
import { paths } from '../../folders.ts';

const ROOT = path.join(import.meta.dirname, '../../../');

const shasum = crypto.createHash('sha256');

shasum.update(fs.readFileSync(paths.build.cachesalt.absPath));
shasum.update(fs.readFileSync(paths.npmrc.absPath));
shasum.update(fs.readFileSync(paths.build.npmrc.absPath));
shasum.update(fs.readFileSync(paths.remote.npmrc.absPath));

// With pnpm workspaces, a single pnpm-lock.yaml replaces all package-lock.json files
shasum.update(fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml')));
shasum.update(fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml')));

// Hash root package.json sections that affect dependency resolution
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')).toString());
shasum.update(JSON.stringify({
	dependencies: rootPackageJson.dependencies,
	devDependencies: rootPackageJson.devDependencies,
	optionalDependencies: rootPackageJson.optionalDependencies,
	pnpm: rootPackageJson.pnpm
}));

// Add any other command line arguments
for (let i = 2; i < process.argv.length; i++) {
	shasum.update(process.argv[i]);
}

process.stdout.write(shasum.digest('hex'));
