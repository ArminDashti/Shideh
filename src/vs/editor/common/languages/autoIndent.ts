/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from '../../../base/common/strings.js';
import { Range } from '../core/range.js';
import { ITextModel } from '../model.js';
import { IndentAction } from './languageConfiguration.js';
import { IndentConsts } from './supports/indentRules.js';
import { EditorAutoIndentStrategy } from '../config/editorOptions.js';
import { ILanguageConfigurationService } from './languageConfigurationRegistry.js';
import { IViewLineTokens } from '../tokens/lineTokens.js';
import { IndentationContextProcessor, isLanguageDifferentFromLineStart, ProcessedIndentRulesSupport } from './supports/indentationLineProcessor.js';
import { CursorConfiguration } from '../cursorCommon.js';

/**
 * Result type for indentation inheritance operations
 */
interface IndentationResult {
	indentation: string;
	action: IndentAction | null;
	line?: number;
}

export interface IVirtualModel {
	tokenization: {
		getLineTokens(lineNumber: number): IViewLineTokens;
		getLanguageId(): string;
		getLanguageIdAtPosition(lineNumber: number, column: number): string;
		forceTokenization?(lineNumber: number): void;
	};
	getLineContent(lineNumber: number): string;
}

export interface IIndentConverter {
	shiftIndent(indentation: string): string;
	unshiftIndent(indentation: string): string;
	normalizeIndentation?(indentation: string): string;
}

/**
 * Validates prerequisites for auto-indentation operations
 */
function validateAutoIndentPrerequisites(
	autoIndent: EditorAutoIndentStrategy,
	languageConfigurationService: ILanguageConfigurationService,
	languageId: string
) {
	if (autoIndent < EditorAutoIndentStrategy.Full) {
		return null;
	}

	const indentRulesSupport = languageConfigurationService.getLanguageConfiguration(languageId).indentRulesSupport;
	if (!indentRulesSupport) {
		return null;
	}

	return indentRulesSupport;
}

/**
 * Creates a standardized indentation result object
 */
function createIndentationResult(
	indentation: string,
	action: IndentAction | null = null,
	line?: number
): IndentationResult {
	return { indentation, action, line };
}

/**
 * Checks if the line is the first non-blank line and returns appropriate indentation
 */
function getIndentationForFirstNonBlankLine(
	model: IVirtualModel,
	lineNumber: number
): IndentationResult | null {
	if (lineNumber <= 1) {
		return createIndentationResult('');
	}

	// Use no indent if this is the first non-blank line
	for (let priorLineNumber = lineNumber - 1; priorLineNumber > 0; priorLineNumber--) {
		if (model.getLineContent(priorLineNumber) !== '') {
			break;
		}
		if (priorLineNumber === 1) {
			return createIndentationResult('');
		}
	}

	return null;
}

/**
 * Processes indentation based on the preceding valid line's characteristics
 */
function processIndentationFromPrecedingLine(
	model: IVirtualModel,
	precedingLineNumber: number,
	processedIndentRulesSupport: ProcessedIndentRulesSupport,
	indentRulesSupport: any
): IndentationResult {
	const precedingLineContent = model.getLineContent(precedingLineNumber);
	const precedingIndentation = strings.getLeadingWhitespace(precedingLineContent);

	if (processedIndentRulesSupport.shouldIncrease(precedingLineNumber) || 
		processedIndentRulesSupport.shouldIndentNextLine(precedingLineNumber)) {
		return createIndentationResult(precedingIndentation, IndentAction.Indent, precedingLineNumber);
	}

	if (processedIndentRulesSupport.shouldDecrease(precedingLineNumber)) {
		return createIndentationResult(precedingIndentation, null, precedingLineNumber);
	}

	// Handle case where preceding line doesn't match any indent patterns
	if (precedingLineNumber === 1) {
		return createIndentationResult(precedingIndentation, null, precedingLineNumber);
	}

	return handleComplexIndentationCase(model, precedingLineNumber, processedIndentRulesSupport, indentRulesSupport);
}

/**
 * Handles complex indentation cases where the preceding line doesn't match simple patterns
 */
