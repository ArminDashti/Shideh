import fs from 'node:fs';

const files = {
	hHarness: 'src/vs/platform/agentHost/test/node/e2e/harness/agentHostE2ETestHarness.ts',
	hTarget: 'src/vs/platform/agentHost/test/node/e2e/harness/agentHostTarget.ts',
	hStubs: 'src/vs/platform/agentHost/test/node/e2e/harness/capiStubs.ts',
	hCodec: 'src/vs/platform/agentHost/test/node/e2e/harness/capiWireCodec.ts',
	hReplay: 'src/vs/platform/agentHost/test/node/e2e/harness/capiReplayProxy.ts',
	hSnap: 'src/vs/platform/agentHost/test/node/e2e/harness/ahpSnapshot.ts',
	sSuites: 'src/vs/platform/agentHost/test/node/e2e/suites/agentHostE2ESuites.ts',
	sChangeset: 'src/vs/platform/agentHost/test/node/e2e/suites/changesetSuite.ts',
	sCore: 'src/vs/platform/agentHost/test/node/e2e/suites/coreSuite.ts',
	sCustom: 'src/vs/platform/agentHost/test/node/e2e/suites/customizationDiscoverySuite.ts',
	sFileOps: 'src/vs/platform/agentHost/test/node/e2e/suites/fileOperationsSuite.ts',
	sMcpSide: 'src/vs/platform/agentHost/test/node/e2e/suites/mcpSideChannelSuite.ts',
	sProviderErr: 'src/vs/platform/agentHost/test/node/e2e/suites/providerErrorSuite.ts',
	sServerTools: 'src/vs/platform/agentHost/test/node/e2e/suites/serverToolsSuite.ts',
	sSessionPersist: 'src/vs/platform/agentHost/test/node/e2e/suites/sessionPersistenceSuite.ts',
	sWorkingDirs: 'src/vs/platform/agentHost/test/node/e2e/suites/workingDirectoriesSuite.ts',
	sWorkspace: 'src/vs/platform/agentHost/test/node/e2e/suites/workspaceSuite.ts',
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
		s.fails.push(`rep expected ${expect} got ${count} for ${JSON.stringify(find.slice(0, 110))}`);
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
			s.fails.push(`line ${r.start} mismatch: ${JSON.stringify(actual)}`);
		}
		if (r.startWith !== undefined && !(actual || '').startsWith(r.startWith)) {
			s.fails.push(`line ${r.start} prefix mismatch: ${JSON.stringify(actual)}`);
		}
		for (const [idx, is] of r.alsoAt || []) {
			if (lines[idx - 1] !== is) { s.fails.push(`line ${idx} mismatch: ${JSON.stringify(lines[idx - 1])}`); }
		}
		if (r.afterWith !== undefined && !(lines[r.end] || '').startsWith(r.afterWith)) {
			s.fails.push(`line ${r.end + 1} (after range) prefix mismatch: ${JSON.stringify(lines[r.end])}`);
		}
	}
	if (s.fails.length) { return; }
	for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
		lines.splice(r.start - 1, r.end - r.start + 1);
	}
	s.text = lines.join('\n');
}

// ================= string reps (line-count neutral) =================

// --- hHarness ---
rep('hHarness', 'shared across all agents (Copilot, Codex, Claude) via the host-owned',
	'shared across all agents (Copilot, Claude) via the host-owned', 1);
rep('hHarness', 'asserted. Currently true only for Copilot — Codex and Claude run shell',
	'asserted. Currently true only for Copilot — Claude runs shell', 1);
rep('hHarness', 'commands inside their own SDK subprocess and never surface a host',
	'commands inside its own SDK subprocess and never surfaces a host', 1);
rep('hHarness',
	'readonly claudeSdkRoot?: string; readonly codexSdkRoot?: string; readonly codexHomeDir: string; readonly homeDir: string;',
	'readonly claudeSdkRoot?: string; readonly homeDir: string;', 1);
rep('hHarness',
	'startOptions: { readonly claudeSdkRoot?: string; readonly codexSdkRoot?: string; readonly target?: IAgentHostTarget } = {},',
	'startOptions: { readonly claudeSdkRoot?: string; readonly target?: IAgentHostTarget } = {},', 1);
