'use strict';

const USER_AGENT = 'shideh/1.0.0';

function baseUrlOf(configValue, fallback) {
	const raw = (configValue || fallback).trim().replace(/\/+$/, '');
	return raw || fallback;
}

function parseExtraHeaders(raw) {
	const headers = {};
	if (!raw || typeof raw !== 'string') {
		return headers;
	}
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const index = trimmed.indexOf(':');
		if (index <= 0) {
			continue;
		}
		const name = trimmed.slice(0, index).trim();
		const value = trimmed.slice(index + 1).trim();
		if (name) {
			headers[name] = value;
		}
	}
	return headers;
}

function requestHeaders(config, spec, apiKey) {
	return {
		'User-Agent': USER_AGENT,
		...spec.authHeaders(apiKey),
		...(spec.extraHeadersSetting ? parseExtraHeaders(config.get(spec.extraHeadersSetting)) : {}),
	};
}

function toOpenAiMessages(messages) {
	const out = [];
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
					content: textOf(part.content).slice(0, 12000)
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
		let chunk;
		try {
			chunk = JSON.parse(data);
		} catch {
			continue;
		}
		const delta = chunk.choices?.[0]?.delta;
		if (delta?.content) {
			text.push(delta.content);
		}
		if (delta?.tool_calls) {
			for (const call of delta.tool_calls) {
				const index = call.index ?? 0;
				let entry = calls.get(index);
				if (!entry) {
					entry = { id: call.id || '', name: call.function?.name || '', arguments: '' };
					calls.set(index, entry);
				}
				if (call.id) {
					entry.id = call.id;
				}
				if (call.function?.name) {
					entry.name = call.function.name;
				}
				if (call.function?.arguments) {
					entry.arguments += call.function.arguments;
				}
			}
		}
	}
	return { text: text.join(''), toolCalls: [...calls.values()] };
}

function registerOpenAiCompatibleProvider(vscode, context, onDidChangeModels, spec) {
	const secretKey = spec.secretKey;
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(spec.vendor, {
		onDidChangeLanguageModelChatInformation: onDidChangeModels.event,
		async provideLanguageModelChatInformation(options) {
			const config = vscode.workspace.getConfiguration('shideh');
			const base = baseUrlOf(config.get(spec.baseUrlSetting), spec.defaultBaseUrl);
			const apiKey = await spec.readApiKey(context.secrets, options.silent !== false);
			if (!apiKey) {
				return [];
			}
			const modelsUrl = spec.modelsPath ? `${base}${spec.modelsPath}` : `${base}/models`;
			const headers = requestHeaders(config, spec, apiKey);
			const response = await fetch(modelsUrl, { headers });
			if (!response.ok) {
				return spec.fallbackModels || [];
			}
			const body = await response.json();
			const rows = Array.isArray(body) ? body : (body.data || body.models || []);
			const mapped = rows.filter(row => row && (row.id || row.name)).map(row => ({
				id: row.id || row.name,
				name: row.id || row.name,
				family: row.id || row.name,
				version: '1',
				maxInputTokens: row.context_length || 200000,
				maxOutputTokens: 16000,
				capabilities: { toolCalling: true }
			}));
			return mapped.length ? mapped : (spec.fallbackModels || []);
		},
		async provideLanguageModelChatResponse(model, messages, options, progress) {
			const config = vscode.workspace.getConfiguration('shideh');
			const base = baseUrlOf(config.get(spec.baseUrlSetting), spec.defaultBaseUrl);
			const apiKey = await spec.readApiKey(context.secrets, false);
			if (!apiKey) {
				throw new Error(`${spec.displayName} API key is missing.`);
			}
			const chatPath = spec.chatPath || '/chat/completions';
			const response = await fetch(`${base}${chatPath}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...requestHeaders(config, spec, apiKey),
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
				throw new Error(`${spec.displayName} returned ${response.status}.`);
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
}

module.exports = { registerOpenAiCompatibleProvider, baseUrlOf, USER_AGENT };