function handleComplexIndentationCase(
	model: IVirtualModel,
	precedingLineNumber: number,
	processedIndentRulesSupport: ProcessedIndentRulesSupport,
	indentRulesSupport: any
): IndentationResult {
	const previousLine = precedingLineNumber - 1;
	const previousLineIndentMetadata = indentRulesSupport.getIndentMetadata(model.getLineContent(previousLine));

	if (!(previousLineIndentMetadata & (IndentConsts.INCREASE_MASK | IndentConsts.DECREASE_MASK)) &&
		(previousLineIndentMetadata & IndentConsts.INDENT_NEXTLINE_MASK)) {
		
		let stopLine = 0;
		for (let i = previousLine - 1; i > 0; i--) {
			if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
				continue;
			}
			stopLine = i;
			break;
		}

		return createIndentationResult(
			strings.getLeadingWhitespace(model.getLineContent(stopLine + 1)),
			null,
			stopLine + 1
		);
	}

	return createIndentationResult(
		strings.getLeadingWhitespace(model.getLineContent(precedingLineNumber)),
		null,
		precedingLineNumber
	);
}

/**
 * Searches for appropriate indentation when honoring intentional indent is disabled
 */
function searchForNonTemporaryIndent(
	model: IVirtualModel,
	startLineNumber: number,
	processedIndentRulesSupport: ProcessedIndentRulesSupport
): IndentationResult {
	for (let i = startLineNumber; i > 0; i--) {
		if (processedIndentRulesSupport.shouldIncrease(i)) {
			return createIndentationResult(
				strings.getLeadingWhitespace(model.getLineContent(i)),
				IndentAction.Indent,
				i
			);
		}

		if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
			let stopLine = 0;
			for (let j = i - 1; j > 0; j--) {
				if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
					continue;
				}
				stopLine = j;
				break;
			}

			return createIndentationResult(
				strings.getLeadingWhitespace(model.getLineContent(stopLine + 1)),
				null,
				stopLine + 1
			);
		}

		if (processedIndentRulesSupport.shouldDecrease(i)) {
			return createIndentationResult(
				strings.getLeadingWhitespace(model.getLineContent(i)),
				null,
				i
			);
		}
	}

	return createIndentationResult(
		strings.getLeadingWhitespace(model.getLineContent(1)),
		null,
		1
	);
}
/**
 * Get nearest preceding line which doesn't match unIndentPattern or contains all whitespace.
 * Result:
 * -1: run into the boundary of embedded languages
 * 0: every line above are invalid
 * else: nearest preceding line of the same language
 */
function getPrecedingValidLine(model: IVirtualModel, lineNumber: number, processedIndentRulesSupport: ProcessedIndentRulesSupport) {
	const languageId = model.tokenization.getLanguageIdAtPosition(lineNumber, 0);
	if (lineNumber > 1) {
		let lastLineNumber: number;
		// The initial value is -1, meaning if it is returned then that means that we do not have lines before the current line number with the same language ID
		let resultLineNumber = -1;

		// We iterate down from the current line number all the way to 1
		for (lastLineNumber = lineNumber - 1; lastLineNumber >= 1; lastLineNumber--) {
			// Suppose that the language id at the current line number and column 0 is not the language id of interest
			// Then return the result line number
			if (model.tokenization.getLanguageIdAtPosition(lastLineNumber, 0) !== languageId) {
				return resultLineNumber;
			}
			// Otherwise we assume the line at lastLineNumber is of the same language as our language of interest
			// We access the line content
			const text = model.getLineContent(lastLineNumber);
			if (processedIndentRulesSupport.shouldIgnore(lastLineNumber) || /^\s+$/.test(text) || text === '') {
				resultLineNumber = lastLineNumber;
				continue;
			}
			return lastLineNumber;
		}
	}

	return -1;
}

// TODO: seems not very efficient, if we have to go up from the current line in order to find indentations which can be found when going from top to bottom

