import fs from 'node:fs';

const files = {
	sChangeset: 'src/vs/platform/agentHost/test/node/e2e/suites/changesetSuite.ts',
	sProviderErr: 'src/vs/platform/agentHost/test/node/e2e/suites/providerErrorSuite.ts',
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

// --- sChangeset ---
rep('sChangeset', 'providerFileEditsEnabled && providerChangesetAggregationEnabled ? test : test.skip',
	'providerFileEditsEnabled ? test : test.skip', 1);
// reps are line-neutral; splice ranges below match the ORIGINAL line numbers.
splice('sChangeset', [
	{ start: 1645, end: 1646,
		startWith: '\t\t// Quarantined on Codex Windows: https://github.com/microsoft/vscode/issues/338153',
		alsoAt: [[1646, "\t\tconst providerChangesetAggregationEnabled = config.provider !== 'codex' || !context.isWindows;"]],
		// after the gate rep above, line 1647 no longer names providerChangesetAggregationEnabled:
		afterWith: '\t\t(config.supportsMultipleChats && supportsProviderFileEdits && providerFileEditsEnabled ? test : test.skip)(' },
]);

// --- sProviderErr ---
// NOTE: the title rep merges 3 original lines into 2, shifting everything after
// original line 32 down by one — splice ranges below use the post-rep numbers.
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
splice('sProviderErr', [
	{ start: 75, end: 77,
		startWith: '\t\t\tif (genericRateLimit) {',
		alsoAt: [[76, '\t\t\t\tassert.match(action.part.error.message, /usage|limit|429/i);']],
		afterWith: '\t\t}' },
]);

// ================= final scans + write =================
let anyFail = false;
for (const [k, s] of Object.entries(state)) {
	if (s.fails.length) {
		anyFail = true;
		console.log(`FAIL ${s.path}`);
		for (const f of s.fails) { console.log(`  - ${f}`); }
		continue;
	}
	const residual = s.text.match(/codex/gi);
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
