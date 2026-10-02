import fs from 'node:fs';

const files = {
	helpers: 'src/vs/platform/agentHost/test/node/serverIntegrationTestHelpers.ts',
	promptRegistry: 'src/vs/platform/agentHost/test/node/agentHostPromptRegistry.test.ts',
	sessionServerTools: 'src/vs/platform/agentHost/test/node/sessionServerTools.test.ts',
	stateManager: 'src/vs/platform/agentHost/test/node/agentHostStateManager.test.ts',
	sessionPermissions: 'src/vs/platform/agentHost/test/node/sessionPermissions.test.ts',
	otelIntegration: 'src/vs/platform/agentHost/test/node/otel/agentHostOTelService.integrationTest.ts',
	claudeAgent: 'src/vs/platform/agentHost/test/node/claudeAgent.test.ts',
	sessionOpenTelemetry: 'src/vs/platform/agentHost/test/node/agentHostSessionOpenTelemetry.test.ts',
	providerTestEnvironment: 'src/vs/platform/agentHost/test/node/providerTestEnvironment.ts',
	sdkDownloader: 'src/vs/platform/agentHost/test/node/agentSdkDownloader.test.ts',
	sdkSetupChannel: 'src/vs/platform/agentHost/test/node/agentSdkSetupChannel.test.ts',
	sideEffects: 'src/vs/platform/agentHost/test/node/agentSideEffects.test.ts',
	automationService: 'src/vs/platform/agentHost/test/node/agentHostAutomationService.test.ts',
	catalogResolver: 'src/vs/platform/agentHost/test/node/agentHostCatalogSourceResolver.test.ts',
	protocolServerHandler: 'src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts',
	editSurvival: 'src/vs/platform/agentHost/test/node/shared/editSurvivalReporter.test.ts',
	mcpController: 'src/vs/platform/agentHost/test/node/shared/mcpCustomizationController.test.ts',
	protocolClient: 'src/vs/platform/agentHost/test/electron-browser/agentHostProtocolClient.test.ts',
	protocolReadme: 'src/vs/platform/agentHost/test/node/protocol/README.md',
	shellToolNames: 'src/vs/platform/agentHost/test/node/e2e/harness/shellToolNames.ts',
	shellToolsTest: 'src/vs/platform/agentHost/test/node/capiReplayProxyShellTools.test.ts',
};

const state = {};
for (const [k, p] of Object.entries(files)) {
	const raw = fs.readFileSync(p, 'utf8');
	const crlf = raw.includes('\r\n');
	state[k] = { path: p, crlf, text: raw.replace(/\r\n/g, '\n'), fails: [] };
}

function rep(k, find, repl, expect) {
	const s = state[k];
	const parts = s.text.split(find);
	const count = parts.length - 1;
	if (count !== expect) {
		s.fails.push(`rep expected ${expect} got ${count} for ${JSON.stringify(find.slice(0, 100))}`);
		return;
	}
	s.text = parts.join(repl);
}

function splice(k, ranges) {
	const s = state[k];
	const lines = s.text.split('\n');
	for (const r of ranges) {
		const actual = lines[r.start - 1];
		if (r.startIs !== undefined && actual !== r.startIs) {
			s.fails.push(`line ${r.start} mismatch: got ${JSON.stringify(actual)}`);
		}
		if (r.startWith !== undefined && !(actual || '').startsWith(r.startWith)) {
			s.fails.push(`line ${r.start} prefix mismatch: got ${JSON.stringify(actual)}`);
		}
		for (const [idx, is] of r.alsoAt || []) {
			if (lines[idx - 1] !== is) { s.fails.push(`line ${idx} mismatch: got ${JSON.stringify(lines[idx - 1])}`); }
		}
		if (r.afterWith !== undefined && !(lines[r.end] || '').startsWith(r.afterWith)) {
			s.fails.push(`line ${r.end + 1} (after range) prefix mismatch: got ${JSON.stringify(lines[r.end])}`);
		}
	}
	if (s.fails.length) { return; }
	for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
		lines.splice(r.start - 1, r.end - r.start + 1);
	}
	s.text = lines.join('\n');
}

// ---- helpers ----
splice('helpers', [
	{ start: 51, end: 51,
		startIs: "import { AgentHostCodexAgentBinaryArgsEnvVar, AgentHostCodexAgentCodexHomeEnvVar, AgentHostCodexAgentEnabledEnvVar } from '../../common/agentService.js';" },
	{ start: 1116, end: 1118,
		startWith: '\t\tif (options.codexSdkRoot) {',
		afterWith: '\t\tif (options.userDataDir) {' },
	{ start: 1127, end: 1132,
		startWith: '\t\t\t...(options.codexHomeDir ? { [AgentHostCodexAgentCodexHomeEnvVar]',
		afterWith: '\t\t\t...(realCapture ? {' },
]);
rep('helpers',
	'readonly claudeSdkRoot?: string; readonly codexSdkRoot?: string; readonly codexHomeDir?: string; readonly codexAgentEnabled?: boolean; readonly mockLlm?: boolean',
	'readonly claudeSdkRoot?: string; readonly mockLlm?: boolean', 1);
