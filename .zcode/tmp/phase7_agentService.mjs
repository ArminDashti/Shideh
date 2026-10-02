import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/vs/platform/agentHost/test/node/agentService.test.ts';
const raw = readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
let text = crlf ? raw.replace(/\r\n/g, '\n') : raw;

const edits = [
	// --- import of deleted module
	{ find: "import { CodexSessionConfigKey } from '../../common/codexSessionConfigKeys.js';\n", replace: '', expect: 1 },
	// --- generic blocked-input errorType relabel (6 sites)
	{ find: "errorType: 'CodexThreadInUse'", replace: "errorType: 'ThreadInUse'", expect: 6, all: true },
	// --- SDK download progress test -> claude package
	{ find: "service.emitDownloadProgress('codex', 'Codex', 50, 100, false, true);", replace: "service.emitDownloadProgress('claude', 'Claude', 50, 100, false, true);", expect: 1 },
	{ find: "progressToken: 'codex',", replace: "progressToken: 'claude',", expect: 1 },
	{ find: "message: 'Downloading Codex Agent',", replace: "message: 'Downloading Claude Agent',", expect: 1 },
	// --- provider loop: drop codex iteration
	{ find: "\t\tfor (const provider of ['copilotcli', 'claude', 'codex']) {", replace: "\t\tfor (const provider of ['copilotcli', 'claude']) {", expect: 1 },
	// --- startup registration-count seed: drop codex bucket
	{ find: "for (const [provider, count] of [['copilotcli', 101], ['codex', 99], ['claude', 100], ['custom', 1]] as const)", replace: "for (const [provider, count] of [['copilotcli', 101], ['claude', 100], ['custom', 1]] as const)", expect: 1 },
	{ find: "data?.copilotSessionCount, data?.codexSessionCount, data?.claudeSessionCount", replace: "data?.copilotSessionCount, data?.claudeSessionCount", expect: 1 },
	{ find: "\t\t\t\t\tcodex: data.codexSessionCount,\n", replace: '', expect: 1 },
	{ find: "listSizes: [300, 300, 300],", replace: "listSizes: [201, 201, 201],", expect: 1 },
	{ find: "firstLists: [[301, 101, 99, 100, 1, 300, 1, 0]],", replace: "firstLists: [[202, 101, 100, 1, 201, 1, 0]],", expect: 1 },
	{ find: "registered: 301, copilot: 101, codex: 99, claude: 100, other: 1, visible: 300, hidden: 1, catalog: 300,", replace: "registered: 202, copilot: 101, claude: 100, other: 1, visible: 201, hidden: 1, catalog: 201,", expect: 1 },
	// --- startup-context snapshot test: register claude so claudeRegistered flips
	{ find: "[AgentHostSessionCatalogEnabledConfigKey]: false });\n\t\t\tconst agent = disposables.add(new MockAgent('codex'));", replace: "[AgentHostSessionCatalogEnabledConfigKey]: false });\n\t\t\tconst agent = disposables.add(new MockAgent('claude'));", expect: 1 },
	{ find: "data?.name, data?.copilotRegistered, data?.claudeRegistered, data?.codexRegistered,", replace: "data?.name, data?.copilotRegistered, data?.claudeRegistered,", expect: 1 },
	{ find: "contexts: [['hostReady', false, false, false], ['firstSessionList', false, false, true], ['startupSettled', false, false, true]],", replace: "contexts: [['hostReady', false, false], ['firstSessionList', false, true], ['startupSettled', false, true]],", expect: 1 },
	// --- config-inheritance key lists: drop CodexSessionConfigKey.PermissionsPreset
	{ find: "ClaudeSessionConfigKey.PermissionMode, CodexSessionConfigKey.PermissionsPreset])", replace: "ClaudeSessionConfigKey.PermissionMode])", expect: 2, all: true },
	// value-line deletions anchored on the preceding newline (indent depth varies)
	{ find: "\n\t\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'full-access',", replace: '', expect: 1 },
	{ find: "\n\t\t\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'full-access',", replace: '', expect: 1 },
	{ find: "\n\t\t\t\t\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'read-only',", replace: '', expect: 1 },
	{ find: "\n\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'read-only',", replace: '', expect: 1 },
	{ find: "\n\t\t\t\t\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'danger-full-access',", replace: '', expect: 1 },
	{ find: "\n\t\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: 'danger-full-access',", replace: '', expect: 1 },
	// --- cached-peers test: rename codex-specific enumeration agent
	{ find: "test('Claude and Codex persist cached peers when enumeration is unavailable or lacks the URI', async () => {", replace: "test('Claude and third-party providers persist cached peers when enumeration is unavailable or lacks the URI', async () => {", expect: 1 },
	{ find: "class EnumeratingCodexAgent extends DirectImportAgent {", replace: "class EnumeratingBackingAgent extends DirectImportAgent {", expect: 1 },
	{ find: "new EnumeratingCodexAgent(provider)", replace: "new EnumeratingBackingAgent(provider)", expect: 1 },
	// --- comment rewords (actual late agent in these tests is claude)
	{ find: "provider (e.g. Codex) can register later", replace: "provider (e.g. Claude) can register later", expect: 1 },
	{ find: "simulating Codex enabling after", replace: "simulating Claude enabling after", expect: 1 },
	// --- external linked worktree paths + agent id
	{ find: "URI.file('/workspace/codex')", replace: "URI.file('/workspace/mycli')", expect: 1 },
	{ find: "URI.file('/home/user/.codex/worktrees/4b6d/codex')", replace: "URI.file('/home/user/.mycli/worktrees/4b6d/mycli')", expect: 1 },
	// --- mock model-id namespaces
	{ find: "codex-model", replace: "mycli-model", expect: 2, all: true },
];

for (const e of edits) {
	const count = text.split(e.find).length - 1;
	if (count !== e.expect) {
		console.error(`FAIL count ${count} !== ${e.expect} for: ${JSON.stringify(e.find.slice(0, 140))}`);
		process.exit(1);
	}
}
for (const e of edits) {
	text = text.split(e.find).join(e.replace);
}

// Every remaining codex occurrence must be the exact quoted provider id 'codex'.
const re = /codex/gi;
let m;
const bad = [];
while ((m = re.exec(text)) !== null) {
	if (text[m.index - 1] !== "'" || text[m.index + 5] !== "'") {
		bad.push(JSON.stringify(text.slice(Math.max(0, m.index - 40), m.index + 40)));
	}
}
if (bad.length) {
	console.error('FAIL non-quoted codex leftovers after specials:');
	for (const b of bad) { console.error('  ' + b); }
	process.exit(1);
}
const quoted = text.split("'codex'").length - 1;
if (quoted !== 47) {
	console.error(`FAIL quoted 'codex' count ${quoted} !== 47`);
	process.exit(1);
}
text = text.split("'codex'").join("'mycli'");
if (/codex/i.test(text)) {
	console.error('FAIL residual codex after blanket relabel');
	process.exit(1);
}

writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log('OK: all edits applied');
