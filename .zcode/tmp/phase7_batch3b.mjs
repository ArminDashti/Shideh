import fs from 'node:fs';

const path = 'src/vs/platform/agentHost/test/node/agentHostPromptRegistry.test.ts';
const raw = fs.readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
let text = raw.replace(/\r\n/g, '\n');
const fails = [];

const lines = text.split('\n');
const ranges = [
	{ start: 289, end: 289,
		startWith: '\t\t\t\tnamesProviderTools: AGENT_HOST_WORKSPACELESS_INSTRUCTIONS.includes(',
		afterWith: '\t\t\t\tcombinesWorkspaceAndIsolation: AGENT_HOST_WORKSPACELESS_INSTRUCTIONS' },
	{ start: 298, end: 298,
		startWith: '\t\t\t\tnamesProviderTools: true,',
		afterWith: '\t\t\t\tcombinesWorkspaceAndIsolation: true,' },
];
for (const r of ranges) {
	const actual = lines[r.start - 1];
	if (!(actual || '').startsWith(r.startWith)) { fails.push(`line ${r.start} prefix mismatch: ${JSON.stringify(actual)}`); }
	if (!(lines[r.end] || '').startsWith(r.afterWith)) { fails.push(`line ${r.end + 1} after mismatch: ${JSON.stringify(lines[r.end])}`); }
}
if (fails.length) {
	for (const f of fails) { console.log(`FAIL - ${f}`); }
	process.exit(1);
}
for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
	lines.splice(r.start - 1, r.end - r.start + 1);
}
text = lines.join('\n');

// keep-set: gpt-5*/gpt-6* codex model ids + the synthetic prompt sentinel
// (scan copy only — never mutate the text that gets written)
let scanText = text;
for (const keep of ['gpt-5-codex', 'gpt-5.3-codex', 'gpt-6-codex', "'CODEX'", "includes('codex')"]) {
	scanText = scanText.split(keep).join('');
}
const residual = scanText.match(/codex/gi);
if (residual) {
	console.log(`FAIL: ${residual.length} residual codex matches`);
	process.exit(1);
}
fs.writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log(`OK ${path}`);
