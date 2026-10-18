/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor, isCodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IRemoteCodingAgentsService } from '../../../remoteCodingAgents/common/remoteCodingAgentsService.js';
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { PROMPT_LANGUAGE_ID } from '../../common/promptSyntax/promptTypes.js';
import { $ } from '../../../../../base/browser/dom.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';

export class PromptCodingAgentFloatingMenu extends AbstractFloatingClickMenu {
	static readonly ID = 'editor.contrib.promptCodingAgentFloatingMenu';

	constructor(
		private readonly _editor: ICodeEditor,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IRemoteCodingAgentsService private readonly _remoteCodingAgentService: IRemoteCodingAgentsService,
		@IPromptsService private readonly _promptsService: IPromptsService,
	) {
		super(MenuId.ChatFileEditorContent, menuService, contextKeyService);
		this.render();
	}

	protected override createWidget(action: IAction): FloatingClickWidget {
		return this.instantiationService.createInstance(FloatingEditorClickWidget, this.editor, action.label, action.id);
	}

	protected override isVisible(): boolean {
		const model = this.editor.getModel();
		return !(this.editor instanceof EmbeddedCodeEditorWidget)
			&& this.editor?.hasModel()
			&& !this.editor.getOption(EditorOption.inDiffEditor)
			&& model?.getLanguageId() === PROMPT_LANGUAGE_ID;
	}

		this._button.element.style.background = 'var(--vscode-button-background)';
		this._button.element.style.color = 'var(--vscode-button-foreground)';
		this._button.label = localize('runWithCodingAgent.label', "{0} Delegate to Copilot coding agent", '$(cloud-upload)');

const PROMPT_CODING_AGENT_ACTION_ID = 'prompt.runWithCodingAgent';

class RunPromptWithCodingAgentAction extends Action2 {
	constructor() {
		super({
			id: PROMPT_CODING_AGENT_ACTION_ID,
			title: localize2('runWithCodingAgent', 'Run with Coding Agent'),
			icon: Codicon.cloudUpload,
			precondition: ContextKeyExpr.and(
				ChatContextKeys.hasRemoteCodingAgent,
				ContextKeyExpr.equals('resourceLangId', PROMPT_LANGUAGE_ID)
			),
			menu: {
				id: MenuId.ChatFileEditorContent,
				when: ContextKeyExpr.and(
					ChatContextKeys.hasRemoteCodingAgent,
					ContextKeyExpr.equals('resourceLangId', PROMPT_LANGUAGE_ID)
				),
				group: 'navigation',
				order: 1
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);
		const remoteCodingAgentService = accessor.get(IRemoteCodingAgentsService);

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		if (!this._isVisible) {
			return null;
		}

		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER,
		};
	}

	private _updateVisibility(): void {
		const enableRemoteCodingAgentPromptFileOverlay = ChatContextKeys.enableRemoteCodingAgentPromptFileOverlay.getValue(this._contextKeyService);
		const hasRemoteCodingAgent = ChatContextKeys.hasRemoteCodingAgent.getValue(this._contextKeyService);
		const model = this._editor.getModel();
		const isPromptFile = model?.getLanguageId() === PROMPT_LANGUAGE_ID;
		const shouldBeVisible = !!(isPromptFile && enableRemoteCodingAgentPromptFileOverlay && hasRemoteCodingAgent);

		if (shouldBeVisible !== this._isVisible) {
			this._isVisible = shouldBeVisible;
			if (this._isVisible) {
				this._editor.addOverlayWidget(this);
			} else {
				this._editor.removeOverlayWidget(this);
			}
		}
	}

	private async _execute(): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		this._button.enabled = false;
		try {
			const promptContent = model.getValue();
			const promptName = await this._promptsService.getPromptSlashCommandName(model.uri, CancellationToken.None);

			const agents = this._remoteCodingAgentService.getAvailableAgents();
			const agent = agents[0]; // Use the first available agent
			if (!agent) {
				return;
			}

			await this._commandService.executeCommand(agent.command, {
				userPrompt: promptName,
				summary: promptContent,
				source: 'prompt',
			});
		} finally {
			this._button.enabled = true;
		}

		const promptContent = model.getValue();
		const promptName = getPromptCommandName(model.uri.path);

		const agents = remoteCodingAgentService.getAvailableAgents();
		const agent = agents[0]; // Use the first available agent
		if (!agent) {
			return;
		}

		await commandService.executeCommand(agent.command, {
			userPrompt: promptName,
			summary: promptContent,
			source: 'prompt',
		});
	}
}

registerAction2(RunPromptWithCodingAgentAction);
