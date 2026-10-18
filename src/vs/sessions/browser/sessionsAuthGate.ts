/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { IObservable, observableFromEvent } from '../../base/common/observable.js';
import { isWeb } from '../../base/common/platform.js';
import { AgentHostAllowSignedOutWhenUsableSettingId } from '../../platform/agentHost/common/agentService.js';
import type { IConfigurationService } from '../../platform/configuration/common/configuration.js';

/**
 * Predicates behind optional sign-in in the Agents window. The window itself
 * never gates entry on GitHub; only individual surfaces may offer sign-in, and
 * only when the `chat.agentHost.allowSignedOutWhenUsable` opt-in is enabled.
 */

/**
 * Whether the `chat.agentHost.allowSignedOutWhenUsable` experimentation opt-in
 * is enabled in a desktop window. Web always requires sign-in.
 */
export function isAllowSignedOutWhenUsableEnabled(configurationService: IConfigurationService): boolean {
	return !isWeb && configurationService.getValue<boolean>(AgentHostAllowSignedOutWhenUsableSettingId) === true;
}

/** Whether the GitHub workspace group should offer sign-in. */
export function shouldShowGitHubWorkspaceGroupSignIn(signedIn: boolean, allowSignedOutWhenUsable: boolean): boolean {
	return !signedIn && allowSignedOutWhenUsable;
}

export function shouldForceGitHubSignIn(allowSignedOutWhenUsable: boolean): boolean {
	return !allowSignedOutWhenUsable;
}

/**
 * Observe the setting that permits running without GitHub sign-in when a
 * session type can operate that way.
 */
export function observeAllowSignedOutWhenUsable(configurationService: IConfigurationService): IObservable<boolean> {
	return observableFromEvent(
		Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(AgentHostAllowSignedOutWhenUsableSettingId)),
		() => isAllowSignedOutWhenUsableEnabled(configurationService));
}

/**
 * Whether the window may be used while signed out: either the experimentation opt-in is
 * set, or a provider advertises a session type that needs no GitHub account.
 *
 * Every conditional-auth surface must agree on this. If the window gate widens but the
 * workspace picker and type picker do not, a signed-out user is admitted to a window where
 * every chat type is unavailable and no sign-in action is offered.
 */
export function isSignedOutWindowUsable(configured: boolean, sessionTypes: readonly { readonly authRequirement?: SessionTypeAuthRequirement }[]): boolean {
	return configured || !isWeb && sessionTypes.some(sessionType => sessionType.authRequirement === SessionTypeAuthRequirement.None);
}
