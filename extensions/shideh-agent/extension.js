'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const VERSION = '1.0.0';
const USER_AGENT = `shideh/${VERSION}`;
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const SECRET_KEY = 'shideh.opencodeGo.apiKey';
const { registerOpenAiCompatibleProvider } = require('./providers.js');
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CHARS = 12000;

function baseUrlOf(configValue) {
	const raw = (configValue || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
	return raw || DEFAULT_BASE_URL;
}

function loadMemorySnippet(config) {
	if (config.get('memory.enabled', true) === false) {
		return '';
	}
	const framework = config.get('memory.framework', 'mem0');
	const file = path.join(os.homedir(), '.sauronharness', 'memory', framework, 'active.json');
	try {
		const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
		const lines = (doc.entries || []).slice(-8).map(entry => entry.text).filter(Boolean);
		if (!lines.length) {
			return '';
		}
		return `\n\nRelevant memory (${framework}):\n${lines.join('\n')}`;
	} catch {
		return '';
	}
}

function toOpenAiMessages(messages, memorySuffix) {
	const out = [{
		role: 'system',
		content: `You are Shideh, a coding agent in the user editor. Use the tools to read files, edit files, list directories, and run terminal commands. Prefer small edits. Stay inside the workspace.${memorySuffix || ''}`
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

async function readSecret(secrets, storageKey, envName, promptTitle, silent) {
	if (envName && process.env[envName]) {
		return process.env[envName];
	}
	const stored = await secrets.get(storageKey);
	if (stored) {
		return stored;
	}
	if (silent) {
		return '';
	}
	const vscode = require('vscode');
	const typed = await vscode.window.showInputBox({
		title: promptTitle,
		prompt: promptTitle,
		password: true,
		ignoreFocusOut: true
	});
	if (!typed) {
		return '';
	}
	await secrets.store(storageKey, typed);
	return typed;
}

async function readOpenCodeGoApiKey(secrets, silent) {
	const fromEnv = await readSecret(secrets, SECRET_KEY, 'OPENCODE_API_KEY', 'OpenCode Go API key', true);
	if (fromEnv) {
		return fromEnv;
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
	return readSecret(secrets, SECRET_KEY, 'OPENCODE_API_KEY', 'OpenCode Go API key', silent);
}

function registerShidehProviders(vscode, context, onDidChangeModels) {
	const bearer = apiKey => ({ Authorization: `Bearer ${apiKey}` });
	const specs = [
		{ vendor: 'opencode-go', displayName: 'OpenCode Go', secretKey: SECRET_KEY, env: 'OPENCODE_API_KEY', baseUrlSetting: 'opencodeGo.baseUrl', defaultBaseUrl: 'https://opencode.ai/zen/go/v1', read: readOpenCodeGoApiKey },
		{ vendor: 'opencode-zen', displayName: 'OpenCode Zen', secretKey: 'shideh.opencodeZen.apiKey', env: 'OPENCODE_ZEN_API_KEY', baseUrlSetting: 'opencodeZen.baseUrl', defaultBaseUrl: 'https://opencode.ai/zen/v1' },
		{ vendor: 'openrouter', displayName: 'OpenRouter', secretKey: 'shideh.openrouter.apiKey', env: 'OPENROUTER_API_KEY', baseUrlSetting: 'openrouter.baseUrl', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
		{ vendor: 'openai', displayName: 'OpenAI', secretKey: 'shideh.openai.apiKey', env: 'OPENAI_API_KEY', baseUrlSetting: 'openai.baseUrl', defaultBaseUrl: 'https://api.openai.com/v1' },
		{ vendor: 'anthropic', displayName: 'Anthropic', secretKey: 'shideh.anthropic.apiKey', env: 'ANTHROPIC_API_KEY', baseUrlSetting: 'anthropic.baseUrl', defaultBaseUrl: 'https://api.anthropic.com/v1', chatPath: '/messages', modelsPath: '/models' },
		{ vendor: 'ollama', displayName: 'Ollama', secretKey: 'shideh.ollama.apiKey', env: 'OLLAMA_API_KEY', baseUrlSetting: 'ollama.baseUrl', defaultBaseUrl: 'http://127.0.0.1:11434/v1', fallbackModels: [{ id: 'llama3.2', name: 'llama3.2' }] },
		{ vendor: 'openai-compatible', displayName: 'OpenAI Compatible', secretKey: 'shideh.openaiCompatible.apiKey', env: 'OPENAI_COMPATIBLE_API_KEY', baseUrlSetting: 'openaiCompatible.baseUrl', extraHeadersSetting: 'openaiCompatible.extraHeaders', defaultBaseUrl: 'http://127.0.0.1:8080/v1' },
		{ vendor: 'deepseek', displayName: 'DeepSeek', secretKey: 'shideh.deepseek.apiKey', env: 'DEEPSEEK_API_KEY', baseUrlSetting: 'deepseek.baseUrl', defaultBaseUrl: 'https://api.deepseek.com/v1', fallbackModels: [{ id: 'deepseek-chat', name: 'deepseek-chat' }] },
	];
	for (const spec of specs) {
		registerOpenAiCompatibleProvider(vscode, context, onDidChangeModels, {
			vendor: spec.vendor,
			displayName: spec.displayName,
			secretKey: spec.secretKey,
			baseUrlSetting: spec.baseUrlSetting,
			defaultBaseUrl: spec.defaultBaseUrl,
			chatPath: spec.chatPath,
			modelsPath: spec.modelsPath,
			fallbackModels: spec.fallbackModels,
			authHeaders: apiKey => bearer(apiKey || 'ollama'),
			readApiKey: async (secrets, silent) => {
				const key = await readSecret(secrets, spec.secretKey, spec.env, `${spec.displayName} API key`, silent);
				if (spec.vendor === 'ollama' && !key) {
					return 'ollama';
				}
				return key;
			},
		});
	}
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

	registerShidehProviders(vscode, context, onDidChangeModels);

	context.subscriptions.push(context.secrets.onDidChange(e => {
		if (typeof e.key === 'string' && e.key.startsWith('shideh.')) {
			onDidChangeModels.fire();
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('shideh')) {
			onDidChangeModels.fire();
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
		const shidehConfig = vscode.workspace.getConfiguration('shideh');
		const memorySuffix = loadMemorySnippet(shidehConfig);
		const messages = historyMessages(vscode, chatContext, request, memorySuffix);
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

	if (vscode.workspace.getConfiguration('shideh').get('openAgentPanelOnStartup') === true) {
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

function historyMessages(vscode, chatContext, request, memorySuffix) {
	const messages = [];
	if (memorySuffix) {
		messages.push(vscode.LanguageModelChatMessage.User(`Use this persisted memory when answering:${memorySuffix}`));
	}
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