rep('helpers',
	'(used by the Codex /\n\t\t\t\t// agent-host harnesses for model discovery + requests) at the',
	'(used by the\n\t\t\t\t// agent-host harnesses for model discovery + requests) at the', 1);

// ---- promptRegistry: production instructions no longer name provider tools ----
splice('promptRegistry', [
	{ start: 289, end: 289,
		startWith: '\t\t\t\tnamesProviderTools: AGENT_HOST_WORKSPACELESS_INSTRUCTIONS.includes(',
		afterWith: '\t\t\t\tcombinesWorkspaceAndIsolation: AGENT_HOST_WORKSPACELESS_INSTRUCTIONS' },
	{ start: 298, end: 298,
		startWith: '\t\t\t\tnamesProviderTools: true,',
		afterWith: '\t\t\t\tcombinesWorkspaceAndIsolation: true,' },
]);

// ---- sessionServerTools: generic provider id + URIs ----
rep('sessionServerTools', "'Provider codex cannot enumerate its native session catalog yet'", "'Provider mycli cannot enumerate its native session catalog yet'", 2);
rep('sessionServerTools', "executionContext('codex:/", "executionContext('mycli:/", 2);
rep('sessionServerTools', "URI.parse('codex:/s1')", "URI.parse('mycli:/s1')", 1);
rep('sessionServerTools', "session: 'codex:/s1',", "session: 'mycli:/s1',", 1);
rep('sessionServerTools', "'agent-host-session://codex/s1'", "'agent-host-session://mycli/s1'", 1);

// ---- stateManager: generic settings-extraction fixture ----
rep('stateManager', 'codex.personality', 'mycli.personality', 4);
rep('stateManager', "provider: 'codex',", "provider: 'mycli',", 1);
rep('stateManager', "title: 'Codex',", "title: 'MyCli',", 1);
rep('stateManager', "description: 'Codex settings',", "description: 'MyCli settings',", 1);

// ---- sessionPermissions: production lifecycle list no longer includes .codex ----
splice('sessionPermissions', [
	{ start: 208, end: 209,
		startIs: "\t\t\t\tjoin('.CODEX', 'hooks.json'),",
		alsoAt: [[209, "\t\t\t\tjoin('.codex', 'CONFIG.TOML'),"]],
		afterWith: '\t\t\t];' },
	{ start: 278, end: 280,
		startIs: "\t\t\tjoin('.codex', 'agents', 'dev-helper.md'),",
		alsoAt: [
			[279, "\t\t\tjoin('.codex', 'config.toml'),"],
			[280, "\t\t\tjoin('.codex', 'hooks.json'),"],
		],
		afterWith: '\t\t];' },
]);

// ---- otel integration: codex span filter removed from production ----
rep('otelIntegration',
	"import { AgentHostOTelService, normalizeAgentHostOtlpBody, readAgentHostOTelEnv } from '../../../node/otel/agentHostOTelService.js';",
	"import { AgentHostOTelService, readAgentHostOTelEnv } from '../../../node/otel/agentHostOTelService.js';", 1);
splice('otelIntegration', [
	{ start: 183, end: 224,
		startWith: "\ttest('normalizes resources and narrowly filters Codex 0.142 auth polling spans'",
		afterWith: "\ttest('getSdkTelemetryConfig: returns undefined when fully disabled'" },
]);

// ---- claudeAgent: generic dispatch agent ids ----
rep('claudeAgent', "dispatchDownload(ctx, 'codex');", "dispatchDownload(ctx, 'mycli');", 1);
rep('claudeAgent', "dispatchReload(ctx, 'codex');", "dispatchReload(ctx, 'mycli');", 1);
rep('claudeAgent', "key: { agent: 'codex', request: 'req-1' },", "key: { agent: 'mycli', request: 'req-1' },", 2);

// ---- sessionOpenTelemetry: CODEX_AGENT_PROVIDER_ID removed from agent.ts ----
rep('sessionOpenTelemetry',
	"import { AgentSession, CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID, type IAgent } from '../../common/agent.js';",
	"import { AgentSession, CLAUDE_AGENT_PROVIDER_ID, type IAgent } from '../../common/agent.js';", 1);
rep('sessionOpenTelemetry',
	"const providers = [CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID, 'future'];",
	"const providers = [CLAUDE_AGENT_PROVIDER_ID, 'future'];", 1);
rep('sessionOpenTelemetry',
	"for (const provider of [CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID, 'future']) {",
	"for (const provider of [CLAUDE_AGENT_PROVIDER_ID, 'future']) {", 1);
