/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShiftCommand } from '../commands/shiftCommand.js';
import { CompositionSurroundSelectionCommand } from '../commands/surroundSelectionCommand.js';
import { CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from '../cursorCommon.js';
import { Range } from '../core/range.js';
import { Selection } from '../core/selection.js';
import { Position } from '../core/position.js';
import { ICommand } from '../editorCommon.js';
import { ITextModel } from '../model.js';
import { AutoClosingOpenCharTypeOperation, AutoClosingOvertypeOperation, AutoClosingOvertypeWithInterceptorsOperation, AutoIndentOperation, CompositionOperation, CompositionEndOvertypeOperation, EnterOperation, InterceptorElectricCharOperation, PasteOperation, shiftIndent, shouldSurroundChar, SimpleCharacterTypeOperation, SurroundSelectionOperation, TabOperation, TypeWithoutInterceptorsOperation, unshiftIndent } from './cursorTypeEditOperations.js';

export class TypeOperations {

	public static indent(config: CursorConfiguration, model: ICursorSimpleModel | null, selections: Selection[] | null): ICommand[] {
		if (model === null || selections === null) {
			return [];
		}

		// This is a collection of commands that modify the text or the cursor state
		const commands: ICommand[] = [];
		// Create a command for each selection
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ShiftCommand(selections[i], {
				isUnshift: false,
				tabSize: config.tabSize,
				indentSize: config.indentSize,
				insertSpaces: config.insertSpaces,
				useTabStops: config.useTabStops,
				autoIndent: config.autoIndent
			}, config.languageConfigurationService);
		}
		return commands;
	}

	public static outdent(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): ICommand[] {
		const commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ShiftCommand(selections[i], {
				isUnshift: true,
				tabSize: config.tabSize,
				indentSize: config.indentSize,
				insertSpaces: config.insertSpaces,
				useTabStops: config.useTabStops,
				autoIndent: config.autoIndent
			}, config.languageConfigurationService);
		}
		return commands;
	}

	public static shiftIndent(config: CursorConfiguration, indentation: string, count?: number): string {
		return shiftIndent(config, indentation, count);
	}

	public static unshiftIndent(config: CursorConfiguration, indentation: string, count?: number): string {
		return unshiftIndent(config, indentation, count);
	}

	public static paste(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], text: string, pasteOnNewLine: boolean, multicursorText: string[]): EditOperationResult {
		return PasteOperation.getEdits(config, model, selections, text, pasteOnNewLine, multicursorText);
	}

	public static tab(config: CursorConfiguration, model: ITextModel, selections: Selection[]): ICommand[] {
		return TabOperation.getCommands(config, model, selections);
	}

	public static compositionType(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], text: string, replacePrevCharCnt: number, replaceNextCharCnt: number, positionDelta: number): EditOperationResult {
		return CompositionOperation.getEdits(prevEditOperationType, config, model, selections, text, replacePrevCharCnt, replaceNextCharCnt, positionDelta);
	}

	/**
	 * This is very similar with typing, but the character is already in the text buffer!
	 */
	public static compositionEndWithInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, compositions: CompositionOutcome[] | null, selections: Selection[], autoClosedCharacters: Range[]): EditOperationResult | null {
		if (!compositions) {
			// could not deduce what the composition did
			return null;
		}

		let insertedText: string | null = null;
		for (const composition of compositions) {
			if (insertedText === null) {
				insertedText = composition.insertedText;
			} else if (insertedText !== composition.insertedText) {
				// not all selections agree on what was typed
				return null;
			}
		}

		if (!insertedText || insertedText.length !== 1) {
			// we're only interested in the case where a single character was inserted
			return CompositionEndOvertypeOperation.getEdits(config, compositions);
		}

		const ch = insertedText;

		let hasDeletion = false;
		for (const composition of compositions) {
			if (composition.deletedText.length !== 0) {
				hasDeletion = true;
				break;
			}
		}

		if (hasDeletion) {
			// Check if this could have been a surround selection

			if (!shouldSurroundChar(config, ch) || !config.surroundingPairs.hasOwnProperty(ch)) {
				return null;
			}

			const isTypingAQuoteCharacter = isQuote(ch);

			for (const composition of compositions) {
				if (composition.deletedSelectionStart !== 0 || composition.deletedSelectionEnd !== composition.deletedText.length) {
					// more text was deleted than was selected, so this could not have been a surround selection
					return null;
				}
				if (/^[ \t]+$/.test(composition.deletedText)) {
					// deleted text was only whitespace
					return null;
				}
				if (isTypingAQuoteCharacter && isQuote(composition.deletedText)) {
					// deleted text was a quote
					return null;
				}
			}

			const positions: Position[] = [];
			for (const selection of selections) {
				if (!selection.isEmpty()) {
					return null;
				}
				positions.push(selection.getPosition());
			}

			if (positions.length !== compositions.length) {
				return null;
			}

			const commands: ICommand[] = [];
			for (let i = 0, len = positions.length; i < len; i++) {
				commands.push(new CompositionSurroundSelectionCommand(positions[i], compositions[i].deletedText, config.surroundingPairs[ch]));
			}
			return new EditOperationResult(EditOperationType.TypingOther, commands, {
				shouldPushStackElementBefore: true,
				shouldPushStackElementAfter: false
			});
		}

		const autoClosingOvertypeEdits = AutoClosingOvertypeWithInterceptorsOperation.getEdits(config, model, selections, autoClosedCharacters, ch);
		if (autoClosingOvertypeEdits !== undefined) {
			return autoClosingOvertypeEdits;
		}

		const autoClosingOpenCharEdits = AutoClosingOpenCharTypeOperation.getEdits(config, model, selections, ch, true, false);
		if (autoClosingOpenCharEdits !== undefined) {
			return autoClosingOpenCharEdits;
		}

		return CompositionEndOvertypeOperation.getEdits(config, compositions);
	}

	public static typeWithInterceptors(isDoingComposition: boolean, prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], autoClosedCharacters: Range[], ch: string): EditOperationResult {

		const enterEdits = EnterOperation.getEdits(config, model, selections, ch, isDoingComposition);
		if (enterEdits !== undefined) {
			return enterEdits;
		}

		const autoIndentEdits = AutoIndentOperation.getEdits(config, model, selections, ch, isDoingComposition);
		if (autoIndentEdits !== undefined) {
			return autoIndentEdits;
		}

		const autoClosingOverTypeEdits = AutoClosingOvertypeOperation.getEdits(prevEditOperationType, config, model, selections, autoClosedCharacters, ch);
		if (autoClosingOverTypeEdits !== undefined) {
			return autoClosingOverTypeEdits;
		}

		const autoClosingOpenCharEdits = AutoClosingOpenCharTypeOperation.getEdits(config, model, selections, ch, false, isDoingComposition);
		if (autoClosingOpenCharEdits !== undefined) {
			return autoClosingOpenCharEdits;
		}

		const surroundSelectionEdits = SurroundSelectionOperation.getEdits(config, model, selections, ch, isDoingComposition);
		if (surroundSelectionEdits !== undefined) {
			return surroundSelectionEdits;
		}

		const interceptorElectricCharOperation = InterceptorElectricCharOperation.getEdits(prevEditOperationType, config, model, selections, ch, isDoingComposition);
		if (interceptorElectricCharOperation !== undefined) {
			return interceptorElectricCharOperation;
		}

		return SimpleCharacterTypeOperation.getEdits(config, prevEditOperationType, selections, ch, isDoingComposition);
	}

	public static typeWithoutInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], str: string): EditOperationResult {
		return TypeWithoutInterceptorsOperation.getEdits(prevEditOperationType, selections, str);
	}
}

