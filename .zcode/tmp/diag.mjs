import { readFileSync } from 'node:fs';
const file = 'src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatInputState.ts';
const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');
const seg = lines.slice(92, 101).join('\n'); // lines 93-101
const find = [
	'\t\t\ticon: locked || checking ? Codicon.lock : undefined,',
	'\t\t\tmessage: checking ? localize(\'agentHost.checkingConversationTitle\', "Checking Conversation") : locked ? localize(\'agentHost.conversationInUse\', "This chat is open in another app") : localize(\'agentHost.conversationUnavailable\', "Conversation Unavailable"),',
	'\t\t\tdescription: checking',
	'\t\t\t\t? localize(\'agentHost.checkingConversation\', "Checking whether this conversation is available…")',
	'\t\t\t\t: locked ? new MarkdownString()',
	'\t\t\t\t\t.appendMarkdown(escapeMarkdownSyntaxTokens(localize(\'agentHost.codexWriterLockExplanation\', "The other app has locked this chat. It must release the lock before you can continue here.")))',
	"\t\t\t\t\t.appendMarkdown('  \n')",
	'\t\t\t\t\t.appendMarkdown(escapeMarkdownSyntaxTokens(localize(\'agentHost.codexWriterLockRetry\', "Quit the other app (e.g. ChatGPT, Codex CLI), then retry.")))',
	'\t\t\t\t\t: localize(\'agentHost.prepareChatFailed\', "Couldn\'t prepare this conversation. Select Retry to try again. {0}", error?.message ?? \'\'),',
].join('\n');
console.log('seg==find:', seg === find, 'segLen:', seg.length, 'findLen:', find.length);
const a = seg.split('\n'), b = find.split('\n');
for (let i = 0; i < Math.max(a.length, b.length); i++) {
	if (a[i] !== b[i]) {
		console.log('DIFF line', i);
		console.log('file :', JSON.stringify(a[i]));
		console.log('find :', JSON.stringify(b[i]));
		for (let j = 0; j < Math.max(a[i]?.length ?? 0, b[i]?.length ?? 0); j++) {
			if ((a[i] ?? '')[j] !== (b[i] ?? '')[j]) {
				console.log('  first char diff at', j, 'file:', (a[i] ?? '')[j]?.charCodeAt(0), 'find:', (b[i] ?? '')[j]?.charCodeAt(0));
				break;
			}
		}
	}
}
