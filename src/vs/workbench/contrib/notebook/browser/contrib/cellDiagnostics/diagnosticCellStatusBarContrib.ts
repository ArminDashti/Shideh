/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { FIX_CELL_ERROR_COMMAND_ID, OPEN_CELL_FAILURE_ACTIONS_COMMAND_ID } from './cellDiagnosticsActions.js';
import { NotebookStatusBarController } from '../cellStatusBar/executionStatusBarItemController.js';
import { INotebookEditor, INotebookEditorContribution, INotebookViewModel } from '../../notebookBrowser.js';
import { registerNotebookContribution } from '../../notebookEditorExtensions.js';
import { CodeCellViewModel } from '../../viewModel/codeCellViewModel.js';
import { INotebookCellStatusBarItem, CellStatusbarAlignment } from '../../../common/notebookCommon.js';
import { ICellExecutionError } from '../../../common/notebookExecutionStateService.js';
import { IChatAgentService } from '../../../../chat/common/participants/chatAgents.js';
import { ChatAgentLocation } from '../../../../chat/common/constants.js';

export class DiagnosticCellStatusBarContrib extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.statusBar.diagtnostic';

	constructor(
		notebookEditor: INotebookEditor,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this._register(new NotebookStatusBarController(notebookEditor, (vm, cell) =>
			cell instanceof CodeCellViewModel ?
				instantiationService.createInstance(DiagnosticCellStatusBarItem, vm, cell) :
				Disposable.None
		));
	}
}
registerNotebookContribution(DiagnosticCellStatusBarContrib.id, DiagnosticCellStatusBarContrib);


class DiagnosticCellStatusBarItem extends Disposable {
	private _currentItemIds: string[] = [];

	constructor(
		private readonly _notebookViewModel: INotebookViewModel,
		private readonly cell: CodeCellViewModel,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
	) {
		super();
		this._register(autorun((reader) => this.updateSparkleItem(reader.readObservable(cell.executionErrorDiagnostic))));
	}

	private hasNotebookAgent(): boolean {
		const agents = this.chatAgentService.getAgents();
		return !!agents.find(agent => agent.locations.includes(ChatAgentLocation.Notebook));
	}

	private async updateQuickActions(error: ICellExecutionError | undefined) {
		let items: INotebookCellStatusBarItem[] = [];

		if (error?.location && this.hasNotebookAgent()) {
			const tooltip = this.keybindingService.appendKeybinding(
				localize('notebook.cell.status.diagnostic', "Quick Actions"),
				OPEN_CELL_FAILURE_ACTIONS_COMMAND_ID);

			items = [{
				text: `$(sparkle) fix`,
				tooltip,
				alignment: CellStatusbarAlignment.Left,
				command: FIX_CELL_ERROR_COMMAND_ID,
				priority: Number.MAX_SAFE_INTEGER - 1
			}, {
				text: `$(sparkle) explain`,
				tooltip,
				alignment: CellStatusbarAlignment.Left,
				command: OPEN_CELL_FAILURE_ACTIONS_COMMAND_ID,
				priority: Number.MAX_SAFE_INTEGER - 1
			}];
		}

		this._currentItemIds = this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this.cell.handle, items }]);
	}

	override dispose() {
		super.dispose();
		this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this.cell.handle, items: [] }]);
	}
}
