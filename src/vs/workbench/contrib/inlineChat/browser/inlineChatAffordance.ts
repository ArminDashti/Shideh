/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun, debouncedObservable, derived, observableSignalFromEvent, observableValue, runOnChange } from '../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../editor/browser/observableCodeEditor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InlineChatConfigKeys, CTX_INLINE_CHAT_AFFORDANCE_VISIBLE } from '../common/inlineChat.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { InlineChatAffordanceWidget } from './inlineChatAffordanceWidget.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { CursorChangeReason } from '../../../../editor/common/cursorEvents.js';
import { IInlineChatSessionService } from './inlineChatSessionService.js';
import { CodeActionController } from '../../../../editor/contrib/codeAction/browser/codeActionController.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

type InlineChatAffordanceEvent = {
	mode: string;
	id: string;
	commandId: string;
};

type InlineChatAffordanceClassification = {
	mode: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The affordance mode: editor.' };
	id: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'UUID to correlate shown and selected events.' };
	commandId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The command that was executed.' };
	owner: 'jrieken';
	comment: 'Tracks when the inline chat affordance is shown or selected.';
};

export class InlineChatAffordance extends Disposable {

	readonly #editor: ICodeEditor;
	readonly #instantiationService: IInstantiationService;
	readonly #selectionData = observableValue<Selection | undefined>(this, undefined);

	constructor(
		editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		@IInlineChatSessionService inlineChatSessionService: IInlineChatSessionService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.#editor = editor;
		this.#instantiationService = instantiationService;

		const editorObs = observableCodeEditor(this.#editor);
		const affordance = observableConfigValue<'off' | 'editor'>(InlineChatConfigKeys.Affordance, 'off', configurationService);
		const debouncedSelection = debouncedObservable(editorObs.cursorSelection, 500);

		const selectionData = this.#selectionData;

		const ctxAffordanceVisible = CTX_INLINE_CHAT_AFFORDANCE_VISIBLE.bindTo(contextKeyService);
		this._store.add({ dispose: () => ctxAffordanceVisible.reset() });

		let explicitSelection = false;
		let affordanceId: string | undefined;

		this._store.add(runOnChange(editorObs.selections, (value, _prev, events) => {
			explicitSelection = events.every(e => e.reason === CursorChangeReason.Explicit);
			if (!value || value.length !== 1 || value[0].isEmpty() || !explicitSelection) {
				selectionData.set(undefined, undefined);
			}
		);

		this._store.add(autorun(r => {
			const value = debouncedSelection.read(r);
			if (!value || value.isEmpty() || !explicitSelection || this.#editor.getModel()?.getValueInRange(value).match(/^\s+$/)) {
				selectionData.set(undefined, undefined);
				affordanceId = undefined;
				return;
			}
			affordanceId = generateUuid();
			const mode = affordance.read(undefined);
			if (mode === 'editor') {
				telemetryService.publicLog2<InlineChatAffordanceEvent, InlineChatAffordanceClassification>('inlineChatAffordance/shown', { mode, id: affordanceId, commandId: '' });
			}
			selectionData.set(value, undefined);
		}));

		this._store.add(autorun(r => {
			if (chatEntiteldService.sentimentObs.read(r).hidden) {
				selectionData.set(undefined, undefined);
			}
		}));

		const hasSessionObs = derived(r => {
			observableSignalFromEvent(this, inlineChatSessionService.onDidChangeSessions).read(r);
			const model = editorObs.model.read(r);
			return model ? inlineChatSessionService.getSessionByTextModel(model.uri) !== undefined : false;
		});

		const isDiffModifiedEditorObs = derived(r => !!diffInfoObs.read(r));

		// Hide when the editor context menu shows
		this._store.add(this.#editor.onContextMenu(() => {
			selectionData.set(undefined, undefined);
		}));

		// Hide when the editor loses focus (e.g., switching tabs in notebooks)
		this._store.add(autorun(r => {
			if (!editorObs.isFocused.read(r)) {
				selectionData.set(undefined, undefined);
			}
		}));

		this._store.add(autorun(r => {
			const sel = selectionData.read(r);
			const mode = affordance.read(r);
			ctxAffordanceVisible.set(sel !== undefined && mode === 'editor');
		}));

		const editorAffordance = this.#instantiationService.createInstance(
			InlineChatAffordanceWidget,
			this.#editor,
			derived(r => affordance.read(r) === 'editor' ? selectionData.read(r) : undefined)
		);
		this._store.add(editorAffordance);

		this._store.add(editorAffordance.onDidRunAction(commandId => {
			if (affordanceId) {
				telemetryService.publicLog2<InlineChatAffordanceEvent, InlineChatAffordanceClassification>('inlineChatAffordance/selected', { mode: affordance.get(), id: affordanceId, commandId });
			}
		}));

		this._store.add(autorun(r => {
			const mode = affordance.read(r);
			const hideWithSelection = mode === 'editor';
			const controller = CodeActionController.get(this.#editor);
			if (controller) {
				controller.onlyLightBulbWithEmptySelection = hideWithSelection;
			}
		}));

	}

	dismiss(): void {
		this.#selectionData.set(undefined, undefined);
	}
}

// --- Selection Tracking -------------------------------------------------------

/**
 * Tracks the user's explicit selection in the editor.
 * In diff editors, also accepts empty selections on diff-changed lines.
 */
class SelectionTracker extends Disposable {

