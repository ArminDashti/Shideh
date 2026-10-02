/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { type IAgentHostChatContribution, type IAgentHostChatContributionContext, type IDispatchedAction } from '../../../common/agentHostChatContributionsService.js';
import { ActionType } from '../../../common/state/sessionActions.js';
import { IAgentHostChatInputService } from '../../agentHostChatInputService.js';
import { IAgentHostStateManager, AgentHostStateManager } from '../../agentHostStateManager.js';

/** Clears chat input state when chats or sessions are removed or archived. */
export class ChatInputContribution extends Disposable implements IAgentHostChatContribution {
	static readonly id = 'chatInput';
	readonly order = 150;

	constructor(
		protected readonly _context: IAgentHostChatContributionContext,
		@IAgentHostChatInputService private readonly _inputService: IAgentHostChatInputService,
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
	) {
		super();
	}

	onDidDispatchAction({ channel, session, action, rejectionReason }: IDispatchedAction): void {
		if (rejectionReason) {
			return;
		}
		if (action.type === ActionType.SessionChatRemoved) {
			this._inputService.clear(session, action.chat);
		} else if (action.type === ActionType.ChatIsArchivedChanged && action.isArchived) {
			this._inputService.clear(session, channel);
		} else if (action.type === ActionType.SessionIsArchivedChanged && action.isArchived) {
			for (const chat of this._stateManager.getSessionState(session)?.chats ?? []) {
				this._inputService.clear(session, chat.resource);
			}
		}
	}
}