/**
 * Get inherited indentation from above lines.
 * 1. Find the nearest preceding line which doesn't match unIndentedLinePattern.
 * 2. If this line matches indentNextLinePattern or increaseIndentPattern, it means that the indent level of `lineNumber` should be 1 greater than this line.
 * 3. If this line doesn't match any indent rules
 *   a. check whether the line above itself matches indentNextLinePattern
 *   b. If not, the indent level of this line is the result
 *   c. If yes, it means the indent of this line is *temporary*, go upward utill we find a line whose indent is not temporary (the same workflow a -> b -> c).
 * 4. Otherwise, we fail to get an inherited indent from aboves. Return null and we should not touch the indent of `lineNumber`
 *
 * This function only return the inherited indent based on above lines, it doesn't check whether current line should decrease or not.
 * This inherited indent should be combined with information regarding the current line, in order to decide whether the current line's indentation should be changed.
 */
export function getInheritIndentForLine(
	autoIndent: EditorAutoIndentStrategy, // Different setting values can be used for the auto indentation strategy
	model: IVirtualModel,
	lineNumber: number,
	honorIntentialIndent: boolean = true, // When the user changes the indentation after the auto indent, we should keep this.
	languageConfigurationService: ILanguageConfigurationService
): { indentation: string; action: IndentAction | null; line?: number } | null {

	// The Full indent strategy is the highest value strategy, if the strategy is below this, then we do not want to calculate the inherited indent for the line
	if (autoIndent < EditorAutoIndentStrategy.Full) {
		return null;
	}

	// The indent rules support basically takes the indent rules in their regex forms and can be used to test regex validity on input text
	const indentRulesSupport = languageConfigurationService.getLanguageConfiguration(model.tokenization.getLanguageId()).indentRulesSupport;
	if (!indentRulesSupport) {
		return null;
	}

	const processedIndentRulesSupport = new ProcessedIndentRulesSupport(model, indentRulesSupport, languageConfigurationService);

	// Technically this should not happen?
	if (lineNumber <= 1) {
		return {
			indentation: '',
			action: null
		};
	}

	// Use no indent if this is the first non-blank line
	// Meaning if the lineNumber line is the first line which is not consisting of only whitespaces, then we do not want to take into account the indentation of the lines before it
	// Presumably this is because no pertinent information can be gathered from the whitespace lines above it, since an arbitrary number of whitespaces can be present
	for (let priorLineNumber = lineNumber - 1; priorLineNumber > 0; priorLineNumber--) {
		if (model.getLineContent(priorLineNumber) !== '') {
			break;
		}
		if (priorLineNumber === 1) {
			return {
				indentation: '',
				action: null
			};
		}
	}

	const precedingUnIgnoredLine = getPrecedingValidLine(model, lineNumber, processedIndentRulesSupport);
	if (precedingUnIgnoredLine < 0) {
		return null;
	} else if (precedingUnIgnoredLine < 1) {
		// If preceedingUnIgnoredLine >= 0 and < 1, then it is equal to 0 exactly
		// I suppose this comparison is made in such a way to preserve the symmetry in the comparison
		return {
			indentation: '',
			action: null
		};
	}

	if (processedIndentRulesSupport.shouldIncrease(precedingUnIgnoredLine) || processedIndentRulesSupport.shouldIndentNextLine(precedingUnIgnoredLine)) {
		const precedingUnIgnoredLineContent = model.getLineContent(precedingUnIgnoredLine);
		return {
			indentation: strings.getLeadingWhitespace(precedingUnIgnoredLineContent),
			action: IndentAction.Indent, // From here on we want to indent further.
			line: precedingUnIgnoredLine
		};
	} else if (processedIndentRulesSupport.shouldDecrease(precedingUnIgnoredLine)) {
		const precedingUnIgnoredLineContent = model.getLineContent(precedingUnIgnoredLine);
		return {
			indentation: strings.getLeadingWhitespace(precedingUnIgnoredLineContent),
			action: null, // If we should decrease the indent from here on, we return as an action null? We could return IndentAction.Outdent instead no?
			line: precedingUnIgnoredLine
		};
	} else {
		// precedingUnIgnoredLine can not be ignored.
		// it doesn't increase indent of following lines
		// it doesn't increase just next line
		// so current line is not affect by precedingUnIgnoredLine
		// and then we should get a correct inherited indentation from above lines

		// meaning that we have no information from the preceding unignored line as to the inherited indentation, but we still want to find it
		// hence the following heuristic goes above this line

		if (precedingUnIgnoredLine === 1) {
			// If the preceding unignored line number is 1, then we can not go above it, hence we return the action null
			return {
				indentation: strings.getLeadingWhitespace(model.getLineContent(precedingUnIgnoredLine)),
				action: null,
				line: precedingUnIgnoredLine
			};
		}

		// Go to the line right above the preceding unignored line number
		const previousLine = precedingUnIgnoredLine - 1;

		// Find the mask corresponding to the line right before the preceding unignored line number
		const previousLineIndentMetadata = indentRulesSupport.getIndentMetadata(model.getLineContent(previousLine));
		// If the mask does not consist of the increase mask followed by the decrease mask, and it corresponds (entirely?) to the indent next line mask, then enter the if statement
		if (!(previousLineIndentMetadata & (IndentConsts.INCREASE_MASK | IndentConsts.DECREASE_MASK)) &&
			(previousLineIndentMetadata & IndentConsts.INDENT_NEXTLINE_MASK)) {
			// Take the stop line equal to 0, and start from the previous line number - 1, and continue decreasing the line number by 1, while we continuously get the shouldIndentNextLine on that line
			let stopLine = 0;
			for (let i = previousLine - 1; i > 0; i--) {
				if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
					continue;
				}
				stopLine = i;
				break;
			}
			// After the above for loop, we will have found the first line above precedingUnIgnoredLine which does not validate the pattern shouldIndentNextLinePattern
			// Then we take the line after that, the first in its sequence, and take the indentation of this line

			// After some thought, this makes sense. We do this because the previous lines matches the indentNextLinePattern, hence we only wanted to indent the next line pattern, not the current line
			// So we need to move up to the first occurence in a sequence of a line that validates this check, and take its indentation

			return {
				indentation: strings.getLeadingWhitespace(model.getLineContent(stopLine + 1)),
				action: null,
				line: stopLine + 1
			};
		}

		if (honorIntentialIndent) {
			// If we really do want to honor the intentiontal indent, we will take the indentation in fron of the preceding unignored line
			return {
				indentation: strings.getLeadingWhitespace(model.getLineContent(precedingUnIgnoredLine)),
				action: null,
				line: precedingUnIgnoredLine
			};
		} else {
			// search from precedingUnIgnoredLine until we find one whose indent is not temporary
			for (let i = precedingUnIgnoredLine; i > 0; i--) {
				if (processedIndentRulesSupport.shouldIncrease(i)) {
					return {
						indentation: strings.getLeadingWhitespace(model.getLineContent(i)),
						action: IndentAction.Indent,
						line: i
					};
				} else if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
					let stopLine = 0;
					for (let j = i - 1; j > 0; j--) {
						if (processedIndentRulesSupport.shouldIndentNextLine(i)) {
							continue;
						}
						stopLine = j;
						break;
					}

					const lineContent = processLines.getStrippedLine(stopLine + 1);
					return {
						indentation: strings.getLeadingWhitespace(lineContent),
						action: null,
						line: stopLine + 1
					};
				} else if (processedIndentRulesSupport.shouldDecrease(i)) {
					return {
						indentation: strings.getLeadingWhitespace(model.getLineContent(i)),
						action: null,
						line: i
					};
				}
			}

			const lineContent = processLines.getStrippedLine(1);
			return {
				indentation: strings.getLeadingWhitespace(lineContent),
				action: null,
				line: 1
			};
		}
	}

	// Search for non-temporary indent
	return searchForNonTemporaryIndent(model, precedingValidLineNumber, processedIndentRulesSupport);
}

