// Phase 5b: workbench browser-side edits (assert-all-then-apply, indexOf-based)
import { readFileSync, writeFileSync } from 'node:fs';

const edits = {
	'src/vs/workbench/contrib/chat/browser/actions/chatContinueInAction.ts': [
		{
			find: 'e.g. Copilot CLI / Codex / Claude agent-host sessions.',
			replace: 'e.g. Copilot CLI / Claude agent-host sessions.',
		},
		{
			find: 'agent host session (e.g. Copilot CLI / Codex / Claude agent host),',
			replace: 'agent host session (e.g. Copilot CLI / Claude agent host),',
		},
		{
			find: 'agent host providers (e.g. `agent-host-codex`), which are not part of',
			replace: 'agent host providers (e.g. `remote-{authority}-copilot`), which are not part of',
		},
	],
	'src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts': [
		{
			find: 'Agent-host backed sessions (Copilot CLI, Claude, Codex and the',
			replace: 'Agent-host backed sessions (Copilot CLI, Claude and the',
		},
	],
	'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatRequestOriginPart.ts': [
		{
			find: 'localize(\'chat.requestOrigin.delegation\', "Sent by Codex from another chat")',
			replace: 'localize(\'chat.requestOrigin.delegation\', "Sent by another agent")',
		},
		{
			find: 'localize(\'chat.requestOrigin.delegationAriaLabel\', "Sent by Codex from another chat. Select to open the source chat.")',
			replace: 'localize(\'chat.requestOrigin.delegationAriaLabel\', "Sent by another agent. Select to open the source chat.")',
		},
	],
	'src/vs/workbench/contrib/chat/browser/actions/chatAccessibilityHelp.ts': [
		{
			find: 'localize(\'chat.inputBlocked\', \'When another Codex app is using a conversation, a banner above the input explains how to release it. You can keep editing your draft, but sending is disabled. Quit the app holding the conversation, such as ChatGPT, or exit the Codex CLI session. Use Tab to focus Retry in the banner, then press Enter or Space to check again. Retry does not send your draft.\')',
			replace: 'localize(\'chat.inputBlocked\', \'When a conversation cannot be prepared, a banner above the input explains the problem. You can keep editing your draft, but sending is disabled. Use Tab to focus Retry in the banner, then press Enter or Space to try again. Retry does not send your draft.\')',
		},
	],
	'src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts': [
		{
			find: 'OpenAgentHostAutoApprovePickerAction, OpenAgentHostCodexApprovalsPickerAction, OpenAgentHostModePickerAction',
			replace: 'OpenAgentHostAutoApprovePickerAction, OpenAgentHostModePickerAction',
		},
		{
			find: [
				'\t\treturn sessionType === SessionType.Codex',
				'\t\t\t|| sessionType === SessionType.AgentHostClaude',
				'\t\t\t|| sessionType === SessionType.AgentHostCodex;',
			].join('\n'),
			replace: '\t\treturn sessionType === SessionType.AgentHostClaude;',
		},
		{ find: '\t\t\t[\'sessions.agentHost.runningSessionCodexApprovalsPicker\', CHAT_INPUT_COMPACT_PICKER_WIDTH],\n', replace: '' },
		{ find: '\t\t\t[OpenAgentHostCodexApprovalsPickerAction.ID, CHAT_INPUT_COMPACT_PICKER_WIDTH],\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/browser/widget/input/delegationSessionPickerActionItem.ts': [
		{ find: 'import { ICodexAccountService } from \'../../../../../services/agentHost/browser/codexAccountService.js\';\n', replace: '' },
		{ find: '\t\t@ICodexAccountService codexAccountService: ICodexAccountService,\n', replace: '' },
		{
			find: 'agentSdkSetupService, codexAccountService, harnessSwitchFeedbackSurveyService);',
			replace: 'agentSdkSetupService, harnessSwitchFeedbackSurveyService);',
		},
	],
	'src/vs/workbench/contrib/chat/browser/widget/input/sessionTargetPickerActionItem.ts': [
		{ find: 'import { hasSignedInCodexChatGPTAccount, ICodexAccountService } from \'../../../../../services/agentHost/browser/codexAccountService.js\';\n', replace: '' },
		{
			find: 'type CopilotHarnessTargetCategory = \'copilot\' | \'local\' | \'claude\' | \'codex\' | \'cloud\' | \'other\';',
			replace: 'type CopilotHarnessTargetCategory = \'copilot\' | \'local\' | \'claude\' | \'cloud\' | \'other\';',
		},
		{
			find: [
				'\tif (target === AgentSessionProviders.Codex || target === AgentSessionProviders.AgentHostCodex || provider === \'codex\') {',
				'\t\treturn \'codex\';',
				'\t}',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\tcodexAccountService: ICodexAccountService,\n', replace: '' },
		{ find: '\tconst hasProviderAccount = type === AgentSessionProviders.AgentHostCodex && hasSignedInCodexChatGPTAccount(codexAccountService.account);\n', replace: '' },
		{
			find: 'canInitializeSessionTypeOnSelection(chatEntitlementService.entitlement, allowSignedOutWhenUsable, hasAgentSdkSetup, hasProviderAccount),',
			replace: 'canInitializeSessionTypeOnSelection(chatEntitlementService.entitlement, allowSignedOutWhenUsable, hasAgentSdkSetup),',
		},
		{ find: '\t\t@ICodexAccountService protected readonly codexAccountService: ICodexAccountService,\n', replace: '' },
		{ find: '\t\t\t\t\t\tthis.codexAccountService,\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/browser/widget/input/modelPicker/modelProviderIcons.ts': [
		{ find: ' || normalized.includes(\'codex\')', replace: '' },
	],
	'src/vs/workbench/contrib/chat/common/actions/chatContextKeys.ts': [
		{
			find: 'logical Agent Host provider ID for this chat widget, e.g. `copilotcli`, `claude`, or `codex`.',
			replace: 'logical Agent Host provider ID for this chat widget, e.g. `copilotcli` or `claude`.',
		},
	],
	'src/vs/workbench/contrib/chat/common/chatErrorMessages.ts': [
		{
			find: [
				' * values are forwarded verbatim from the agent host harnesses (Copilot CLI,',
				' * Claude, Codex) over `_meta`, so they MUST stay in sync with the extension.',
			].join('\n'),
			replace: [
				' * values are forwarded verbatim from the agent host harnesses (Copilot CLI,',
				' * Claude) over `_meta`, so they MUST stay in sync with the extension.',
			].join('\n'),
		},
	],
	'src/vs/workbench/contrib/chat/common/chatService/chatServiceTelemetry.ts': [
		{
			find: 'the underlying harness/provider (e.g. copilotcli, claude, codex) so remote activity',
			replace: 'the underlying harness/provider (e.g. copilotcli, claude) so remote activity',
		},
	],
	'src/vs/workbench/contrib/chat/common/chatSessionsService.ts': [
		{ find: '\texport const Codex = \'openai-codex\';\n', replace: '' },
		{ find: '\texport const AgentHostCodex = \'agent-host-codex\';\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/common/constants.ts': [
		{ find: '\t\'openai-codex\', // Codex session custom editor scheme\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/common/editorChatUsage.ts': [
		{
			find: 'const providers = [\'local\', \'copilotcli\', \'cloud\', \'copilot\', \'claude\', \'codex\', \'codexExtension\', \'growth\', \'remoteCopilot\', \'remoteClaude\', \'remoteCodex\', \'other\'] as const;',
			replace: 'const providers = [\'local\', \'copilotcli\', \'cloud\', \'copilot\', \'claude\', \'growth\', \'remoteCopilot\', \'remoteClaude\', \'other\'] as const;',
		},
		{
			find: [
				'\t\tcase SessionType.AgentHostCodex: return \'codex\';',
				'\t\tcase SessionType.Codex: return \'codexExtension\';',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\t\tcase \'codex\': return \'remoteCodex\';\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/electron-browser/chat.contribution.ts': [
		{ find: 'import \'./codexCustomizationSettings.contribution.js\';\n', replace: '' },
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
