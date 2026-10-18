/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTrustedTypesPolicy } from '../../../base/browser/trustedTypes.js';
import { CharCode } from '../../../base/common/charCode.js';
import * as strings from '../../../base/common/strings.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { applyFontInfo } from '../config/domFontInfo.js';
import { WrappingIndent } from '../../common/config/editorOptions.js';
import { StringBuilder } from '../../common/core/stringBuilder.js';
import { InjectedTextOptions, TextDirection } from '../../common/model.js';
import { ILineBreaksComputer, ILineBreaksComputerContext, ILineBreaksComputerFactory, ModelLineProjectionData } from '../../common/modelLineProjectionData.js';
import { FixedWidthInjectedTextRange, LineInjectedText } from '../../common/textModelEvents.js';
import { FontInfo, getFullwidthCharacterWidth } from '../../common/config/fontInfo.js';
import type { IFullwidthLetterSpacingProvider, IFullwidthLetterSpacingRequest } from '../../common/viewLayout/viewLineRenderer.js';
import { getFullwidthLetterSpacingProvider } from '../config/fullwidthLetterSpacing.js';

const ttPolicy = createTrustedTypesPolicy('domLineBreaksComputer', { createHTML: value => value });

const LINE_BREAK_LINE_HEIGHT = 300;
const DOM_LINE_BREAKS_COMPUTER_CLASS_NAME = 'dom-line-breaks-computer';

export class DOMLineBreaksComputerFactory implements ILineBreaksComputerFactory {

	public static create(targetWindow: Window): DOMLineBreaksComputerFactory {
		return new DOMLineBreaksComputerFactory(new WeakRef(targetWindow));
	}

	private _containerDomNode: HTMLDivElement | null = null;

	constructor(private targetWindow: WeakRef<Window>) {
	}

	public createLineBreaksComputer(context: ILineBreaksComputerContext, fontInfo: FontInfo, tabSize: number, wrappingColumn: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll', wrapOnEscapedLineFeeds: boolean, useTwoCellFullwidthCharacters: boolean): ILineBreaksComputer {
		const lineNumbers: number[] = [];
		return {
			addRequest: (lineNumber: number, previousLineBreakData: ModelLineProjectionData | null) => {
				lineNumbers.push(lineNumber);
			},
			finalize: () => {
				return createLineBreaks(assertReturnsDefined(this.targetWindow.deref()), context, lineNumbers, fontInfo, tabSize, wrappingColumn, wrappingIndent, wordBreak, useTwoCellFullwidthCharacters);
			}
		};
	}
}

