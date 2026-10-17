/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InsertSpaces } from '../../../common/core/misc/indentation.js';

export function getSpaceCnt(str: string, tabSize: number) {
	let spacesCnt = 0;

	for (let i = 0; i < str.length; i++) {
		if (str.charAt(i) === '\t') {
			spacesCnt += tabSize;
		} else {
			spacesCnt++;
		}
	}

	return spacesCnt;
}

export function generateIndent(spacesCnt: number, tabSize: number, insertSpaces: InsertSpaces) {
	spacesCnt = spacesCnt < 0 ? 0 : spacesCnt;

	let result = '';
	if (insertSpaces !== InsertSpaces.Spaces) {
		const tabsCnt = Math.floor(spacesCnt / tabSize);
		// Then we find the remainder on the floor division
		spacesCnt = spacesCnt % tabSize;
		for (let i = 0; i < tabsCnt; i++) {
			result += '\t';
		}
	}

	// Make the indentation out of the tabs and spaces are requested
	for (let i = 0; i < spacesCnt; i++) {
		result += ' ';
	}

	return result;
}
