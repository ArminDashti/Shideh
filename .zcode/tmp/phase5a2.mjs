import { readFileSync, writeFileSync } from 'node:fs';
const BS = String.fromCharCode(92); // backslash
const file = 'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatInputState.ts';
const list = [
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
			'\t\t\t\t\t.appendMarkdown(\'  ' + BS + 'n\')',
			'\t\t\t\t\t.appendMarkdown(escapeMarkdownSyntaxTokens(localize(\'agentHost.codexWriterLockRetry\', "Quit the other app (e.g. ChatGPT, Codex CLI), then retry.")))',
			'\t\t\t\t\t: localize(\'agentHost.prepareChatFailed\', "Couldn\'t prepare this conversation. Select Retry to try again. {0}", error?.message ?? \'\'),',
		].join('\n'),
		replace: [
			'\t\t\ticon: checking ? Codicon.lock : undefined,',
			'\t\t\tmessage: checking ? localize(\'agentHost.checkingConversationTitle\', "Checking Conversation") : localize(\'agentHost.conversationUnavailable\', "Conversation Unavailable"),',
			'\t\t\tdescription: checking',
			'\t\t\t\t? localize(\'agentHost.checkingConversation\', "Checking whether this conversation is available…")',
			'\t\t\t\t: localize(\'agentHost.prepareChatFailed\', "Couldn\'t prepare this conversation. Select Retry to try again. {0}", error?.message ?? \'\'),',
		].join('\n'),
	},
];
const raw = readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let text = raw.replace(/\r\n/g, '\n');
const counts = list.map((e) => text.split(e.find).length - 1);
if (counts.some((n) => n !== 1)) { console.error('FAIL counts:', counts); process.exit(1); }
for (const e of list) {
	const idx = text.indexOf(e.find);
	text = text.slice(0, idx) + e.replace + text.slice(idx + e.find.length);
}
if (crlf) text = text.replace(/\n/g, '\r\n');
writeFileSync(file, text);
console.log('OK inputState', list.length, 'edits');