function createLineBreaks(targetWindow: Window, context: ILineBreaksComputerContext, lineNumbers: number[], fontInfo: FontInfo, tabSize: number, firstLineBreakColumn: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll', useTwoCellFullwidthCharacters: boolean): (ModelLineProjectionData | null)[] {
	function createEmptyLineBreakWithPossiblyInjectedText(lineNumber: number): ModelLineProjectionData | null {
		const injectedTexts = context.getLineInjectedText(lineNumber);
		if (injectedTexts) {
			const lineContent = context.getLineContent(lineNumber);
			const lineText = LineInjectedText.applyInjectedText(lineContent, injectedTexts);

			const injectionOptions = injectedTexts.map(t => t.options);
			const injectionOffsets = injectedTexts.map(text => text.column - 1);

			// creating a `LineBreakData` with an invalid `breakOffsetsVisibleColumn` is OK
			// because `breakOffsetsVisibleColumn` will never be used because it contains injected text
			return new ModelLineProjectionData(injectionOffsets, injectionOptions, [lineText.length], [], 0);
		} else {
			return null;
		}
	}

	if (firstLineBreakColumn === -1) {
		const result: (ModelLineProjectionData | null)[] = [];
		for (let i = 0, len = lineNumbers.length; i < len; i++) {
			result[i] = createEmptyLineBreakWithPossiblyInjectedText(lineNumbers[i]);
		}
		return { data: result, domNode: null };
	}

	const overallWidth = Math.round(firstLineBreakColumn * fontInfo.typicalHalfwidthCharacterWidth);
	const fullwidthLetterSpacingProvider = getFullwidthLetterSpacingProvider(targetWindow, fontInfo, forceFullwidthCharacterWidth);
	const additionalIndent = (wrappingIndent === WrappingIndent.DeepIndent ? 2 : wrappingIndent === WrappingIndent.Indent ? 1 : 0);
	const additionalIndentSize = Math.round(tabSize * additionalIndent);
	const additionalIndentLength = Math.ceil(fontInfo.spaceWidth * additionalIndentSize);
	// Stretching full-width characters to two cells makes their width independent of the font, so the
	// width the font reports for them must not be used anywhere below.
	const fullwidthCharacterWidth = useTwoCellFullwidthCharacters ? 2 * fontInfo.spaceWidth : undefined;

	const containerDomNode = document.createElement('div');
	containerDomNode.classList.add(DOM_LINE_BREAKS_COMPUTER_CLASS_NAME);
	applyFontInfo(containerDomNode, fontInfo);

	const sb = new StringBuilder(10000);
	const wrappedTextIndentLengths: number[] = [];
	const renderLineContents: string[] = [];
	const allCharOffsets: number[][] = [];
	const allSpanStartOffsets: number[][] = [];
	const allVisibleColumns: number[][] = [];
	const lineContents: string[] = [];
	const lineFixedWidthRanges: FixedWidthInjectedTextRange[][] = [];
	const lineFullwidthLetterSpacingProviders: (IFullwidthLetterSpacingProvider | null)[] = [];
	const fullwidthLetterSpacingRequests: IFullwidthLetterSpacingRequest[] = [];
	for (let i = 0; i < lineNumbers.length; i++) {
		const lineNumber = lineNumbers[i];
		const injectedTexts = context.getLineInjectedText(lineNumber);
		const lineContent = LineInjectedText.applyInjectedText(context.getLineContent(lineNumber), injectedTexts);
		const provider = strings.containsRTL(lineContent) ? null : fullwidthLetterSpacingProvider;
		lineContents[i] = lineContent;
		lineFixedWidthRanges[i] = LineInjectedText.getFixedWidthInjectedTextRanges(injectedTexts);
		lineFullwidthLetterSpacingProviders[i] = provider;

		if (provider) {
			const graphemeIterator = new strings.GraphemeIterator(lineContent);
			while (!graphemeIterator.eol()) {
				const graphemeStartIndex = graphemeIterator.offset;
				graphemeIterator.nextGraphemeLength();
				if (strings.isFullWidthCharacterAt(lineContent, graphemeStartIndex)) {
					fullwidthLetterSpacingRequests.push({
						grapheme: lineContent.substring(graphemeStartIndex, graphemeIterator.offset),
						className: '',
					});
				}
			}
		}
	}
	fullwidthLetterSpacingProvider?.prepare(fullwidthLetterSpacingRequests);

	for (let i = 0; i < lineNumbers.length; i++) {
		const lineContent = lineContents[i];
		const fixedWidthRanges = lineFixedWidthRanges[i];
		const fullwidthLetterSpacingProviderForLine = lineFullwidthLetterSpacingProviders[i];
		const forceFullwidthCharacterWidthForLine = fullwidthLetterSpacingProviderForLine !== null;
		const fullwidthCharacterWidth = getFullwidthCharacterWidth(fontInfo, forceFullwidthCharacterWidthForLine);

		renderLineContents[i] = lineContent;
		let wrappedTextIndentLength = 0;
		let width = overallWidth;

		if (wrappingIndent !== WrappingIndent.None) {
			const firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
			if (firstNonWhitespaceIndex !== -1) {
				for (let i = 0; i < firstNonWhitespaceIndex; i++) {
					const fixedWidthRange = fixedWidthRanges[0];
					const isFixedWidthStart = fixedWidthRange && fixedWidthRange.startOffset === i;
					if (isFixedWidthStart) {
						firstNonWhitespaceIndex = i;
						break;
					} else {
						const charWidth = (
							lineContent.charCodeAt(i) === CharCode.Tab
								? (tabSize - (wrappedTextIndentLength % tabSize))
								: 1
						);
						wrappedTextIndentLength += charWidth;
					}
				}
				const indentWidth = Math.ceil(fontInfo.spaceWidth * wrappedTextIndentLength);

				// Force sticking to beginning of line if no character would fit except for the indentation
				if (indentWidth + (fullwidthCharacterWidth ?? fontInfo.typicalFullwidthCharacterWidth) > overallWidth) {
					firstNonWhitespaceIndex = 0;
					wrappedTextIndentLength = 0;
				} else {
					width = overallWidth - indentWidth;
				}
			}
		}

		const renderLineContent = lineContent.substr(firstNonWhitespaceIndex);
		const shiftedFixedWidthRanges = firstNonWhitespaceIndex === 0
			? fixedWidthRanges
			: fixedWidthRanges.map(range => ({
				startOffset: Math.max(0, range.startOffset - firstNonWhitespaceIndex),
				endOffset: range.endOffset - firstNonWhitespaceIndex,
				widthInEm: range.widthInEm
			}));
		const tmp = renderLine(renderLineContent, wrappedTextIndentLength, tabSize, width, sb, additionalIndentLength, shiftedFixedWidthRanges, fullwidthCharacterWidth);
		firstNonWhitespaceIndices[i] = firstNonWhitespaceIndex;
		wrappedTextIndentLengths[i] = wrappedTextIndentLength;
		renderLineContents[i] = renderLineContent;
		allCharOffsets[i] = tmp[0];
		allSpanStartOffsets[i] = tmp[2];
		allVisibleColumns[i] = tmp[1];
	}
	const html = sb.build();
	const trustedhtml = ttPolicy?.createHTML(html) ?? html;
	containerDomNode.innerHTML = trustedhtml as string;

	containerDomNode.style.position = 'absolute';
	containerDomNode.style.top = '10000px';
	if (wordBreak === 'keepAll') {
		// word-break: keep-all; overflow-wrap: anywhere
		containerDomNode.style.wordBreak = 'keep-all';
		containerDomNode.style.overflowWrap = 'anywhere';
	} else {
		// overflow-wrap: break-word
		containerDomNode.style.wordBreak = 'inherit';
		containerDomNode.style.overflowWrap = 'break-word';
	}
	targetWindow.document.body.appendChild(containerDomNode);

	const range = document.createRange();
	const lineDomNodes = Array.prototype.slice.call(containerDomNode.children, 0);

	const result: (ModelLineProjectionData | null)[] = [];
	for (let i = 0; i < lineNumbers.length; i++) {
		const lineDomNode = lineDomNodes[i];
		const breakOffsets: number[] | null = readLineBreaks(range, lineDomNode, renderLineContents[i], allCharOffsets[i], allSpanStartOffsets[i]);
		if (breakOffsets === null) {
			result[i] = createEmptyLineBreakWithPossiblyInjectedText(lineNumber);
			continue;
		}

		const wrappedTextIndentLength = wrappedTextIndentLengths[i] + additionalIndentSize;

		const breakOffsetsVisibleColumn: number[] = [];
		const breakOffsets = breakData.breakOffsets;
		const breakDomPositions = breakData.breakDomPositions;
		for (let j = 0, len = breakDomPositions.length; j < len; j++) {
			const breakDomPosition = breakDomPositions[j];
			breakOffsetsVisibleColumn[j] = characterMapping.getColumn(breakDomPosition.domPosition, breakDomPosition.partLength);
		}

		let injectionOptions: InjectedTextOptions[] | null;
		let injectionOffsets: number[] | null;
		const curInjectedTexts = context.getLineInjectedText(lineNumbers[i]);
		if (curInjectedTexts) {
			injectionOptions = curInjectedTexts.map(t => t.options);
			injectionOffsets = curInjectedTexts.map(text => text.column - 1);
		} else {
			injectionOptions = null;
			injectionOffsets = null;
		}

		result[i] = new ModelLineProjectionData(injectionOffsets, injectionOptions, breakOffsets, breakOffsetsVisibleColumn, wrappedTextIndentLength);
	}

	containerDomNode.remove();
	return result;
}

