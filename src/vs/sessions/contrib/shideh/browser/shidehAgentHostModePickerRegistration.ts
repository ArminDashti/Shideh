/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchLayoutService } from '../../../../workbench/services/layout/browser/layoutService.js';
import { isPhoneLayout } from '../../../browser/parts/mobile/mobileLayout.js';
import { IObservable } from '../../../../base/common/observable.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';
import { AgentHostModePicker } from '../../providers/agentHost/browser/agentHostModePicker.js';
import { MobileAgentHostModePicker } from '../../providers/agentHost/browser/mobile/mobileAgentHostModePicker.js';
import { isShidehSimplifiedChatChrome } from '../common/shidehChatPresentation.js';
import { ShidehAgentHostModePicker } from './shidehAgentHostModePicker.js';
import { ShidehMobileAgentHostModePicker } from './shidehMobileAgentHostModePicker.js';

export type AgentHostModePickerCtor = new (session: IObservable<IActiveSession | undefined>, ...services: never[]) => AgentHostModePicker;

export function getAgentHostModePickerCtor(accessor: ServicesAccessor): AgentHostModePickerCtor {
	const productService = accessor.get(IProductService);
	const layoutService = accessor.get(IWorkbenchLayoutService);
	const phone = isPhoneLayout(layoutService);
	if (!isShidehSimplifiedChatChrome(productService)) {
		return phone ? MobileAgentHostModePicker : AgentHostModePicker;
	}
	return phone ? ShidehMobileAgentHostModePicker : ShidehAgentHostModePicker;
}

export function createAgentHostModePicker(instantiationService: IInstantiationService, session: IObservable<IActiveSession | undefined>): AgentHostModePicker {
	const Ctor = instantiationService.invokeFunction(getAgentHostModePickerCtor);
	return instantiationService.createInstance(Ctor, session);
}