// TODO: do a search for EditorAutoIndentStrategy in order to find the usages and understand better its impact
export function getGoodIndentForLine(
	autoIndent: EditorAutoIndentStrategy,
	useOnEnterRulesForInheritedIndent: boolean,
	virtualModel: IVirtualModel,
	languageId: string,
	position: Position,
	indentConverter: IIndentConverter,
	languageConfigurationService: ILanguageConfigurationService
): string | null {
	console.log('getGoodIndentForLine');
	if (autoIndent < EditorAutoIndentStrategy.Full) {
		return null;
	}

	const richEditSupport = languageConfigurationService.getLanguageConfiguration(languageId);
	// When this language does not have a set of methods that we will use later in this method, we return null.
	// The particular language needs to support rich edits
	if (!richEditSupport) {
		return null;
	}

	const processedIndentRulesSupport = new ProcessedIndentRulesSupport(virtualModel, indentRulesSupport, languageConfigurationService);
	const indentData = getInheritIndentForLine(autoIndent, virtualModel, lineNumber, undefined, languageConfigurationService);

	// Suppose the indent object is not null
	if (indent) {
		// Find the line from which we apply the indent action. This is sort of the base line from which we continue the indentation.
		// This line can be undefined, for example when the current line number is 1 and it has no preceding lines, then the base line is undefined
		const inheritLine = indent.line;
		if (inheritLine !== undefined) {
			// Apply enter action as long as there are only whitespace lines between inherited line and this line.
			let shouldApplyEnterRules = true;

			// Go from the inherited line all the way to the lineNumber - 1
			// For each such intermediary line, we test if there are only whitespace characters. If this is the case, then we want to apply the enter rules
			// Otherwise if there is at least one line where there characters other than whitespace in between then we do not want to apply the enter rules
			for (let inBetweenLine = inheritLine; inBetweenLine < lineNumber - 1; inBetweenLine++) {
				const lineContent = processLines.getStrippedLine(inBetweenLine);
				if (!/^\s*$/.test(lineContent)) {
					shouldApplyEnterRules = false;
					break;
				}
			}
			// Suppose we want to apply the enter rules
			if (shouldApplyEnterRules) {
				// Pass in the auto indent strategy
				// For some reason previousLineText is empty?
				// The beforeEnterText is the line content of the inherited line
				// There is no afterEnterText
				const enterResult = richEditSupport.onEnter(autoIndent, '', virtualModel.getLineContent(inheritLine), '');

				if (enterResult) {
					// Get the indentation or the leading white spaces at the inherited line
					let indentation = strings.getLeadingWhitespace(virtualModel.getLineContent(inheritLine));

					// We remove 'removeText' characters from the indentation to get the new indentation string
					if (enterResult.removeText) {
						indentation = indentation.substring(0, indentation.length - enterResult.removeText);
					}

					if (
						(enterResult.indentAction === IndentAction.Indent) ||
						(enterResult.indentAction === IndentAction.IndentOutdent)
					) {
						// Shift the indent when we want to indent or indent/outdent
						indentation = indentConverter.shiftIndent(indentation);
					} else if (enterResult.indentAction === IndentAction.Outdent) {
						indentation = indentConverter.unshiftIndent(indentation);
					}

					if (processedIndentRulesSupport.shouldDecrease(lineNumber)) {
						indentation = indentConverter.unshiftIndent(indentation);
					}

					// add some text to the indentation result
					if (enterResult.appendText) {
						// indentation not necessarily made of just whitespaces, can contain other characters
						// Added in case the appendText contains whitespaces that should be taken into account in the return statement
						indentation += enterResult.appendText;
					}

					return strings.getLeadingWhitespace(indentation);
				}
			}
		}

		if (processedIndentRulesSupport.shouldDecrease(lineNumber)) {
			if (indentData.action === IndentAction.Indent) {
				return indentData.indentation;
			} else {
				// Otherwise we want to unshift the indentation
				return indentConverter.unshiftIndent(indent.indentation);
			}
		} else {
			// Inherited indent mentions to increase indent
			if (indent.action === IndentAction.Indent) {
				// Then increase indentation
				return indentConverter.shiftIndent(indent.indentation);
			} else {
				// Otherwise do not change current indent
				return indent.indentation;
			}
		}
	}
	return null;
}

