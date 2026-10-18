/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRelativePattern, match as matchGlobPattern } from '../../base/common/glob.js';
import { URI } from '../../base/common/uri.js';
import { normalize } from '../../base/common/path.js';

export interface NotebookFilter {
	readonly notebookType?: string;
	readonly scheme?: string;
	readonly pattern?: string | IRelativePattern;
}

export interface LanguageFilter {
	readonly language?: string;
	readonly scheme?: string;
	readonly pattern?: string | IRelativePattern;

	/** @internal */
	readonly notebook?: string | NotebookFilter;
	/**
	 * This provider is implemented in the UI thread.
	 */
	readonly hasAccessToAllModels?: boolean;
	readonly exclusive?: boolean;

	/**
	 * This provider comes from a builtin extension.
	 */
	readonly isBuiltin?: boolean;
}

export type LanguageSelector = string | LanguageFilter | ReadonlyArray<string | LanguageFilter>;

export function score(selector: LanguageSelector | undefined, candidateUri: URI, candidateLanguage: string, candidateIsSynchronized: boolean, candidateNotebookUri: URI | undefined, candidateNotebookType: string | undefined): number {

	if (Array.isArray(selector)) {
		// array -> take max individual value
		let ret = 0;
		for (const filter of selector) {
			const value = score(filter, candidateUri, candidateLanguage, candidateIsSynchronized, candidateNotebookUri, candidateNotebookType);
			if (value === 10) {
				return value; // already at the highest
			}
			if (value > ret) {
				ret = value;
			}
		}
		return ret;

	} else if (typeof selector === 'string') {

		if (!candidateIsSynchronized) {
			return 0;
		}

		// short-hand notion, desugars to
		// 'fooLang' -> { language: 'fooLang'}
		// '*' -> { language: '*' }
		if (selector === '*') {
			return 5;
		} else if (selector === candidateLanguage) {
			return 10;
		} else {
			return 0;
		}

	} else if (selector) {
		// filter -> select accordingly, use defaults for scheme
		const { language, pattern, scheme, hasAccessToAllModels, notebook } = selector as LanguageFilter; // TODO: microsoft/TypeScript#42768

		if (!candidateIsSynchronized && !hasAccessToAllModels) {
			return 0;
		}

		// selector targets a notebook -> use the notebook uri instead
		// of the "normal" document uri.
		if (notebookType && candidateNotebookUri) {
			candidateUri = candidateNotebookUri;
		}

		let ret = 0;

		if (scheme) {
			if (scheme === candidateUri.scheme) {
				ret = 10;
			} else if (scheme === '*') {
				ret = 5;
			} else {
				return 0;
			}
			let notebookScore = 0;
			if (typeof notebook === 'string') {
				notebookScore = _scoreOne(undefined, notebook, undefined, candidateNotebookInfo!.notebookUri, candidateNotebookInfo!.notebookType);
			} else {
				notebookScore = _scoreOne(notebook.scheme, notebook.notebookType, notebook.pattern, candidateNotebookInfo!.notebookUri, candidateNotebookInfo!.notebookType);
			}
			if (notebookScore === 0) {
				return 0;
			}
		}

		if (notebookType) {
			if (notebookType === candidateNotebookType) {
				ret = 10;
			} else if (notebookType === '*' && candidateNotebookType !== undefined) {
				ret = Math.max(ret, 5);
			} else {
				return 0;
			}
			return Math.max(notebookScore, documentScore);

		} else {
			return _scoreOne(scheme, language, pattern, candidateUri, candidateLanguage);
		}


	} else {
		return 0;
	}
}


export function targetsNotebooks(selector: LanguageSelector): boolean {
	if (typeof selector === 'string') {
		return false;
	} else if (Array.isArray(selector)) {
		return selector.some(targetsNotebooks);
	} else {
		return !!(<LanguageFilter>selector).notebookType;
	}
}