rep('hHarness',
	'return { homeDir, userDataDir: join(homeDir, \'user-data\'), codexHomeDir };',
	'return { homeDir, userDataDir: join(homeDir, \'user-data\') };', 1);
rep('hHarness', 'so only it is run verbosely; Claude/Codex use their own runtimes.',
	'so only it is run verbosely; Claude uses its own runtime.', 1);

// --- hStubs ---
rep('hStubs', '// Codex follows an unavailable MCP response with standard OAuth protected',
	'// Provider SDKs follow an unavailable MCP response with standard OAuth protected', 1);

// --- hCodec ---
rep('hCodec', 'and Codex\'s `<environment_context>` cwd/date preamble)',
	'and the `<environment_context>` cwd/date preamble)', 1);
rep('hCodec', 'The OpenAI Responses API (`POST /responses`) used by the Codex provider. We',
	'The OpenAI Responses API (`POST /responses`). We', 1);
rep('hCodec',
	'// Skip harness-injected instruction messages (Codex uses the\n\t\t\t\t// `developer` / `system` roles for its permissions + environment\n\t\t\t\t// preamble); the real system prompt is already a placeholder.',
	'// Skip harness-injected instruction messages (the `developer` /\n\t\t\t\t// `system` roles carry the permissions + environment\n\t\t\t\t// preamble); the real system prompt is already a placeholder.', 1);
rep('hCodec', 'sequence the Codex app-server expects (`response.created` -> per-item',
	'sequence the Responses API expects (`response.created` -> per-item', 1);

// --- hReplay ---
rep('hReplay', 'Responses API (`/responses`, used by Codex) echoes the full request',
	'Responses API (`/responses`) echoes the full request', 1);

// --- hSnap ---
rep('hSnap',
	' * Only the names that actually vary by platform are mapped. Claude\'s `Bash` and\n * Codex\'s `shell` are fixed strings their SDKs use everywhere, so they are left\n * alone — rewriting them would hide a genuine provider change.',
	' * Only the names that actually vary by platform are mapped. Fixed strings\n * like Claude\'s `Bash` are left alone — rewriting them would hide a genuine\n * provider change.', 1);

// --- sChangeset ---
rep('sChangeset', 'providerFileEditsEnabled && providerChangesetAggregationEnabled ? test : test.skip',
	'providerFileEditsEnabled ? test : test.skip', 1);

// --- sCore ---
rep('sCore',
	'// Quarantined on Codex Linux/macOS: https://github.com/microsoft/vscode/issues/338152\n\t(config.provider !== \'codex\' || context.isWindows ? test : test.skip)(\'retains context across consecutive turns\'',
	'\ttest(\'retains context across consecutive turns\'', 1);
rep('sCore',
	'// Quarantined on Codex Linux: https://github.com/microsoft/vscode/issues/338152\n\t(modelSwitchTarget && (config.provider !== \'codex\' || !context.isLinux) ? test : test.skip)(',
	'\t(modelSwitchTarget ? test : test.skip)(', 1);

// --- sCustom ---
rep('sCustom',
	"\t\tconst files = config.provider === 'codex'\n\t\t\t? [join(workspace, 'AGENTS.md')]\n\t\t\t: [\n\t\t\t\tjoin(workspace, 'AGENTS.md'),\n\t\t\t\tjoin(workspace, 'CLAUDE.md'),\n\t\t\t\tjoin(workspace, '.github', 'copilot-instructions.md'),\n\t\t\t];",
	"\t\tconst files = [\n\t\t\tjoin(workspace, 'AGENTS.md'),\n\t\t\tjoin(workspace, 'CLAUDE.md'),\n\t\t\tjoin(workspace, '.github', 'copilot-instructions.md'),\n\t\t];", 1);

// --- sFileOps ---
rep('sFileOps', "if (config.streamingFileCreateToolName && config.provider !== 'codex') {",
	'if (config.streamingFileCreateToolName) {', 1);
rep('sFileOps', '\tconst createFileReplayEnabled = RECORDING || !isWindows || !config.fileCreateReplayUnstableOnWindows;',
	'\tconst createFileReplayEnabled = RECORDING || !isWindows;', 1);

// --- sProviderErr ---
rep('sProviderErr',
	"const retries = context.config.provider === 'claude' ? status !== 402 : context.config.provider === 'codex' && (status === 402 || status === 404);",
	"const retries = context.config.provider === 'claude' && status !== 402;", 1);
