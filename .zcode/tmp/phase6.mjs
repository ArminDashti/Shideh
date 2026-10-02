// Phase 6: terminal + platform misc (assert-all-then-apply)
import { readFileSync, writeFileSync } from 'node:fs';
const BS = String.fromCharCode(92); // backslash

const edits = {
	'src/vs/platform/terminal/common/terminal.ts': [
		{ find: '\tCodex = \'codex\',\n', replace: '' },
	],
	'src/vs/platform/terminal/node/windowsShellHelper.ts': [
		{ find: '\t{ regex: /[' + BS + BS + '/]codex[' + BS + BS + '/]/i, executable: \'codex.exe\' },\n', replace: '' },
		{
			find: [
				'\t\t\tcase \'codex.exe\':',
				'\t\t\t\treturn GeneralShellType.Codex;',
				'',
			].join('\n'),
			replace: '',
		},
	],
	'src/vs/platform/terminal/node/terminalProcess.ts': [
		{ find: '\t[\'codex\', GeneralShellType.Codex],\n', replace: '' },
	],
	'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts': [
		{ find: '\t// [GeneralShellType.Codex, /' + BS + 'bcodex' + BS + 'bi], // codex does not report osc title.\n', replace: '' },
		{ find: '\t\tGeneralShellType.Codex,\n', replace: '' },
	],
	'src/vs/workbench/contrib/terminalContrib/stickyScroll/common/terminalStickyScrollConfiguration.ts': [
		{ find: '\t\t\t\'codex\',\n', replace: '' },
	],
	'src/vs/workbench/contrib/terminalContrib/telemetry/browser/terminalTelemetry.ts': [
		{ find: '\tCodex = \'codex\',\n', replace: '' },
	],
	'src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/runInTerminalToolTelemetry.ts': [
		{ find: '\t\'codex\',\n', replace: '' },
	],
	'src/vs/platform/chat/common/chatSettings.ts': [
		{
			find: [
				'\t\'**/.codex/agents/**\': false,',
				'\t\'**/.codex/config.toml\': false,',
				'\t\'**/.codex/hooks.json\': false,',
				'',
			].join('\n'),
			replace: '',
		},
	],
	'src/vs/platform/policy/common/copilotManagedSettings.ts': [
		{
			find: [
				'\t * `value` callback shared by the third-party agent harness policies (`Claude3PIntegration`,',
				'\t * `Codex3PIntegration`): forces the harness off when the account disables chat preview features,',
			].join('\n'),
			replace: [
				'\t * `value` callback shared by the third-party agent harness policies (e.g. `Claude3PIntegration`):',
				'\t * forces the harness off when the account disables chat preview features,',
			].join('\n'),
		},
		{
			find: [
				'\t * Managed settings are composed and enforced by the Copilot runtime and never reach the Claude or',
				'\t * Codex harnesses, so leaving them available would hand a governed user an ungoverned path around',
			].join('\n'),
			replace: [
				'\t * Managed settings are composed and enforced by the Copilot runtime and never reach third-party',
				'\t * harnesses, so leaving them available would hand a governed user an ungoverned path around',
			].join('\n'),
		},
	],
	'src/vs/platform/telemetry/common/languageModelToolTelemetry.ts': [
		{
			find: 'The agent host provider that invoked the tool (e.g. copilotcli, claude, codex), if applicable.',
			replace: 'The agent host provider that invoked the tool (e.g. copilotcli, claude), if applicable.',
		},
	],
	'src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts': [
		{
			find: 'such as Claude Code, Codex, Command Code, GitHub Copilot CLI, and Gemini CLI',
			replace: 'such as Claude Code, Command Code, GitHub Copilot CLI, and Gemini CLI',
		},
	],
};

let anyFailed = false;
for (const [file, list] of Object.entries(edits)) {
	const raw = readFileSync(file, 'utf8');
	const crlf = raw.includes('\r\n');
	let text = raw.replace(/\r\n/g, '\n');

	const counts = list.map((e) => text.split(e.find).length - 1);
	const bad = counts.map((n, i) => [n, i]).filter(([n]) => n !== 1);
	if (bad.length) {
		anyFailed = true;
		for (const [n, i] of bad) {
			console.error(`FAIL ${file} edit #${i + 1}: ${n} matches\n---find---\n${JSON.stringify(list[i].find)}\n---`);
		}
		continue;
	}
	for (const e of list) {
		const idx = text.indexOf(e.find);
		text = text.slice(0, idx) + e.replace + text.slice(idx + e.find.length);
	}
	if (crlf) text = text.replace(/\n/g, '\r\n');
	writeFileSync(file, text);
	console.log(`OK   ${file} (${list.length} edits)`);
}
if (anyFailed) {
	console.error('ASSERTIONS FAILED — failed files were not written');
	process.exit(1);
}
