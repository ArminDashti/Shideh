/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShidehLmProviderId } from './shidehLmProviderCatalog.js';

/** Inline SVG marks (data URLs) for provider branding in settings UI. */
export const SHIDEH_PROVIDER_LOGO_DATA_URL: Readonly<Record<ShidehLmProviderId, string>> = {
	ollama: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#000"/><path fill="#fff" d="M7 17c0-3 2-5 5-5s5 2 5 5v1H7v-1zm5-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>`),
	anthropic: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#D97757"/><path fill="#fff" d="M12 4 6 20h2.2l1-2.8h5.6l1 2.8H18L12 4zm-1.2 11.2 1.2-3.4 1.2 3.4H10.8z"/></svg>`),
	openai: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#10A37F"/><path fill="#fff" d="M12 5.5c2.8 0 4.5 1.5 4.5 3.6 0 1.4-.8 2.5-2.1 3.1 1.5.5 2.4 1.8 2.4 3.4 0 2.3-1.9 3.9-4.8 3.9S7.2 18 7.2 15.6c0-1.6.9-2.9 2.4-3.4-1.3-.6-2.1-1.7-2.1-3.1 0-2.1 1.7-3.6 4.5-3.6zm0 2.2c-1.2 0-1.9.6-1.9 1.4s.7 1.4 1.9 1.4 1.9-.6 1.9-1.4-.7-1.4-1.9-1.4zm0 5.4c-1.3 0-2.1.7-2.1 1.6s.8 1.6 2.1 1.6 2.1-.7 2.1-1.6-.8-1.6-2.1-1.6z"/></svg>`),
	openrouter: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#6366F1"/><path fill="#fff" d="M6 8h5v2H9v6H7V8zm8 0h2v8h-2v-3h-2v3h-2V8h2v3h2V8z"/></svg>`),
	'opencode-go': svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#F59E0B"/><path fill="#fff" d="M8 7h8v2h-3v8H11V9H8V7z"/></svg>`),
	'opencode-zen': svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#8B5CF6"/><circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M12 9v6M9 12h6"/></svg>`),
	'openai-compatible': svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#64748B"/><path fill="#fff" d="M8 9h8v2H8V9zm0 4h5v2H8v-2z"/></svg>`),
};

function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