	readonly selectionData = observableValue<Selection | undefined>(this, undefined);

	constructor(
		editorObs: ObservableCodeEditor,
		editor: ICodeEditor,
		diffMappings: IObservable<readonly DetailedLineRangeMapping[] | undefined>,
		chatEntitlementService: IChatEntitlementService,
		inlineChatSessionService: IInlineChatSessionService,
	) {
		super();

		const debouncedSelection = debouncedObservable(editorObs.cursorSelection, 500);
		let explicitSelection = false;

		this._store.add(runOnChange(editorObs.selections, (_value, _prev, events) => {
			explicitSelection = events.every(e => e.reason === CursorChangeReason.Explicit);
			this.selectionData.set(undefined, undefined);
		}));

		this._store.add(autorun(r => {
			const value = debouncedSelection.read(r);
			if (!value || !explicitSelection) {
				this.selectionData.set(undefined, undefined);
				return;
			}

			if (value.isEmpty()) {
				const mappings = diffMappings.read(r);
				if (mappings) {
					const cursorLine = value.getPosition().lineNumber;
					if (mappings.some(m => m.modified.contains(cursorLine))) {
						this.selectionData.set(value, undefined);
						return;
					}
				}
				this.selectionData.set(undefined, undefined);
				return;
			}

			if (editor.getModel()?.getValueInRange(value).match(/^\s+$/)) {
				this.selectionData.set(undefined, undefined);
				return;
			}
			this.selectionData.set(value, undefined);
		}));

		this._store.add(autorun(r => {
			if (chatEntitlementService.sentimentObs.read(r).hidden) {
				this.selectionData.set(undefined, undefined);
			}
		}));

		const hasSessionObs = derived(r => {
			observableSignalFromEvent(this, inlineChatSessionService.onDidChangeSessions).read(r);
			const model = editorObs.model.read(r);
			return model ? inlineChatSessionService.getSessionByTextModel(model.uri) !== undefined : false;
		});

		this._store.add(autorun(r => {
			if (hasSessionObs.read(r)) {
				this.selectionData.set(undefined, undefined);
			}
		}));
	}
}

// --- Normal Editor Affordance -------------------------------------------------

/**
 * Manages gutter and editor affordances for non-diff editors.
 * These are suppressed when the editor becomes the modified side of a diff editor.
 */
class NormalEditorAffordance extends Disposable {

	constructor(
		instantiationService: IInstantiationService,
		editorObs: ObservableCodeEditor,
		editor: ICodeEditor,
		configurationService: IConfigurationService,
		selectionData: IObservable<Selection | undefined>,
		isDiffModifiedEditorObs: IObservable<boolean>,
		menuData: ISettableObservable<{ rect: DOMRect; above: boolean; lineNumber: number } | undefined>,
	) {
		super();

		const affordance = observableConfigValue<'off' | 'gutter' | 'editor'>(InlineChatConfigKeys.Affordance, 'off', configurationService);

		this._store.add(instantiationService.createInstance(
			InlineChatGutterAffordance,
			editorObs,
			derived(r => !isDiffModifiedEditorObs.read(r) && affordance.read(r) === 'gutter' ? selectionData.read(r) : undefined),
			menuData
		));

		this._store.add(instantiationService.createInstance(
			InlineChatEditorAffordance,
			editor,
			derived(r => !isDiffModifiedEditorObs.read(r) && affordance.read(r) === 'editor' ? selectionData.read(r) : undefined)
		));
	}
}

// --- Diff Editor Affordance ---------------------------------------------------

type MenuData = { rect: DOMRect; above: boolean; lineNumber: number };

/**
 * Manages the diff-editor-specific affordance:
 * - Auto-shows the input widget on selections/cursor on diff lines
 * - Intercepts keyboard input to redirect typing into the input widget
 * - Submits prompts to the chat widget with the diff hunk as attachment
 */
class DiffEditorAffordance extends Disposable {