const enum Constants {
	SPAN_MODULO_LIMIT = 16384
}

function renderLine(lineContent: string, initialVisibleColumn: number, tabSize: number, width: number, sb: StringBuilder, wrappingIndentLength: number, fixedWidthRanges: readonly FixedWidthInjectedTextRange[], fullwidthCharacterWidth: number | undefined): [number[], number[], number[]] {

	if (wrappingIndentLength !== 0) {
		const hangingOffset = String(wrappingIndentLength);
		sb.appendString('text-indent: -');
		sb.appendString(hangingOffset);
		sb.appendString('px; padding-left: ');
		sb.appendString(hangingOffset);
		sb.appendString('px; box-sizing: border-box;');
	}
	sb.appendString('width:');
	sb.appendString(String(width));
	sb.appendString('px;">');

	const len = lineContent.length;
	let visibleColumn = initialVisibleColumn;
	let charOffset = 0;
	let fixedWidthRangeIndex = 0;
	const charOffsets: number[] = [];
	const spanStartOffsets: number[] = [0];
	const visibleColumns: number[] = [];
	let spanOpen = true;
	const fullwidthCharacterWidths = fullwidthLetterSpacingProvider === null ? null : strings.getFullwidthCharacterColumnWidths(lineContent);
	const fullwidthLetterSpacings = getFullwidthLetterSpacings(lineContent, fullwidthCharacterWidths, fullwidthLetterSpacingProvider);
	let spanLetterSpacing = fullwidthLetterSpacings?.[0];

	const appendNormalSpanStart = (letterSpacing: number | undefined): void => {
		if (letterSpacing !== undefined) {
			sb.appendString('<span style="letter-spacing:');
			sb.appendString(String(letterSpacing));
			sb.appendString('px;">');
		} else {
			sb.appendString('<span>');
		}
	};
	appendNormalSpanStart(spanLetterSpacing);
	for (let charIndex = 0; charIndex < len; charIndex++) {
		let fixedWidthRange = fixedWidthRanges[fixedWidthRangeIndex];
		const startsFixedWidth = fixedWidthRange && fixedWidthRange.startOffset === charIndex;
		const charCode = lineContent.charCodeAt(charIndex);
		const isFullWidthCharacter = fullwidthCharacterWidth !== undefined && strings.isFullWidthCharacter(charCode);
		if (startsFixedWidth) {
			if (spanOpen) {
				sb.appendString('</span>');
			}
			// Injected text that only reserves horizontal space covers no character, so it gets a span of
			// its own. Rendering it inside the span of the character below would make that character fixed
			// width as well. Several such injections can sit at the same offset.
			while (fixedWidthRange && fixedWidthRange.startOffset === charIndex && fixedWidthRange.endOffset === charIndex) {
				sb.appendString('<span style="display:inline-block;box-sizing:border-box;white-space:nowrap;width:');
				sb.appendString(String(fixedWidthRange.widthInEm));
				sb.appendString('em;">');
				sb.appendString('</span>');
				spanStartOffsets.push(charOffset);
				fixedWidthRange = fixedWidthRanges[++fixedWidthRangeIndex];
			}
			// The character below goes into a fixed width span if one still covers it, a normal one
			// otherwise. At most one such range can start here: injections at the same column are laid
			// out one after the other, so only an empty one leaves the next starting at the same offset.
			if (fixedWidthRange && fixedWidthRange.startOffset === charIndex) {
				sb.appendString('<span style="display:inline-block;box-sizing:border-box;white-space:nowrap;width:');
				sb.appendString(String(fixedWidthRange.widthInEm));
				sb.appendString('em;">');
				// The span carries a width of its own, so the character in it needs no correction.
				spanLetterSpacing = undefined;
			} else {
				appendNormalSpanStart(charLetterSpacing);
				spanLetterSpacing = charLetterSpacing;
			}
			spanStartOffsets.push(charOffset);
			spanOpen = true;
		} else if (isFullWidthCharacter) {
			if (spanOpen) {
				sb.appendString('</span>');
			}
			sb.appendString('<span class="mtkfullwidth" style="width:');
			sb.appendString(String(fullwidthCharacterWidth));
			sb.appendString('px;">');
			spanStartOffsets.push(charOffset);
			spanOpen = true;
		} else if (!spanOpen) {
			appendNormalSpanStart(charLetterSpacing);
			spanStartOffsets.push(charOffset);
			spanOpen = true;
			spanLetterSpacing = charLetterSpacing;
		} else if ((!fixedWidthRange || charIndex < fixedWidthRange.startOffset) && charLetterSpacing !== spanLetterSpacing) {
			sb.appendString('</span>');
			appendNormalSpanStart(charLetterSpacing);
			spanStartOffsets.push(charOffset);
			spanLetterSpacing = charLetterSpacing;
		} else if ((!fixedWidthRange || charIndex < fixedWidthRange.startOffset) && charIndex !== 0 && charIndex % Constants.SPAN_MODULO_LIMIT === 0) {
			sb.appendString('</span>');
			appendNormalSpanStart(spanLetterSpacing);
			spanStartOffsets.push(charOffset);
		}

		charOffsets[charIndex] = charOffset;
		visibleColumns[charIndex] = visibleColumn;
		let producedCharacters = 1;
		let charWidth = 1;
		if (isFullWidthCharacter) {
			sb.appendCharCode(charCode);
			charWidth = 2;
			sb.appendString('</span>');
			spanOpen = false;
		} else {
			switch (charCode) {
				case CharCode.Tab:
					producedCharacters = (tabSize - (visibleColumn % tabSize));
					charWidth = producedCharacters;
					for (let space = 1; space <= producedCharacters; space++) {
						if (space < producedCharacters) {
							sb.appendCharCode(0xA0); // &nbsp;
						} else {
							sb.appendASCIICharCode(CharCode.Space);
						}
					}
					break;

				case CharCode.Space:
					// `charCodeAt` past the end of the line yields `NaN`, which is not a space either.
					if (lineContent.charCodeAt(charIndex + 1) === CharCode.Space) {
						sb.appendCharCode(0xA0); // &nbsp;
					} else {
						sb.appendASCIICharCode(CharCode.Space);
					}
					break;

				case CharCode.LessThan:
					sb.appendString('&lt;');
					break;

				case CharCode.GreaterThan:
					sb.appendString('&gt;');
					break;

				case CharCode.Ampersand:
					sb.appendString('&amp;');
					break;

				case CharCode.Null:
					sb.appendString('&#00;');
					break;

				case CharCode.UTF8_BOM:
				case CharCode.LINE_SEPARATOR:
				case CharCode.PARAGRAPH_SEPARATOR:
				case CharCode.NEXT_LINE:
					sb.appendCharCode(0xFFFD);
					break;

				default:
					if (strings.isFullWidthCharacter(charCode)) {
						charWidth++;
					}
					if (charCode < 32) {
						sb.appendCharCode(9216 + charCode);
					} else {
						sb.appendCharCode(charCode);
					}
			}
		}
		// if (specialFontInfo) {
		// 	sb.appendString('</span>');
		// }

		charOffset += producedCharacters;
		if (startsFixedWidth) {
			charWidth = fixedWidthRange.widthInEm * columnsPerEm;
		} else if (fixedWidthRange && charIndex > fixedWidthRange.startOffset && charIndex < fixedWidthRange.endOffset) {
			charWidth = 0;
		}
		visibleColumn += charWidth;

		// A range that covers no character has already been closed above, and must not be consumed here:
		// its `endOffset` equals its `startOffset`, so this condition would hold one character too early.
		if (fixedWidthRange && fixedWidthRange.startOffset < fixedWidthRange.endOffset && charIndex + 1 === fixedWidthRange.endOffset) {
			sb.appendString('</span>');
			spanOpen = false;
			fixedWidthRangeIndex++;
		}
	}
	if (spanOpen) {
		sb.appendString('</span>');
	}
	// A spacing-only injection at the very end of the line is left out on purpose: nothing follows it,
	// so it cannot move a break point. `MonospaceLineBreaksComputer` ignores it for the same reason.

	charOffsets[lineContent.length] = charOffset;
	visibleColumns[lineContent.length] = visibleColumn;

	const renderLineInput = new RenderLineInput(
		useMonospaceOptimizations,
		fontInfo.canUseHalfwidthRightwardsArrow,
		lineContent,
		false,
		isBasicASCII,
		false,
		0,
		tokens,
		lineDecorations,
		tabSize,
		0,
		fontInfo.spaceWidth,
		fontInfo.middotWidth,
		fontInfo.wsmiddotWidth,
		stopRenderingLineAfter,
		renderWhitespace,
		renderControlCharacters,
		fontLigaturesEnabled,
		null,
		TextDirection.LTR,
		verticalScrollbarSize
	);
	const renderedLineOutput = renderViewLine(renderLineInput, sb);
	sb.appendString('</div>');

	return [charOffsets, visibleColumns, spanStartOffsets];
}

