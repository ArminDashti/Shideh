// Batch comment/doc scrub: remove Codex mentions from shared agentHost files.
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'C:/Users/armin/GitHub/Shideh/';
const edits = [
	['src/vs/platform/agentHost/node/shared/workspacelessInstructions.ts',
		'via `request_user_input` (Codex) or `ask_user` (Copilot).',
		'via `ask_user`.'],
	['src/vs/platform/agentHost/node/shared/agentBranchNameGenerator.ts',
		'Shared by every agent-host provider (Copilot, Codex,\n * Claude) via {@link WorktreeIsolation}.',
		'Shared by every agent-host provider (Copilot,\n * Claude) via {@link WorktreeIsolation}.'],
	['src/vs/platform/agentHost/node/shared/agentFeedbackServerTools.ts',
		'(Copilot, Claude, Codex, …) renders them identically instead of',
		'(Copilot, Claude, …) renders them identically instead of'],
	['src/vs/platform/agentHost/node/shared/folderPickerDecision.ts',
		'predicate. Each provider (Copilot hooks, Claude MCP/hooks, Codex hooks)',
		'predicate. Each provider (Copilot hooks, Claude MCP/hooks)'],
	['src/vs/platform/agentHost/node/agentSdkDownloadTelemetry.ts',
		"comment: 'Which agent SDK was being fetched, e.g. claude or codex.'",
		"comment: 'Which agent SDK was being fetched, e.g. claude.'"],
	['src/vs/platform/agentHost/node/sessionPermissions.ts',
		"(Copilot SDK `'on'`, Claude bypass/acceptEdits, or Codex, which never\n\t * routes through the host permission layer) don't reach it, so the read-only presentation is the\n\t * primary defense there.",
		"(Copilot SDK `'on'`, Claude bypass/acceptEdits) don't reach it, so\n\t * the read-only presentation is the primary defense there."],
	['src/vs/platform/agentHost/node/shared/worktreeIsolation.ts',
		'\t * Codex, Claude) now write and read these same keys;',
		'\t * Claude) now write and read these same keys;'],
	['src/vs/platform/agentHost/node/shared/worktreeIsolation.ts',
		'so Codex and Claude get identical behavior:',
		'so Claude gets identical behavior:'],
	['src/vs/platform/agentHost/node/shared/proxyChatError.ts',
		'through the Claude and Codex child-process boundaries. Their model proxies\n * hold the rich {@link CopilotApiError}, while the child processes only see\n * HTTP/SSE error text.',
		'through proxy-backed child-process boundaries. Their model proxies\n * hold the rich {@link CopilotApiError}, while the child processes only see\n * HTTP/SSE error text.'],
	['src/vs/platform/agentHost/node/shared/proxyChatError.ts',
		" * error: { errorType: 'CodexError', ...extractForwardedErrorInfo(message) }",
		" * error: { errorType: 'error_during_execution', ...extractForwardedErrorInfo(message) }"],
	['src/vs/platform/agentHost/node/shared/serverToolGroups.ts',
		'(Copilot,\n * Claude, Codex, …) and — if the group implements',
		'(Copilot,\n * Claude, …) and — if the group implements'],
	['src/vs/platform/agentHost/node/shared/mcpCustomizationController.ts',
		'shape (Copilot, Claude, Codex, …) and feeds them to',
		'shape (Copilot, Claude, …) and feeds them to'],
	['src/vs/platform/agentHost/node/agentSessionRegistry.ts',
		'code silently skipping a provider (e.g. Codex) that only registers later.',
		'code silently skipping a provider that only registers later.'],
	['src/vs/platform/agentHost/node/activeClientState.ts',
		'tool model shared by the agent-host providers (Copilot, Claude, Codex):',
		'tool model shared by the agent-host providers (Copilot, Claude):'],
	['src/vs/platform/agentHost/node/agentModelRefreshScheduler.ts',
		'// tick without re-arming the timer: dynamically registering Codex must\n\t\t// not postpone the next refresh for providers that were already present.',
		'// tick without re-arming the timer: a provider registering late\n\t\t// must not postpone the next refresh for providers that were already present.'],
	['src/vs/platform/agentHost/node/shared/copilotApiService.ts',
		'\t/**\n\t * Pass-through to CAPI\'s OpenAI-shaped Responses endpoint\n\t * (`{capiBaseUrl}/responses`). Used by `CodexProxyService` to forward\n\t * `/v1/responses` requests from the Codex CLI without deserializing\n\t * the body. The caller owns the returned `Response` (its body and any\n\t * streaming) and is responsible for consuming or aborting it.\n\t *\n\t * @throws on non-2xx upstream response.\n\t */\n\tresponses(\n\t\tgithubToken: string,\n\t\tbody: string,\n\t\toptions?: ICopilotApiServiceRequestOptions,\n\t): Promise<Response>;\n\n',
		''],
	['src/vs/platform/agentHost/node/shared/copilotApiService.ts',
		'\tasync responses(\n\t\tgithubToken: string,\n\t\tbody: string,\n\t\toptions?: ICopilotApiServiceRequestOptions,\n\t): Promise<Response> {\n\t\tconst capiClient = await this._getClientForToken(githubToken);\n\t\tconst requestId = generateUuid();\n\n\t\t// Parse the request body to log the model being sent (debug aid; failures\n\t\t// are non-fatal — the body is forwarded byte-for-byte regardless).\n\t\tlet requestModel = \'<unknown>\';\n\t\ttry {\n\t\t\tconst parsed = JSON.parse(body);\n\t\t\trequestModel = parsed.model ?? \'<none>\';\n\t\t} catch { /* ignore parse errors */ }\n\t\tthis._logService.info(`[CopilotApiService] POST responses: requestId=${requestId}, model=${requestModel}`);\n\n\t\tconst response = await capiClient.makeRequest<Response>(\n\t\t\t{\n\t\t\t\tmethod: \'POST\',\n\t\t\t\theaders: {\n\t\t\t\t\t...options?.headers,\n\t\t\t\t\t\'Content-Type\': \'application/json\',\n\t\t\t\t\t\'Authorization\': `Bearer ${githubToken}`,\n\t\t\t\t\t\'X-Request-Id\': requestId,\n\t\t\t\t\t\'OpenAI-Intent\': \'conversation\',\n\t\t\t\t},\n\t\t\t\t// Opt-in per request — see\n\t\t\t\t// `ICopilotApiServiceRequestOptions.suppressIntegrationId`.\n\t\t\t\tsuppressIntegrationId: options?.suppressIntegrationId,\n\t\t\t\tbody,\n\t\t\t\tsignal: options?.signal,\n\t\t\t},\n\t\t\t{ type: RequestType.ChatResponses },\n\t\t);\n\n\t\tthis._logService.info(`[CopilotApiService] responses status=${response.status}, requestId=${requestId}`);\n\n\t\tif (!response.ok) {\n\t\t\tif (response.status === 401 || response.status === 403) {\n\t\t\t\tthis._invalidateClientForToken(githubToken, capiClient);\n\t\t\t}\n\t\t\tconst text = await response.text().catch(() => \'\');\n\t\t\tthrow buildCopilotApiHttpError(response.status, response.statusText, text, \'CAPI responses request failed\');\n\t\t}\n\t\treturn response;\n\t}\n\n',
		''],
	['src/vs/platform/agentHost/node/shared/copilotApiService.ts',
		'// request without it (the `responses()` and `utilityChatCompletion()`\n\t\t\t\t\t// paths already omit it).',
		'// request without it (the `utilityChatCompletion()` path already\n\t\t\t\t\t// omits it).'],
];

const failures = [];
const done = new Set();
for (const [file, find, replace] of edits) {
	let text;
	try {
		text = readFileSync(root + file, 'utf8');
	} catch (e) {
		failures.push(`${file}: READ FAILED: ${e.message}`);
		continue;
	}
	let f = find;
	let r = replace;
	if (text.includes('\r\n')) {
		f = f.replaceAll('\n', '\r\n');
		r = r.replaceAll('\n', '\r\n');
	}
	const count = text.split(f).length - 1;
	if (count !== 1) {
		failures.push(`${file}: matches=${count} for ${JSON.stringify(f.slice(0, 60))}...`);
		continue;
	}
	writeFileSync(root + file, text.replace(f, r), 'utf8');
	done.add(file);
}
console.log(`applied to ${done.size} files`);
if (failures.length) {
	console.log('FAILURES:');
	for (const f of failures) console.log('  ' + f);
	process.exitCode = 1;
}
