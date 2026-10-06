/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isWindows } from '../../../../base/common/platform.js';

export function getShidehDefaultTerminalProfileConfigurationKey(): string {
	if (isWindows) {
		return 'terminal.integrated.defaultProfile.windows';
	}
	if (isMacintosh) {
		return 'terminal.integrated.defaultProfile.osx';
	}
	return 'terminal.integrated.defaultProfile.linux';
}