function getFullwidthLetterSpacings(lineContent: string, fullwidthCharacterWidths: Int8Array | null, provider: IFullwidthLetterSpacingProvider | null): (number | undefined)[] | null {
	if (fullwidthCharacterWidths === null || provider === null) {
		return null;
	}

	const requests: IFullwidthLetterSpacingRequest[] = [];
	const graphemes: { startOffset: number; endOffset: number; text: string }[] = [];
	const graphemeIterator = new strings.GraphemeIterator(lineContent);
	while (!graphemeIterator.eol()) {
		const startOffset = graphemeIterator.offset;
		graphemeIterator.nextGraphemeLength();
		if (fullwidthCharacterWidths[startOffset] !== 2) {
			continue;
		}
		const text = lineContent.substring(startOffset, graphemeIterator.offset);
		graphemes.push({ startOffset, endOffset: graphemeIterator.offset, text });
		requests.push({ grapheme: text, className: '' });
	}
	provider.prepare(requests);

	const result: (number | undefined)[] = new Array(lineContent.length);
	for (const grapheme of graphemes) {
		result.fill(provider.getLetterSpacing(grapheme.text, ''), grapheme.startOffset, grapheme.endOffset);
	}
	return result;
}

function readLineBreaks(range: Range, lineDomNode: HTMLDivElement, lineContent: string, charOffsets: number[], spanStartOffsets: number[]): number[] | null {
	if (lineContent.length <= 1) {
		return null;
	}
	const span = <HTMLSpanElement>Array.prototype.slice.call(lineDomNode.children, 0)[0];

	const breakOffsets: number[] = [];
	const breakDomPositions: BreakDomPosition[] = [];
	try {
		discoverBreaks(range, spans, charOffsets, spanStartOffsets, 0, null, lineContent.length - 1, null, breakOffsets);
	} catch (err) {
		console.error(err);
		return null;
	}

	// if (breakOffsets.length === 0) {
	// 	console.log('return 3');
	// 	return null;
	// }

	breakOffsets.push(lineContent.length);
	breakDomPositions.push(getBreakDomPosition(characterMapping, span, lineContent.length));
	return { breakOffsets, breakDomPositions };
}

