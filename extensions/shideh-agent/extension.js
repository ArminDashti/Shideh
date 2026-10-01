'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const VERSION = '1.0.0';
const USER_AGENT = `shideh/${VERSION}`;
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const SECRET_KEY = 'shideh.opencodeGo.apiKey';
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CHARS = 12000;

function baseUrlOf(configValue) {
	const raw = (configValue || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
	return raw || DEFAULT_BASE_URL;
}

function toOpenAiMessages(messages) {
	const out = [{
		role: 'system',
		content: 'You are Shideh, a coding agent in the user editor. Use the tools to read files, edit files, list directories, and run terminal commands. Prefer small edits. Stay inside the workspace.'
	}];
	for (const message of messages) {
		const role = message.role === 2 || message.role === 'assistant' ? 'assistant' : 'user';
		const parts = Array.isArray(message.content) ? message.content : [{ kind: 'text', value: String(message.content ?? '') }];
		const text = [];
		const toolCalls = [];
		const toolResults = [];
		for (const part of parts) {
			if (part.callId && part.name && part.input && !part.content) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: { name: part.name, arguments: JSON.stringify(part.input) }
				});
			} else if (part.callId && part.content) {
				toolResults.push({
					role: 'tool',
					tool_call_id: part.callId,
					content: textOf(part.content).slice(0, MAX_TOOL_CHARS)
				});
			} else if (typeof part.value === 'string') {
				text.push(part.value);
			}
		}
		if (toolResults.length) {
			out.push(...toolResults);
			continue;
		}
		const body = { role, content: text.join('') || null };
		if (toolCalls.length) {
			body.tool_calls = toolCalls;
		}
		if (body.content || body.tool_calls) {
			out.push(body);
		}
	}
	return out;
}

function textOf(content) {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return String(content ?? '');
	}
	return content.map(part => typeof part.value === 'string' ? part.value : '').join('');
}

function parseSse(body) {
	const text = [];
	const calls = new Map();
	for (const line of body.split(/\r?\n/)) {
		if (!line.startsWith('data:')) {
			continue;
		}
		const data = line.slice(5).trim();
		if (!data || data === '[DONE]') {
			continue;
		}
		let json;
		try {
			json = JSON.parse(data);
		} catch {
			continue;
		}
		const choice = json.choices && json.choices[0];
		const delta = choice && (choice.delta || choice.message);
		if (!delta) {
			continue;
		}
		if (typeof delta.content === 'string') {
			text.push(delta.content);
		}
		for (const call of delta.tool_calls || []) {
			const index = call.index ?? 0;
			const current = calls.get(index) || { id: '', name: '', arguments: '' };
			if (call.id) {
				current.id = call.id;
			}
			if (call.function?.name) {
				current.name += call.function.name;
			}
			if (call.function?.arguments) {
				current.arguments += call.function.arguments;
			}
			calls.set(index, current);
		}
	}
	return {
		text: text.join(''),
		toolCalls: [...calls.values()].filter(call => call.name)
	};
}

function selfCheck() {
	const messages = toOpenAiMessages([
		{ role: 1, content: [{ value: 'edit main.js' }] },
		{
			role: 2,
			content: [
				{ value: 'Looking.' },
				{ callId: 'c1', name: 'shideh_readFile', input: { path: 'main.js' } }
			]
		},
		{ role: 1, content: [{ callId: 'c1', content: [{ value: 'const a = 1;' }] }] }
	]);
	if (messages[0].role !== 'system' || !messages.some(item => item.tool_calls)) {
		throw new Error('toOpenAiMessages dropped the coding-agent tool call');
	}
	const parsed = parseSse([
		'data: {"choices":[{"delta":{"content":"Hi"}}]}',
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"shideh_readFile","arguments":""}}]}}]}',
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}',
		'data: [DONE]'
	].join('\n'));
	if (parsed.text !== 'Hi' || parsed.toolCalls[0].name !== 'shideh_readFile' || !parsed.toolCalls[0].arguments.includes('a.txt')) {
		throw new Error('parseSse failed to assemble text and tool calls');
	}
	console.log('shideh-agent self-check ok');
}

async function readApiKey(secrets, silent) {
	if (process.env.OPENCODE_API_KEY) {
		return process.env.OPENCODE_API_KEY;
	}
	const stored = await secrets.get(SECRET_KEY);
	if (stored) {
		return stored;
	}
	const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
	try {
		const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
		const key = auth['opencode-go'] && auth['opencode-go'].key;
		if (typeof key === 'string' && key) {
			await secrets.store(SECRET_KEY, key);
			return key;
		}
	} catch {
		// Missing local OpenCode auth is fine; prompt next.
	}
	if (silent) {
		return '';
	}
	const vscode = require('vscode');
	const typed = await vscode.window.showInputBox({
		title: 'OpenCode Go API key',
		prompt: 'Paste the OpenCode Go API key. It stays in secret storage.',
		password: true,
		ignoreFocusOut: true
	});
	if (!typed) {
		return '';
	}
	await secrets.store(SECRET_KEY, typed);
	return typed;
}