	private readonly _diffDisposables = this._store.add(new DisposableStore());

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _inputWidget: InlineChatInputWidget,
		private readonly _selectionData: IObservable<Selection | undefined>,
		diffInfoObs: IObservable<{ diffEditor: IDiffEditor } | undefined>,
		private readonly _diffMappings: IObservable<readonly DetailedLineRangeMapping[] | undefined>,
		isDiffModifiedEditorObs: IObservable<boolean>,
		private readonly _menuData: ISettableObservable<MenuData | undefined>,
		private readonly _chatWidgetService: IChatWidgetService,
		private readonly _diffCommentsService: IDiffCommentsService,
	) {
		super();

		// React to diff editor appearing/disappearing
		this._store.add(autorun(r => {
			const info = diffInfoObs.read(r);
			this._diffDisposables.clear();
			this._inputWidget.setCustomSubmitHandler(undefined);

			if (!info) {
				return;
			}

			this._setupSubmitHandler();
			this._setupKeyboardInterception();
		}));

		// Auto-show the input widget when in diff editor mode
		this._store.add(autorun(r => {
			if (!isDiffModifiedEditorObs.read(r)) {
				return;
			}

			const sel = this._selectionData.read(r);
			if (!sel) {
				this._menuData.set(undefined, undefined);
				return;
			}

			this._showInputForSelection(sel, r);
		}));
	}

	private _setupSubmitHandler(): void {
		this._inputWidget.setCustomSubmitHandler(async (text) => {
			const model = this._editor.getModel();
			if (!model) {
				return;
			}

			// Determine the session resource from the last focused chat widget
			const widget = this._chatWidgetService.lastFocusedWidget;
			const sessionResource = widget?.viewModel?.sessionResource;
			if (!sessionResource) {
				return;
			}

			// Determine the range for this comment
			let range: IRange | undefined;
			const sel = this._selectionData.read(undefined);
			if (sel && !sel.isEmpty()) {
				range = Range.lift(sel);
			} else if (sel) {
				const cursorLine = sel.getPosition().lineNumber;
				const mappings = this._diffMappings.read(undefined);
				const mapping = mappings?.find(m => m.modified.contains(cursorLine));
				if (mapping) {
					range = mapping.modified.toInclusiveRange() ?? undefined;
				}
			}

			if (!range) {
				return;
			}

			// Create a comment via the service (this also updates the chat attachment)
			this._diffCommentsService.addComment(sessionResource, model.uri, range, text);
		});
	}

	private _setupKeyboardInterception(): void {
		this._diffDisposables.add(this._editor.onKeyDown(e => {
			if (this._inputWidget.position.read(undefined) === null || this._inputWidget.isFocused) {
				return;
			}

			if (e.keyCode === KeyCode.Tab && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				this._inputWidget.focusInput();
				return;
			}

			if (!e.ctrlKey && !e.altKey && !e.metaKey && e.browserEvent.key.length === 1) {
				e.preventDefault();
				e.stopPropagation();
				this._inputWidget.focusInput(e.browserEvent.key);
				return;
			}
		}));
	}

	private _showInputForSelection(sel: Selection, r: IReader): void {
		let lineNumber: number;
		let above: boolean;

		if (!sel.isEmpty()) {
			above = sel.getDirection() === SelectionDirection.RTL;
			lineNumber = sel.getPosition().lineNumber;
		} else {
			const cursorLine = sel.getPosition().lineNumber;
			const mappings = this._diffMappings.read(r);
			const mapping = mappings?.find(m => m.modified.contains(cursorLine));
			if (!mapping) {
				return;
			}
			({ lineNumber, above } = computeDiffHunkPosition(mapping, cursorLine, this._editor));
		}

		const scrolledPos = this._editor.getScrolledVisiblePosition(sel.getPosition());
		if (!scrolledPos) {
			return;
		}
		const editorDomNode = this._editor.getDomNode()!;
		const editorRect = editorDomNode.getBoundingClientRect();

		this._menuData.set({
			rect: new DOMRect(editorRect.left + scrolledPos.left, editorRect.top + scrolledPos.top, 0, scrolledPos.height),
			above,
			lineNumber,
		}, undefined);
	}
}

// --- Utilities ----------------------------------------------------------------

/**
 * For empty selections on diff lines, compute where the input should render.
 */
function computeDiffHunkPosition(
	mapping: DetailedLineRangeMapping,
	cursorLine: number,
	editor: ICodeEditor
): { lineNumber: number; above: boolean } {
	const diffLength = mapping.modified.length;

	let candidateAboveLine: number;
	let candidateBelowLine: number;

	if (diffLength <= 6) {
		candidateAboveLine = mapping.modified.startLineNumber - 1;
		candidateBelowLine = mapping.modified.endLineNumberExclusive;
	} else {
		candidateAboveLine = cursorLine - 2;
		candidateBelowLine = cursorLine + 2;
	}

	const visibleRanges = editor.getVisibleRanges();
	const isLineVisible = (line: number) =>
		line >= 1 && visibleRanges.some(range =>
			line >= range.startLineNumber && line <= range.endLineNumber
		);

	const aboveVisible = isLineVisible(candidateAboveLine);
	const belowVisible = isLineVisible(candidateBelowLine);

	if (aboveVisible && !belowVisible) {
		return { lineNumber: candidateAboveLine, above: true };
	}
	if (!aboveVisible && belowVisible) {
		return { lineNumber: candidateBelowLine, above: false };
	}
	return { lineNumber: candidateAboveLine, above: true };
}
