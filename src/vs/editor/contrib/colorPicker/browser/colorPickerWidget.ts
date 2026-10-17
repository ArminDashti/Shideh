/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './colorPicker.css';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { ColorPickerModel } from './colorPickerModel.js';
import { IEditorHoverColorPickerWidget } from '../../hover/browser/hoverTypes.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorPickerBody } from './colorPickerParts/colorPickerBody.js';
import { ColorPickerHeader } from './colorPickerParts/colorPickerHeader.js';
import { ColorPickerWidgetType } from './colorPickerParticipantUtils.js';

const $ = dom.$;

export class ColorPickerWidget extends Widget implements IEditorHoverColorPickerWidget {

	private readonly _domNode: HTMLElement;

	body: StandaloneColorPickerBody;

	constructor(container: Node, readonly model: ColorPickerModel, private pixelRatio: number, themeService: IThemeService, type: ColorPickerWidgetType) {
		super();

		this._register(PixelRatio.getInstance(dom.getWindow(container)).onDidChange(() => this.layout()));

		this._domNode = $('.colorpicker-widget');
		container.appendChild(this._domNode);

		this.header = this._register(new ColorPickerHeader(this._domNode, this.model, themeService, type));
		this.body = this._register(new ColorPickerBody(this._domNode, this.model, this.pixelRatio, type));
	}

	getId(): string {
		return StandaloneColorPickerWidget.ID;
	}

	layout(): void {
		this.body.layout();
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}
}

export abstract class AbstractColorPicker extends Disposable {

	protected _editor: IActiveCodeEditor;
	private _context: IEditorHoverRenderContext;

	constructor(
		editor: IActiveCodeEditor,
		colorHover: IColorHover,
		context: IEditorHoverRenderContext
	) {
		super();
		this._editor = editor;
		this._context = context;
		this._setMinimumDimensionsOfHover(context, editor);
		this._registerListeners(colorHover);
	}

	protected abstract _registerListeners(colorHover: IColorHover): void;

	protected _updateEditorModel(editor: IActiveCodeEditor, range: Range, model: ColorPickerModel): Range {
		const textEdits: ISingleEditOperation[] = [];
		const edit = model.presentation.textEdit ?? { range, text: model.presentation.label, forceMoveMarkers: false };
		textEdits.push(edit);

		if (model.presentation.additionalTextEdits) {
			textEdits.push(...model.presentation.additionalTextEdits);
		}
		const replaceRange = Range.lift(edit.range);
		const trackedRange = editor.getModel()._setTrackedRange(null, replaceRange, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
		editor.executeEdits('colorpicker', textEdits);
		editor.pushUndoStop();
		return editor.getModel()._getTrackedRange(trackedRange) ?? replaceRange;
	}

	protected async _updateColorPresentations(editorModel: ITextModel, colorPickerModel: ColorPickerModel, color: Color, range: Range, colorHover: IColorHover) {
		const colorPresentations = await getColorPresentations(editorModel, {
			range: range,
			color: {
				red: color.rgba.r / 255,
				green: color.rgba.g / 255,
				blue: color.rgba.b / 255,
				alpha: color.rgba.a
			}
		}, colorHover.provider, CancellationToken.None);
		colorPickerModel.colorPresentations = colorPresentations || [];
	}

	protected _hide(): void {
		this._context.hide();
		this._editor.focus();
	}

	private _setMinimumDimensionsOfHover(context: IEditorHoverRenderContext, editor: ICodeEditor): void {
		if (!context.setMinimumDimensions) {
			return;
		}
		const minimumHeight = editor.getOption(EditorOption.lineHeight) + 8;
		context.setMinimumDimensions(new dom.Dimension(302, minimumHeight));
	}
}

export class StandaloneColorPicker extends AbstractColorPicker {

	private _color: Color | undefined;
	private _colorPicker: StandaloneColorPickerWidget;

	constructor(
		editor: IActiveCodeEditor,
		colorHover: IColorHover,
		foundInEditor: boolean,
		context: IEditorHoverRenderContext,
		themeService: IThemeService,
	) {
		super(editor, colorHover, context);
		const model = colorHover.model;
		const pixelRatio = editor.getOption(EditorOption.pixelRatio);
		this._colorPicker = this._register(new StandaloneColorPickerWidget(context.fragment, model, pixelRatio, themeService, foundInEditor));
	}

	public layout(): void {
		this._colorPicker.layout();
	}

	public async updateEditorModel(colorHover: IColorHover): Promise<void> {
		if (!this._editor.hasModel()) {
			return;
		}
		const colorPickerModel = colorHover.model;
		let range = new Range(colorHover.range.startLineNumber, colorHover.range.startColumn, colorHover.range.endLineNumber, colorHover.range.endColumn);
		if (this._color) {
			await this._updateColorPresentations(this._editor.getModel(), colorPickerModel, this._color, range, colorHover);
			range = this._updateEditorModel(this._editor, range, colorPickerModel);
		}
	}

	protected _registerListeners(colorHover: IColorHover): void {
		const colorModel = colorHover.model;
		const color = colorModel.color;
		this._color = color;
		const range = Range.lift(colorHover.range);
		const editorModel = this._editor.getModel();
		this._updateColorPresentations(editorModel, colorModel, color, range, colorHover);
		this._register(colorModel.onColorFlushed((color: Color) => {
			this._color = color;
		}));
		this._register(this._editor.onDidChangeModelContent(() => {
			this._hide();
		}));
		this._register(colorModel.onDidChangeColor((color: Color) => {
			this._updateColorPresentations(editorModel, colorModel, color, range, colorHover);
		}));
	}
}

export class HoverColorPicker extends AbstractColorPicker {

	public color: ColorHover;

	private _colorPicker: HoverColorPickerWidget;

	constructor(
		editor: IActiveCodeEditor,
		colorHover: ColorHover,
		context: IEditorHoverRenderContext,
		themeService: IThemeService,
	) {
		super(editor, colorHover, context);
		const model = colorHover.model;
		const pixelRatio = editor.getOption(EditorOption.pixelRatio);
		this.color = colorHover;
		this._colorPicker = this._register(new HoverColorPickerWidget(context.fragment, model, pixelRatio, themeService));
	}

	public get domNode(): HTMLElement {
		return this._colorPicker.domNode;
	}

	public layout(): void {
		this._colorPicker.layout();
	}

	protected override _registerListeners(colorHover: IColorHover): void {
		const editorModel = this._editor.getModel();
		const colorModel = colorHover.model;
		let range = Range.lift(colorHover.range);
		let editorUpdatedByColorPicker = false;
		this._register(colorModel.onColorFlushed(async (color: Color) => {
			await this._updateColorPresentations(editorModel, colorModel, color, range, colorHover);
			editorUpdatedByColorPicker = true;
			range = this._updateEditorModel(this._editor, range, colorModel);
		}));
		this._register(this._editor.onDidChangeModelContent(() => {
			if (editorUpdatedByColorPicker) {
				editorUpdatedByColorPicker = false;
			} else {
				this._hide();
			}
		}));
		this._register(colorModel.onDidChangeColor((color: Color) => {
			this._updateColorPresentations(editorModel, colorModel, color, range, colorHover);
		}));
	}
}

