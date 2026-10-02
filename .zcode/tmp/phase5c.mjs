// Phase 5c: relauncher, agentSdkSetupService, globalCompositeBar (assert-all-then-apply)
import { readFileSync, writeFileSync } from 'node:fs';

const edits = {
	'src/vs/workbench/contrib/relauncher/browser/relauncher.contribution.ts': [
		{ find: '\t\t\tcodexAgent?: { enabled?: boolean };\n', replace: '' },
		{ find: '\t\teditor?: { codex?: { preferAgentHost?: boolean } };\n', replace: '' },
		{ find: '\t\t\'chat.editor.codex.preferAgentHost\',\n', replace: '' },
		{ find: '\tprivate readonly editorCodexPreferAgentHost = new ChangeObserver(\'boolean\');\n', replace: '' },
		{ find: '\t\tprocessChanged(this.editorCodexPreferAgentHost.handleChange(config.chat?.editor?.codex?.preferAgentHost));\n', replace: '' },
	],
	'src/vs/workbench/services/agentHost/browser/agentSdkSetupService.ts': [
		{ find: 'import { ICodexAccountService } from \'./codexAccountService.js\';\n', replace: '' },
		{
			find: 'comment: \'The agent whose setup this step belongs to, e.g. claude or codex.\'',
			replace: 'comment: \'The agent whose setup this step belongs to, e.g. claude.\'',
		},
		{
			find: 'comment: \'Tracks how far a signed-out user gets through setting up their own Claude or Codex account.\'',
			replace: 'comment: \'Tracks how far a signed-out user gets through setting up their own Claude account.\'',
		},
		{ find: '\t\t@ICodexAccountService private readonly _codexAccountService: ICodexAccountService,\n', replace: '' },
		{
			find: [
				'\tsignIn(agent: string): void {',
				'\t\t// Codex is the only agent with an in-app sign-in today, and comparing against',
				'\t\t// the service\'s own `agent` rather than a literal keeps `\'codex\'` out of the',
				'\t\t// workbench. A second such agent turns this comparison into a lookup.',
				'\t\tif (agent !== this._codexAccountService.agent) {',
				'\t\t\treturn;',
				'\t\t}',
				'\t\tthis._reportStep(agent, \'signInClicked\');',
				'\t\tthis._codexAccountService.signIn();',
				'\t}',
			].join('\n'),
			replace: [
				'\tsignIn(agent: string): void {',
				'\t\tthis._reportStep(agent, \'signInClicked\');',
				'\t}',
			].join('\n'),
		},
	],
	'src/vs/workbench/browser/parts/globalCompositeBar.ts': [
		{ find: 'import { createCodexAccountMenuActions, ICodexAccountService, shouldShowCodexAccount } from \'../../services/agentHost/browser/codexAccountService.js\';\n', replace: '' },
		{ find: '\t\t@ICodexAccountService private readonly codexAccountService: ICodexAccountService,\n', replace: '' },
		{
			find: [
				'\t\tconst codexAccountActions = createCodexAccountMenuActions(this.codexAccountService, shouldShowCodexAccount(this.configurationService, false));',
				'\t\tif (codexAccountActions.length) {',
				'\t\t\tif (menus.length) {',
				'\t\t\t\tmenus.push(new Separator());',
				'\t\t\t}',
				'\t\t\tfor (const action of codexAccountActions) {',
				'\t\t\t\tmenus.push(action instanceof Action ? disposables.add(action) : action);',
				'\t\t\t}',
				'\t\t}',
				'',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\t\t@ICodexAccountService codexAccountService: ICodexAccountService,\n', replace: '' },
		{
			find: 'commandService, codexAccountService, defaultAccountService);',
			replace: 'commandService, defaultAccountService);',
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
			console.error(`FAIL ${file} edit #${i + 1}: ${n} matches\n---find---\n${list[i].find}\n---`);
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
