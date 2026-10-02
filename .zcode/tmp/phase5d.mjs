// Phase 5d: chat.shared.contribution + chatSessions.contribution (assert-all-then-apply)
import { readFileSync, writeFileSync } from 'node:fs';

const edits = {
	'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts': [
		{
			find: 'AgentHostSdkSandboxWindowsEnabledSettingId, CodexPreferAgentHostEditorSettingId } from',
			replace: 'AgentHostSdkSandboxWindowsEnabledSettingId } from',
		},
		{ find: 'import { CodexStatusBarEntry } from \'./chatStatus/codexStatusEntry.js\';\n', replace: '' },
		{
			find: [
				'\t\t[CodexPreferAgentHostEditorSettingId]: {',
				'\t\t\ttype: \'boolean\',',
				'\t\t\tmarkdownDescription: nls.localize(\'chat.editor.codex.preferAgentHost\', "When enabled, Codex sessions opened from the regular workbench (sidebar chat) run inside the agent host process using the Codex App Server instead of the OpenAI extension. Only one Codex implementation surfaces per window. Requires `#chat.agentHost.codexAgent.enabled#`."),',
				'\t\t\tdefault: product.quality !== \'stable\',',
				'\t\t\ttags: [\'experimental\'],',
				'\t\t\texperiment: { mode: \'startup\' },',
				'\t\t},',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: 'Agents usable without GitHub (for example Codex with ChatGPT authentication or Claude in native mode with your own Anthropic credentials) work while signed out;',
			replace: 'Agents usable without GitHub (for example Claude in native mode with your own Anthropic credentials) work while signed out;',
		},
		{ find: 'registerWorkbenchContribution2(CodexStatusBarEntry.ID, CodexStatusBarEntry, WorkbenchPhase.BlockRestore);\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts': [
		{
			find: [
				'import { AGENT_HOST_ENABLED_CONTEXT_KEY } from \'../../../../../platform/agentHost/common/agentHostEnablementService.js\';',
				'import { AgentHostCodexAgentEnabledSettingId, CodexPreferAgentHostEditorSettingId } from \'../../../../../platform/agentHost/common/agentService.js\';',
				'import { IsSessionsWindowContext } from \'../../../../common/contextkeys.js\';',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'const codexExtensionHostAvailableWhen = ContextKeyExpr.and(',
				'\tIsSessionsWindowContext.negate(),',
				'\tContextKeyExpr.or(',
				'\t\tAGENT_HOST_ENABLED_CONTEXT_KEY.negate(),',
				'\t\tContextKeyExpr.not(`config.${AgentHostCodexAgentEnabledSettingId}`),',
				'\t\tContextKeyExpr.not(`config.${CodexPreferAgentHostEditorSettingId}`),',
				'\t),',
				')!;',
				'',
				'export function applyCodexAgentHostPreference(contribution: IChatSessionsExtensionPoint): IChatSessionsExtensionPoint {',
				'\tif (contribution.type !== SessionType.Codex) {',
				'\t\treturn contribution;',
				'\t}',
				'',
				'\tconst contributedWhen = contribution.when ? ContextKeyExpr.deserialize(contribution.when) : undefined;',
				'\treturn {',
				'\t\t...contribution,',
				'\t\twhen: ContextKeyExpr.and(contributedWhen, codexExtensionHostAvailableWhen)?.serialize(),',
				'\t};',
				'}',
				'',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\t\tcontribution = applyCodexAgentHostPreference(contribution);\n', replace: '' },
		{
			find: '// A non-delegating contribution (e.g. the Codex editor session) creates',
			replace: '// A non-delegating contribution (e.g. a contributed editor session) creates',
		},
		{
			find: [
				'\t\t// resources, so a session type usable without GitHub (Claude native, Codex on',
				'\t\t// OpenAI) reports `false` while it is. Re-evaluated whenever the contribution\'s',
			].join('\n'),
			replace: [
				'\t\t// resources, so a session type usable without GitHub (Claude native) reports',
				'\t\t// `false` while it is. Re-evaluated whenever the contribution\'s',
			].join('\n'),
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
