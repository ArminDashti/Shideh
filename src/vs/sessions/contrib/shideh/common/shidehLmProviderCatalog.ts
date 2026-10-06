/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ShidehLmProviderId =
	| 'ollama'
	| 'anthropic'
	| 'openai'
	| 'openrouter'
	| 'opencode-go'
	| 'opencode-zen'
	| 'openai-compatible';

export interface IShidehLmProviderDefinition {
	readonly id: ShidehLmProviderId;
	readonly displayName: string;
	readonly secretKey: string;
	readonly envVar?: string;
	readonly baseUrlConfigKey: string;
	readonly defaultBaseUrl: string;
	readonly brandColor: string;
	readonly apiKeyRequired: boolean;
	readonly apiKeyOptional: boolean;
	readonly apiKeyHint?: string;
}

export const SHIDEH_LM_PROVIDERS: readonly IShidehLmProviderDefinition[] = [
	{
		id: 'ollama',
		displayName: 'Ollama',
		secretKey: 'shideh.ollama.apiKey',
		envVar: 'OLLAMA_API_KEY',
		baseUrlConfigKey: 'shideh.ollama.baseUrl',
		defaultBaseUrl: 'http://127.0.0.1:11434/v1',
		brandColor: '#000000',
		apiKeyRequired: false,
		apiKeyOptional: true,
		apiKeyHint: 'Leave empty for local Ollama (uses a placeholder key).',
	},
	{
		id: 'anthropic',
		displayName: 'Anthropic',
		secretKey: 'shideh.anthropic.apiKey',
		envVar: 'ANTHROPIC_API_KEY',
		baseUrlConfigKey: 'shideh.anthropic.baseUrl',
		defaultBaseUrl: 'https://api.anthropic.com/v1',
		brandColor: '#D97757',
		apiKeyRequired: true,
		apiKeyOptional: false,
	},
	{
		id: 'openai',
		displayName: 'OpenAI',
		secretKey: 'shideh.openai.apiKey',
		envVar: 'OPENAI_API_KEY',
		baseUrlConfigKey: 'shideh.openai.baseUrl',
		defaultBaseUrl: 'https://api.openai.com/v1',
		brandColor: '#10A37F',
		apiKeyRequired: true,
		apiKeyOptional: false,
	},
	{
		id: 'openrouter',
		displayName: 'OpenRouter',
		secretKey: 'shideh.openrouter.apiKey',
		envVar: 'OPENROUTER_API_KEY',
		baseUrlConfigKey: 'shideh.openrouter.baseUrl',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		brandColor: '#6366F1',
		apiKeyRequired: true,
		apiKeyOptional: false,
	},
	{
		id: 'opencode-go',
		displayName: 'OpenCode Go',
		secretKey: 'shideh.opencodeGo.apiKey',
		envVar: 'OPENCODE_API_KEY',
		baseUrlConfigKey: 'shideh.opencodeGo.baseUrl',
		defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
		brandColor: '#F59E0B',
		apiKeyRequired: true,
		apiKeyOptional: false,
	},
	{
		id: 'opencode-zen',
		displayName: 'OpenCode Zen',
		secretKey: 'shideh.opencodeZen.apiKey',
		envVar: 'OPENCODE_ZEN_API_KEY',
		baseUrlConfigKey: 'shideh.opencodeZen.baseUrl',
		defaultBaseUrl: 'https://opencode.ai/zen/v1',
		brandColor: '#8B5CF6',
		apiKeyRequired: true,
		apiKeyOptional: false,
	},
	{
		id: 'openai-compatible',
		displayName: 'OpenAI-Compatible',
		secretKey: 'shideh.openaiCompatible.apiKey',
		envVar: 'OPENAI_COMPATIBLE_API_KEY',
		baseUrlConfigKey: 'shideh.openaiCompatible.baseUrl',
		defaultBaseUrl: 'http://127.0.0.1:8080/v1',
		brandColor: '#64748B',
		apiKeyRequired: false,
		apiKeyOptional: true,
		apiKeyHint: 'Optional for some local gateways.',
	},
];

export function getShidehLmProvider(id: string | undefined): IShidehLmProviderDefinition | undefined {
	return SHIDEH_LM_PROVIDERS.find(provider => provider.id === id);
}

export const SHIDEH_STARRED_PROVIDERS_KEY = 'shideh.providers.starred';
export const SHIDEH_SELECTED_PROVIDER_KEY = 'shideh.providers.selected';