export function getIndentForEnter(
	cursorConfig: CursorConfiguration,
	model: ITextModel,
	range: Range,
	indentConverter: IIndentConverter,
	languageConfigurationService: ILanguageConfigurationService
): { beforeEnter: string; afterEnter: string } | null {
	console.log('getIndentForEnter');
	if (autoIndent < EditorAutoIndentStrategy.Full) {
		console.log('return 1');
		return null;
	}
	const languageId = model.getLanguageIdAtPosition(range.startLineNumber, range.startColumn);
	const indentRulesSupport = validateAutoIndentPrerequisites(autoIndent, languageConfigurationService, languageId);
	if (!indentRulesSupport) {
		console.log('return 2');
		return null;
	}

	model.tokenization.forceTokenization(range.startLineNumber);
	const indentationContextProcessor = new IndentationContextProcessor(model, languageConfigurationService);
	const processedContextTokens = indentationContextProcessor.getProcessedTokenContextAroundRange(range);
	const afterEnterProcessedTokens = processedContextTokens.afterRangeProcessedTokens;
	const beforeEnterProcessedTokens = processedContextTokens.beforeRangeProcessedTokens;
	const beforeEnterIndent = strings.getLeadingWhitespace(beforeEnterProcessedTokens.getLineContent());

	const virtualModel = createVirtualModelWithModifiedTokensAtLine(model, range.startLineNumber, beforeEnterProcessedTokens);
	const languageIsDifferentFromLineStart = isLanguageDifferentFromLineStart(model, range.getStartPosition());
	const currentLine = model.getLineContent(range.startLineNumber);
	const currentLineIndent = strings.getLeadingWhitespace(currentLine);
	const afterEnterAction = getInheritIndentForLine(autoIndent, virtualModel, range.startLineNumber + 1, undefined, languageConfigurationService);
	console.log('afterEnterAction : ', JSON.stringify(afterEnterAction));
	if (!afterEnterAction) {
		const beforeEnter = languageIsDifferentFromLineStart ? currentLineIndent : beforeEnterIndent;
		return {
			beforeEnter: beforeEnter,
			afterEnter: beforeEnter
		};
	}

	let afterEnterIndent = languageIsDifferentFromLineStart ? currentLineIndent : afterEnterAction.indentation;

	// If we need to indent, then nident using indent converter
	if (afterEnterAction.action === IndentAction.Indent) {
		afterEnterIndent = indentConverter.shiftIndent(afterEnterIndent);
	}

	if (indentRulesSupport.shouldDecrease(cursorConfig.autoIndent, cursorConfig.useOnEnterRulesForInheritedIndent, afterEnterProcessedTokens.getLineContent())) {
		afterEnterIndent = indentConverter.unshiftIndent(afterEnterIndent);
	}

	console.log('return 4');
	console.log('embeddedLanguage : ', embeddedLanguage);
	console.log('currentLineIndent : ', currentLineIndent.length);
	console.log('beforeEnterIndent : ', beforeEnterIndent.length);
	console.log('afterEnterIndent : ', afterEnterIndent.length);
	return {
		beforeEnter: languageIsDifferentFromLineStart ? currentLineIndent : beforeEnterIndent,
		afterEnter: afterEnterIndent
	};
}

