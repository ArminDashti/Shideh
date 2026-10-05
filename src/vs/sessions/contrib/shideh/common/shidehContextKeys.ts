/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const ShidehNavigationIntegratedContext = new RawContextKey<boolean>('shideh.navigationIntegratedSidebar', false, localize('shidehNavigationIntegrated', "Whether Shideh uses the integrated Agents sidebar layout."));

export const SHIDEH_HUB_SECTION_ID = 'shideh-hub';
export const SHIDEH_STATS_SECTION_ID = 'shideh-stats';
export const SHIDEH_SEARCH_SECTION_ID = 'shideh-search';
export const SHIDEH_NEW_PROJECT_SECTION_ID = 'shideh-new-project';
export const SHIDEH_PROJECTS_HEADER_SECTION_ID = 'shideh-projects-header';