rep('sProviderErr',
	"\t\tconst genericRateLimit = context.config.provider === 'codex' && status === 429;\n\t\tconst title = retries ? `${name} retries without losing the request`\n\t\t\t: `${name} ${genericRateLimit ? 'is surfaced' : 'remains classified'} and allows a subsequent turn`;",
	"\t\tconst title = retries ? `${name} retries without losing the request`\n\t\t\t: `${name} remains classified and allows a subsequent turn`;", 1);
rep('sProviderErr', "}, context.config.provider === 'codex' ? '/responses' : '/v1/messages');",
	"}, '/v1/messages');", 1);
rep('sProviderErr', 'classification: genericRateLimit ? action.part.error.errorType : metadata?.fetchError?.type,',
	'classification: metadata?.fetchError?.type,', 1);
rep('sProviderErr', "}, { state: TurnState.Error, active: undefined, classification: genericRateLimit ? 'CodexError' : fetchType });",
	'}, { state: TurnState.Error, active: undefined, classification: fetchType });', 1);

// --- sServerTools ---
rep('sServerTools', 'assert.strictEqual(turn.sawPendingConfirmation, config.provider !== \'codex\');',
	'assert.strictEqual(turn.sawPendingConfirmation, true);', 1);
rep('sServerTools', "sawPendingConfirmation: config.provider !== 'codex',",
	'sawPendingConfirmation: true,', 2);

// --- sWorkingDirs ---
rep('sWorkingDirs',
	"import { AgentHostClaudeMultiRootEnabledConfigKey, AgentHostCodexMultiRootEnabledConfigKey, AgentHostCopilotMultiRootEnabledConfigKey } from '../../../../common/agentHostSchema.js';",
	"import { AgentHostClaudeMultiRootEnabledConfigKey, AgentHostCopilotMultiRootEnabledConfigKey } from '../../../../common/agentHostSchema.js';", 1);
rep('sWorkingDirs',
	"const multiRootKey = config.provider === 'claude'\n\t\t? AgentHostClaudeMultiRootEnabledConfigKey\n\t\t: config.provider === 'codex' ? AgentHostCodexMultiRootEnabledConfigKey : AgentHostCopilotMultiRootEnabledConfigKey;",
	"const multiRootKey = config.provider === 'claude'\n\t\t? AgentHostClaudeMultiRootEnabledConfigKey\n\t\t: AgentHostCopilotMultiRootEnabledConfigKey;", 1);

// --- sWorkspace ---
rep('sWorkspace',
	'\t\t// materializes on the first turn dispatch. Codex / Claude run shell\n\t\t// commands inside their own SDK subprocess and never surface a host\n\t\t// terminal resource, so they verify isolation via the resolved\n\t\t// working directory alone.',
	'\t\t// materializes on the first turn dispatch. Claude runs shell\n\t\t// commands inside its own SDK subprocess and never surfaces a host\n\t\t// terminal resource, so it verifies isolation via the resolved\n\t\t// working directory alone.', 1);
rep('sWorkspace',
	'\t\t// Codex / Claude run shell commands inside their own SDK subprocess\n\t\t// and surface the output as plain text in the tool result instead,\n\t\t// so we assert the worktree path appears in that text.',
	'\t\t// Claude runs shell commands inside its own SDK subprocess\n\t\t// and surfaces the output as plain text in the tool result instead,\n\t\t// so we assert the worktree path appears in that text.', 1);

// ================= line splices =================

splice('hHarness', [
	{ start: 357, end: 358,
		startWith: "\t/** Optional path to a locally installed `codex` binary. Forwarded to the target's `launch`. */",
		alsoAt: [[358, '\treadonly codexSdkRoot?: string;']],
		afterWith: '\treadonly sessionConfig?: Readonly<Record<string, unknown>>;' },
	{ start: 397, end: 398,
		startIs: "\t/** Provider's file-create shell turn can report success during Windows replay without writing the file. */",
		alsoAt: [[398, '\treadonly fileCreateReplayUnstableOnWindows?: boolean;']],
		afterWith: '\t/** Provider-specific observable used to exercise entering and leaving plan mode. */' },
	{ start: 906, end: 906,
		startWith: '\t\t\tcodexSdkRoot: startOptions.codexSdkRoot,',
		afterWith: '\t\t\t...this._createDataDirectories(),' },
	{ start: 925, end: 926,
		startWith: "\t\tconst codexHomeDir = join(homeDir, '.codex');",
		afterWith: "\t\treturn { homeDir, userDataDir: join(homeDir, 'user-data') };" },
]);