/**
 * Checks if typing a character should trigger decrease indentation
 */
function shouldTriggerDecreaseIndentation(
	indentRulesSupport: any,
	textAroundRange: string,
	textAroundRangeWithCharacter: string
): boolean {
	return !indentRulesSupport.shouldDecrease(textAroundRange) && 
		   indentRulesSupport.shouldDecrease(textAroundRangeWithCharacter);
}

/**
 * Calculates indentation for decrease indent scenario
 */
function getDecreaseIndentation(
	autoIndent: EditorAutoIndentStrategy,
	model: ITextModel,
	lineNumber: number,
	indentConverter: IIndentConverter,
	languageConfigurationService: ILanguageConfigurationService
): string | null {
	const indentationData = getInheritIndentForLine(autoIndent, model, lineNumber, false, languageConfigurationService);
	if (!indentationData) {
		return null;
	}

	let indentation = indentationData.indentation;
	if (indentationData.action !== IndentAction.Indent) {
		indentation = indentConverter.unshiftIndent(indentation);
	}

	return indentation;
}

/**
 * Checks conditions for auto-closing pair indentation
 */
function shouldIndentForAutoClosingPair(
	cursorConfig: CursorConfiguration,
	model: ITextModel,
	range: Range,
	ch: string,
	textAroundRange: string,
	indentRulesSupport: any,
	indentConverter: IIndentConverter,
	languageConfigurationService: ILanguageConfigurationService
): string | null {
	const previousLineNumber = range.startLineNumber - 1;
	if (previousLineNumber <= 0) {
		return null;
	}

	const previousLine = model.getLineContent(previousLineNumber);
	const indentationContextProcessor = new IndentationContextProcessor(model, languageConfigurationService);
	const processedContextTokens = indentationContextProcessor.getProcessedTokenContextAroundRange(range);
	const beforeRangeText = processedContextTokens.beforeRangeProcessedTokens.getLineContent();
	const afterRangeText = processedContextTokens.afterRangeProcessedTokens.getLineContent();
	const textAroundRangeWithCharacter = beforeRangeText + ch + afterRangeText;
	
	if (!indentRulesSupport.shouldIndentNextLine(previousLine) || 
		!indentRulesSupport.shouldIncrease(textAroundRangeWithCharacter)) {
		return null;
	}

	const inheritedIndentationData = getInheritIndentForLine(
		EditorAutoIndentStrategy.Full, 
		model, 
		range.startLineNumber, 
		false, 
		languageConfigurationService
	);
	const inheritedIndentation = inheritedIndentationData?.indentation;
	
	if (inheritedIndentation === undefined) {
		return null;
	}

	const currentLine = model.getLineContent(range.startLineNumber);
	const actualCurrentIndentation = strings.getLeadingWhitespace(currentLine);
	const inferredCurrentIndentation = indentConverter.shiftIndent(inheritedIndentation);
	
	// If the inferred current indentation is not equal to the actual current indentation, 
	// then the indentation has been intentionally changed, in that case keep it
	const inferredIndentationEqualsActual = inferredCurrentIndentation === actualCurrentIndentation;
	const textAroundRangeContainsOnlyWhitespace = /^\s*$/.test(textAroundRange);
	const autoClosingPairs = cursorConfig.autoClosingPairs.autoClosingPairsOpenByEnd.get(ch);
	const autoClosingPairExists = autoClosingPairs && autoClosingPairs.length > 0;
	const isChFirstNonWhitespaceCharacterAndInAutoClosingPair = autoClosingPairExists && textAroundRangeContainsOnlyWhitespace;
	
	if (inferredIndentationEqualsActual && isChFirstNonWhitespaceCharacterAndInAutoClosingPair) {
		return inheritedIndentation;
	}

	return null;
}
/**
 * We should always allow intentional indentation. It means, if users change the indentation of `lineNumber` and the content of
 * this line doesn't match decreaseIndentPattern, we should not adjust the indentation.
 */