class TypeWithAutoClosingCommand extends BaseTypeWithAutoClosingCommand {

	constructor(selection: Selection, openCharacter: string, insertOpenCharacter: boolean, closeCharacter: string) {
		const text = (insertOpenCharacter ? openCharacter : '') + closeCharacter;
		const lineNumberDeltaOffset = 0;
		const columnDeltaOffset = -closeCharacter.length;
		super(selection, text, lineNumberDeltaOffset, columnDeltaOffset, openCharacter, closeCharacter);
	}

	public override computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		const range = inverseEditOperations[0].range;
		return this._computeCursorStateWithRange(model, range, helper);
	}
}

class TypeWithIndentationAndAutoClosingCommand extends BaseTypeWithAutoClosingCommand {

	private readonly _autoIndentationEdit: { range: Range; text: string };
	private readonly _autoClosingEdit: { range: Range; text: string };

	constructor(autoIndentationEdit: { range: Range; text: string }, selection: Selection, openCharacter: string, closeCharacter: string) {
		const text = openCharacter + closeCharacter;
		const lineNumberDeltaOffset = 0;
		const columnDeltaOffset = openCharacter.length;
		super(selection, text, lineNumberDeltaOffset, columnDeltaOffset, openCharacter, closeCharacter);
		this._autoIndentationEdit = autoIndentationEdit;
		this._autoClosingEdit = { range: selection, text };
	}

