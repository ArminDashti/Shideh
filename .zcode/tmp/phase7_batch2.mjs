import fs from 'node:fs';

const files = {
	a: 'src/vs/platform/agentHost/test/node/agentHostTurnTelemetry.test.ts',
	b: 'src/vs/platform/agentHost/test/node/agentHostTurnHangTelemetry.test.ts',
	c: 'src/vs/platform/agentHost/test/node/agentHostTelemetryReporter.test.ts',
	d: 'src/vs/platform/agentHost/test/node/copilotAgent.test.ts',
	e: 'src/vs/platform/agentHost/test/node/agentHostStartupPerformance.test.ts',
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
		s.fails.push(`rep expected ${expect} got ${count} for ${JSON.stringify(find.slice(0, 90))}`);
		return;
	}
	s.text = parts.join(repl);
}

// Splice 1-based inclusive line ranges. All boundary asserts run before any mutation.
function splice(k, ranges) {
	const s = state[k];
	const lines = s.text.split('\n');
	for (const r of ranges) {
		const at = r.start - 1;
		const actual = lines[at];
		if (r.startIs !== undefined && actual !== r.startIs) {
			s.fails.push(`line ${r.start} mismatch: got ${JSON.stringify(actual)}`);
		}
		if (r.startWith !== undefined && !(actual || '').startsWith(r.startWith)) {
			s.fails.push(`line ${r.start} prefix mismatch: got ${JSON.stringify(actual)}`);
		}
		for (const [idx, is] of r.alsoAt || []) {
			if (lines[idx - 1] !== is) { s.fails.push(`line ${idx} mismatch: got ${JSON.stringify(lines[idx - 1])}`); }
		}
		if (r.afterIs !== undefined && lines[r.end] !== r.afterIs) {
			s.fails.push(`line ${r.end + 1} (after range) mismatch: got ${JSON.stringify(lines[r.end])}`);
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

// ---------- string reps (line-count neutral) ----------
// a: reword comment
rep('a', '// The emission sequence Claude and Codex produce: a rename, then an',
	'// The emission sequence Claude produces: a rename, then an', 1);
// c: narrow reporter import (type symbols only used by deleted test)
rep('c', "import { AgentHostTelemetryReporter, type IAgentHostTurnCompletedReport, type IAgentHostTurnHungReport } from '../../node/agentHostTelemetryReporter.js';",
	"import { AgentHostTelemetryReporter } from '../../node/agentHostTelemetryReporter.js';", 1);
// d: drop IAgentHostCheckpointService symbol (only use was in deleted test)
rep('d', "import { IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE } from '../../common/agentHostCheckpointService.js';",
	"import { NULL_CHECKPOINT_SERVICE } from '../../common/agentHostCheckpointService.js';", 1);
// e: blanket neutral relabel of provider id
rep('e', "'codex'", "'mycli'", 20);

// ---------- line-range deletions ----------
// a: 2 dead codex-context imports; 4 dead tests + trailing blank; queued-context test + trailing blank
splice('a', [
	{ start: 27, end: 28,
		startIs: "import { getCodexAccountTelemetryContext } from '../../node/codex/codexAccountTelemetry.js';",
		alsoAt: [[28, "import type { ICodexAccountState } from '../../node/codex/codexAccountState.js';"]],
		afterWith: "import type { SessionMode } from '../../common/agentHostSchema.js';" },
	{ start: 336, end: 433,
		startWith: "\ttest('keeps admission context independent across concurrent chats and sessions', async () => {",
		afterWith: "\ttest('records an admitted send before its outcome" },
	{ start: 2198, end: 2221,
		startWith: "\ttest('captures queued context when the queued turn is admitted', () => {",
		afterWith: "\ttest('emits a single turnCompleted when both the client cancel" },
]);

// b: dead codex-context import; dead Codex-scoped hang-context loop + trailing blank
splice('b', [
	{ start: 58, end: 58,
		startIs: "import { getCodexAccountTelemetryContext } from '../../node/codex/codexAccountTelemetry.js';",
		afterWith: "import { IAgentHostWorktreeIsolation } from '../../node/shared/worktreeIsolation.js';" },
	{ start: 297, end: 324,
		startWith: "\tfor (const provider of ['codex', 'copilot', 'claude']) {",
		afterWith: "\ttest('reports noProgress for a turn that starts" },
]);

// c: dead codex-context import; dead schema-limits test + trailing blank
splice('c', [
	{ start: 20, end: 20,
		startIs: "import { getCodexAccountTelemetryContext } from '../../node/codex/codexAccountTelemetry.js';",
		afterWith: "import { AgentHostClientType } from '../../common/agentHostClientInfo.js';" },
	{ start: 85, end: 118,
		startWith: "\ttest('limits turn context to schema fields on Codex completion and hang events', () => {",
		afterWith: "\ttest('turnCompleted preserves optional root cohort fields" },
]);

// d: dead CodexAgent/CodexProxyService/RecordingAgentSdkDownloader imports; dead Codex SKU test + trailing blank
splice('d', [
	{ start: 51, end: 53,
		startIs: "import { CodexAgent } from '../../node/codex/codexAgent.js';",
		alsoAt: [
			[52, "import { CodexProxyService, ICodexProxyService } from '../../node/codex/codexProxyService.js';"],
			[53, "import { RecordingAgentSdkDownloader } from './testAgentSdkDownloader.js';"],
		],
		afterWith: "import { IAgentHostSessionOpenTelemetry } from '../../node/agentHostSessionOpenTelemetry.js';" },
	{ start: 3357, end: 3433,
		startWith: "\ttest('keeps Codex SKU telemetry independent of concurrent Copilot authentication and clearing', async () => {",
		afterWith: "\ttest('does not discover SKU on a new enterprise endpoint" },
]);

// ---------- final scans + write ----------
const postScans = {
	a: ['captureTurnTelemetryContext', 'turnTelemetryContext', 'getProviderTelemetryContext'],
	b: ['captureTurnTelemetryContext', 'turnTelemetryContext', 'chatgpt'],
	c: ['getCodexAccountTelemetryContext', 'IAgentHostTurnCompletedReport', 'IAgentHostTurnHungReport'],
	d: ['CodexAgent', 'CodexProxyService', 'RecordingAgentSdkDownloader', 'IAgentHostCheckpointService'],
};
let anyFail = false;
for (const [k, s] of Object.entries(state)) {
	if (s.fails.length) {
		anyFail = true;
		console.log(`FAIL ${s.path}`);
		for (const f of s.fails) { console.log(`  - ${f}`); }
		continue;
	}
	let fileBad = false;
	const residual = s.text.match(/codex/gi);
	if (residual) {
		fileBad = true;
		console.log(`FAIL ${s.path}: ${residual.length} residual codex matches`);
	}
	for (const needle of postScans[k] || []) {
		const n = s.text.split(needle).length - 1;
		if (n !== 0) {
			fileBad = true;
			console.log(`FAIL ${s.path}: ${n} leftover ${needle}`);
		}
	}
	if (fileBad) { anyFail = true; continue; }
	const out = s.crlf ? s.text.replace(/\n/g, '\r\n') : s.text;
	fs.writeFileSync(s.path, out);
	console.log(`OK ${s.path}`);
}
process.exit(anyFail ? 1 : 0);
