/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// TODO - @lramos15 - Issue link

	export enum LanguageModelChatApiType {
		ChatCompletions = 1,
		Responses = 2,
		Messages = 3
	}

	export interface LanguageModelChatCapabilities {
		/** The provider's request protocol, used to determine which reasoning blocks can be replayed. Omit when unknown. */
		readonly apiType?: LanguageModelChatApiType;
		/** Whether a Messages API model accepts adaptive thinking, including thinking from earlier user turns. */
		readonly adaptiveThinking?: boolean;
	}

	export interface LanguageModelChat {
		/**
		 * The maximum number of tokens the model can produce in a single response.
		 *
		 * This mirrors the stable {@link LanguageModelChat.maxInputTokens} but for output. It is
		 * provided by the model provider and allows consumers (e.g. other extensions routing
		 * requests through this model) to size requests correctly instead of assuming a default.
		 */
		readonly maxOutputTokens?: number;

		/**
		 * The capabilities of the language model.
		 */
		readonly capabilities: {
			/**
			 * Whether the language model supports tool calling.
			 */
			readonly supportsToolCalling: boolean;
			/**
			 * Whether the language model supports image to text. This means it can take an image as input and produce a text response.
			 */
			readonly supportsImageToText: boolean;

			/**
			 * The tools the model prefers for making file edits. See {@link LanguageModelChatCapabilities.editTools}.
			 */
			readonly editToolsHint?: readonly string[];
			/** The provider's request protocol, or undefined when it has not been declared. */
			readonly apiType?: LanguageModelChatApiType;
			/** Whether this Messages API model supports adaptive thinking. */
			readonly supportsAdaptiveThinking?: boolean;
		};
	}
}
