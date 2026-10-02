import fs from 'node:fs';

const path = 'src/vs/platform/agentHost/test/node/agentHostStartupPerformance.test.ts';
const raw = fs.readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
let text = raw.replace(/\r\n/g, '\n');
const fails = [];

function rep(find, repl, expect) {
	const parts = text.split(find);
	const count = parts.length - 1;
	if (count !== expect) { fails.push(`expected ${expect} got ${count} for ${JSON.stringify(find)}`); return; }
	text = parts.join(repl);
}

rep("\t\tconst codex = performance.start('sessionDiscoveryScan', 'codex');", "\t\tconst scan = performance.start('sessionDiscoveryScan', 'mycli');", 1);
rep("\t\tcodex?.complete('success', { scannedSessionCount: 101 });", "\t\tscan?.complete('success', { scannedSessionCount: 101 });", 1);
rep("'codex'", "'mycli'", 18); // the remaining quoted provider ids (line 98 handled above)

if (fails.length) {
	for (const f of fails) { console.log(`FAIL - ${f}`); }
	process.exit(1);
}
const residual = text.match(/codex/gi);
if (residual) {
	console.log(`FAIL: ${residual.length} residual codex matches`);
	process.exit(1);
}
fs.writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log(`OK ${path}`);
