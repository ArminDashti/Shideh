/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/modalEditorPart.css';
import { $, addDisposableListener, append, Dimension, EventHelper, EventType, hide, IDimension, isHTMLElement, setVisibility, show } from '../../../../base/browser/dom.js';
import { GlobalPointerMoveMonitor } from '../../../../base/browser/globalPointerMoveMonitor.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { ActionBar, prepareActions } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Action, Separator } from '../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Orientation, Sash, SashState } from '../../../../base/browser/ui/sash/sash.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResizableHTMLElement } from '../../../../base/browser/ui/resizable/resizable.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar, WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Orientation, OrthogonalEdge, Sash, SashState } from '../../../../base/browser/ui/sash/sash.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorGroupView, IEditorPartsView } from './editor.js';
import { EditorPart } from './editorPart.js';
import { GroupDirection, GroupsOrder, IModalEditorPart, GroupActivationReason } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService, USE_MODAL_EDITOR_SETTING, UseModalEditorMode } from '../../../services/editor/common/editorService.js';
import { EditorPartModalContext, EditorPartModalMaximizedContext, EditorPartModalNavigationContext, EditorPartModalSidebarContext, EditorPartModalSidebarVisibleContext } from '../../../common/contextkeys.js';
import { EditorResourceAccessor, IEditorCommandsContext, SideBySideEditor, Verbosity } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ResourceLabel } from '../../labels.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { CLOSE_MODAL_EDITOR_COMMAND_ID, MOVE_MODAL_EDITOR_TO_MAIN_COMMAND_ID, MOVE_MODAL_EDITOR_TO_WINDOW_COMMAND_ID, NAVIGATE_MODAL_EDITOR_NEXT_COMMAND_ID, NAVIGATE_MODAL_EDITOR_PREVIOUS_COMMAND_ID, TOGGLE_MODAL_EDITOR_MAXIMIZED_COMMAND_ID, TOGGLE_MODAL_EDITOR_SIDEBAR_COMMAND_ID } from './editorCommands.js';
import { IModalEditorContentFooter, IModalEditorNavigation, IModalEditorPartOptions, IModalEditorSidebar, isModalEditorOptionsProvider } from '../../../../platform/editor/common/editor.js';

const MODAL_MIN_WIDTH_DEFAULT = 400;
const MODAL_MIN_HEIGHT_DEFAULT = 300;
const MODAL_MAX_DEFAULT_WIDTH = 1400;
const MODAL_MAX_DEFAULT_HEIGHT = 900;
const MODAL_BORDER_WIDTH = 1; // 1px border on each side
const MODAL_BORDER_SIZE = MODAL_BORDER_WIDTH * 2;
const MODAL_HEADER_HEIGHT = 33; // Fallback only — actual height is measured from the rendered header element to account for the compact-header variant.
const MODAL_SNAP_THRESHOLD = 20;
const MODAL_MAXIMIZED_PADDING = 16;
const MODAL_SIDEBAR_MIN_WIDTH = 160;
const MODAL_SIDEBAR_DEFAULT_WIDTH = 260;
const MODAL_SIDEBAR_MIN_HEIGHT = 160;
const MODAL_SIDEBAR_DEFAULT_HEIGHT = 240;
const MODAL_SIDEBAR_PADDING = 8; // matches CSS padding on sidebar container
const MODAL_SIDEBAR_BORDER_WIDTH = 1; // matches the separator border on the sidebar container
const MODAL_CONTENT_FOOTER_BORDER_WIDTH = 1;

const defaultModalEditorAllowableCommands = new Set([

	// Application
	'workbench.action.quit',
	'workbench.action.reloadWindow',
	'workbench.action.toggleFullScreen',

	// Quick access
	'workbench.action.gotoSymbol',
	'workbench.action.gotoLine',

	// Zoom
	'workbench.action.zoomIn',
	'workbench.action.zoomOut',
	'workbench.action.zoomReset',

	// File operations
	'workbench.action.files.save',
	'workbench.action.files.saveAll',
	'workbench.action.files.revert',

	// Close editors
	'workbench.action.closeActiveEditor',
	'workbench.action.closeAllEditors',
	'workbench.action.closeEditorsInGroup',
	'workbench.action.closeUnmodifiedEditors',

	// Settings
	'workbench.action.openSettings',
	'workbench.action.openSettings2',
	'workbench.action.openSettingsJson',
	'workbench.action.openGlobalSettings',
	'workbench.action.openApplicationSettingsJson',
	'workbench.action.openRawDefaultSettings',
	'workbench.action.openWorkspaceSettings',
	'workbench.action.openWorkspaceSettingsFile',
	'workbench.action.openFolderSettings',
	'workbench.action.openFolderSettingsFile',
	'workbench.action.openRemoteSettings',
	'workbench.action.openRemoteSettingsFile',
	'workbench.action.openAccessibilitySettings',
	'workbench.action.configureLanguageBasedSettings',

	// Keybindings
	'workbench.action.openGlobalKeybindings',
	'workbench.action.openDefaultKeybindingsFile',
	'workbench.action.openGlobalKeybindingsFile',
	'workbench.action.openKeyboardLayoutPicker',

	// Modal editor
	CLOSE_MODAL_EDITOR_COMMAND_ID,
	MOVE_MODAL_EDITOR_TO_MAIN_COMMAND_ID,
	MOVE_MODAL_EDITOR_TO_WINDOW_COMMAND_ID,
	TOGGLE_MODAL_EDITOR_MAXIMIZED_COMMAND_ID,
	NAVIGATE_MODAL_EDITOR_PREVIOUS_COMMAND_ID,
	NAVIGATE_MODAL_EDITOR_NEXT_COMMAND_ID,
	TOGGLE_MODAL_EDITOR_SIDEBAR_COMMAND_ID,
]);

const MODAL_EDITOR_CUSTOM_SIZE_KEY = 'modalEditorPart.customSize';
const MIN_MODAL_WIDTH = 400;
const MIN_MODAL_HEIGHT = 300;

const defaultModalEditorAllowableCommands = new Set([
	'workbench.action.quit',
	'workbench.action.reloadWindow',
	'workbench.action.closeActiveEditor',
	'workbench.action.closeAllEditors',
	'workbench.action.files.save',
	'workbench.action.files.saveAll',
]);

export interface ICreateModalEditorPartResult {
	readonly part: ModalEditorPartImpl;
	readonly instantiationService: IInstantiationService;
	readonly disposables: DisposableStore;
}

interface IModalEditorSidebarController {

	readonly onDidResize: Event<void>;

	getWidth(): number;
	getHeight(): number;
	getPreferredWidth(): number;
	getPlacement(): 'left' | 'bottom';
	hasCustomWidth(): boolean;
	clampWidth(modalWidth: number): void;

	isVisible(): boolean;
	setVisible(visible: boolean): void;

	prepareLayout(width: number, height: number, minimumEditorHeight: number): void;
	layout(height: number): void;
	updateContent(content: IModalEditorSidebar): void;
}

export class ModalEditorPart {

	constructor(
		private readonly editorPartsView: IEditorPartsView,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
	}

