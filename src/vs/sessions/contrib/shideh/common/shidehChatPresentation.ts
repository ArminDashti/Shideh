/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ChatPermissionLevel } from '../../../../workbench/contrib/chat/common/constants.js';
import { isShidehAgentsFirstProduct } from './shidehProduct.js';

export type ShidehInteractionMode = 'ask' | 'build' | 'plan';

export const SHIDEH_INTERACTION_MODE_KEY = 'shideh.defaultInteractionMode';

export function isShidehSimplifiedChatChrome(productService: IProductService): boolean {
	return isShidehAgentsFirstProduct(productService);
}

export function getShidehInteractionMode(configurationService: IConfigurationService): ShidehInteractionMode {
	const mode = configurationService.getValue<string>(SHIDEH_INTERACTION_MODE_KEY);
	return mode === 'ask' || mode === 'plan' ? mode : 'build';
}

export function shidehInteractionModeFromAgentHostMode(agentHostMode: string, configurationService: IConfigurationService): ShidehInteractionMode {
	if (agentHostMode === 'plan') {
		return 'plan';
	}
	return getShidehInteractionMode(configurationService);
}

export function agentHostModeForShidehInteractionMode(mode: ShidehInteractionMode): string {
	return mode === 'plan' ? 'plan' : 'interactive';
}

export function getShidehInteractionModeLabel(mode: ShidehInteractionMode): string {
	switch (mode) {
		case 'ask': return localize('shidehInteractionMode.ask', "Ask");
		case 'build': return localize('shidehInteractionMode.build', "Build");
		case 'plan': return localize('shidehInteractionMode.plan', "Plan");
	}
}

export function getShidehInteractionModeDescription(mode: ShidehInteractionMode): string {
	switch (mode) {
		case 'ask': return localize('shidehInteractionMode.ask.description', "Q&A without running tools.");
		case 'build': return localize('shidehInteractionMode.build.description', "Agent mode with tools.");
		case 'plan': return localize('shidehInteractionMode.plan.description', "Plan before making changes.");
	}
}

export function getShidehPermissionLevelLabel(level: ChatPermissionLevel): string {
	switch (level) {
		case ChatPermissionLevel.Default: return localize('shidehPermission.manual', "Manual");
		case ChatPermissionLevel.Assisted: return localize('shidehPermission.assisted', "Assisted");
		case ChatPermissionLevel.AutoApprove: return localize('shidehPermission.full', "Full");
		default: return level;
	}
}

export function getShidehTimeOfDayGreeting(accountName?: string): string {
	const hour = new Date().getHours();
	let greeting: string;
	if (hour < 12) {
		greeting = localize('shidehGreeting.morning', "Good morning");
	} else if (hour < 17) {
		greeting = localize('shidehGreeting.afternoon', "Good afternoon");
	} else {
		greeting = localize('shidehGreeting.evening', "Good evening");
	}
	if (accountName) {
		return localize('shidehGreeting.named', "{0}, {1}", greeting, accountName);
	}
	return greeting;
}

export function formatWorkspaceLabelWithGitBranch(workspaceLabel: string, branchName?: string): string {
	const branch = branchName?.trim();
	if (!branch) {
		return workspaceLabel;
	}
	return localize('shidehWorkspaceLabelWithBranch', "{0} · {1}", workspaceLabel, branch);
}

export interface IShidehModePickerItem {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export function mapShidehModePickerContext<T extends { currentValue: string; items: readonly IShidehModePickerItem[]; tooltip: string }>(
	ctx: T,
	configurationService: IConfigurationService,
): T {
	const current = shidehInteractionModeFromAgentHostMode(ctx.currentValue, configurationService);
	const items: IShidehModePickerItem[] = SHIDEH_MODES.map(mode => ({
		value: mode,
		label: getShidehInteractionModeLabel(mode),
		description: getShidehInteractionModeDescription(mode),
	}));
	return {
		...ctx,
		currentValue: current,
		items,
		tooltip: localize('shidehInteractionMode.pickerTooltip', "Choose how the agent should work in this session."),
	};
}

const SHIDEH_MODES: readonly ShidehInteractionMode[] = ['ask', 'build', 'plan'];

export function resolveShidehModePickerSelection(value: string, configurationService: IConfigurationService): string | undefined {
	if (value === 'ask' || value === 'build' || value === 'plan') {
		void configurationService.updateValue(SHIDEH_INTERACTION_MODE_KEY, value);
		return agentHostModeForShidehInteractionMode(value);
	}
	return undefined;
}