function resolveInWorkspace(inputPath, vscode) {
	const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
	if (!folder) {
		throw new Error('Open a folder first.');
	}
	const target = path.isAbsolute(inputPath || '')
		? vscode.Uri.file(inputPath)
		: vscode.Uri.joinPath(folder.uri, inputPath || '.');
	const root = folder.uri.fsPath.toLowerCase();
	const full = target.fsPath.toLowerCase();
	const rootPrefix = root.endsWith('\\') ? root : root + '\\';
	if (full !== root && !full.startsWith(rootPrefix)) {
		throw new Error('Path is outside the workspace.');
	}
	return target;
}

function toolResult(vscode, text) {
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart(String(text).slice(0, MAX_TOOL_CHARS))
	]);
}

function activate(context) {
	const vscode = require('vscode');
	const onDidChangeModels = new vscode.EventEmitter();
	context.subscriptions.push(onDidChangeModels);

	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('opencode-go', {
		onDidChangeLanguageModelChatInformation: onDidChangeModels.event,
		async provideLanguageModelChatInformation(options) {
			const config = vscode.workspace.getConfiguration('shideh');
			const base = baseUrlOf(config.get('opencodeGo.baseUrl'));
			const apiKey = await readApiKey(context.secrets, options.silent !== false);
			if (!apiKey) {
				return [];
			}
			const response = await fetch(`${base}/models`, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'User-Agent': USER_AGENT
				}
			});
			if (!response.ok) {
				return [];
			}
			const body = await response.json();
			const rows = Array.isArray(body) ? body : (body.data || []);
			return rows.filter(row => row && row.id).map(row => ({
				id: row.id,
				name: row.id,
				family: row.id,
				version: '1',
				maxInputTokens: 200000,
				maxOutputTokens: 16000,
				capabilities: { toolCalling: true }
			}));
		},
		async provideLanguageModelChatResponse(model, messages, options, progress) {
			const config = vscode.workspace.getConfiguration('shideh');
			const base = baseUrlOf(config.get('opencodeGo.baseUrl'));
			const apiKey = await readApiKey(context.secrets, false);
			if (!apiKey) {
				throw new Error('OpenCode Go API key is missing.');
			}
			const sessionId = (options.modelOptions && options.modelOptions.sessionId) || 'shideh';
			const response = await fetch(`${base}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'User-Agent': USER_AGENT,
					'x-opencode-session': sessionId
				},
				body: JSON.stringify({
					model: model.id,
					stream: true,
					messages: toOpenAiMessages(messages),
					tools: (options.tools || []).map(tool => ({
						type: 'function',
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema || { type: 'object', properties: {} }
						}
					}))
				})
			});
			if (!response.ok) {
				throw new Error(`OpenCode Go returned ${response.status}.`);
			}
			const parsed = parseSse(await response.text());
			if (parsed.text) {
				progress.report(new vscode.LanguageModelTextPart(parsed.text));
			}
			for (const call of parsed.toolCalls) {
				let input = {};
				try {
					input = call.arguments ? JSON.parse(call.arguments) : {};
				} catch {
					input = {};
				}
				progress.report(new vscode.LanguageModelToolCallPart(call.id || call.name, call.name, input));
			}
		},
		provideTokenCount(_model, text) {
			const value = typeof text === 'string' ? text : JSON.stringify(text);
			return Math.ceil(value.length / 4);
		}
	}));

	for (const tool of createTools(vscode)) {
		context.subscriptions.push(vscode.lm.registerTool(tool.name, tool.impl));
	}

	const participant = vscode.chat.createChatParticipant('shideh.agent', async (request, chatContext, stream, token) => {
		const sessionId = sessionIdFrom(chatContext);
		let model = request.model && request.model.vendor === 'opencode-go' ? request.model : undefined;
		if (!model) {
			const models = await vscode.lm.selectChatModels({ vendor: 'opencode-go' });
			model = models[0];
		}
		if (!model) {
			onDidChangeModels.fire();
			stream.markdown('OpenCode Go is not connected. Set OPENCODE_API_KEY, or enter the key when Shideh asks.');
			return { metadata: { sessionId } };
		}
		const messages = historyMessages(vscode, chatContext, request);
		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			if (token.isCancellationRequested) {
				return { metadata: { sessionId } };
			}
			const response = await model.sendRequest(messages, {
				tools: vscode.lm.tools.map(tool => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema
				})),
				toolMode: vscode.LanguageModelChatToolMode.Auto,
				modelOptions: { sessionId }
			}, token);
			const toolCalls = [];
			let text = '';
			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					text += part.value;
					stream.markdown(part.value);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					toolCalls.push(part);
				}
			}
			if (!toolCalls.length) {
				break;
			}
			messages.push(vscode.LanguageModelChatMessage.Assistant([
				...(text ? [new vscode.LanguageModelTextPart(text)] : []),
				...toolCalls
			]));
			const results = [];
			for (const call of toolCalls) {
				const result = await vscode.lm.invokeTool(call.name, {
					input: call.input,
					toolInvocationToken: request.toolInvocationToken
				}, token);
				results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
			}
			messages.push(vscode.LanguageModelChatMessage.User(results));
		}
		return { metadata: { sessionId } };
	});
	context.subscriptions.push(participant);

	if (vscode.workspace.getConfiguration('shideh').get('openAgentOnStartup') !== false) {
		openAgent(vscode);
	}
}

function sessionIdFrom(chatContext) {
	const history = chatContext && chatContext.history || [];
	for (let i = history.length - 1; i >= 0; i--) {
		const sessionId = history[i].result && history[i].result.metadata && history[i].result.metadata.sessionId;
		if (sessionId) {
			return sessionId;
		}
	}
	return `shideh-${Date.now()}`;
}

function historyMessages(vscode, chatContext, request) {
	const messages = [];
	for (const turn of (chatContext && chatContext.history) || []) {
		if (typeof turn.prompt === 'string') {
			messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
		} else if (turn.response) {
			const text = turn.response.map(part => part.value || '').join('');
			if (text) {
				messages.push(vscode.LanguageModelChatMessage.Assistant(text));
			}
		}
	}
	messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
	return messages;
}

async function openAgent(vscode) {
	const open = { mode: 'agent', query: '', isPartialQuery: true };
	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			...open,
			modelSelector: { vendor: 'opencode-go' }
		});
	} catch {
		try {
			await vscode.commands.executeCommand('workbench.action.chat.open', open);
		} catch {
			// Chat may not be ready on the first tick. The user can open it from the Agent mode command.
		}
	}
}

function createTools(vscode) {
	return [
		{
			name: 'shideh_readFile',
			impl: {
				async invoke(options) {
					const uri = resolveInWorkspace(options.input.path, vscode);
					const bytes = await vscode.workspace.fs.readFile(uri);
					return toolResult(vscode, Buffer.from(bytes).toString('utf8'));
				}
			}
		},
		{
			name: 'shideh_writeFile',
			impl: {
				prepareInvocation(options) {
					return {
						invocationMessage: `Edit ${options.input.path}`,
						confirmationMessages: {
							title: 'Edit file',
							message: new vscode.MarkdownString(`Replace \`${options.input.path}\`?`)
						}
					};
				},
				async invoke(options) {
					const uri = resolveInWorkspace(options.input.path, vscode);
					await vscode.workspace.fs.writeFile(uri, Buffer.from(String(options.input.content ?? ''), 'utf8'));
					return toolResult(vscode, `Wrote ${options.input.path}`);
				}
			}
		},
		{
			name: 'shideh_listDirectory',
			impl: {
				async invoke(options) {
					const uri = resolveInWorkspace(options.input.path || '', vscode);
					const entries = await vscode.workspace.fs.readDirectory(uri);
					const lines = entries.map(([name, kind]) => `${kind === vscode.FileType.Directory ? 'dir' : 'file'} ${name}`);
					return toolResult(vscode, lines.join('\n') || '(empty)');
				}
			}
		},
		{
			name: 'shideh_runTerminal',
			impl: {
				prepareInvocation(options) {
					return {
						invocationMessage: options.input.command,
						confirmationMessages: {
							title: 'Run terminal command',
							message: new vscode.MarkdownString('```powershell\n' + options.input.command + '\n```')
						}
					};
				},
				invoke(options) {
					const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
					return new Promise(resolve => {
						execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', options.input.command], {
							cwd: folder ? folder.uri.fsPath : os.homedir(),
							timeout: 60000,
							maxBuffer: 1024 * 1024,
							windowsHide: true
						}, (error, stdout, stderr) => {
							const text = [stdout, stderr, error ? error.message : ''].filter(Boolean).join('\n');
							resolve(toolResult(vscode, text || '(no output)'));
						});
					});
				}
			}
		}
	];
}

function deactivate() { }

module.exports = {
	activate,
	deactivate,
	toOpenAiMessages,
	parseSse
};

if (require.main === module) {
	selfCheck();
}
