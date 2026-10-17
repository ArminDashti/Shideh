/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TerminalShellType } from './constants';


export const enum TokenType {
	Command,
	Argument,
}

export const shellTypeResetChars = new Map<TerminalShellType, string[]>([
	[TerminalShellType.Bash, ['>', '>>', '<', '2>', '2>>', '&>', '&>>', '|', '|&', '&&', '||', '&', ';', '(', '{', '<<']],
	[TerminalShellType.Zsh, ['>', '>>', '<', '2>', '2>>', '&>', '&>>', '<>', '|', '|&', '&&', '||', '&', ';', '(', '{', '<<', '<<<', '<(']],
	[TerminalShellType.PowerShell, ['>', '>>', '<', '2>', '2>>', '*>', '*>>', '|', ';', ' -and ', ' -or ', ' -not ', '!', '&', ' -eq ', ' -ne ', ' -gt ', ' -lt ', ' -ge ', ' -le ', ' -like ', ' -notlike ', ' -match ', ' -notmatch ', ' -contains ', ' -notcontains ', ' -in ', ' -notin ']]
]);

export const defaultShellTypeResetChars = shellTypeResetChars.get(TerminalShellType.Bash)!;

export function getTokenType(ctx: { commandLine: string; cursorIndex: number }, shellType: TerminalShellType | undefined): TokenType {
	const commandLine = ctx.commandLine;
	const cursorPosition = ctx.cursorIndex;
	const commandResetChars = shellType === undefined ? defaultShellTypeResetChars : shellTypeResetChars.get(shellType) ?? defaultShellTypeResetChars;

	// Check for reset char before the current word
	const beforeCursor = commandLine.substring(0, cursorPosition);
	const wordStart = beforeCursor.lastIndexOf(' ') + 1;
	const beforeWord = commandLine.substring(0, wordStart);

	// Look for " <reset char> " before the word
	for (const resetChar of commandResetChars) {
		const pattern = shellType === TerminalShellType.PowerShell ? `${resetChar}` : ` ${resetChar} `;
		if (beforeWord.endsWith(pattern)) {
			return TokenType.Command;
		}
	}

	// Fallback to original logic for the very first command
	const spaceIndex = beforeCursor.lastIndexOf(' ');
	if (spaceIndex === -1) {
		return TokenType.Command;
	}
	const previousTokens = beforeCursor.substring(0, spaceIndex + 1).trim();
	if (commandResetChars.some(e => previousTokens.endsWith(e))) {
		return TokenType.Command;
	}

	// Find the last command separator (that starts a new command context)
	// Examples: in "ls && git status", find the "&&" separator
	const commandSeparators = shellType === undefined ? defaultShellTypeCommandSeparators : shellTypeCommandSeparators.get(shellType) ?? defaultShellTypeCommandSeparators;
	let lastSeparatorIndex = -1;
	for (const separator of commandSeparators) {
		const index = beforeCursor.lastIndexOf(separator);
		if (index > lastSeparatorIndex) {
			lastSeparatorIndex = index + separator.length - 1;
		}
	}

	// Get the text after the last separator (or from the beginning if no separator found)
	// Examples: "ls && git status" → "git status", "git status" → "git status"
	const afterSeparator = lastSeparatorIndex >= 0 ? beforeCursor.slice(lastSeparatorIndex + 1) : beforeCursor;

	// If there's no content after separator (empty or only whitespace),
	// this indicates we're at the start of a new command context
	// Examples: "ls && |" → Command, "|" → Command, "ls &&|" → Argument (no space)
	if (afterSeparator.trim() === '') {
		// For empty input or separator with trailing space, show commands
		// For cursor immediately after separator with no space, don't show suggestions
		return afterSeparator.length > 0 || lastSeparatorIndex === -1 ? TokenType.Command : TokenType.Argument;
	}

	const trimmedAfterSeparator = afterSeparator.trim();
	
	// If the trimmed text contains a space, we're clearly in argument mode
	// Examples: "git status --all|" → Argument, "ls && git status|" → Argument
	if (trimmedAfterSeparator.includes(' ')) {
		return TokenType.Argument;
	}

	// If there's a trailing space after the command name, we're in argument mode
	// Examples: "git |" → Argument, "ls && git |" → Argument
	if (afterSeparator.endsWith(' ')) {
		return TokenType.Argument;
	}

	// No spaces and no trailing space means we're still typing the command name
	// Examples: "git|" → Command, "ls && git|" → Command
	return TokenType.Command;
}
