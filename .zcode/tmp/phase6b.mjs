import { readFileSync, writeFileSync } from 'node:fs';
const BS = String.fromCharCode(92);
const edits = {
	'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts': [
		{ find: '\t// [GeneralShellType.Codex, /' + BS + 'bcodex' + BS + 'b/i], // codex does not report osc title.\n', replace: '' },
		{ find: '\t\tGeneralShellType.Codex,\n', replace: '' },
	],
	'src/vs/platform/policy/common/copilotManagedSettings.ts': [
		{
			find: [
				' * `value` callback shared by the third-party agent harness policies (`Claude3PIntegration`,',
				' * `Codex3PIntegration`): forces the harness off when the account disables chat preview features,',
			].join('\n'),
			replace: [
				' * `value` callback shared by the third-party agent harness policies (e.g. `Claude3PIntegration`):',
				' * forces the harness off when the account disables chat preview features,',
			].join('\n'),
		},
		{
			find: [
				' * Managed settings are composed and enforced by the Copilot runtime and never reach the Claude or',
				' * Codex harnesses, so leaving them available would hand a governed user an ungoverned path around',
			].join('\n'),
			replace: [
				' * Managed settings are composed and enforced by the Copilot runtime and never reach third-party',
				' * harnesses, so leaving them available would hand a governed user an ungoverned path around',
			].join('\n'),
		},
	],
};
let failed = false;
for (const [file, list] of Object.entries(edits)) {
	const raw = readFileSync(file, 'utf8');
	const crlf = raw.includes('\r\n');
	let text = raw.replace(/\r\n/g, '\n');
	const counts = list.map((e) => text.split(e.find).length - 1);
	const bad = counts.map((n, i) => [n, i]).filter(([n]) => n !== 1);
	if (bad.length) {
		failed = true;
		for (const [n, i] of bad) console.error(`FAIL ${file} #${i + 1}: ${n} matches`);
		continue;
	}
	for (const e of list) {
		const idx = text.indexOf(e.find);
		text = text.slice(0, idx) + e.replace + text.slice(idx + e.find.length);
	}
	if (crlf) text = text.replace(/\n/g, '\r\n');
	writeFileSync(file, text);
	console.log('OK', file, list.length, 'edits');
}
if (failed) process.exit(1);
