import { readFileSync, writeFileSync } from 'node:fs';

const root = 'C:/Users/armin/GitHub/Shideh/';
const edits = [
	['src/vs/platform/agentHost/common/agentHostEnablementService.ts',
		'for a new editor chat session. Claude and Codex selections are unaffected.',
		'for a new editor chat session. Claude selections are unaffected.'],
	['src/vs/platform/agentHost/common/otel/agentHostOTelService.ts',
		'session id (e.g. the Copilot SDK conversation id, the Claude SDK\n\t * session id, or the Codex agent host session id). No span is emitted when',
		'session id (e.g. the Copilot SDK conversation id or the Claude SDK\n\t * session id). No span is emitted when'],
	['src/vs/platform/agentHost/common/reasoningEffort.ts',
		'agent-host provider. Individual providers expose a subset:\n * - Codex: model-dependent, currently up to `\'ultra\'`\n * - Copilot / Claude: model-dependent, currently up to `\'max\'`',
		'agent-host provider. Individual providers expose a subset:\n * - Copilot / Claude: model-dependent, currently up to `\'max\'`'],
	['src/vs/platform/agentHost/common/meta/agentSnapshotAttachmentMeta.ts',
		'note), while Codex/Claude annotate the path reference inline as read-only.',
		'note), while Claude annotates the path reference inline as read-only.'],
	['src/vs/platform/agentHost/common/agentSdkSetup.ts',
		'AHP proper, alongside `vscode.codexAccount`: the protocol files here are',
		'AHP proper: the protocol files here are'],
	['src/vs/platform/agentHost/common/agentHostCustomizationConfig.ts',
		'authentication (for example Codex with ChatGPT authentication or Claude in native mode with your own Anthropic credentials)',
		'authentication (for example Claude in native mode with your own Anthropic credentials)'],
];

const failures = [];
for (const [file, find, replace] of edits) {
	const text = readFileSync(root + file, 'utf8');
	let f = find;
	let r = replace;
	if (text.includes('\r\n')) {
		f = f.replaceAll('\n', '\r\n');
		r = r.replaceAll('\n', '\r\n');
	}
	const count = text.split(f).length - 1;
	if (count !== 1) {
		failures.push(`${file}: matches=${count}`);
		continue;
	}
	writeFileSync(root + file, text.replace(f, r), 'utf8');
	console.log('ok ' + file);
}
if (failures.length) {
	console.log('FAILURES:');
	for (const f of failures) console.log('  ' + f);
	process.exitCode = 1;
}