	async create(options?: IModalEditorPartOptions): Promise<ICreateModalEditorPartResult> {
		if (options?.sidebar?.sidebarHeight !== undefined && (!Number.isFinite(options.sidebar.sidebarHeight) || options.sidebar.sidebarHeight <= 0)) {
			throw new Error(localize('invalidModalSidebarHeight', "The modal sidebar height must be a positive finite number."));
		}
		const contentFooter = options?.contentFooter;
		if (contentFooter && (!Number.isFinite(contentFooter.height) || contentFooter.height <= 0)) {
			throw new Error(localize('invalidModalContentFooterHeight', "The modal content footer height must be a positive finite number."));
		}
		const disposables = new DisposableStore();

		// Create modal container
		const modalElement = $('.monaco-modal-editor-block.dimmed');
		modalElement.tabIndex = -1;
		this.layoutService.mainContainer.appendChild(modalElement);
		disposables.add(toDisposable(() => modalElement.remove()));

		// Context key service scoped to the entire modal element so that the
		// modal-level context keys (e.g. `editorPartModal`) are active when focus
		// is anywhere inside the modal. Both the editor part and the sidebar
		// content are wired up to descend from this service so that commands like
		// closing the modal on `Escape` work regardless of which area has focus
		// (e.g. the sidebar changes tree).
		const modalContextKeyService = disposables.add(this.contextKeyService.createScoped(modalElement));

		disposables.add(addDisposableListener(modalElement, EventType.MOUSE_DOWN, e => {
			if (e.target === modalElement) {
				EventHelper.stop(e, true);

				// Close modal when clicking outside the dialog
				void editorPart.close();
			}
		}));

		let useModalMode = this.configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING);
		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(USE_MODAL_EDITOR_SETTING)) {
				useModalMode = this.configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING);
			}
		}));

		disposables.add(addDisposableListener(modalElement, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);

			// Prevent unsupported commands unless all editors open in modal
			if (useModalMode !== 'all') {
				const resolved = this.keybindingService.softDispatch(event, this.layoutService.mainContainer);
				if (resolved.kind === ResultKind.KbFound && resolved.commandId) {
					if (
						resolved.commandId.startsWith('workbench.') &&
						!defaultModalEditorAllowableCommands.has(resolved.commandId)
					) {
						EventHelper.stop(event, true);
					}
				}
			}
		}));

		// Resizable wrapper
		const resizableElement = new ResizableHTMLElement();
		disposables.add(toDisposable(() => resizableElement.dispose()));
		resizableElement.domNode.classList.add('modal-editor-resizable');
		const configuredModalMinWidth = this.configurationService.getValue<number>('workbench.editor.modalMinWidth');
		const safeModalMinWidth = Number.isFinite(configuredModalMinWidth) ? configuredModalMinWidth : MODAL_MIN_WIDTH_DEFAULT;
		const modalMinWidth = Math.max(200, safeModalMinWidth);
		const configuredModalMinHeight = this.configurationService.getValue<number>('workbench.editor.modalMinHeight');
		const safeModalMinHeight = Number.isFinite(configuredModalMinHeight) ? configuredModalMinHeight : MODAL_MIN_HEIGHT_DEFAULT;
		const modalMinHeight = Math.max(200, safeModalMinHeight);
		const effectiveMinWidth = modalMinWidth + (options?.sidebar ? MODAL_SIDEBAR_MIN_WIDTH : 0);
		resizableElement.minSize = new Dimension(effectiveMinWidth, modalMinHeight);
		modalElement.appendChild(resizableElement.domNode);

		const shadowElement = resizableElement.domNode.appendChild($('.modal-editor-shadow'));

		// Create editor part container
		const titleId = 'modal-editor-title';
		const editorPartContainer = $('.part.editor.modal-editor-part', {
			role: 'dialog',
			'aria-modal': 'true',
			'aria-labelledby': titleId,
		});
		shadowElement.appendChild(editorPartContainer);

		// Create header with title and close button
		const headerElement = editorPartContainer.appendChild($('.modal-editor-header'));

		// Sidebar toggle button (only when sidebar is configured)
		const sidebarToggleContainer = append(headerElement, $('div.modal-editor-sidebar-toggle'));
		if (!options?.sidebar) {
			hide(sidebarToggleContainer);
		}
		const sidebarToggleIcon = options?.sidebar?.sidebarHidden ? Codicon.layoutSidebarLeftOff : Codicon.layoutSidebarLeft;
		const sidebarToggleAction = disposables.add(new Action(TOGGLE_MODAL_EDITOR_SIDEBAR_COMMAND_ID, localize('toggleSidebar', "Toggle Sidebar"), ThemeIcon.asClassName(sidebarToggleIcon), true));
		const sidebarToggleActionBar = disposables.add(new ActionBar(sidebarToggleContainer));
		sidebarToggleActionBar.push(sidebarToggleAction, { icon: true, label: false });

		// Title element
		const titleElement = append(headerElement, $('div.modal-editor-title.show-file-icons'));
		titleElement.id = titleId;
		titleElement.textContent = '';

		// Action buttons using ActionBar for proper accessibility
		const actionBarContainer = append(headerElement, $('div.modal-editor-action-container'));
		const actionBar = disposables.add(new ActionBar(actionBarContainer));

		// Open as Editor
		const openAsEditorAction = disposables.add(new Action(
			'modalEditorPart.openAsEditor',
			localize('openAsEditor', "Open as Editor"),
			ThemeIcon.asClassName(Codicon.openInProduct),
			true,
			async () => {
				const activeEditor = editorPart.activeGroup.activeEditor;
				if (activeEditor) {
					await this.editorService.openEditor(activeEditor, { pinned: true, preserveFocus: false }, this.editorPartsView.mainPart.activeGroup.id);
					editorPart.close();
				}
			}
		));
		actionBar.push(openAsEditorAction, { icon: true, label: false });

		// Close action
		const closeAction = disposables.add(new Action(
			'modalEditorPart.close',
			localize('close', "Close"),
			ThemeIcon.asClassName(widgetClose),
			true,
			async () => editorPart.close()
		));
		actionBar.push(closeAction, { icon: true, label: false, keybinding: localize('escape', "Escape") });

		// Bottom-capable sidebars follow the editor in focus order without reparenting rendered content.
		const sidebarAfterEditor = options?.sidebar?.placement === 'bottom' || options?.sidebar?.placement === 'auto';
		const initialSidebar = sidebarAfterEditor ? undefined : this.createSidebar(editorPartContainer, headerElement, options?.sidebar, modalContextKeyService, disposables, !!contentFooter);
		if (initialSidebar?.isVisible()) {
			editorPartContainer.classList.add('has-sidebar');
		}

		// Create the editor part (scoped to the modal context key service so that
		// the editor area also descends from it)
		const modalInstantiationService = disposables.add(this.instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, modalContextKeyService]
		)));
		const editorPart = disposables.add(modalInstantiationService.createInstance(
			ModalEditorPartImpl,
			mainWindow.vscodeWindowId,
			this.editorPartsView,
			localize('modalEditorPart', "Modal Editor Area")
		));
		disposables.add(this.editorPartsView.registerPart(editorPart));
		editorPart.create(editorPartContainer);

		const layoutContentFooter = this.createContentFooter(editorPartContainer, contentFooter, modalContextKeyService, disposables);
		const sidebarResult = initialSidebar ?? (sidebarAfterEditor ? this.createSidebar(editorPartContainer, headerElement, options?.sidebar, modalContextKeyService, disposables, !!contentFooter) : undefined);
		if (sidebarResult) {
			editorPartContainer.classList.toggle('has-sidebar', sidebarResult.isVisible());
			disposables.add(sidebarResult.onDidResize(() => layoutModal()));
		}

		disposables.add(Event.once(editorPart.onWillClose)(() => disposables.dispose()));
		const pendingBubbleCloseEvents = new WeakSet<KeyboardEvent>();
		disposables.add(addDisposableListener(mainWindow, EventType.KEY_DOWN, e => pendingBubbleCloseEvents.delete(e)));
		// Capture close keybindings before focused controls can stop propagation.
		disposables.add(addDisposableListener(modalElement, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			const resolved = this.keybindingService.softDispatch(event, event.target);
			if (resolved.kind === ResultKind.KbFound && resolved.commandId === CLOSE_MODAL_EDITOR_COMMAND_ID) {
				if (resolved.isBubble) {
					pendingBubbleCloseEvents.add(e);
					// Dispatch after target delivery only when propagation did not reach the window.
					queueMicrotask(() => {
						if (pendingBubbleCloseEvents.delete(e)) {
							this.keybindingService.dispatchEvent(event, event.target);
						}
					});
					return;
				}
				const shouldPreventDefault = this.keybindingService.dispatchEvent(event, event.target);
				event.stopPropagation();
				if (shouldPreventDefault) {
					event.preventDefault();
				}
			}
		}, true));
		disposables.add(Event.runAndSubscribe(editorPart.onDidChangeNavigation, ((navigation: IModalEditorNavigation | undefined) => {
			if (navigation && navigation.total > 1) {
				show(navigationContainer);
				navigationLabel.textContent = localize('navigationCounter', "{0} of {1}", navigation.current + 1, navigation.total);
				previousButton.enabled = navigation.current > 0;
				nextButton.enabled = navigation.current < navigation.total - 1;
			} else {
				hide(navigationContainer);
			}
		}), editorPart.navigation));
		const updateSidebarToggleIcon = () => {
			const icon = sidebarResult?.getPlacement() === 'bottom'
				? (editorPart.sidebarHidden ? Codicon.layoutPanelOff : Codicon.layoutPanel)
				: (editorPart.sidebarHidden ? Codicon.layoutSidebarLeftOff : Codicon.layoutSidebarLeft);
			sidebarToggleAction.class = ThemeIcon.asClassName(icon);
		};
		if (sidebarResult) {
			disposables.add(Event.runAndSubscribe(sidebarResult.onDidResize, () => {
				if (sidebarResult.isVisible()) {
					editorPart.sidebarWidth = sidebarResult.hasCustomWidth() ? sidebarResult.getPreferredWidth() : undefined;
				}
			}));
			disposables.add(editorPart.onDidToggleSidebar(() => {
				sidebarResult.setVisible(!editorPart.sidebarHidden);
				updateSidebarToggleIcon();
				layoutModal();
			}));
		}

		// Wire up sidebar toggle button
		disposables.add(sidebarToggleActionBar.onDidRun(() => editorPart.toggleSidebar()));

		// Create scoped instantiation service
		const modalEditorService = this.editorService.createScoped(editorPart, disposables);
		const scopedInstantiationService = disposables.add(editorPart.scopedInstantiationService.createChild(new ServiceCollection(
			[IEditorService, modalEditorService]
		)));

		// Create editor toolbar
		const editorActionsToolbarContainer = append(actionBarContainer, $('div.modal-editor-editor-actions'));
		const editorActionsToolbar = disposables.add(scopedInstantiationService.createInstance(WorkbenchToolBar, editorActionsToolbarContainer, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			highlightToggledItems: true,
		}));

		const editorActionsSeparator = append(actionBarContainer, $('div.modal-editor-action-separator'));
		const editorActionsDisposables = disposables.add(new DisposableStore());
		const updateEditorActions = () => {
			editorActionsDisposables.clear();

			const editorActions = editorPart.activeGroup.createEditorActions(editorActionsDisposables, MenuId.ModalEditorEditorTitle);
			editorActionsDisposables.add(editorActions.onDidChange(() => updateEditorActions()));

			const { primary, secondary } = editorActions.actions;
			editorActionsToolbar.setActions(prepareActions(primary), prepareActions(secondary));

			const hasActions = primary.length > 0 || secondary.length > 0;
			setVisibility(hasActions, editorActionsSeparator);
		};
		disposables.add(Event.runAndSubscribe(modalEditorService.onDidActiveEditorChange, () => updateEditorActions()));
		disposables.add(modalEditorService.onDidEditorsChange(() => editorPart.enforceModalPartOptions()));

		// Create global toolbar
		disposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, actionBarContainer, MenuId.ModalEditorTitle, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			menuOptions: { shouldForwardArgs: true }
		}));

		// Create label
		const label = disposables.add(scopedInstantiationService.createInstance(ResourceLabel, titleElement, {}));
		const labelChangeDisposable = disposables.add(new MutableDisposable());
		let trackedEditor: EditorInput | undefined;
		const updateLabel = () => {
			const activeEditor = editorPart.activeGroup.activeEditor;
			if (activeEditor) {
				const { labelFormat } = editorPart.partOptions;

				label.element.setResource(
					{
						resource: EditorResourceAccessor.getOriginalUri(activeEditor, { supportSideBySide: SideBySideEditor.BOTH }),
						name: activeEditor.getName(),
						description: activeEditor.getDescription(labelFormat === 'short' ? Verbosity.SHORT : labelFormat === 'long' ? Verbosity.LONG : Verbosity.MEDIUM) || ''
					},
					{
						title: activeEditor.getTitle(Verbosity.LONG),
						icon: activeEditor.getIcon(),
						extraClasses: activeEditor.getLabelExtraClasses(),
					}
				);

				// Only (re)subscribe when the active editor changes, not on every label update
				if (trackedEditor !== activeEditor) {
					trackedEditor = activeEditor;
					labelChangeDisposable.value = activeEditor.onDidChangeLabel(() => updateLabel());
				}
			} else {
				label.element.clear();
				trackedEditor = undefined;
				labelChangeDisposable.clear();
			}
		};
		disposables.add(Event.runAndSubscribe(modalEditorService.onDidActiveEditorChange, updateLabel));

		// Handle double-click on header to toggle maximize
		disposables.add(addDisposableListener(headerElement, EventType.DBLCLICK, e => {
			EventHelper.stop(e);

			editorPart.handleHeaderDoubleClick();
		}));

		// Handle right-click on header to open context menu. The context menu
		// also surfaces the editor actions of the active editor group, mirroring
		// how the workbench titlebar exposes them when
		// `workbench.editor.editorActionsLocation` is set to `titleBar`. The
		// active editor pane's `scopedContextKeyService` is used so the actions'
		// `when`/`precondition` and keybinding labels are evaluated in the correct
		// scope.
		disposables.add(addDisposableListener(headerElement, EventType.CONTEXT_MENU, e => {
			const target = e.target;
			if (isHTMLElement(target) && (target.closest('.monaco-button') || target.closest('.action-item'))) {
				return; // do not show our context menu over header buttons / actions
			}

			EventHelper.stop(e, true);

			const contextMenuDisposables = new DisposableStore();
			const activeGroup = editorPart.activeGroup;
			const activeEditor = activeGroup.activeEditor;
			const editorScopedContextKeyService = activeGroup.activeEditorPane?.scopedContextKeyService ?? activeGroup.scopedContextKeyService;
			const editorActions = activeGroup.createEditorActions(contextMenuDisposables, MenuId.EditorTitle);
			const { primary, secondary } = editorActions.actions;

			this.contextMenuService.showContextMenu({
				menuId: MenuId.ModalEditorTitleContext,
				contextKeyService: editorScopedContextKeyService,
				getAnchor: () => ({ x: e.clientX, y: e.clientY }),
				getActions: () => Separator.join(primary, secondary),
				getActionsContext: () => ({ groupId: activeGroup.id, editorIndex: activeEditor ? activeGroup.getIndexOfEditor(activeEditor) : undefined } satisfies IEditorCommandsContext),
				getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id, editorScopedContextKeyService),
				onHide: () => contextMenuDisposables.dispose(),
			});
		}));

		const layout = (sizeChanged: boolean) => {
			const { width: modalWidth, height: modalHeight } = resizableElement.size;
			const { top: topPx, left: leftPx } = resizableElement.domNode.style;
			const headerHeight = headerElement.offsetHeight;
			const bodyHeight = Math.max(0, modalHeight - MODAL_BORDER_SIZE - headerHeight);
			const minimumEditorHeight = sidebarAfterEditor || contentFooter ? Math.max(0, ...editorPart.groups.map(group => group.minimumHeight)) : 0;
			sidebarResult?.prepareLayout(
				modalWidth - MODAL_BORDER_SIZE,
				bodyHeight,
				minimumEditorHeight + (contentFooter?.height ?? 0),
			);
			const sidebarWidth = sidebarResult?.getWidth() ?? 0;
			const sidebarHeight = sidebarResult?.getHeight() ?? 0;
			const contentHeight = Math.max(0, bodyHeight - sidebarHeight);
			const footerHeight = contentFooter ? Math.min(contentFooter.height, Math.max(0, contentHeight - Math.min(minimumEditorHeight, contentHeight / 2))) : 0;
			const editorHeight = contentHeight - footerHeight;
			const editorWidth = Math.max(0, modalWidth - MODAL_BORDER_SIZE - sidebarWidth);
			updateSidebarToggleIcon();

			editorPart.layout(
				editorWidth,
				editorHeight,
				parseFloat(topPx) + MODAL_BORDER_WIDTH + headerHeight,
				parseFloat(leftPx) + MODAL_BORDER_WIDTH + sidebarWidth,
			);

			if (sizeChanged) {
				sidebarResult?.layout(bodyHeight);
				layoutContentFooter?.(editorWidth, footerHeight);
			}
		};

		// Handle drag on header to move the modal
		const dragMonitor = disposables.add(new GlobalPointerMoveMonitor());
		const dragDisposables = disposables.add(new DisposableStore());
		let didDrag = false;
		disposables.add(addDisposableListener(headerElement, EventType.POINTER_DOWN, e => {
			if (editorPart.maximized) {
				return; // no drag when maximized
			}

			if (e.button !== 0) {
				return; // only left button
			}

			// Ignore if target is a button or action
			const target = e.target;
			if (!isHTMLElement(target)) {
				return;
			}

			if (target.closest('.monaco-button') || target.closest('.action-item')) {
				return;
			}

			// Prevent text selection during drag
			EventHelper.stop(e, true);
			dragDisposables.clear();

			headerElement.classList.add('dragging');
			dragDisposables.add(toDisposable(() => headerElement.classList.remove('dragging')));

			const startX = e.clientX;
			const startY = e.clientY;
			const startLeft = parseFloat(resizableElement.domNode.style.left) || 0;
			const startTop = parseFloat(resizableElement.domNode.style.top) || 0;
			didDrag = false;

			const onPointerMove = (moveEvent: PointerEvent) => {
				didDrag = true;
				EventHelper.stop(moveEvent, true);

				const containerDimension = this.layoutService.mainContainerDimension;
				const titleBarOffset = this.layoutService.mainContainerOffset.top;
				const dialogWidth = resizableElement.size.width;
				const dialogHeight = resizableElement.size.height;

				// Clamp to window bounds
				const minLeft = 0;
				const minTop = titleBarOffset;
				const maxLeft = Math.max(minLeft, containerDimension.width - dialogWidth);
				const maxTop = Math.max(minTop, containerDimension.height - dialogHeight);

				let newLeft = Math.max(minLeft, Math.min(maxLeft, startLeft + (moveEvent.clientX - startX)));
				let newTop = Math.max(minTop, Math.min(maxTop, startTop + (moveEvent.clientY - startY)));

				// Snap to center position when close
				const centerLeft = (containerDimension.width - dialogWidth) / 2;
				const centerTop = Math.max(titleBarOffset, (containerDimension.height - dialogHeight) / 2);

				if (Math.abs(newLeft - centerLeft) < MODAL_SNAP_THRESHOLD && Math.abs(newTop - centerTop) < MODAL_SNAP_THRESHOLD) {
					newLeft = centerLeft;
					newTop = centerTop;
				}

				resizableElement.domNode.style.left = `${newLeft}px`;
				resizableElement.domNode.style.top = `${newTop}px`;

				// Update editor part position during drag
				layout(false);
			};

			const onStop = () => {
				dragDisposables.clear();

				if (didDrag) {
					const currentLeft = parseFloat(resizableElement.domNode.style.left) || 0;
					const currentTop = parseFloat(resizableElement.domNode.style.top) || 0;

					// Check if snapped to center — if so, clear custom position
					const containerDimension = this.layoutService.mainContainerDimension;
					const titleBarOffset = this.layoutService.mainContainerOffset.top;
					const centerLeft = (containerDimension.width - resizableElement.size.width) / 2;
					const centerTop = Math.max(titleBarOffset, (containerDimension.height - resizableElement.size.height) / 2);

					if (Math.abs(currentLeft - centerLeft) < 1 && Math.abs(currentTop - centerTop) < 1) {
						editorPart.position = undefined;
					} else {
						editorPart.position = { left: currentLeft, top: currentTop };
					}
				}
			};

			dragMonitor.startMonitoring(headerElement, e.pointerId, e.buttons, onPointerMove, onStop);
		}));

		// Focus active editor when clicking into the title area with no other click target
		disposables.add(addDisposableListener(headerElement, EventType.CLICK, e => {
			const wasDrag = didDrag;
			didDrag = false;
			if (wasDrag) {
				return; // skip focus after drag
			}

			EventHelper.stop(e);

			editorPart.activeGroup.focus();
		}));

		// Handle resize from sashes
		let isResizing = false;
		let resizeStartLeft = 0;
		let resizeStartTop = 0;
		let resizeStartSize = Dimension.None;

		disposables.add(resizableElement.onDidWillResize(() => {
			isResizing = true;
			resizeStartLeft = parseFloat(resizableElement.domNode.style.left) || 0;
			resizeStartTop = parseFloat(resizableElement.domNode.style.top) || 0;
			resizeStartSize = new Dimension(resizableElement.size.width, resizableElement.size.height);
		}));

		disposables.add(resizableElement.onDidResize(e => {

			// Clamp position and size to window bounds during active resize
			// (skip on `done` — values are already correct from prior events,
			//  and directional flags are not set on the done event)
			if (!e.done) {
				const containerDimension = this.layoutService.mainContainerDimension;
				const titleBarOffset = this.layoutService.mainContainerOffset.top;

				const deltaWidth = e.dimension.width - resizeStartSize.width;
				const deltaHeight = e.dimension.height - resizeStartSize.height;

				let newLeft = e.west ? resizeStartLeft - deltaWidth : resizeStartLeft;
				let newTop = e.north ? resizeStartTop - deltaHeight : resizeStartTop;
				let newWidth = e.dimension.width;
				let newHeight = e.dimension.height;

				if (newLeft < 0) {
					newWidth += newLeft;
					newLeft = 0;
				}
				if (newTop < titleBarOffset) {
					newHeight += newTop - titleBarOffset;
					newTop = titleBarOffset;
				}
				if (newLeft + newWidth > containerDimension.width) {
					newWidth = containerDimension.width - newLeft;
				}
				if (newTop + newHeight > containerDimension.height) {
					newHeight = containerDimension.height - newTop;
				}

				// Apply corrected size if it was clamped
				if (newWidth !== e.dimension.width || newHeight !== e.dimension.height) {
					resizableElement.layout(newHeight, newWidth);
				}

				// Adjust position to keep the opposite edge fixed
				if (e.west) {
					resizableElement.domNode.style.left = `${newLeft}px`;
				}
				if (e.north) {
					resizableElement.domNode.style.top = `${newTop}px`;
				}
			}

			// Update editor part layout during resize
			layout(true);

			if (e.done) {
				isResizing = false;

				// Check if size matches the default (from sash double-click reset)
				const defaultSize = getDefaultSize();
				const size = resizableElement.size;
				if (size.width === defaultSize.width && size.height === defaultSize.height) {
					editorPart.size = undefined;
					editorPart.position = undefined;
					layoutModal();
				} else {
					editorPart.size = new Dimension(size.width, size.height);
					editorPart.position = {
						left: parseFloat(resizableElement.domNode.style.left) || 0,
						top: parseFloat(resizableElement.domNode.style.top) || 0,
					};
				}
			}
		}));

		// Compute default (non-custom, non-maximized) modal size
		const getDefaultSize = (): Dimension => {
			const containerDimension = this.layoutService.mainContainerDimension;
			const titleBarOffset = this.layoutService.mainContainerOffset.top;
			const availableHeight = Math.max(containerDimension.height - titleBarOffset, 0);
			const targetWidth = containerDimension.width * 0.8;
			const targetHeight = availableHeight * 0.8;
			const width = Math.min(targetWidth, MODAL_MAX_DEFAULT_WIDTH, containerDimension.width);
			const height = Math.min(targetHeight, MODAL_MAX_DEFAULT_HEIGHT, availableHeight);

			return new Dimension(width, height);
		};

		// Layout the modal editor part
		let isFirstLayout = true;
		const layoutModal = () => {
			if (isResizing) {
				return; // skip layout during interactive resize
			}

			const containerDimension = this.layoutService.mainContainerDimension;
			const titleBarOffset = this.layoutService.mainContainerOffset.top;
			const availableHeight = Math.max(containerDimension.height - titleBarOffset, 0);

			const defaultSize = getDefaultSize();

			let width: number;
			let height: number;

			if (editorPart.maximized) {
				const verticalPadding = Math.max(titleBarOffset /* keep away from title bar to prevent clipping issues with WCO */, MODAL_MAXIMIZED_PADDING);
				width = Math.max(containerDimension.width - MODAL_MAXIMIZED_PADDING, 0);
				height = Math.max(availableHeight - verticalPadding, 0);
			} else if (editorPart.size) {
				width = Math.min(editorPart.size.width, containerDimension.width);
				height = Math.min(editorPart.size.height, availableHeight);
			} else {
				width = defaultSize.width;
				height = defaultSize.height;
			}

			height = Math.min(height, availableHeight); // Ensure the modal never exceeds available height (below the title bar)

			if (sidebarAfterEditor || contentFooter) {
				const maximumWidth = editorPart.maximized ? width : containerDimension.width;
				const maximumHeight = editorPart.maximized ? height : availableHeight;
				resizableElement.minSize = new Dimension(Math.min(effectiveMinWidth, maximumWidth), Math.min(MODAL_MIN_HEIGHT, maximumHeight));
				width = Math.max(width, resizableElement.minSize.width);
				height = Math.max(height, resizableElement.minSize.height);
			}

			// On first layout, clamp sidebar width if it would leave the editor too narrow
			if (isFirstLayout) {
				isFirstLayout = false;
				sidebarResult?.clampWidth(width);
			}

			// Update resizable element size and constraints
			resizableElement.maxSize = new Dimension(containerDimension.width, availableHeight);
			resizableElement.preferredSize = defaultSize;
			resizableElement.layout(height, width);

			// Enable/disable sashes based on maximized state
			const canResize = !editorPart.maximized;
			resizableElement.enableSashes(canResize, canResize, canResize, canResize);

			// Position: use custom position if available (clamped to bounds), otherwise center
			if (!editorPart.maximized && editorPart.position) {
				const clampedLeft = Math.max(0, Math.min(editorPart.position.left, containerDimension.width - width));
				const clampedTop = Math.max(titleBarOffset, Math.min(editorPart.position.top, titleBarOffset + availableHeight - height));
				resizableElement.domNode.style.left = `${clampedLeft}px`;
				resizableElement.domNode.style.top = `${clampedTop}px`;
			} else {
				const left = (containerDimension.width - width) / 2;
				const top = Math.max(titleBarOffset, (containerDimension.height - height) / 2); // center in full window, but clamp to stay below the title bar
				resizableElement.domNode.style.left = `${left}px`;
				resizableElement.domNode.style.top = `${top}px`;
			}

			layout(true);
		};

		// Resize sashes
		const eastSash = disposables.add(new Sash(shadowElement, { getVerticalSashLeft: () => currentWidth }, { orientation: Orientation.VERTICAL }));
		const westSash = disposables.add(new Sash(shadowElement, { getVerticalSashLeft: () => 0 }, { orientation: Orientation.VERTICAL }));
		const northSash = disposables.add(new Sash(shadowElement, { getHorizontalSashTop: () => 0 }, { orientation: Orientation.HORIZONTAL, orthogonalEdge: OrthogonalEdge.North }));
		const southSash = disposables.add(new Sash(shadowElement, { getHorizontalSashTop: () => currentHeight }, { orientation: Orientation.HORIZONTAL, orthogonalEdge: OrthogonalEdge.South }));

		northSash.orthogonalStartSash = westSash;
		northSash.orthogonalEndSash = eastSash;
		southSash.orthogonalStartSash = westSash;
		southSash.orthogonalEndSash = eastSash;

		let dragStartWidth = 0;
		let dragStartHeight = 0;

		disposables.add(Event.any(northSash.onDidStart, eastSash.onDidStart, southSash.onDidStart, westSash.onDidStart)(() => {
			dragStartWidth = currentWidth;
			dragStartHeight = currentHeight;
		}));

		// Use 2x deltas because the modal is centered (grows/shrinks equally on both sides)
		const applyResize = (widthDelta: number, heightDelta: number) => {
			const containerDimension = this.layoutService.mainContainerDimension;
			const titleBarOffset = this.layoutService.mainContainerOffset.top;
			const maxHeight = Math.max(containerDimension.height - titleBarOffset, 0);

			customWidth = Math.max(MIN_MODAL_WIDTH, Math.min(dragStartWidth + widthDelta * 2, containerDimension.width));
			customHeight = Math.max(MIN_MODAL_HEIGHT, Math.min(dragStartHeight + heightDelta * 2, maxHeight));
			layoutModal();
		};

		disposables.add(eastSash.onDidChange(e => applyResize(e.currentX - e.startX, 0)));
		disposables.add(westSash.onDidChange(e => applyResize(-(e.currentX - e.startX), 0)));
		disposables.add(southSash.onDidChange(e => applyResize(0, e.currentY - e.startY)));
		disposables.add(northSash.onDidChange(e => applyResize(0, -(e.currentY - e.startY))));

		// Persist custom size on drag end
		disposables.add(Event.any(northSash.onDidEnd, eastSash.onDidEnd, southSash.onDidEnd, westSash.onDidEnd)(() => {
			if (customWidth !== undefined && customHeight !== undefined) {
				this.storageService.store(MODAL_EDITOR_CUSTOM_SIZE_KEY,
					JSON.stringify({ width: customWidth, height: customHeight }),
					StorageScope.PROFILE, StorageTarget.MACHINE);
			}
		}));

		// Reset to default size on double-click
		disposables.add(Event.any(northSash.onDidReset, eastSash.onDidReset, southSash.onDidReset, westSash.onDidReset)(() => {
			customWidth = undefined;
			customHeight = undefined;
			this.storageService.remove(MODAL_EDITOR_CUSTOM_SIZE_KEY, StorageScope.PROFILE);
			layoutModal();
		}));

		// Disable sashes when maximized
		const updateSashState = (maximized: boolean) => {
			const state = maximized ? SashState.Disabled : SashState.Enabled;
			northSash.state = state;
			eastSash.state = state;
			southSash.state = state;
			westSash.state = state;
		};
		updateSashState(editorPart.maximized);

		disposables.add(Event.runAndSubscribe(this.layoutService.onDidLayoutMainContainer, layoutModal));
		disposables.add(editorPart.onDidChangeMaximized(() => layoutModal()));
		disposables.add(editorPart.onDidRequestLayout(() => layoutModal()));

		// Reflect modal-options from the active editor (e.g. compact header)
		// as classes on the modal block, and re-layout so dimensions account
		// for any header size change.
		disposables.add(Event.runAndSubscribe(modalEditorService.onDidActiveEditorChange, () => {
			const activeEditor = editorPart.activeGroup.activeEditor;
			const editorModalOptions = isModalEditorOptionsProvider(activeEditor) ? activeEditor.getModalEditorOptions() : undefined;
			modalElement.classList.toggle('compact-header', !!editorModalOptions?.compactHeader);
			layoutModal();
		}));

		// Dim window controls to match the modal overlay
		this.hostService.setWindowDimmed(mainWindow, true);
		disposables.add(toDisposable(() => this.hostService.setWindowDimmed(mainWindow, false)));

		// Focus
		editorPart.activeGroup.focus();

		return {
			part: editorPart,
			instantiationService: scopedInstantiationService,
			disposables
		};
	}

	private createContentFooter(container: HTMLElement, content: IModalEditorContentFooter | undefined, modalContextKeyService: IContextKeyService, disposables: DisposableStore): ((width: number, height: number) => void) | undefined {
		if (!content) {
			return undefined;
		}

		container.classList.add('has-content-footer');
		const footerContainer = append(container, $('.modal-editor-content-footer'));
		const contextKeyService = disposables.add(modalContextKeyService.createScoped(footerContainer));
		const onDidLayout = disposables.add(new Emitter<IDimension>());
		try {
			disposables.add(content.render(footerContainer, onDidLayout.event, contextKeyService));
		} catch (error) {
			disposables.dispose();
			throw error;
		}

		return (width, height) => {
			footerContainer.style.width = `${width}px`;
			footerContainer.style.height = `${height}px`;
			onDidLayout.fire({ width, height: Math.max(0, height - MODAL_CONTENT_FOOTER_BORDER_WIDTH) });
		};
	}

	private createSidebar(container: HTMLElement, headerElement: HTMLElement, content: IModalEditorSidebar | undefined, modalContextKeyService: IContextKeyService, disposables: DisposableStore, constrainToViewport = false): IModalEditorSidebarController | undefined {
		if (!content) {
			return undefined;
		}

		let sidebarWidth = content.sidebarWidth && content.sidebarWidth > 0 ? content.sidebarWidth : MODAL_SIDEBAR_DEFAULT_WIDTH;
		let preferredSidebarHeight = content.sidebarHeight ?? MODAL_SIDEBAR_DEFAULT_HEIGHT;
		let sidebarHeight = preferredSidebarHeight;
		let customWidth = content.sidebarWidth !== undefined && content.sidebarWidth > 0;
		let visible = !content.sidebarHidden;
		const requestedPlacement = content.placement ?? 'left';
		let placement: 'left' | 'bottom' = requestedPlacement === 'bottom' ? 'bottom' : 'left';
		let layoutWidth = 0;
		let layoutHeight = 0;
		let minimumEditorHeight = 0;
		let constrainedSidebarWidth: number | undefined;
		const getSidebarWidth = () => constrainedSidebarWidth ?? sidebarWidth;

		const sidebarContainer = append(container, $('div.modal-editor-sidebar.show-file-icons'));
		const updateContainerStyles = () => {
			container.classList.toggle('sidebar-bottom', placement === 'bottom');
			sidebarContainer.style.width = placement === 'left' ? `${getSidebarWidth()}px` : '';
			if (requestedPlacement !== 'left') {
				sidebarContainer.style.height = placement === 'bottom' ? `${sidebarHeight}px` : '';
			}
		};
		updateContainerStyles();
		setVisibility(visible, sidebarContainer);

		// Context key service scoped to the sidebar container, descending from the
		// modal context key service so that content rendered here (e.g. the changes
		// tree) inherits the modal-level context keys.
		const sidebarContextKeyService = disposables.add(modalContextKeyService.createScoped(sidebarContainer));

		// Let the caller render content
		const onDidLayoutEmitter = disposables.add(new Emitter<{ readonly height: number; readonly width: number }>());
		const contentDisposable = disposables.add(new MutableDisposable());
		contentDisposable.value = content.render(sidebarContainer, onDidLayoutEmitter.event, sidebarContextKeyService);

		// Sash for resizing sidebar.
		// Prefer the measured header height so the sash aligns with the real chrome
		// (the compact-header variant is 40px, the default header is 33px). The
		// constant only applies before the header has been laid out.
		const getHeaderHeight = () => (headerElement.offsetHeight || MODAL_HEADER_HEIGHT);
		const onDidResizeEmitter = disposables.add(new Emitter<void>());
		const sashDisposables = disposables.add(new DisposableStore());
		let sash: Sash;

		const getPlacement = (width: number): 'left' | 'bottom' =>
			requestedPlacement === 'bottom' || (requestedPlacement === 'auto' && width < sidebarWidth + MODAL_MIN_WIDTH) ? 'bottom' : 'left';
		const clampHeight = (height: number) => {
			const maximumHeight = Math.max(0, layoutHeight - Math.min(minimumEditorHeight, layoutHeight / 2));
			return Math.min(maximumHeight, Math.max(MODAL_SIDEBAR_MIN_HEIGHT, height));
		};

		const createSash = () => {
			sashDisposables.clear();
			sash = sashDisposables.add(placement === 'bottom'
				? new Sash(container, {
					getHorizontalSashTop: () => getHeaderHeight() + layoutHeight - sidebarHeight,
					getHorizontalSashLeft: () => 0,
					getHorizontalSashWidth: () => layoutWidth,
				}, { orientation: Orientation.HORIZONTAL })
				: new Sash(container, {
					getVerticalSashLeft: () => getSidebarWidth(),
					getVerticalSashTop: () => getHeaderHeight(),
					getVerticalSashHeight: () => (container.clientHeight - getHeaderHeight()),
				}, { orientation: Orientation.VERTICAL }));
			if (!visible) {
				sash.state = SashState.Disabled;
			}

			const delta = e.currentX - e.startX;
			const maxWidth = Math.max(MODAL_SIDEBAR_MIN_WIDTH, container.clientWidth - modalMinWidth);
			sidebarWidth = Math.min(maxWidth, Math.max(MODAL_SIDEBAR_MIN_WIDTH, sashStartWidth + delta));
			customWidth = true;
			sidebarContainer.style.width = `${sidebarWidth}px`;
			sash.layout();
			onDidResizeEmitter.fire();
		}));
		disposables.add(sash.onDidReset(() => {
			const maxWidth = Math.max(MODAL_SIDEBAR_MIN_WIDTH, container.clientWidth - modalMinWidth);
			sidebarWidth = Math.min(maxWidth, MODAL_SIDEBAR_DEFAULT_WIDTH);
			customWidth = false;
			sidebarContainer.style.width = `${sidebarWidth}px`;
			sash.layout();
			onDidResizeEmitter.fire();
		}));

		return {
			onDidResize: onDidResizeEmitter.event,
			getWidth: () => visible && placement === 'left' ? getSidebarWidth() : 0,
			getHeight: () => visible && placement === 'bottom' ? sidebarHeight : 0,
			getPreferredWidth: () => sidebarWidth,
			getPlacement: () => placement,
			hasCustomWidth: () => customWidth,
			clampWidth: (modalWidth: number) => {
				if (sidebarWidth + modalMinWidth > modalWidth) {
					sidebarWidth = Math.min(MODAL_SIDEBAR_DEFAULT_WIDTH, Math.max(MODAL_SIDEBAR_MIN_WIDTH, modalWidth - modalMinWidth));
					customWidth = false;
					sidebarContainer.style.width = `${sidebarWidth}px`;
					sash.layout();
					onDidResizeEmitter.fire();
				}
			},
			isVisible: () => visible,
			setVisible: (value: boolean) => {
				visible = value;
				setVisibility(visible, sidebarContainer);
				container.classList.toggle('has-sidebar', visible);
				sash.state = visible ? SashState.Enabled : SashState.Disabled;
				onDidResizeEmitter.fire();
			},
			prepareLayout: (width, height, editorMinimumHeight) => {
				if (requestedPlacement === 'left' && !constrainToViewport) {
					return;
				}
				layoutWidth = width;
				layoutHeight = height;
				minimumEditorHeight = editorMinimumHeight;
				if (constrainToViewport) {
					constrainedSidebarWidth = Math.min(sidebarWidth, Math.max(0, width - Math.min(MODAL_MIN_WIDTH, width / 2)));
				}
				sidebarHeight = clampHeight(preferredSidebarHeight);
				const nextPlacement = getPlacement(width);
				if (placement !== nextPlacement) {
					placement = nextPlacement;
					createSash();
				}
				updateContainerStyles();
			},
			layout: (height: number) => {
				if (visible) {
					onDidLayoutEmitter.fire(placement === 'bottom' ? {
						height: Math.max(0, sidebarHeight - MODAL_SIDEBAR_PADDING * 2 - MODAL_SIDEBAR_BORDER_WIDTH),
						width: Math.max(0, layoutWidth - MODAL_SIDEBAR_PADDING * 2),
					} : {
						height: Math.max(0, height - MODAL_SIDEBAR_PADDING * 2),
						width: Math.max(0, getSidebarWidth() - MODAL_SIDEBAR_PADDING * 2 - MODAL_SIDEBAR_BORDER_WIDTH),
					});
				}
				sash.layout();
			},
			updateContent: (newContent: IModalEditorSidebar) => {
				contentDisposable.clear();
				sidebarContainer.textContent = '';
				contentDisposable.value = newContent.render(sidebarContainer, onDidLayoutEmitter.event, sidebarContextKeyService);
			},
		};
	}
}

