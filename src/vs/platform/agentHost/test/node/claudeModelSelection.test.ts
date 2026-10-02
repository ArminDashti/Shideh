/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CLAUDE_AGENT_PROVIDER_ID, IAgentModelInfo } from '../../common/agent.js';
import { AGENT_MODEL_GROUP_ID_META_KEY } from '../../common/agentModelSource.js';
import { CLAUDE_PROVIDER_ANTHROPIC, CLAUDE_PROVIDER_COPILOT } from '../../common/claudeProviders.js';
import { parseClaudeModelSelection, qualifyClaudeModelCatalog, toClaudeModelSelectionId, toClaudeSdkModelId } from '../../node/claude/claudeModelSelection.js';

suite('claudeModelSelection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('round trips provider and model identifiers, url-encoding separators', () => {
		const id = toClaudeModelSelectionId('custom/provider', 'org/model:latest');
		assert.strictEqual(id, '@provider=custom%2Fprovider:org%2Fmodel%3Alatest');
		assert.deepStrictEqual(parseClaudeModelSelection({ id }), {
			provider: 'custom/provider',
			modelId: 'org/model:latest',
			explicitProvider: true,
		});
	});

	test('a bare (un-prefixed) id decodes to the default Copilot provider, id passed through', () => {
		assert.deepStrictEqual(parseClaudeModelSelection({ id: 'claude-opus-4-8' }), {
			provider: CLAUDE_PROVIDER_COPILOT,
			modelId: 'claude-opus-4-8',
			explicitProvider: false,
		});
	});

	test('a malformed prefix (no separator) falls back to the default Copilot provider', () => {
		assert.deepStrictEqual(parseClaudeModelSelection({ id: '@provider=anthropic' }), {
			provider: CLAUDE_PROVIDER_COPILOT,
			modelId: '@provider=anthropic',
			explicitProvider: false,
		});
	});

	test('the same model under two providers does not collide', () => {
		assert.notStrictEqual(
			toClaudeModelSelectionId(CLAUDE_PROVIDER_COPILOT, 'claude-opus-4-8'),
			toClaudeModelSelectionId(CLAUDE_PROVIDER_ANTHROPIC, 'claude-opus-4-8'),
		);
	});

	suite('qualifyClaudeModelCatalog', () => {

		const model = (id: string, name: string, supportsVision = false): IAgentModelInfo =>
			({ provider: CLAUDE_AGENT_PROVIDER_ID, id, name, supportsVision });

		test('qualifies each id + stamps the Anthropic group token into _meta, preserves provider and every other field', () => {
			// The input carries the harness provider (`claude`); qualification keeps it
			// as the routing owner and instead stamps the group token into `_meta`
			// (`modelGroupId`) so the picker groups the catalog under Anthropic without
			// misrouting `create_session`.
			assert.deepStrictEqual(
				qualifyClaudeModelCatalog([model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', true)]),
				[{ provider: CLAUDE_AGENT_PROVIDER_ID, id: '@provider=anthropic:claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', supportsVision: true, _meta: { [AGENT_MODEL_GROUP_ID_META_KEY]: CLAUDE_PROVIDER_ANTHROPIC } }],
			);
		});

		test('an empty catalog qualifies to an empty catalog', () => {
			assert.deepStrictEqual(qualifyClaudeModelCatalog([]), []);
		});
	});

	suite('toClaudeSdkModelId', () => {

		test('peels off the provider qualification and normalizes to the bare SDK id; a legacy bare id and undefined pass through', () => {
			// A provider-qualified id must be stripped to its bare model id before
			// SDK-normalization, or the unparseable `@provider=…` string reaches the
			// subprocess verbatim and 400s. A bare/legacy id has no
			// wrapper and just normalizes (dotted→dashed); undefined stays undefined.
			assert.deepStrictEqual(
				[
					toClaudeSdkModelId({ id: toClaudeModelSelectionId(CLAUDE_PROVIDER_ANTHROPIC, 'claude-sonnet-4-5-20250929') }),
					toClaudeSdkModelId({ id: toClaudeModelSelectionId(CLAUDE_PROVIDER_COPILOT, 'claude-opus-4.6') }),
					toClaudeSdkModelId({ id: 'claude-opus-4.6' }),
					toClaudeSdkModelId(undefined),
				],
				['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-opus-4-6', undefined],
			);
		});
	});
});
