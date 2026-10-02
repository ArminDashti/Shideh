/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { shouldShowGitHubWorkspaceGroupSignIn } from '../../browser/sessionsAuthGate.js';

suite('Sessions - Auth Gate', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('GitHub workspace group offers sign-in only for signed-out opted-in users', () => {
		assert.deepStrictEqual([
			shouldShowGitHubWorkspaceGroupSignIn(false, false),
			shouldShowGitHubWorkspaceGroupSignIn(false, true),
			shouldShowGitHubWorkspaceGroupSignIn(true, false),
			shouldShowGitHubWorkspaceGroupSignIn(true, true),
		], [false, true, false, false]);
	});
});
