// Phase 5a: agentSessions + agentHost workbench files (assert-all-then-apply, indexOf-based)
import { readFileSync, writeFileSync } from 'node:fs';

const edits = {
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentSessions.ts': [
		{ find: '\tCodex = SessionType.Codex,\n', replace: '' },
		{ find: '\tAgentHostCodex = SessionType.AgentHostCodex,\n', replace: '' },
		{
			find: [
				'\t\tcase AgentSessionProviders.Cloud:',
				'\t\tcase AgentSessionProviders.Codex:',
				'\t\tcase AgentSessionProviders.AgentHostCopilot:',
				'\t\tcase AgentSessionProviders.AgentHostClaude:',
				'\t\tcase AgentSessionProviders.AgentHostCodex:',
				'\t\t\treturn type;',
			].join('\n'),
			replace: [
				'\t\tcase AgentSessionProviders.Cloud:',
				'\t\tcase AgentSessionProviders.AgentHostCopilot:',
				'\t\tcase AgentSessionProviders.AgentHostClaude:',
				'\t\t\treturn type;',
			].join('\n'),
		},
		{
			find: [
				"\t\tcase AgentSessionProviders.Codex:",
				'\t\tcase AgentSessionProviders.AgentHostCodex:',
				"\t\t\treturn 'Codex';",
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\t\tcase AgentSessionProviders.Codex:',
				'\t\tcase AgentSessionProviders.AgentHostCodex:',
				'\t\t\treturn Codicon.openai;',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\t\tcase AgentSessionProviders.AgentHostClaude:',
				'\t\tcase AgentSessionProviders.Codex:',
				'\t\tcase AgentSessionProviders.AgentHostCodex:',
				'\t\tcase AgentSessionProviders.Growth:',
				'\t\t\treturn false;',
			].join('\n'),
			replace: [
				'\t\tcase AgentSessionProviders.AgentHostClaude:',
				'\t\tcase AgentSessionProviders.Growth:',
				'\t\t\treturn false;',
			].join('\n'),
		},
		{
			find: [
				'\t\t\treturn true;',
				'\t\tcase AgentSessionProviders.Codex:',
				'\t\tcase AgentSessionProviders.Growth:',
				'\t\t\treturn false;',
			].join('\n'),
			replace: [
				'\t\t\treturn true;',
				'\t\tcase AgentSessionProviders.Growth:',
				'\t\t\treturn false;',
			].join('\n'),
		},
		{
			find: [
				'\t\tcase AgentSessionProviders.Codex:',
				'\t\t\treturn localize(\'chat.session.providerDescription.codex\', "Open a new Codex session using the Codex extension from OpenAI. Codex sessions can be managed from the chat sessions view.");',
				'\t\tcase AgentSessionProviders.AgentHostCodex:',
				'\t\t\treturn localize(\'chat.session.providerDescription.agentHostCodex\', "Work with OpenAI\'s Codex agent using your ChatGPT or GitHub Copilot subscription.");',
				'',
			].join('\n'),
			replace: '',
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatContribution.ts': [
		{ find: 'import { CHATGPT_SUBSCRIPTION_MODEL_SOURCE_ID } from \'../../../../../../platform/agentHost/common/agentModelSource.js\';\n', replace: '' },
		{ find: 'import { languageModelSourcePresentationRegistry } from \'../../../common/languageModelSourcePresentation.js\';\n', replace: '' },
		{
			find: [
				'languageModelSourcePresentationRegistry.register({',
				'\townerVendor: \'agent-host-codex\',',
				'\tsourceId: CHATGPT_SUBSCRIPTION_MODEL_SOURCE_ID,',
				'\tlabel: localize(\'agentHostModelSource.chatGPT.label\', "ChatGPT"),',
				'\ticon: Codicon.openai,',
				'\tdescription: localize(\'agentHostModelSource.chatGPT.description\', "Models provided by your ChatGPT subscription"),',
				'});',
				'',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\t\t\t// Copilot resource `required: false` (Claude in native mode, Codex on',
				'\t\t\t// OpenAI) is usable without signing in. Falls back to "required" until the',
			].join('\n'),
			replace: [
				'\t\t\t// Copilot resource `required: false` (Claude in native mode) is usable',
				'\t\t\t// without signing in. Falls back to "required" until the',
			].join('\n'),
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatInputState.ts': [
		{ find: 'import { escapeMarkdownSyntaxTokens, MarkdownString } from \'../../../../../../base/common/htmlContent.js\';\n', replace: '' },
		{
			find: [
				'export function codexWriterLockMessage(): string {',
				'\treturn localize(\'agentHost.codexWriterLock\', "This conversation is in use by another Codex app. Let any running task finish, then quit the app holding it open, such as ChatGPT, or exit the Codex CLI session.");',
				'}',
				'',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\t\tconst locked = error?.errorType === \'CodexThreadInUse\';\n', replace: '' },
		{
			find: [
				'\t\t\ticon: locked || checking ? Codicon.lock : undefined,',
				'\t\t\tmessage: checking ? localize(\'agentHost.checkingConversationTitle\', "Checking Conversation") : locked ? localize(\'agentHost.conversationInUse\', "This chat is open in another app") : localize(\'agentHost.conversationUnavailable\', "Conversation Unavailable"),',
				'\t\t\tdescription: checking',
				'\t\t\t\t? localize(\'agentHost.checkingConversation\', "Checking whether this conversation is available…")',
				'\t\t\t\t: locked ? new MarkdownString()',
				'\t\t\t\t\t.appendMarkdown(escapeMarkdownSyntaxTokens(localize(\'agentHost.codexWriterLockExplanation\', "The other app has locked this chat. It must release the lock before you can continue here.")))',
				"\t\t\t\t\t.appendMarkdown('  \\n')",
				'\t\t\t\t\t.appendMarkdown(escapeMarkdownSyntaxTokens(localize(\'agentHost.codexWriterLockRetry\', "Quit the other app (e.g. ChatGPT, Codex CLI), then retry.")))',
				'\t\t\t\t: localize(\'agentHost.prepareChatFailed\', "Couldn\'t prepare this conversation. Select Retry to try again. {0}", error?.message ?? \'\'),',
			].join('\n'),
			replace: [
				'\t\t\ticon: checking ? Codicon.lock : undefined,',
				'\t\t\tmessage: checking ? localize(\'agentHost.checkingConversationTitle\', "Checking Conversation") : localize(\'agentHost.conversationUnavailable\', "Conversation Unavailable"),',
				'\t\t\tdescription: checking',
				'\t\t\t\t? localize(\'agentHost.checkingConversation\', "Checking whether this conversation is available…")',
				'\t\t\t\t: localize(\'agentHost.prepareChatFailed\', "Couldn\'t prepare this conversation. Select Retry to try again. {0}", error?.message ?? \'\'),',
			].join('\n'),
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatInputPicker.ts': [
		{ find: 'import { getCodexApprovalsPickerListOptions } from \'../../../../../../platform/agentHost/browser/codexApprovalsPicker.js\';\n', replace: '' },
		{ find: 'import { CodexSessionConfigKey } from \'../../../../../../platform/agentHost/common/codexSessionConfigKeys.js\';\n', replace: '' },
		{ find: 'const CODEX_APPROVALS_LEARN_MORE_URL = \'https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it\';\n', replace: '' },
		{
			find: [
				'\tif (property === CodexSessionConfigKey.PermissionsPreset && typeof value === \'string\') {',
				'\t\tswitch (value) {',
				"\t\t\tcase 'default': return Codicon.shield;",
				"\t\t\tcase 'auto-review': return Codicon.sparkle;",
				"\t\t\tcase 'full-access': return Codicon.warning;",
				'\t\t}',
				'\t}',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\tif (property === CodexSessionConfigKey.PermissionsPreset) {',
				'\t\treturn getEnumValueDescription(schema, value) ?? schema.description ?? schema.title;',
				'\t}',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\tif (property === CodexSessionConfigKey.PermissionsPreset) {',
				'\t\treturn CODEX_APPROVALS_LEARN_MORE_URL;',
				'\t}',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\t\tcase CodexSessionConfigKey.PermissionsPreset:',
				'\t\t\treturn getCodexApprovalsPickerListOptions();',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: '\tCodexSessionConfigKey.PermissionsPreset,\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatInputPicker.contribution.ts': [
		{ find: 'import { CodexSessionConfigKey } from \'../../../../../../platform/agentHost/common/codexSessionConfigKeys.js\';\n', replace: '' },
		{ find: ' *   0.9  OpenAgentHostCodexApprovalsPickerAction (NEW — Codex Approvals)\n', replace: '' },
		{
			find: [
				'export class OpenAgentHostCodexApprovalsPickerAction extends Action2 {',
				'\tstatic readonly ID = \'workbench.action.chat.openAgentHostCodexApprovalsPicker\';',
				'\tconstructor() {',
				'\t\tsuper({',
				'\t\t\tid: OpenAgentHostCodexApprovalsPickerAction.ID,',
				'\t\t\ttitle: localize2(\'agentHost.codexApprovalsPicker\', "Approvals"),',
				'\t\t\tf1: false,',
				'\t\t\tprecondition: ChatContextKeys.enabled,',
				'\t\t\tmenu: [{',
				'\t\t\t\tid: MenuId.ChatInputSecondary,',
				'\t\t\t\tgroup: \'navigation\',',
				'\t\t\t\torder: 0.9,',
				'\t\t\t\twhen: ChatContextKeyExprs.isAgentHostSession,',
				'\t\t\t}],',
				'\t\t});',
				'\t}',
				'\toverride async run(): Promise<void> { /* the action view item handles interaction */ }',
				'}',
				'',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: [
				'\t\tcase OpenAgentHostCodexApprovalsPickerAction.ID:',
				'\t\t\treturn CodexSessionConfigKey.PermissionsPreset;',
				'',
			].join('\n'),
			replace: '',
		},
		{ find: 'registerAction2(OpenAgentHostCodexApprovalsPickerAction);\n', replace: '' },
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostMcpServerSupport.ts': [
		{
			find: 'const AGENT_HOST_PROVIDERS_WITH_GITHUB_MCP = new Set([\'copilotcli\', \'claude\', \'codex\']);',
			replace: 'const AGENT_HOST_PROVIDERS_WITH_GITHUB_MCP = new Set([\'copilotcli\', \'claude\']);',
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostLanguageModelProvider.ts': [
		{
			find: [
				' * available" state when no models are listed. Other harnesses (Claude,',
				' * Codex, …) require an explicit model.',
			].join('\n'),
			replace: [
				' * available" state when no models are listed. Other harnesses (Claude, …)',
				' * require an explicit model.',
			].join('\n'),
		},
		{
			find: ' * `\'claude\'`, `\'codex\'`), not the `agent-host-<provider>` session type.',
			replace: ' * `\'claude\'`), not the `agent-host-<provider>` session type.',
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostProtectedResourcesService.ts': [
		{
			find: [
				' * whether a session type requires GitHub Copilot sign-in right now: Claude in',
				' * native mode / Codex on OpenAI advertise the Copilot resource with',
				' * `required: false`, so they are usable without signing in) and filter',
			].join('\n'),
			replace: [
				' * whether a session type requires GitHub Copilot sign-in right now: Claude in',
				' * native mode advertises the Copilot resource with `required: false`, so it',
				' * is usable without signing in) and filter',
			].join('\n'),
		},
	],
	'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts': [
		{
			find: 'AgentSession, CODEX_AGENT_PROVIDER_ID, type IAgentConnection',
			replace: 'AgentSession, type IAgentConnection',
		},
		{
			find: 'import { AgentHostChatInputState, codexWriterLockMessage } from \'./agentHostChatInputState.js\';',
			replace: 'import { AgentHostChatInputState } from \'./agentHostChatInputState.js\';',
		},
		{
			find: [
				'\t\tif (error.errorType === \'CodexThreadInUse\') {',
				'\t\t\treturn {',
				'\t\t\t\tmessage: localize(\'agentHost.codexThreadInUse\', "{0} Then send your message again in VS Code. Your message has not been sent.", codexWriterLockMessage()),',
				'\t\t\t\tisExpectedError: true,',
				'\t\t\t};',
				'\t\t}',
				'',
			].join('\n'),
			replace: '',
		},
		{
			find: ' * an embedded resource. Copilot CLI and Codex both run as separate processes with only disk',
			replace: ' * an embedded resource. Copilot CLI runs as a separate process with only disk',
		},
		{
			find: 'return this._config.provider === SessionType.CopilotCLI || this._config.provider === CODEX_AGENT_PROVIDER_ID;',
			replace: 'return this._config.provider === SessionType.CopilotCLI;',
		},
		{
			find: '// Copilot CLI and Codex can\'t read unsaved content from disk, so inline the live buffer; drop unreadable schemes.',
			replace: '// Copilot CLI can\'t read unsaved content from disk, so inline the live buffer; drop unreadable schemes.',
		},
	],
};

let anyFailed = false;
for (const [file, list] of Object.entries(edits)) {
	const raw = readFileSync(file, 'utf8');
	const crlf = raw.includes('\r\n');
	let text = raw.replace(/\r\n/g, '\n');

	const counts = list.map((e) => {
		let n = 0;
		let idx = text.indexOf(e.find);
		while (idx !== -1) {
			n++;
			idx = text.indexOf(e.find, idx + 1);
		}
		return n;
	});
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
	console.error('ASSERTIONS FAILED — no partial writes for failed files');
	process.exit(1);
}