interface IPosition {
	left: number;
	top: number;
}

class ModalEditorPartImpl extends EditorPart implements IModalEditorPart {

	private readonly _onWillClose = this._register(new Emitter<void>());
	readonly onWillClose = this._onWillClose.event;

	private readonly _onDidChangeMaximized = this._register(new Emitter<boolean>());
	readonly onDidChangeMaximized = this._onDidChangeMaximized.event;

	private readonly _onDidRequestLayout = this._register(new Emitter<void>());
	readonly onDidRequestLayout = this._onDidRequestLayout.event;

	private readonly _onDidChangeNavigation = this._register(new Emitter<IModalEditorNavigation | undefined>());
	readonly onDidChangeNavigation = this._onDidChangeNavigation.event;

	private _maximized: boolean;
	get maximized(): boolean { return this._maximized; }

	private _size: IDimension | undefined;
	get size(): IDimension | undefined { return this._size; }
	set size(value: IDimension | undefined) { this._size = value; }

	private _position: IPosition | undefined;
	get position(): IPosition | undefined { return this._position; }
	set position(value: IPosition | undefined) { this._position = value; }

	private _sidebarWidth: number | undefined;
	get sidebarWidth(): number | undefined { return this._sidebarWidth; }
	set sidebarWidth(value: number | undefined) { this._sidebarWidth = value; }

