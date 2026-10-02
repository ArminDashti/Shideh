import fs from 'node:fs';

const path = 'src/vs/platform/agentHost/test/node/e2e/suites/providerErrorSuite.ts';
const raw = fs.readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
let text = raw.replace(/\r\n/g, '\n');
const fails = [];

function rep(find, repl, expect) {
	const parts = text.split(find);
	const count = parts.length - 1;
	if (count !== expect) {
		fails.push(`rep expected ${expect} got ${count} for ${JSON.stringify(find.slice(0, 110))}`);
		return;
	}
	text = parts.join(repl);
}

function splice(ranges) {
	const lines = text.split('\n');
	for (const r of ranges) {
		const actual = lines[r.start - 1];
		if (r.startIs !== undefined && actual !== r.startIs) {
			fails.push(`line ${r.start} mismatch: ${JSON.stringify(actual)}`);
		}
		if (r.startWith !== undefined && !(actual || '').startsWith(r.startWith)) {
			fails.push(`line ${r.start} prefix mismatch: ${JSON.stringify(actual)}`);
		}
		for (const [idx, is] of r.alsoAt || []) {
			if (lines[idx - 1] !== is) { fails.push(`line ${idx} mismatch: ${JSON.stringify(lines[idx - 1])}`); }
		}
		if (r.afterWith !== undefined && !(lines[r.end] || '').startsWith(r.afterWith)) {
			fails.push(`line ${r.end + 1} (after range) prefix mismatch: ${JSON.stringify(lines[r.end])}`);
		}
	}
	if (fails.length) { return; }
	for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
		lines.splice(r.start - 1, r.end - r.start + 1);
	}
	text = lines.join('\n');
}

rep("const retries = context.config.provider === 'claude' ? status !== 402 : context.config.provider === 'codex' && (status === 402 || status === 404);",
	"const retries = context.config.provider === 'claude' && status !== 402;", 1);
rep("\t\tconst genericRateLimit = context.config.provider === 'codex' && status === 429;\n\t\tconst title = retries ? `${name} retries without losing the request`\n\t\t\t: `${name} ${genericRateLimit ? 'is surfaced' : 'remains classified'} and allows a subsequent turn`;",
	"\t\tconst title = retries ? `${name} retries without losing the request`\n\t\t\t: `${name} remains classified and allows a subsequent turn`;", 1);
rep("}, context.config.provider === 'codex' ? '/responses' : '/v1/messages');",
	"}, '/v1/messages');", 1);
rep('classification: genericRateLimit ? action.part.error.errorType : metadata?.fetchError?.type,',
	'classification: metadata?.fetchError?.type,', 1);
rep("}, { state: TurnState.Error, active: undefined, classification: genericRateLimit ? 'CodexError' : fetchType });",
	'}, { state: TurnState.Error, active: undefined, classification: fetchType });', 1);

// The title rep above merges 3 original lines into 2 — splice uses post-rep numbering:
// original 76..78 (`if`/`assert`/`}`) become 75..77; original 79 (`\t\t\t}`) becomes 78.
splice([
	{ start: 75, end: 77,
		startWith: '\t\t\t\tif (genericRateLimit) {',
		alsoAt: [[76, '\t\t\t\t\tassert.match(action.part.error.message, /usage|limit|429/i);']],
		afterWith: '\t\t\t}' },
]);

if (fails.length) {
	console.log(`FAIL ${path}`);
	for (const f of fails) { console.log(`  - ${f}`); }
	process.exit(1);
}
const residual = text.match(/codex/gi);
if (residual) {
	console.log(`FAIL ${path}: ${residual.length} residual codex matches`);
	process.exit(1);
}
fs.writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log(`OK ${path}`);