export function getIndentActionForType(
	cursorConfig: CursorConfiguration,
	model: ITextModel,
	range: Range,
	ch: string,
	indentConverter: IIndentConverter,
	languageConfigurationService: ILanguageConfigurationService
): string | null {
	const autoIndent = cursorConfig.autoIndent;
	const languageId = model.getLanguageIdAtPosition(range.startLineNumber, range.startColumn);
	const indentRulesSupport = validateAutoIndentPrerequisites(autoIndent, languageConfigurationService, languageId);
	if (!indentRulesSupport) {
		return null;
	}

	const languageIsDifferentFromLineStart = isLanguageDifferentFromLineStart(model, range.getStartPosition());
	if (languageIsDifferentFromLineStart) {
		// this line has mixed languages and indentation rules will not work
		return null;
	}

	const indentationContextProcessor = new IndentationContextProcessor(model, languageConfigurationService);
	const processedContextTokens = indentationContextProcessor.getProcessedTokenContextAroundRange(range);
	const beforeRangeText = processedContextTokens.beforeRangeProcessedTokens.getLineContent();
	const afterRangeText = processedContextTokens.afterRangeProcessedTokens.getLineContent();
	const textAroundRange = beforeRangeText + afterRangeText;
	const textAroundRangeWithCharacter = beforeRangeText + ch + afterRangeText;

	// If previous content already matches decreaseIndentPattern, it means indentation of this line should already be adjusted
	// Users might change the indentation by purpose and we should honor that instead of readjusting.
	if (shouldTriggerDecreaseIndentation(indentRulesSupport, textAroundRange, textAroundRangeWithCharacter)) {
		// after typing `ch`, the content matches decreaseIndentPattern, we should adjust the indent to a good manner.
		// 1. Get inherited indent action
		const r = getInheritIndentForLine(autoIndent, model, range.getStartPosition(), false, languageConfigurationService);
		if (!r) {
			return null;
		}

		let indentation = r.indentation;
		// If not indent action, we unshift the indent
		if (r.action !== IndentAction.Indent) {
			indentation = indentConverter.unshiftIndent(indentation);
		}

		return indentation;
	}

	const previousLineNumber = range.startLineNumber - 1;
	if (range.isEmpty() && previousLineNumber > 0) {
		const previousLine = model.getLineContent(previousLineNumber);
		if (indentRulesSupport.shouldIndentNextLine(cursorConfig.autoIndent, cursorConfig.useOnEnterRulesForInheritedIndent, previousLine) && indentRulesSupport.shouldIncrease(cursorConfig.autoIndent, cursorConfig.useOnEnterRulesForInheritedIndent, textAroundRangeWithCharacter)) {
			const inheritedIndentationData = getInheritIndentForLine(cursorConfig.autoIndent, cursorConfig.useOnEnterRulesForInheritedIndent, model, range.startLineNumber, false, languageConfigurationService);
			const inheritedIndentation = inheritedIndentationData?.indentation;
			if (inheritedIndentation !== undefined) {
				const currentLine = model.getLineContent(range.startLineNumber);
				const actualCurrentIndentation = strings.getLeadingWhitespace(currentLine);
				const inferredCurrentIndentation = indentConverter.shiftIndent(inheritedIndentation);
				// If the inferred current indentation is not equal to the actual current indentation, then the indentation has been intentionally changed, in that case keep it
				const inferredIndentationEqualsActual = inferredCurrentIndentation === actualCurrentIndentation;
				const textAroundRangeContainsOnlyWhitespace = /^\s*$/.test(textAroundRange);
				const autoClosingPairs = cursorConfig.autoClosingPairs.autoClosingPairsOpenByEnd.get(ch);
				const autoClosingPairExists = autoClosingPairs && autoClosingPairs.length > 0;
				const isChFirstNonWhitespaceCharacterAndInAutoClosingPair = autoClosingPairExists && textAroundRangeContainsOnlyWhitespace;
				if (inferredIndentationEqualsActual && isChFirstNonWhitespaceCharacterAndInAutoClosingPair) {
					return inheritedIndentation;
				}
			}
		}
	}

	return null;
}

