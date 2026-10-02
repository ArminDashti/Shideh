import fs from 'node:fs';

const files = {
	a: 'src/vs/platform/agentHost/test/common/agentService.test.ts',
	b: 'src/vs/platform/agentHost/test/common/agentHostSessionType.test.ts',
	c: 'src/vs/platform/agentHost/test/common/agentSdkSetup.test.ts',
	d: 'src/vs/platform/agentHost/test/browser/agentHostSandboxToggle.test.ts',
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
		s.fails.push(`expected ${expect} got ${count} for ${JSON.stringify(find.slice(0, 90))}`);
		return;
	}
	s.text = parts.join(repl);
}

// ---------- a: common/agentService.test.ts ----------
// 1. Region splice: tests at lines 79-131 (3-arg shouldSurfaceLocalAgentHostProvider calls, codex rows)
{
	const s = state.a;
	const lines = s.text.split('\n');
	if (lines[78] !== "\ttest('surfaces enabled providers and uses window-specific Codex settings', () => {") {
		s.fails.push(`region start mismatch: ${JSON.stringify(lines[78])}`);
	}
	if (lines[130] !== '\t});') { s.fails.push(`region end mismatch: ${JSON.stringify(lines[130])}`); }
	if (lines[131] !== '});') { s.fails.push(`suite close mismatch: ${JSON.stringify(lines[131])}`); }
	if (s.fails.length === 0) {
		const newRegion = [
			"\ttest('surfaces enabled providers using their enable settings', () => {",
			'\t\tconst configurationService = new TestConfigurationService({',
			'\t\t\t[AgentHostClaudeAgentEnabledSettingId]: true,',
			'\t\t});',
			'',
			'\t\tassert.deepStrictEqual({',
			"\t\t\tclaude: shouldSurfaceLocalAgentHostProvider('claude', configurationService),",
			"\t\t\totherProvider: shouldSurfaceLocalAgentHostProvider('copilot', configurationService),",
			'\t\t}, {',
			'\t\t\tclaude: true,',
			'\t\t\totherProvider: true,',
			'\t\t});',
			'\t});',
			'',
			"\ttest('surfaces Claude when the setting is absent, matching its default', () => {",
			'\t\tconst configurationService = new TestConfigurationService();',
			'',
			'\t\tassert.deepStrictEqual({',
			"\t\t\tclaude: shouldSurfaceLocalAgentHostProvider('claude', configurationService),",
			'\t\t}, {',
			'\t\t\tclaude: true,',
			'\t\t});',
			'\t});',
			'',
			"\ttest('hides disabled providers', () => {",
			'\t\tconst configurationService = new TestConfigurationService({',
			'\t\t\t[AgentHostClaudeAgentEnabledSettingId]: false,',
			'\t\t});',
			'',
			'\t\tassert.deepStrictEqual({',
			"\t\t\tclaude: shouldSurfaceLocalAgentHostProvider('claude', configurationService),",
			'\t\t}, {',
			'\t\t\tclaude: false,',
			'\t\t});',
			'\t});',
		].join('\n');
		lines.splice(78, 53, newRegion);
		s.text = lines.join('\n');
	}
}
// 2. Import: drop the two codex setting symbols
rep('a',
	"import { AgentHostClaudeAgentEnabledSettingId, AgentHostCodexAgentEnabledSettingId, AgentHostOTelEnvVars, AgentHostOTelPolicyState, buildAgentHostOTelEnv, CodexPreferAgentHostEditorSettingId, isAgentEnabled, readAgentHostOTelPolicySettings, sanitizeAgentHostOTelPolicySettings, shouldSurfaceLocalAgentHostProvider } from '../../common/agentService.js';",
	"import { AgentHostClaudeAgentEnabledSettingId, AgentHostOTelEnvVars, AgentHostOTelPolicyState, buildAgentHostOTelEnv, isAgentEnabled, readAgentHostOTelPolicySettings, sanitizeAgentHostOTelPolicySettings, shouldSurfaceLocalAgentHostProvider } from '../../common/agentService.js';",
	1);
// 3. Comment at old line 435
rep('a',
	'\t\t\t// Codex on OpenAI: advertises the resource but marks it optional.',
	'\t\t\t// Advertises the Copilot resource but marks it optional.',
	1);

// ---------- b: agentHostSessionType.test.ts ----------
rep('b', "parseRemoteAgentHostHarness('remote-10.0.0.1__8080-codex')", "parseRemoteAgentHostHarness('remote-10.0.0.1__8080-mycli')", 1);
rep('b', "parseAgentHostHarness('remote-foo-bar-codex')", "parseAgentHostHarness('remote-foo-bar-mycli')", 1);
rep('b', "\t\t\t'codex',", "\t\t\t'mycli',", 2);

// ---------- c: agentSdkSetup.test.ts ----------
rep('c', "[agentSdkSetupStatusKey('codex')]: { download: 'downloadOnUse', signInProviderName: 'ChatGPT' },", "[agentSdkSetupStatusKey('mycli')]: { download: 'downloadOnUse', signInProviderName: 'MyProvider' },", 1);
rep('c', "{ agent: 'codex', download: 'downloadOnUse', setupDocsUrl: undefined, signInProviderName: 'ChatGPT' },", "{ agent: 'mycli', download: 'downloadOnUse', setupDocsUrl: undefined, signInProviderName: 'MyProvider' },", 1);
rep('c', "[agentSdkSetupStatusKey('codex')]: 'not an object',", "[agentSdkSetupStatusKey('mycli')]: 'not an object',", 1);
rep('c', "'vscode.codexAccount': { status: 'signedIn' },", "'vscode.someAccount': { status: 'signedIn' },", 1);
rep('c', "isAgentSdkSetupRequestFor({ agent: 'claude', request: 'abc' }, 'codex')", "isAgentSdkSetupRequestFor({ agent: 'claude', request: 'abc' }, 'mycli')", 1);

// ---------- d: agentHostSandboxToggle.test.ts ----------
rep('d', "\t\tconst results = ['claude', 'codex', 'local', 'unknown', undefined].map(provider => {", "\t\tconst results = ['claude', 'mycli', 'local', 'unknown', undefined].map(provider => {", 1);

// ---------- final scans + write ----------
let anyFail = false;
for (const [k, s] of Object.entries(state)) {
	if (s.fails.length) {
		anyFail = true;
		console.log(`FAIL ${s.path}`);
		for (const f of s.fails) console.log(`  - ${f}`);
		continue;
	}
	const residual = s.text.match(/codex/gi);
	if (residual) {
		anyFail = true;
		console.log(`FAIL ${s.path}: ${residual.length} residual codex matches`);
		continue;
	}
	if (k === 'a') {
		const threeArg = s.text.match(/configurationService, (true|false)\)/g);
		if (threeArg) {
			anyFail = true;
			console.log(`FAIL ${s.path}: ${threeArg.length} leftover 3-arg calls`);
			continue;
		}
	}
	const out = s.crlf ? s.text.replace(/\n/g, '\r\n') : s.text;
	fs.writeFileSync(s.path, out);
	console.log(`OK ${s.path}`);
}
process.exit(anyFail ? 1 : 0);
