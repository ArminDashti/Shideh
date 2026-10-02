/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CopilotApiError, CopilotApiService, type FetchFunction } from '../../../node/shared/copilotApiService.js';
import { createTestGitHubEndpointService } from '../testGitHubEndpointService.js';
import { NullLogService } from '../../../../log/common/log.js';
import { IProductService } from '../../../../product/common/productService.js';
import product from '../../../../product/common/product.js';

// #region Test Helpers

const testProductService: IProductService = { _serviceBrand: undefined, ...product };

function getUrl(input: string | URL | Request): string {
	if (typeof input === 'string') {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

function hasMapKey(target: object, key: unknown): boolean {
	return Reflect.ownKeys(target).some(property => {
		const value: unknown = Reflect.get(target, property);
		return value instanceof Map && value.has(key);
	});
}

function userResponse(overrides?: Record<string, unknown>): Response {
	return new Response(JSON.stringify({
		endpoints: { api: 'https://api.githubcopilot.com' },
		...overrides,
	}), { status: 200 });
}

function modelsResponse(models: object[]): Response {
	return new Response(JSON.stringify({ data: models }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

type CapturedRequest = { url: string; init: RequestInit | undefined };

function routingFetch(
	apiResponse: (captured: CapturedRequest) => Response,
	userOverrides?: Record<string, unknown>,
): { fetch: FetchFunction; captured: () => CapturedRequest } {
	let lastCapture: CapturedRequest = { url: '', init: undefined };
	const impl: FetchFunction = async (input, init) => {
		const url = getUrl(input);
		if (url.endsWith('/copilot_internal/user')) {
			return userResponse(userOverrides);
		}
		lastCapture = { url, init };
		return apiResponse(lastCapture);
	};
	return { fetch: impl, captured: () => lastCapture };
}

// #endregion

suite('CopilotApiService', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(fetchImpl: FetchFunction, enterpriseUri?: string): CopilotApiService {
		return disposables.add(new CopilotApiService(fetchImpl, new NullLogService(), testProductService, createTestGitHubEndpointService(enterpriseUri)));
	}

	test('derives restricted telemetry context from user discovery without minting a Copilot token', async () => {
		const requests: string[] = [];
		const service = createService(async input => {
			const url = getUrl(input);
			requests.push(new URL(url).pathname);
			if (url.endsWith('/copilot_internal/user')) {
				return new Response(JSON.stringify({
					login: 'octocat',
					copilotignore_enabled: true,
					restricted_telemetry: true,
					analytics_tracking_id: 'tracking-id',
					organization_login_list: ['microsoft', 'Visual-Studio-Code'],
					endpoints: { api: 'https://api.githubcopilot.com', telemetry: 'https://telemetry.example' },
				}), { status: 200 });
			}
			throw new Error(`Unexpected request: ${url}`);
		});

		assert.deepStrictEqual({
			context: await service.resolveRestrictedTelemetryContext('gh-token'),
			requests,
		}, {
			context: {
				restrictedTelemetryEnabled: true,
				trackingId: 'tracking-id',
				telemetryEndpoint: 'https://telemetry.example',
				isInternal: true,
				userName: 'octocat',
				isVscodeTeamMember: true,
				copilotIgnoreEnabled: true,
			},
			requests: ['/copilot_internal/user'],
		});
	});

	test('keeps restricted telemetry disabled when user discovery does not opt in', async () => {
		const service = createService(async input => {
			const url = getUrl(input);
			if (url.endsWith('/copilot_internal/user')) {
				return new Response(JSON.stringify({
					restricted_telemetry: false,
					analytics_tracking_id: 'tracking-id',
					endpoints: { telemetry: 'https://telemetry.example' },
				}), { status: 200 });
			}
			throw new Error(`Unexpected request: ${url}`);
		});

		assert.deepStrictEqual(await service.resolveRestrictedTelemetryContext('gh-token'), {
			restrictedTelemetryEnabled: false,
			trackingId: 'tracking-id',
			telemetryEndpoint: undefined,
			isInternal: false,
			userName: undefined,
			isVscodeTeamMember: false,
			copilotIgnoreEnabled: undefined,
		});
	});

	test('recognizes all internal organization login aliases from user discovery', async () => {
		const contexts = await Promise.all(['github', 'microsoft', 'ms-copilot', 'MicrosoftCopilot'].map(async organization => {
			const service = createService(async input => {
				const url = getUrl(input);
				if (url.endsWith('/copilot_internal/user')) {
					return userResponse({ organization_login_list: [organization] });
				}
				throw new Error(`Unexpected request: ${url}`);
			});
			return service.resolveRestrictedTelemetryContext(`gh-token-${organization}`);
		}));

		assert.deepStrictEqual(contexts.map(context => ({
			isInternal: context.isInternal,
			isVscodeTeamMember: context.isVscodeTeamMember,
		})), [
			{ isInternal: true, isVscodeTeamMember: false },
			{ isInternal: true, isVscodeTeamMember: false },
			{ isInternal: true, isVscodeTeamMember: false },
			{ isInternal: true, isVscodeTeamMember: false },
		]);
	});

	test('recognizes staff without an internal organization', async () => {
		const service = createService(async input => {
			const url = getUrl(input);
			if (url.endsWith('/copilot_internal/user')) {
				return userResponse({ is_staff: true });
			}
			throw new Error(`Unexpected request: ${url}`);
		});

		const context = await service.resolveRestrictedTelemetryContext('gh-token');
		assert.deepStrictEqual({
			isInternal: context.isInternal,
			isVscodeTeamMember: context.isVscodeTeamMember,
		}, {
			isInternal: true,
			isVscodeTeamMember: false,
		});
	});

	// #region Endpoint Discovery

	suite('Endpoint Discovery', () => {

		test('runs endpoint discovery on first request', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 1);
		});

		test('reuses cached endpoint discovery for consecutive calls with same github token', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('gh-tok');
			await service.models('gh-tok');
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 1);
		});

		test('re-discovers endpoints when the github token changes', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('gh-tok-A');
			await service.models('gh-tok-B');
			assert.strictEqual(discoveryCount, 2);
		});

		test('invalidates cached endpoint discovery on 401 from models so the next call re-discovers', async () => {
			let discoveryCount = 0;
			let modelsCallCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				modelsCallCount++;
				if (modelsCallCount === 1) {
					return new Response('unauthorized', { status: 401, statusText: 'Unauthorized' });
				}
				return modelsResponse([]);
			});

			await assert.rejects(() => service.models('gh-tok'));
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 2);
		});

		test('releases a rejected credential key while invalidating its captured SKU reader', async () => {
			const token = 'rejected-gh-token';
			const service = createService(async input => getUrl(input).includes('/copilot_internal')
				? userResponse({ access_type_sku: 'sku-a' })
				: new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }));
			await service.resolveCopilotSku(token);
			const capturedSku = service.captureCopilotSku(token);

			await assert.rejects(() => service.models(token));

			assert.deepStrictEqual({
				capturedSku: capturedSku(),
				retainedAsMapKey: hasMapKey(service, token),
			}, {
				capturedSku: undefined,
				retainedAsMapKey: false,
			});
		});

		test('invalidates cached endpoint discovery on 403 from models so the next call re-discovers', async () => {
			let discoveryCount = 0;
			let modelsCallCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				modelsCallCount++;
				if (modelsCallCount === 1) {
					return new Response('forbidden', { status: 403, statusText: 'Forbidden' });
				}
				return modelsResponse([]);
			});

			await assert.rejects(() => service.models('gh-tok'));
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 2);
		});

		test('does not re-discover when the cache is still warm for the same token', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('gh-tok');
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 1);
		});

		test('uses endpoints.api from the /copilot_internal/user response as the CAPI base', async () => {
			const { fetch: fetchFn, captured } = routingFetch(
				() => modelsResponse([]),
				{ endpoints: { api: 'https://custom.copilot.example.com' } },
			);
			const service = createService(fetchFn);

			await service.models('gh-tok');
			assert.strictEqual(captured().url, 'https://custom.copilot.example.com/models');
		});

		test('reuses endpoint discovery when resolving GitHub login and Copilot SKU', async () => {
			let discoveryCount = 0;
			const service = createService(async input => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal/user')) {
					discoveryCount++;
					return new Response(JSON.stringify({
						login: 'octocat',
						access_type_sku: 'copilot_for_business_seat',
						endpoints: { api: 'https://custom.copilot.example.com' },
					}), { status: 200 });
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const apiEndpoint = await service.resolveApiEndpoint('gh-tok');
			const login = await service.resolveUserLogin('gh-tok');
			const copilotSku = await service.resolveCopilotSku('gh-tok');

			assert.deepStrictEqual({ apiEndpoint, login, copilotSku, discoveryCount }, {
				apiEndpoint: 'https://custom.copilot.example.com',
				login: 'octocat',
				copilotSku: 'copilot_for_business_seat',
				discoveryCount: 1,
			});
		});

		test('falls back to default API base when endpoints.api is missing', async () => {
			const { fetch: fetchFn, captured } = routingFetch(
				() => modelsResponse([]),
			);
			const service = createService(fetchFn);

			await service.models('gh-tok');
			assert.strictEqual(captured().url, 'https://api.githubcopilot.com/models');
		});

		test('sends the github token as a Bearer Authorization header to the discovery endpoint', async () => {
			let capturedAuthHeader: string | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					const headers = init?.headers as Record<string, string>;
					capturedAuthHeader = headers?.['Authorization'];
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('my-secret-gh-token');
			assert.strictEqual(capturedAuthHeader, 'Bearer my-secret-gh-token');
		});

		test('routes endpoint discovery to the GitHub Enterprise host when configured', async () => {
			let discoveryUrl: string | undefined;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryUrl = url;
					return userResponse();
				}
				return modelsResponse([]);
			}, 'https://acme.ghe.com');

			await service.models('gh-tok');
			assert.strictEqual(discoveryUrl, 'https://api.acme.ghe.com/copilot_internal/user');
		});

		test('preserves authentication errors from endpoint discovery', async () => {
			const service = createService(async () => new Response('{"message":"Bad credentials"}', { status: 401, statusText: 'Unauthorized' }));
			await assert.rejects(
				() => service.models('bad-tok'),
				(err: Error) => {
					assert.deepStrictEqual({
						isCopilotApiError: err instanceof CopilotApiError,
						status: err instanceof CopilotApiError ? err.status : undefined,
						message: err.message,
						envelope: err instanceof CopilotApiError ? err.envelope : undefined,
					}, {
						isCopilotApiError: true,
						status: 401,
						message: 'Copilot endpoint discovery failed: 401 Unauthorized — {"message":"Bad credentials"}',
						envelope: {
							type: 'error',
							error: {
								type: 'api_error',
								message: '{"message":"Bad credentials"}',
							},
							request_id: null,
						},
					});
					return true;
				},
			);
		});

		test('throws on 500 from endpoint discovery', async () => {
			const service = createService(async () => new Response('internal error', { status: 500, statusText: 'Internal Server Error' }));
			await assert.rejects(
				() => service.models('gh-tok'),
				(err: Error) => err.message.includes('Copilot endpoint discovery failed: 500'),
			);
		});

		test('does not double-discover when concurrent requests race on first call', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					await new Promise(r => setTimeout(r, 10)); // ensure overlap
					return userResponse();
				}
				return modelsResponse([]);
			});

			await Promise.all([
				service.models('gh-tok'),
				service.models('gh-tok'),
			]);
			assert.strictEqual(discoveryCount, 1);
		});

		test('in-flight discovery dedup spans concurrent models + utility calls', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					await new Promise(r => setTimeout(r, 10));
					return userResponse();
				}
				if (url.includes('/models')) {
					return modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }]);
				}
				return new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 });
			});

			await Promise.all([
				service.models('gh-tok'),
				service.utilityChatCompletion('gh-tok', { messages: [{ role: 'user', content: 'Generate a title' }] }),
			]);
			assert.strictEqual(discoveryCount, 1);
		});

		test('error from endpoint discovery does not include the github token', async () => {
			const service = createService(async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' }));
			await assert.rejects(
				() => service.models('super-secret-gh-token-xyz'),
				(err: Error) => !err.message.includes('super-secret-gh-token-xyz'),
			);
		});

		test('error from CAPI does not include the github token', async () => {
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				return new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
			});
			await assert.rejects(
				() => service.models('super-secret-gh-token-xyz'),
				(err: Error) => !err.message.includes('super-secret-gh-token-xyz'),
			);
		});

		test('discovers independently for concurrent requests with different github tokens', async () => {
			const authorizationHeaders: string[] = [];
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					const auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
					authorizationHeaders.push(auth);
					await new Promise(r => setTimeout(r, 10)); // ensure overlap
					return userResponse();
				}
				return modelsResponse([]);
			});

			await Promise.all([
				service.models('gh-tok-A'),
				service.models('gh-tok-B'),
			]);
			assert.strictEqual(authorizationHeaders.length, 2);
			assert.ok(authorizationHeaders.some(header => header.includes('gh-tok-A')));
			assert.ok(authorizationHeaders.some(header => header.includes('gh-tok-B')));
		});

		suite('CAPI URL override (VSCODE_AGENT_HOST_CAPI_URL_OVERRIDE)', () => {
			const ENV = 'VSCODE_AGENT_HOST_CAPI_URL_OVERRIDE';
			const SMOKE_TEST_ENV = 'VSCODE_SMOKE_TEST_PROXY_HEADER';
			let saved: string | undefined;
			let savedSmokeTestEnv: string | undefined;

			setup(() => {
				saved = process.env[ENV];
				savedSmokeTestEnv = process.env[SMOKE_TEST_ENV];
				delete process.env[SMOKE_TEST_ENV];
			});
			teardown(() => {
				if (saved === undefined) {
					delete process.env[ENV];
				} else {
					process.env[ENV] = saved;
				}
				if (savedSmokeTestEnv === undefined) {
					delete process.env[SMOKE_TEST_ENV];
				} else {
					process.env[SMOKE_TEST_ENV] = savedSmokeTestEnv;
				}
			});

			test('a loopback override skips discovery and routes CAPI at the override', async () => {
				process.env[ENV] = 'http://127.0.0.1:12345';
				let discoveryHit = false;
				const service = createService(async (input) => {
					const url = getUrl(input);
					if (url.includes('/copilot_internal')) {
						discoveryHit = true;
						return userResponse();
					}
					return modelsResponse([]);
				});

				await service.models('gh-secret');

				assert.strictEqual(discoveryHit, false, 'discovery must be skipped for a loopback override');
			});

			test('the reserved smoke-test host skips discovery only with the proxy marker', async () => {
				process.env[ENV] = 'http://vscode-smoke.test:12345';
				process.env[SMOKE_TEST_ENV] = 'test-marker';
				let discoveryHit = false;
				const service = createService(async (input) => {
					const url = getUrl(input);
					if (url.includes('/copilot_internal')) {
						discoveryHit = true;
						return userResponse();
					}
					return modelsResponse([]);
				});

				await service.models('gh-secret');

				assert.strictEqual(discoveryHit, false, 'the smoke-test override must skip endpoint discovery');
			});

			test('a non-loopback override is ignored and normal discovery runs (no token leak)', async () => {
				process.env[ENV] = 'https://evil.example.com';
				process.env[SMOKE_TEST_ENV] = 'test-marker';
				let discoveryHit = false;
				const service = createService(async (input) => {
					const url = getUrl(input);
					if (url.includes('/copilot_internal')) {
						discoveryHit = true;
						return userResponse();
					}
					return modelsResponse([]);
				});

				await service.models('gh-secret');

				assert.strictEqual(discoveryHit, true, 'a non-loopback override must be ignored so the token is never sent to it');
			});
		});
	});

	// #endregion

	// #region Request Format

	suite('Request Format', () => {

		test('sends utility maxTokens as max_tokens in the body', async () => {
			let capturedBody: string | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				if (url.endsWith('/models')) {
					return modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }]);
				}
				capturedBody = init?.body as string;
				return new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 });
			});

			await service.utilityChatCompletion('gh-tok', {
				messages: [{ role: 'user', content: 'Generate a title' }],
				maxTokens: 32,
			});

			assert.strictEqual(JSON.parse(capturedBody ?? '{}').max_tokens, 32);
		});

		test('uses the GitHub OAuth token directly for utility completions', async () => {
			const requests: Array<{ url: string; authorization: string | undefined }> = [];
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				requests.push({ url, authorization: (init?.headers as Record<string, string> | undefined)?.['Authorization'] });
				if (url.endsWith('/models')) {
					return modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }]);
				}
				return new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 });
			});

			await service.utilityChatCompletion('gh-oauth-token', {
				messages: [{ role: 'user', content: 'Generate a title' }],
			});

			assert.deepStrictEqual(requests.map(request => ({
				path: new URL(request.url).pathname,
				authorization: request.authorization,
			})), [
				{ path: '/copilot_internal/user', authorization: 'Bearer gh-oauth-token' },
				{ path: '/models', authorization: 'Bearer gh-oauth-token' },
				{ path: '/chat/completions', authorization: 'Bearer gh-oauth-token' },
			]);
		});

		test('utility auth failure rediscovers endpoints and utility model', async () => {
			let userCount = 0;
			let modelsCount = 0;
			let completionCount = 0;
			const service = createService(async input => {
				const url = getUrl(input);
				if (url.endsWith('/copilot_internal/user')) {
					userCount++;
					return userResponse();
				}
				if (url.endsWith('/models')) {
					modelsCount++;
					return modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }]);
				}
				completionCount++;
				return completionCount === 1
					? new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
					: new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 });
			});
			const request = { messages: [{ role: 'user' as const, content: 'Generate a title' }] };

			await assert.rejects(() => service.utilityChatCompletion('gh-oauth-token', request));
			await service.utilityChatCompletion('gh-oauth-token', request);

			assert.deepStrictEqual({ userCount, modelsCount, completionCount }, {
				userCount: 2,
				modelsCount: 2,
				completionCount: 2,
			});
		});

		test('sends correct CAPI headers', async () => {
			const { fetch: fetchFn, captured } = routingFetch(
				() => modelsResponse([]),
			);
			const service = createService(fetchFn);

			await service.models('gh-tok');
			const headers = captured().init?.headers as Record<string, string>;

			assert.strictEqual(headers['Authorization'], 'Bearer gh-tok');
			assert.ok(headers['X-GitHub-Api-Version'], 'CAPIClient should inject API version');
			assert.ok(headers['VScode-SessionId'], 'CAPIClient should inject session id');
		});

		test('merges caller-provided headers into the request', async () => {
			const { fetch: fetchFn, captured } = routingFetch(
				() => modelsResponse([]),
			);
			const service = createService(fetchFn);

			await service.models('gh-tok', {
				headers: { 'X-Custom-Trace': 'abc-123', 'X-Session-Id': 'sess-456' },
			});
			const headers = captured().init?.headers as Record<string, string>;

			assert.strictEqual(headers['X-Custom-Trace'], 'abc-123');
			assert.strictEqual(headers['X-Session-Id'], 'sess-456');
			assert.strictEqual(headers['Authorization'], 'Bearer gh-tok', 'standard headers should not be overridden');
		});

		test('caller-supplied headers cannot override security-sensitive standard headers', async () => {
			// Documented invariant: Authorization, Content-Type, X-Request-Id, OpenAI-Intent
			// must always reflect the values the service computes — never the caller's.
			const { fetch: fetchFn, captured } = routingFetch(
				({ url }) => url.endsWith('/models')
					? modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }])
					: new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 }),
			);
			const service = createService(fetchFn);

			await service.utilityChatCompletion('gh-tok', {
				messages: [{ role: 'user', content: 'Say hi' }],
			}, {
				headers: {
					'Authorization': 'Bearer attacker-token',
					'Content-Type': 'text/plain',
					'X-Request-Id': 'attacker-id',
					'OpenAI-Intent': 'attacker-intent',
				},
			});
			const headers = captured().init?.headers as Record<string, string>;

			assert.strictEqual(headers['Authorization'], 'Bearer gh-tok');
			assert.strictEqual(headers['Content-Type'], 'application/json');
			assert.notStrictEqual(headers['X-Request-Id'], 'attacker-id');
			assert.strictEqual(headers['OpenAI-Intent'], 'conversation-background');
		});

	});

	// #endregion

	// #region Non-2xx Responses

	suite('Non-2xx Responses', () => {

		test('throws on 429 rate limit', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('{"error":"rate_limited"}', { status: 429, statusText: 'Too Many Requests' }),
			);
			const service = createService(fetchFn);

			await assert.rejects(
				() => service.models('gh-tok'),
				(err: unknown) => err instanceof CopilotApiError
					&& err.status === 429
					&& err.message.includes('CAPI models request failed: 429'),
			);
		});

		test('throws on 500 server error', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('internal server error', { status: 500, statusText: 'Internal Server Error' }),
			);
			const service = createService(fetchFn);

			await assert.rejects(
				() => service.models('gh-tok'),
				(err: unknown) => err instanceof CopilotApiError
					&& err.status === 500
					&& err.message.includes('CAPI models request failed: 500'),
			);
		});
	});

	// #endregion

	// #region countTokens

	suite('countTokens', () => {

		test('throws "countTokens not supported by CAPI"', async () => {
			const service = createService(async () => new Response('{}', { status: 200 }));
			await assert.rejects(
				() => service.countTokens('gh-tok', { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
				(err: Error) => err.message.includes('countTokens not supported by CAPI'),
			);
		});

		test('does not discover endpoints before throwing', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				return new Response('{}', { status: 200 });
			});

			await assert.rejects(
				() => service.countTokens('gh-tok', { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
			);
			assert.strictEqual(discoveryCount, 0);
		});
	});

	// #endregion

	// #region CopilotApiError contract

	suite('CopilotApiError contract', () => {

		async function captureCopilotApiError(promise: Promise<unknown>): Promise<CopilotApiError> {
			try {
				await promise;
			} catch (err) {
				assert.ok(err instanceof CopilotApiError, `expected CopilotApiError, got: ${err instanceof Error ? err.message : String(err)}`);
				return err;
			}
			assert.fail('expected to throw CopilotApiError');
		}

		test('non-2xx with conforming Anthropic envelope: passthrough verbatim', async () => {
			const upstreamEnvelope: Anthropic.ErrorResponse = {
				type: 'error',
				error: { type: 'rate_limit_error', message: 'You are sending requests too fast.' },
				request_id: 'req_abc',
			};
			const { fetch: fetchFn } = routingFetch(
				() => new Response(JSON.stringify(upstreamEnvelope), { status: 429, statusText: 'Too Many Requests' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{ status: 429, envelope: upstreamEnvelope },
			);
		});

		test('non-2xx with non-Anthropic JSON body: synthesizes api_error envelope', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('{"error":"rate_limited"}', { status: 429, statusText: 'Too Many Requests' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{
					status: 429,
					envelope: {
						type: 'error',
						error: { type: 'api_error', message: '{"error":"rate_limited"}' },
						request_id: null,
					},
				},
			);
		});

		test('non-2xx with plain-text body: synthesizes api_error envelope using body', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('internal server error', { status: 500, statusText: 'Internal Server Error' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{
					status: 500,
					envelope: {
						type: 'error',
						error: { type: 'api_error', message: 'internal server error' },
						request_id: null,
					},
				},
			);
		});

		test('non-2xx with empty body: synthesizes api_error envelope using status text', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('', { status: 502, statusText: 'Bad Gateway' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{
					status: 502,
					envelope: {
						type: 'error',
						error: { type: 'api_error', message: '502 Bad Gateway' },
						request_id: null,
					},
				},
			);
		});

		test('models() non-2xx throws typed error with synthesized envelope', async () => {
			const { fetch: fetchFn } = routingFetch(
				() => new Response('upstream down', { status: 503, statusText: 'Service Unavailable' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{
					status: 503,
					envelope: {
						type: 'error',
						error: { type: 'api_error', message: 'upstream down' },
						request_id: null,
					},
				},
			);
			assert.ok(err.message.includes('CAPI models request failed: 503'));
		});

		test('models() non-2xx with conforming Anthropic envelope: passthrough verbatim', async () => {
			const upstreamEnvelope: Anthropic.ErrorResponse = {
				type: 'error',
				error: { type: 'authentication_error', message: 'Invalid token.' },
				request_id: 'req_def',
			};
			const { fetch: fetchFn } = routingFetch(
				() => new Response(JSON.stringify(upstreamEnvelope), { status: 401, statusText: 'Unauthorized' }),
			);
			const service = createService(fetchFn);

			const err = await captureCopilotApiError(service.models('gh-tok'));
			assert.deepStrictEqual(
				{ status: err.status, envelope: err.envelope },
				{ status: 401, envelope: upstreamEnvelope },
			);
		});

		test('error message never embeds auth tokens', async () => {
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				return new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
			});

			const err = await captureCopilotApiError(service.models('super-secret-gh-token-xyz'));
			const serialized = JSON.stringify({ message: err.message, envelope: err.envelope });
			assert.strictEqual(serialized.includes('super-secret-gh-token-xyz'), false);
		});

		test('401 still invalidates cached endpoint discovery', async () => {
			let discoveryCount = 0;
			let next401 = true;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				if (next401) {
					next401 = false;
					return new Response('unauthorized', { status: 401, statusText: 'Unauthorized' });
				}
				return modelsResponse([]);
			});

			await captureCopilotApiError(service.models('gh-tok'));
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 2);
		});
	});

	// #endregion

	// #region Cancellation

	suite('Cancellation', () => {

		test('forwards AbortSignal to fetch for models', async () => {
			const controller = new AbortController();
			let capturedSignal: AbortSignal | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				capturedSignal = init?.signal as AbortSignal;
				return modelsResponse([]);
			});

			await service.models('gh-tok', { signal: controller.signal });
			assert.strictEqual(capturedSignal, controller.signal);
		});

		test('does not forward AbortSignal to shared endpoint discovery', async () => {
			const controller = new AbortController();
			let discoverySignal: AbortSignal | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoverySignal = init?.signal as AbortSignal;
					return userResponse();
				}
				return modelsResponse([]);
			});

			await service.models('gh-tok', { signal: controller.signal });
			assert.strictEqual(discoverySignal, undefined);
		});

	});

	// #endregion

	// #region Models

	suite('Models', () => {

		test('returns models from the data array', async () => {
			const fakeModels = [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'anthropic', supported_endpoints: ['chat/messages'] },
				{ id: 'claude-opus-4', name: 'Claude Opus 4', vendor: 'anthropic', supported_endpoints: ['chat/messages'] },
			];
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				return modelsResponse(fakeModels);
			});

			const result = await service.models('gh-tok');
			assert.deepStrictEqual(result, fakeModels);
		});

		test('returns empty array when data is missing', async () => {
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				return new Response(JSON.stringify({}), { status: 200 });
			});

			const result = await service.models('gh-tok');
			assert.deepStrictEqual(result, []);
		});

		test('sends Bearer token in Authorization header', async () => {
			let capturedAuthHeader: string | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				capturedAuthHeader = (init?.headers as Record<string, string>)?.['Authorization'];
				return modelsResponse([]);
			});

			await service.models('gh-tok');
			assert.strictEqual(capturedAuthHeader, 'Bearer gh-tok');
		});

		test('throws on non-200 response', async () => {
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				return new Response('forbidden', { status: 403, statusText: 'Forbidden' });
			});

			await assert.rejects(
				() => service.models('gh-tok'),
				(err: unknown) => err instanceof CopilotApiError
					&& err.status === 403
					&& err.message.includes('CAPI models request failed: 403'),
			);
		});

		test('reuses cached endpoint discovery across utility and models calls', async () => {
			let discoveryCount = 0;
			const service = createService(async (input) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					discoveryCount++;
					return userResponse();
				}
				if (url.includes('/models')) {
					return modelsResponse([{ id: 'gpt-4o-mini-model', capabilities: { family: 'gpt-4o-mini' } }]);
				}
				return new Response(JSON.stringify({ choices: [{ message: { content: 'Generated title' } }] }), { status: 200 });
			});

			await service.utilityChatCompletion('gh-tok', { messages: [{ role: 'user', content: 'Generate a title' }] });
			await service.models('gh-tok');
			assert.strictEqual(discoveryCount, 1);
		});

		test('routes to the models endpoint URL', async () => {
			const { fetch: fetchFn, captured } = routingFetch(() => modelsResponse([]));
			const service = createService(fetchFn);

			await service.models('gh-tok');
			assert.ok(captured().url.includes('/models'), `expected models URL, got: ${captured().url}`);
		});

		test('caller-supplied headers cannot override Authorization in models()', async () => {
			let capturedHeaders: Record<string, string> | undefined;
			const service = createService(async (input, init) => {
				const url = getUrl(input);
				if (url.includes('/copilot_internal')) {
					return userResponse();
				}
				capturedHeaders = init?.headers as Record<string, string>;
				return modelsResponse([]);
			});

			await service.models('gh-tok', {
				headers: { 'Authorization': 'Bearer attacker-token' },
			});
			assert.strictEqual(capturedHeaders?.['Authorization'], 'Bearer gh-tok');
		});

		test('suppressIntegrationId opt-in controls the Copilot-Integration-Id header', async () => {
			const { fetch: fetchFn, captured } = routingFetch(() => modelsResponse([]));
			const service = createService(fetchFn);

			// Default (no opt-in): @vscode/copilot-api derives and sends the header.
			await service.models('gh-tok');
			const withHeader = captured().init?.headers as Record<string, string>;

			// Opt-in: the header is omitted entirely so CAPI authorizes against
			// the token's real entitlement instead of the derived integration id.
			await service.models('gh-tok', { suppressIntegrationId: true });
			const suppressed = captured().init?.headers as Record<string, string>;

			assert.ok(withHeader['Copilot-Integration-Id'], 'integration id should be present by default');
			assert.strictEqual(suppressed['Copilot-Integration-Id'], undefined, 'integration id should be suppressed when opted in');
		});
	});

	// #endregion
});