	public override getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._autoIndentationEdit.range, this._autoIndentationEdit.text);
		builder.addTrackedEditOperation(this._autoClosingEdit.range, this._autoClosingEdit.text);
	}

	public override computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		if (inverseEditOperations.length !== 2) {
			throw new Error('There should be two inverse edit operations!');
		}
		const range1 = inverseEditOperations[0].range;
		const range2 = inverseEditOperations[1].range;
		const range = range1.plusRange(range2);
		return this._computeCursorStateWithRange(model, range, helper);
	}
}

class AutoIndentOperation {

	public static getEdits(config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): EditOperationResult | undefined {
		const indentationForSelections: { selection: Selection; indentation: string }[] = [];
		for (const selection of selections) {
			const indentation = this._findActualIndentationForSelection(config, model, selection, ch);
			if (indentation === null) {
				// Auto indentation failed
				return;
			}
			indentationForSelections.push({ selection, indentation });
		}
		const autoClosingPairClose = this._getAutoClosingPairClose(config, model, selections, ch, false);
		return this._getIndentationAndAutoClosingPairEdits(config, model, indentationForSelections, ch, autoClosingPairClose);
	}

	private static _findActualIndentationForSelection(config: CursorConfiguration, model: ITextModel, selection: Selection, ch: string): string | null {
		const actualIndentation = getIndentActionForType(config, model, selection, ch, {
			shiftIndent: (indentation) => {
				return TypeOperations.shiftIndent(config, indentation);
			},
			unshiftIndent: (indentation) => {
				return TypeOperations.unshiftIndent(config, indentation);
			},
		}, config.languageConfigurationService);

		if (actualIndentation === null) {
			return null;
		}

		const currentIndentation = getIndentationAtPosition(model, selection.startLineNumber, selection.startColumn);
		if (actualIndentation === config.normalizeIndentation(currentIndentation)) {
			return null;
		}
		return actualIndentation;
	}

	private static _getIndentationAndAutoClosingPairEdits(config: CursorConfiguration, model: ITextModel, indentationForSelections: { selection: Selection; indentation: string }[], ch: string, autoClosingPairClose: string | null): EditOperationResult {
		const commands: ICommand[] = indentationForSelections.map(({ selection, indentation }) => {
			if (autoClosingPairClose !== null) {
				// Apply both auto closing pair edits and auto indentation edits
				const indentationEdit = this._getEditFromIndentationAndSelection(config, model, indentation, selection, ch, false);
				return new TypeWithIndentationAndAutoClosingCommand(indentationEdit, selection, ch, autoClosingPairClose);
			} else {
				// Apply only auto indentation edits
				const indentationEdit = this._getEditFromIndentationAndSelection(config, model, indentation, selection, ch, true);
				return TypeOperations._typeCommand(indentationEdit.range, indentationEdit.text, false);
			}
		});
		const editOptions = { shouldPushStackElementBefore: true, shouldPushStackElementAfter: false };
		return new EditOperationResult(EditOperationType.TypingOther, commands, editOptions);
	}

	private static _getEditFromIndentationAndSelection(config: CursorConfiguration, model: ITextModel, indentation: string, selection: Selection, ch: string, includeChInEdit: boolean = true): { range: Range; text: string } {
		const startLineNumber = selection.startLineNumber;
		const firstNonWhitespaceColumn = model.getLineFirstNonWhitespaceColumn(startLineNumber);
		let text: string = config.normalizeIndentation(indentation);
		if (firstNonWhitespaceColumn !== 0) {
			const startLine = model.getLineContent(startLineNumber);
			text += startLine.substring(firstNonWhitespaceColumn - 1, selection.startColumn - 1);
		}
		text += includeChInEdit ? ch : '';
		const range = new Range(startLineNumber, 1, selection.endLineNumber, selection.endColumn);
		return { range, text };
	}
}

export class CompositionOutcome {
	constructor(
		public readonly deletedText: string,
		public readonly deletedSelectionStart: number,
		public readonly deletedSelectionEnd: number,
		public readonly insertedText: string,
		public readonly insertedSelectionStart: number,
		public readonly insertedSelectionEnd: number,
		public readonly insertedTextRange: Range,
	) { }
}