rep('sessionOpenTelemetry',
	"\n\t\t\t\t{ name: 'agentHost.sessionSubscribe', provider: 'codex', channel: 'session', outcome: 'success', sdkResumeOutcome: undefined, sdkResumeAttemptCount: undefined },",
	'', 1);

// ---- providerTestEnvironment ----
splice('providerTestEnvironment', [
	{ start: 20, end: 20,
		startIs: '\t\tCODEX_HOME: undefined,',
		afterWith: '\t\t...(isWindows && homeDir.match(' },
]);

// ---- sdkDownloader ----
rep('sdkDownloader', "'codex-style: musl host → no suffix (statically musl-linked, single SKU)'", "'single-SKU style: musl host → no suffix (statically musl-linked, single SKU)'", 1);
rep('sdkDownloader', "{ ...ClaudeSdkPackage, id: 'codex' }", "{ ...ClaudeSdkPackage, id: 'mycli' }", 1);

// ---- sdkSetupChannel ----
rep('sdkSetupChannel', "downloads.fire(progress('started', 'codex'));", "downloads.fire(progress('started', 'mycli'));", 1);

// ---- sideEffects: generic provider-owned failure ----
rep('sideEffects', "test('does not duplicate a Codex provider-owned failure when sendMessage resolves', async () => {", "test('does not duplicate a provider-owned failure when sendMessage resolves', async () => {", 1);
rep('sideEffects', "errorType: 'CodexMaterializeFailed', message: 'workspace root rejected'", "errorType: 'MaterializeFailed', message: 'workspace root rejected'", 1);

// ---- automationService ----
rep('automationService', "changes: { session: { provider: 'codex',", "changes: { session: { provider: 'mycli',", 1);

// ---- ThreadInUse relabels (generic blocked-input machinery) ----
rep('catalogResolver', "errorType: 'CodexThreadInUse', message: 'Locked'", "errorType: 'ThreadInUse', message: 'Locked'", 1);
rep('protocolServerHandler', "errorType: 'CodexThreadInUse', message: 'Locked'", "errorType: 'ThreadInUse', message: 'Locked'", 1);

// ---- editSurvival ----
rep('editSurvival', "sessionUri: 'codex:/session-2',", "sessionUri: 'mycli:/session-2',", 1);
rep('editSurvival', "assert.strictEqual(data.provider, 'codex');", "assert.strictEqual(data.provider, 'mycli');", 1);

// ---- mcpController: negative-scheme case ----
rep('mcpController', "MCP_FS_CHANNEL.replace('mcp://copilot/', 'mcp://codex/')", "MCP_FS_CHANNEL.replace('mcp://copilot/', 'mcp://mycli/')", 1);

// ---- protocolClient ----
rep('protocolClient', "URI.parse('codex:/stuck-session')", "URI.parse('mycli:/stuck-session')", 2);

// ---- protocol README ----
rep('protocolReadme', 'a real Claude, Copilot, or Codex process', 'a real Claude or Copilot process', 1);

// ---- shell tool comments ----
rep('shellToolNames',
	" * platform. Only the names that actually vary are mapped: Claude's `Bash` and\n * Codex's `shell` are fixed strings their SDKs use everywhere.",
	" * platform. Only the names that actually vary are mapped: fixed strings\n * like Claude's `Bash` are left alone.", 1);
rep('shellToolsTest',
	"\t\t// Claude's `Bash` and Codex's `shell` are fixed strings their SDKs use\n\t\t// everywhere; rewriting them would hide a genuine provider change.",
	"\t\t// Fixed strings their SDKs use everywhere, like Claude's `Bash`,\n\t\t// would hide a genuine provider change if rewritten.", 1);

// ---- final scans + write ----
const keepAllow = {
	promptRegistry: ['gpt-5-codex', 'gpt-5.3-codex', 'gpt-6-codex', "'CODEX'"],
	helpers: ['gpt-5.3-codex'],
};
let anyFail = false;
for (const [k, s] of Object.entries(state)) {
	if (s.fails.length) {
		anyFail = true;
		console.log(`FAIL ${s.path}`);
		for (const f of s.fails) { console.log(`  - ${f}`); }
		continue;
	}
	let scanText = s.text;
	for (const keep of keepAllow[k] || []) {
		scanText = scanText.split(keep).join('');
	}
	const residual = scanText.match(/codex/gi);
	let fileBad = false;
	if (residual) {
		fileBad = true;
		console.log(`FAIL ${s.path}: ${residual.length} residual codex matches`);
	}
	if (fileBad) { anyFail = true; continue; }
	const out = s.crlf ? s.text.replace(/\n/g, '\r\n') : s.text;
	fs.writeFileSync(s.path, out);
	console.log(`OK ${s.path}`);
}
process.exit(anyFail ? 1 : 0);