	private _sidebarHidden = false;
	get sidebarHidden(): boolean { return this._sidebarHidden; }
	set sidebarHidden(value: boolean) { this._sidebarHidden = value; }

	private _hasSidebar = false;
	get hasSidebar(): boolean { return this._hasSidebar; }
	set hasSidebar(value: boolean) { this._hasSidebar = value; }

	private readonly _onDidToggleSidebar = this._register(new Emitter<void>());
	readonly onDidToggleSidebar = this._onDidToggleSidebar.event;

	private savedSize: IDimension | undefined;
	private savedPosition: IPosition | undefined;

	private _navigation: IModalEditorNavigation | undefined;
	get navigation(): IModalEditorNavigation | undefined { return this._navigation; }

	private readonly optionsDisposable = this._register(new MutableDisposable());

	constructor(
		windowId: number,
		editorPartsView: IEditorPartsView,
		groupsLabel: string,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService private readonly modalContextKeyService: IContextKeyService,
	) {
		// Keep a stable component ID so recreating the modal does not grow the global memento cache.
		super(editorPartsView, 'workbench.parts.modalEditor', localize('modalEditorPart', "Modal Editor Area"), windowId, instantiationService, themeService, configurationService, storageService, layoutService, hostService, modalContextKeyService);

		this._maximized = options?.maximized ?? false;
		this._size = options?.size;
		this._position = options?.position;
		this._navigation = options?.navigation;
		this._hasSidebar = !!options?.sidebar;
		this._sidebarHidden = options?.sidebar?.sidebarHidden ?? false;
		this._sidebarWidth = options?.sidebar?.sidebarWidth;

		// When restoring a maximized state with custom layout,
		// initialize saved state so un-maximize can restore it
		if (this._maximized) {
			this.savedSize = this._size;
			this.savedPosition = this._position;
		}

		this.enforceModalPartOptions();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(USE_MODAL_EDITOR_SETTING)) {
				this.enforceModalPartOptions();
			}
		}));
	}

	override create(parent: HTMLElement, options?: object): void {
		this.previousMainWindowActiveElement = mainWindow.document.activeElement;

		super.create(parent, options);
	}

	enforceModalPartOptions(): void {
		const useModalForAll = this.configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING) === 'all';
		const editorCount = this.groups.reduce((count, group) => count + group.count, 0);
		const showTabs = useModalForAll && editorCount > 1 ? 'multiple' : 'none';

		this.optionsDisposable.value = this.enforcePartOptions({
			showTabs,
			enablePreview: true,
			closeEmptyGroups: true,
			tabActionCloseVisibility: showTabs !== 'none',
			editorActionsLocation: 'hidden',
			tabHeight: 'default',
			wrapTabs: false
		});
	}

	updateOptions(options?: IModalEditorPartOptions): void {
		if (typeof options?.maximized === 'boolean' && options.maximized !== this._maximized) {
			this.toggleMaximized();
		}

		this._navigation = options?.navigation;

		this._onDidChangeNavigation.fire(options?.navigation);
	}

	toggleMaximized(): void {
		this._maximized = !this._maximized;

		if (this._maximized) {
			this.savedSize = this._size;
			this.savedPosition = this._position;
		} else {
			this._size = this.savedSize;
			this._position = this.savedPosition;
			this.savedSize = undefined;
			this.savedPosition = undefined;
		}

		this._onDidChangeMaximized.fire(this._maximized);
	}

	toggleSidebar(): void {
		this._sidebarHidden = !this._sidebarHidden;

		this._onDidToggleSidebar.fire();
	}

	handleHeaderDoubleClick(): void {
		if (this._maximized) {
			// Clear saved state so that toggleMaximized restores to default
			this.savedSize = undefined;
			this.savedPosition = undefined;
			this.toggleMaximized();
		} else if (this._size) {
			this._size = undefined;
			this._position = undefined;
			this._onDidRequestLayout.fire();
		} else {
			this.toggleMaximized(); // maximize
		}
	}

	protected override handleContextKeys(): void {

		// Bind the modal-level context keys to the modal context key service which
		// is scoped to the entire modal element (not just the editor part
		// container). This keeps them active when focus is anywhere inside the
		// modal, including the sidebar (e.g. the changes tree). Otherwise commands
		// like closing the modal on `Escape` would not fire while the sidebar has
		// focus.
		const isModalEditorPartContext = EditorPartModalContext.bindTo(this.modalContextKeyService);
		isModalEditorPartContext.set(true);

		const isMaximizedContext = EditorPartModalMaximizedContext.bindTo(this.modalContextKeyService);
		isMaximizedContext.set(this._maximized);
		this._register(this.onDidChangeMaximized(maximized => isMaximizedContext.set(maximized)));

		const hasNavigationContext = EditorPartModalNavigationContext.bindTo(this.modalContextKeyService);
		hasNavigationContext.set(!!this._navigation && this._navigation.total > 1);
		this._register(this.onDidChangeNavigation(navigation => hasNavigationContext.set(!!navigation && navigation.total > 1)));

		const sidebarContext = EditorPartModalSidebarContext.bindTo(this.modalContextKeyService);
		sidebarContext.set(this._hasSidebar);

		const sidebarVisibleContext = EditorPartModalSidebarVisibleContext.bindTo(this.modalContextKeyService);
		sidebarVisibleContext.set(this._hasSidebar && !this._sidebarHidden);
		this._register(this.onDidToggleSidebar(() => sidebarVisibleContext.set(this._hasSidebar && !this._sidebarHidden)));

		super.handleContextKeys();
	}

	override removeGroup(group: number | IEditorGroupView, preserveFocus?: boolean): void {

		// Close modal when last group removed
		const groupView = this.assertGroupView(group);
		if (this.count === 1 && this.activeGroup === groupView) {
			this.doRemoveLastGroup(preserveFocus);
		}

		// Otherwise delegate to parent implementation
		else {
			super.removeGroup(group, preserveFocus);
		}
	}

	private doRemoveLastGroup(preserveFocus?: boolean): void {
		const restoreFocus = !preserveFocus && this.shouldRestoreFocus(this.container);

		// Activate next group
		const mostRecentlyActiveGroups = this.editorPartsView.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		const nextActiveGroup = mostRecentlyActiveGroups[1]; // [0] will be the current group we are about to dispose
		if (nextActiveGroup) {
			nextActiveGroup.groupsView.activateGroup(nextActiveGroup);

			if (restoreFocus) {
				nextActiveGroup.focus();
			}
		}

		this._onWillClose.fire();
	}

	protected override saveState(): void {
		return; // disabled, modal editor part state is not persisted
	}

	async close(options?: { mergeAllEditorsToMainPart?: boolean }): Promise<boolean> {

		// Merge all editors to main part (editors stay open, no confirmation needed)
		if (options?.mergeAllEditorsToMainPart) {
			const result = this.mergeGroupsToMainPart();
			if (!result) {
				return false;
			}
		}

		// Close all editors in each group, leveraging the existing
		// confirmation infrastructure for dirty editors
		else {
			for (const group of this.groups) {
				const closed = await group.closeAllEditors();
				if (!closed) {
					return false; // user cancelled
				}
			}
		}

		this._onWillClose.fire();

		return true;
	}

	private mergeGroupsToMainPart(): boolean {
		if (!this.groups.some(group => group.count > 0)) {
			return true; // skip if we have no editors opened
		}

		// Find the most recent group that is not locked
		let targetGroup: IEditorGroupView | undefined = undefined;
		for (const group of this.editorPartsView.mainPart.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (!group.isLocked) {
				targetGroup = group;
				break;
			}
		}

		if (!targetGroup) {
			targetGroup = this.editorPartsView.mainPart.addGroup(this.editorPartsView.mainPart.activeGroup, this.partOptions.openSideBySideDirection === 'right' ? GroupDirection.RIGHT : GroupDirection.DOWN);
		}

		const result = this.mergeAllGroups(targetGroup, {
			// Try to reduce the impact of closing the modal
			// as much as possible by not changing existing editors
			// in the main window.
			preserveExistingIndex: true
		});
		targetGroup.focus();

		return result;
	}
}
