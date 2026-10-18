/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension, getWindow } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { TestAccessibilityService } from '../../../../platform/accessibility/test/common/testAccessibilityService.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { emptyProgressRunner, IEditorProgressService } from '../../../../platform/progress/common/progress.js';
import { IDiffProviderFactoryService } from '../../../browser/widget/diffEditor/diffProviderFactoryService.js';
import { DiffEditorOptions } from '../../../browser/widget/diffEditor/diffEditorOptions.js';
import { DiffEditorWidget } from '../../../browser/widget/diffEditor/diffEditorWidget.js';
import { CodeEditorWidget } from '../../../browser/widget/codeEditor/codeEditorWidget.js';
import { MouseTargetType } from '../../../browser/editorBrowser.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { DiffEditorViewModel, UnchangedRegion } from '../../../browser/widget/diffEditor/diffEditorViewModel.js';
import { RefCounted } from '../../../browser/widget/diffEditor/utils.js';
import { LineRange } from '../../../common/core/ranges/lineRange.js';
import { IDocumentDiff, IDocumentDiffProvider, IDocumentDiffProviderOptions } from '../../../common/diff/documentDiffProvider.js';
import { linesDiffComputers } from '../../../common/diff/linesDiffComputers.js';
import { DetailedLineRangeMapping } from '../../../common/diff/rangeMapping.js';
import { instantiateTextModel } from '../../common/testTextModel.js';
import { TestDiffProviderFactoryService } from '../diff/testDiffProviderFactoryService.js';
import { createCodeEditorServices } from '../testCodeEditor.js';