function discoverBreaks(range: Range, spans: HTMLSpanElement[], charOffsets: number[], spanStartOffsets: number[], low: number, lowRects: DOMRectList | null, high: number, highRects: DOMRectList | null, result: number[]): void {
	if (low === high) {
		return;
	}

	lowRects = lowRects || readClientRect(range, spans, charOffsets[low], charOffsets[low + 1], spanStartOffsets);
	highRects = highRects || readClientRect(range, spans, charOffsets[high], charOffsets[high + 1], spanStartOffsets);

	if (Math.abs(lowRects[0].top - highRects[0].top) <= LINE_BREAK_LINE_HEIGHT / 2) {
		// same line
		return;
	}

	// there is at least one line break between these two offsets
	if (low + 1 === high) {
		// the two characters are adjacent, so the line break must be exactly between them
		breakOffsets.push(high);
		breakDomPositions.push(getBreakDomPosition(characterMapping, span, high));
		return;
	}

	const mid = low + ((high - low) / 2) | 0;
	const midRects = readClientRect(range, spans, charOffsets[mid], charOffsets[mid + 1], spanStartOffsets);
	discoverBreaks(range, spans, charOffsets, spanStartOffsets, low, lowRects, mid, midRects, result);
	discoverBreaks(range, spans, charOffsets, spanStartOffsets, mid, midRects, high, highRects, result);
}

function readClientRect(range: Range, spans: HTMLSpanElement[], startOffset: number, endOffset: number, spanStartOffsets: number[]): DOMRectList {
	if (!spanStartOffsets) {
		range.setStart(spans[(startOffset / Constants.SPAN_MODULO_LIMIT) | 0].firstChild!, startOffset % Constants.SPAN_MODULO_LIMIT);
		range.setEnd(spans[(endOffset / Constants.SPAN_MODULO_LIMIT) | 0].firstChild!, endOffset % Constants.SPAN_MODULO_LIMIT);
		return range.getClientRects();
	}
	const startSpanIndex = findSpanIndex(spanStartOffsets, startOffset);
	const endSpanIndex = findSpanIndex(spanStartOffsets, endOffset);
	range.setStart(spans[startSpanIndex].firstChild!, startOffset - spanStartOffsets[startSpanIndex]);
	range.setEnd(spans[endSpanIndex].firstChild!, endOffset - spanStartOffsets[endSpanIndex]);
	return range.getClientRects();
}

function findSpanIndex(spanStartOffsets: readonly number[], offset: number): number {
	let low = 0;
	let high = spanStartOffsets.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (spanStartOffsets[mid] <= offset) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low - 1;
}