export function getIndentMetadata(
	model: ITextModel,
	autoIndent: EditorAutoIndentStrategy,
	useOnEnterRulesForInheritedIndent: boolean,
	lineNumber: number,
	languageConfigurationService: ILanguageConfigurationService
): number | null {
	const indentRulesSupport = validateAutoIndentPrerequisites(
		EditorAutoIndentStrategy.Full,
		languageConfigurationService,
		model.getLanguageId()
	);
	if (!indentRulesSupport) {
		return null;
	}
	if (lineNumber < 1 || lineNumber > model.getLineCount()) {
		return null;
	}
	// get metadata using the indent rules support for the specific line
	return indentRulesSupport.getIndentMetadata(model.getLineContent(lineNumber));
}

function createVirtualModelWithModifiedTokensAtLine(model: ITextModel, modifiedLineNumber: number, modifiedTokens: IViewLineTokens): IVirtualModel {
	const virtualModel: IVirtualModel = {
		tokenization: {
			getLineTokens: (lineNumber: number): IViewLineTokens => {
				if (lineNumber === modifiedLineNumber) {
					return modifiedTokens;
				} else {
					return model.tokenization.getLineTokens(lineNumber);
				}
			},
			getLanguageId: (): string => {
				return model.getLanguageId();
			},
			getLanguageIdAtPosition: (lineNumber: number, column: number): string => {
				return model.getLanguageIdAtPosition(lineNumber, column);
			},
		},
		getLineContent: (lineNumber: number): string => {
			if (lineNumber === modifiedLineNumber) {
				return modifiedTokens.getLineContent();
			} else {
				return model.getLineContent(lineNumber);
			}
		}
	};
	return virtualModel;
}