suite('DiffEditorWidget2', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('inline deleted margins share the editor mouse move listener', async () => {
		const services = new ServiceCollection();
		services.set(IAccessibilitySignalService, new class extends mock<IAccessibilitySignalService>() { }());
		services.set(IEditorProgressService, new class extends mock<IEditorProgressService>() {
			override show() { return emptyProgressRunner; }
		}());
		services.set(IDiffProviderFactoryService, new TestDiffProviderFactoryService());
		const instantiationService = createCodeEditorServices(disposables, services);
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const lines = Array.from({ length: 40 }, (_, i) => `unchanged ${i}\nkeep ${i}\nmore ${i}\n`);
		const original = disposables.add(instantiateTextModel(instantiationService, lines.map((line, i) => `deleted ${i}\n${line}`).join('')));
		const modified = disposables.add(instantiateTextModel(instantiationService, lines.join('')));
		const widget = disposables.add(instantiationService.createInstance(DiffEditorWidget, container, {
			renderSideBySide: true,
			useInlineViewWhenSpaceIsLimited: false,
			renderGutterMenu: false,
			experimental: { useTrueInlineView: false },
		}, {
			originalEditor: { contributions: [] },
			modifiedEditor: { contributions: [] },
		}));
		const model = disposables.add(RefCounted.create(widget.createViewModel({ original, modified })));
		widget.layout(new Dimension(800, 500));
		widget.setDiffModel(model);
		try {
			await widget.waitForDiff();
			const editor = widget.getModifiedEditor();
			assert.ok(editor instanceof CodeEditorWidget);
			// eslint-disable-next-line local/code-no-bracket-notation-for-identifiers
			const mouseMoveEmitter = editor['_onMouseMove'];
			// eslint-disable-next-line local/code-no-bracket-notation-for-identifiers
			const listenerCount = () => mouseMoveEmitter['_size'];
			const sideBySideListeners = listenerCount();
			widget.updateOptions({ renderSideBySide: false });
			const inlineListeners = listenerCount();
			const margins = container.querySelectorAll<HTMLElement>('.inline-deleted-margin-view-zone');
			const visibility = () => Array.from(margins).slice(0, 2).map(margin => margin.querySelector<HTMLElement>('.lightbulb-glyph')!.style.visibility);
			const moveToMargin = (index: number, type: MouseTargetType.CONTENT_VIEW_ZONE | MouseTargetType.GUTTER_VIEW_ZONE, viewZoneId = margins[index].getAttribute('monaco-view-zone')!) => {
				const position = new Position(1, 1);
				mouseMoveEmitter.fire({
					event: new StandardMouseEvent(getWindow(container), new MouseEvent('mousemove', { clientY: margins[index].getBoundingClientRect().top + 2 })),
					target: {
						type, element: margins[index], mouseColumn: 1, position, range: Range.fromPositions(position),
						detail: { viewZoneId, position, positionBefore: null, positionAfter: position, afterLineNumber: 0 },
					},
				});
			};
			moveToMargin(0, MouseTargetType.CONTENT_VIEW_ZONE);
			const firstHovered = visibility();
			moveToMargin(1, MouseTargetType.GUTTER_VIEW_ZONE);
			const secondHovered = visibility();
			moveToMargin(1, MouseTargetType.GUTTER_VIEW_ZONE, 'unrelated-view-zone');
			const leftMargins = visibility();
			widget.updateOptions({ renderSideBySide: true });
			assert.deepStrictEqual({
				marginCount: margins.length,
				inlineListeners,
				sideBySideAgainListeners: listenerCount(),
				firstHovered, secondHovered, leftMargins,
			}, {
				marginCount: 40,
				inlineListeners: sideBySideListeners,
				sideBySideAgainListeners: sideBySideListeners,
				firstHovered: ['visible', 'hidden'],
				secondHovered: ['hidden', 'visible'],
				leftMargins: ['hidden', 'hidden'],
			});
		} finally {
			widget.setDiffModel(null);
		}
	});

	for (const renderSideBySide of [true, false]) {
		test(`compact disclosures expand and collapse with a persistent keyboard target (side by side: ${renderSideBySide})`, async () => {
			const services = new ServiceCollection();
			services.set(IAccessibilitySignalService, new class extends mock<IAccessibilitySignalService>() { }());
			services.set(IEditorProgressService, new class extends mock<IEditorProgressService>() {
				override show() { return emptyProgressRunner; }
			}());
			services.set(IDiffProviderFactoryService, new TestDiffProviderFactoryService());
			const instantiationService = createCodeEditorServices(disposables, services);
			const container = document.createElement('div');
			document.body.appendChild(container);
			disposables.add(toDisposable(() => container.remove()));
			const lines = Array.from({ length: 40 }, (_, i) => `const value${i} = ${i};`);
			const original = disposables.add(instantiateTextModel(instantiationService, lines.join('\n')));
			lines[20] = 'const value20 = 100;';
			const modified = disposables.add(instantiateTextModel(instantiationService, lines.join('\n')));
			const widget = disposables.add(instantiationService.createInstance(DiffEditorWidget, container, {
				renderSideBySide,
				renderGutterMenu: false,
				useInlineViewWhenSpaceIsLimited: false,
				hideUnchangedRegions: { enabled: true, contextLineCount: 2, minimumLineCount: 4 },
			}, {
				variant: 'compact',
				originalEditor: { contributions: [] },
				modifiedEditor: { contributions: [] },
			}));
			const model = disposables.add(RefCounted.create(widget.createViewModel({ original, modified })));
			widget.layout(new Dimension(800, 500));
			widget.setDiffModel(model);
			try {
				await widget.waitForDiff();
				assert.ok(model.object instanceof DiffEditorViewModel);
				const region = model.object.unchangedRegions.get()[0];
				const toggle = container.querySelector<HTMLElement>('.editor.modified .disclosure-toggle')!;
				const initiallyHidden = region.getHiddenModifiedRange(undefined).length;
				toggle.focus();
				toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				const expanded = {
					hiddenLines: region.getHiddenModifiedRange(undefined).length,
					ariaExpanded: toggle.getAttribute('aria-expanded'),
					retainsFocus: document.activeElement === toggle,
					retainsControl: toggle.isConnected,
				};
				toggle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
				assert.deepStrictEqual({
					expanded,
					collapsedHiddenLines: region.getHiddenModifiedRange(undefined).length,
					collapsedAriaExpanded: toggle.getAttribute('aria-expanded'),
				}, {
					expanded: { hiddenLines: 0, ariaExpanded: 'true', retainsFocus: true, retainsControl: true },
					collapsedHiddenLines: initiallyHidden,
					collapsedAriaExpanded: 'false',
				});
			} finally {
				widget.setDiffModel(null);
			}
		});
	}

	suite('width based layout', () => {
		test('commits temporary inline when smoothly enlarging from automatic inline', () => {
			const options = new DiffEditorOptions({
				renderSideBySide: true,
				renderSideBySideInlineBreakpoint: 900,
				useInlineViewWhenSpaceIsLimited: true,
			}, new TestAccessibilityService());

			options.setWidth(1000);
			const initiallySideBySide = options.renderSideBySide.get();
			options.setWidth(800, 1000);
			const inlineDuringResize = options.renderSideBySide.get();
			const temporaryInlineAfterShrinking = options.temporaryInlineMode.get();
			options.setWidth(1000, 1000);
			const restoredDuringResize = options.renderSideBySide.get();
			options.setWidth(800, 1000);
			const temporaryInlineAfterEndingNarrow = options.temporaryInlineMode.get();
			options.setWidth(1000, 800);
			const wideAfterInlineWasCommitted = options.renderSideBySide.get();
			const temporaryInlineMode = options.temporaryInlineMode.get();
			options.setWidth(800);
			const temporaryInlineAfterBecomingNarrow = options.temporaryInlineMode.get();
			options.setWidth(1000, 800);
			options.resetWidthBasedLayout();
			const wideAfterResettingAutomatic = options.renderSideBySide.get();
			options.setWidth(800);
			const automaticInlineResult = options.renderSideBySideInAutomaticMode.get();
			options.setWidth(1000);
			const automaticSideBySideResult = options.renderSideBySideInAutomaticMode.get();
			options.updateOptions({ renderSideBySide: false });
			options.updateOptions({ renderSideBySide: true });

			assert.deepStrictEqual({
				initiallySideBySide,
				inlineDuringResize,
				temporaryInlineAfterShrinking,
				restoredDuringResize,
				temporaryInlineAfterEndingNarrow,
				wideAfterInlineWasCommitted,
				temporaryInlineMode,
				temporaryInlineAfterBecomingNarrow,
				wideAfterResettingAutomatic,
				automaticInlineResult,
				automaticSideBySideResult,
				wideAfterExplicitlyRestoringAuto: options.renderSideBySide.get(),
			}, {
				initiallySideBySide: true,
				inlineDuringResize: false,
				temporaryInlineAfterShrinking: false,
				restoredDuringResize: true,
				temporaryInlineAfterEndingNarrow: false,
				wideAfterInlineWasCommitted: false,
				temporaryInlineMode: true,
				temporaryInlineAfterBecomingNarrow: false,
				wideAfterResettingAutomatic: true,
				automaticInlineResult: false,
				automaticSideBySideResult: true,
				wideAfterExplicitlyRestoringAuto: true,
			});
		});

		test('keeps auto layout after a non-resize layout change', () => {
			const options = new DiffEditorOptions({
				renderSideBySide: true,
				renderSideBySideInlineBreakpoint: 900,
				useInlineViewWhenSpaceIsLimited: true,
			}, new TestAccessibilityService());

			options.setWidth(800);
			const narrow = options.renderSideBySide.get();
			options.setWidth(1000);

			assert.deepStrictEqual({
				narrow,
				wideAfterLayoutChange: options.renderSideBySide.get(),
			}, {
				narrow: false,
				wideAfterLayoutChange: true,
			});
		});
	});

	suite('UnchangedRegion', () => {
		function serialize(regions: UnchangedRegion[]): unknown {
			return regions.map(r => `${r.originalUnchangedRange} - ${r.modifiedUnchangedRange}`);
		}

		test('overlapping tracked regions are compared with the last retained region', () => {
			const regions = [
				new UnchangedRegion(150, 150, 53, 0, 0),
				new UnchangedRegion(160, 160, 10, 0, 0),
				new UnchangedRegion(180, 180, 10, 0, 0),
				new UnchangedRegion(220, 220, 10, 0, 0),
			];
			const retained = filterWithPrevious(regions, (current, previous) => !previous || (
				current.originalLineNumber >= previous.originalLineNumber + previous.lineCount
				&& current.modifiedLineNumber >= previous.modifiedLineNumber + previous.lineCount
			));
			const hidden = retained.map(region => new LineRangeMapping(region.getHiddenOriginalRange(undefined), region.getHiddenModifiedRange(undefined)));

			assert.deepStrictEqual(LineRangeMapping.inverse(hidden, 250, 250).map(range => range.toString()), [
				'{[1,150)->[1,150)}',
				'{[203,220)->[203,220)}',
				'{[230,251)->[230,251)}',
			]);
		});

		test('Everything changed', () => {
			assert.deepStrictEqual(serialize(UnchangedRegion.fromDiffs(
				[new DetailedLineRangeMapping(new LineRange(1, 10), new LineRange(1, 10), [])],
				10,
				10,
				3,
				3,
			)), []);
		});

		test('Nothing changed', () => {
			assert.deepStrictEqual(serialize(UnchangedRegion.fromDiffs(
				[],
				10,
				10,
				3,
				3,
			)), [
				'[1,11) - [1,11)'
			]);
		});

		test('Change in the middle', () => {
			assert.deepStrictEqual(serialize(UnchangedRegion.fromDiffs(
				[new DetailedLineRangeMapping(new LineRange(50, 60), new LineRange(50, 60), [])],
				100,
				100,
				3,
				3,
			)), ([
				'[1,47) - [1,47)',
				'[63,101) - [63,101)'
			]));
		});

		test('Change at the end', () => {
			assert.deepStrictEqual(serialize(UnchangedRegion.fromDiffs(
				[new DetailedLineRangeMapping(new LineRange(99, 100), new LineRange(100, 100), [])],
				100,
				100,
				3,
				3,
			)), (['[1,96) - [1,96)']));
		});

		test('Preserves visible state when line range shrinks', () => {
			const regions = [
				new UnchangedRegion(1, 1, 10, 3, 5).withUpdatedLineRange(2, 3, 6, undefined),
				new UnchangedRegion(1, 1, 10, 8, 2).withUpdatedLineRange(2, 3, 5, undefined),
			];

			assert.deepStrictEqual(regions.map(region => ({
				originalRange: region.originalUnchangedRange.toString(),
				modifiedRange: region.modifiedUnchangedRange.toString(),
				visibleLineCountTop: region.visibleLineCountTop.get(),
				visibleLineCountBottom: region.visibleLineCountBottom.get(),
			})), [{
				originalRange: '[2,8)',
				modifiedRange: '[3,9)',
				visibleLineCountTop: 3,
				visibleLineCountBottom: 3,
			}, {
				originalRange: '[2,7)',
				modifiedRange: '[3,8)',
				visibleLineCountTop: 5,
				visibleLineCountBottom: 0,
			}]);
		});
	});

	suite('DiffEditorViewModel', () => {
		test('applies concurrent modified edits before normalizing inner changes', async () => {
			const disposables = new DisposableStore();
			try {
				const instantiationService = createModelServices(disposables);
				const original = disposables.add(instantiateTextModel(instantiationService, 'keep1\nkeep2\nkeep3\norig4'));
				const modified = disposables.add(instantiateTextModel(instantiationService, 'keep1\nkeep2\nkeep3\nmod4'));
				const diffProviderFactoryService = new ConcurrentEditDiffProviderFactoryService(() => {
					modified.applyEdits([{ range: new Range(1, 1, 2, 1), text: '' }]);
				});
				const options = new DiffEditorOptions({}, new TestAccessibilityService());
				const viewModel = disposables.add(new DiffEditorViewModel({ original, modified }, options, diffProviderFactoryService));

				await viewModel.waitForDiff();

				const diff = viewModel.diff.get();
				assert.ok(diff);

				for (const mapping of diff.mappings) {
					assert.ok(mapping.lineRangeMapping.original.endLineNumberExclusive <= original.getLineCount() + 1);
					assert.ok(mapping.lineRangeMapping.modified.endLineNumberExclusive <= modified.getLineCount() + 1);
					for (const innerChange of mapping.lineRangeMapping.innerChanges ?? []) {
						assert.doesNotThrow(() => modified.getLineMaxColumn(innerChange.modifiedRange.endLineNumber));
					}
				}
			} finally {
				disposables.dispose();
			}
		});
	});
});

class ConcurrentEditDiffProviderFactoryService implements IDiffProviderFactoryService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly editDuringResolve: () => void) { }

	createDiffProvider(): IDocumentDiffProvider {
		return new ConcurrentEditDiffProvider(this.editDuringResolve);
	}
}

class ConcurrentEditDiffProvider implements IDocumentDiffProvider {
	private didInjectEdit = false;
	readonly onDidChange = Event.None;

	constructor(private readonly editDuringResolve: () => void) { }

	computeDiff(original: ITextModel, modified: ITextModel, options: IDocumentDiffProviderOptions): Promise<IDocumentDiff> {
		const originalLines = original.getLinesContent();
		const modifiedLines = modified.getLinesContent();
		const result = linesDiffComputers.getDefault().computeDiff(originalLines, modifiedLines, options);

		return new Promise<IDocumentDiff>(resolve => {
			queueMicrotask(() => {
				resolve({
					changes: result.changes,
					quitEarly: result.hitTimeout,
					identical: original.getValue() === modified.getValue(),
					moves: result.moves,
				});
				if (!this.didInjectEdit) {
					this.didInjectEdit = true;
					this.editDuringResolve();
				}
			});
		});
	}
}