splice('hTarget', [
	{ start: 31, end: 32,
		startIs: '\t/** Absolute path to the Codex home directory. */',
		alsoAt: [[32, '\treadonly codexHomeDir: string;']],
		afterWith: '\t/** Record/replay proxy configuration fronting the model boundary. */' },
	{ start: 39, end: 40,
		startIs: '\t/** Optional dev override for a locally installed Codex SDK root. */',
		alsoAt: [[40, '\treadonly codexSdkRoot?: string;']],
		afterWith: '\t/** Optional agent-host log level' },
	{ start: 71, end: 71,
		startWith: '\t\t\tcodexHomeDir: options.codexHomeDir,',
		afterWith: '\t\t\tcapiReplay: options.capiReplay,' },
	{ start: 75, end: 75,
		startWith: '\t\t\tcodexSdkRoot: options.codexSdkRoot,',
		afterWith: '\t\t\tlogLevel: options.logLevel,' },
]);

splice('hStubs', [
	{ start: 112, end: 112,
		startWith: '\t\tcodex_agent_enabled: true,',
		afterWith: '\t\tcloud_session_storage_enabled: true,' },
]);

splice('sSuites', [
	{ start: 100, end: 100,
		startWith: '\t\t\t\tcodexSdkRoot: config.codexSdkRoot,',
		afterWith: '\t\t\t\ttarget: options.target,' },
]);

splice('sChangeset', [
	{ start: 1645, end: 1646,
		startWith: '\t\t// Quarantined on Codex Windows: https://github.com/microsoft/vscode/issues/338153',
		afterWith: '\t\t(config.supportsMultipleChats && supportsProviderFileEdits && providerFileEditsEnabled && providerChangesetAggregationEnabled ? test : test.skip)(' },
]);

splice('sCustom', [
	{ start: 86, end: 88,
		startWith: "\t\tif (config.provider === 'codex') {",
		afterWith: "\t\tconst skill = join(workspace, '.github', 'skills', 'hello-skill', 'SKILL.md');" },
]);

splice('sFileOps', [
	{ start: 68, end: 69,
		startWith: '\t\t// Codex occasionally omits command completion; direct filesystem and response assertions are the success oracle.',
		afterWith: '\t} as const;' },
	{ start: 534, end: 536,
		startWith: '\t// Codex replays the recorded `exec_command` turn on Windows but the workspace',
		afterWith: '\tconst createFileReplayEnabled = RECORDING || !isWindows;' },
]);

splice('sMcpSide', [
	{ start: 200, end: 213,
		startWith: "\tif (context.config.provider === 'codex') {",
		afterWith: "\tif (context.config.provider === 'copilotcli') {" },
]);

splice('sProviderErr', [
	{ start: 76, end: 78,
		startWith: '\t\t\tif (genericRateLimit) {',
		alsoAt: [[77, '\t\t\t\tassert.match(action.part.error.message, /usage|limit|429/i);']],
		afterWith: '\t\t}' },
]);

splice('sServerTools', [
	{ start: 111, end: 117,
		startWith: "\t\tif (config.provider === 'codex' && context.isLinux) {",
		afterWith: '\t\tif (!stableResource) {' },
]);

splice('sSessionPersist', [
	{ start: 148, end: 188,
		startWith: "\tif (config.provider === 'codex') {",
		afterWith: "\tif (config.provider === 'copilotcli') {" },
]);

// ================= final scans + write =================
const keepAllow = {
	hStubs: ['gpt-5-codex', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.3-codex'],
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
	if (residual) {
		anyFail = true;
		console.log(`FAIL ${s.path}: ${residual.length} residual codex matches`);
		continue;
	}
	const out = s.crlf ? s.text.replace(/\n/g, '\r\n') : s.text;
	fs.writeFileSync(s.path, out);
	console.log(`OK ${s.path}`);
}
process.exit(anyFail ? 1 : 0);
