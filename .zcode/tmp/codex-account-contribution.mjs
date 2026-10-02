import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/vs/sessions/contrib/accountMenu/browser/account.contribution.ts';
let text = readFileSync(path, 'utf8');
const crlf = text.includes('\r\n');
if (crlf) {
	text = text.replaceAll('\r\n', '\n');
}

// Every find is built from verbatim source lines joined with '\n', plus an explicit tail:
//   '\n'    -> eat the last removed line's own terminator
//   '\n\n'  -> additionally eat the blank line that follows (removals surrounded by blanks)
const remove = (lines, tail) => [lines.join('\n') + tail, ''];

const edits = [
	// --- imports ---
	remove([`import { getCodexRateLimitLabel, getCodexRateLimits } from '../../../../workbench/contrib/chat/browser/chatStatus/codexStatusDashboard.js';`], '\n'),
	remove([`import { createCodexAccountMenuActions, getCodexAccountPlanName, hasSignedInCodexChatGPTAccount, ICodexAccountService, shouldShowCodexAccount, type ICodexAccountViewInfo } from '../../../../workbench/services/agentHost/browser/codexAccountService.js';`], '\n'),
	[`import { fromNow, safeIntl } from '../../../../base/common/date.js';`, `import { safeIntl } from '../../../../base/common/date.js';`],
	remove([`import { AgentHostCodexAgentEnabledSettingId } from '../../../../platform/agentHost/common/agentService.js';`], '\n'),
	remove([`import { ICodexAccountRateLimitInfo } from '../../../../platform/agentHost/common/codexAccount.js';`], '\n'),
	remove([`import { equals } from '../../../../base/common/arrays.js';`], '\n'),

	// --- module-level formatter only used by the ChatGPT rate-limit hover ---
	remove([`const accountFullDateFormatter = safeIntl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' });`], '\n'),

	// --- getChatGPTRateLimitResetHover (exported; its test is fixed in Phase 7) ---
	remove([
		`export function getChatGPTRateLimitResetHover(rateLimit: ICodexAccountRateLimitInfo): string | undefined {`,
		`\tif (!rateLimit.resetsAt) {`,
		`\t\treturn undefined;`,
		`\t}`,
		`\tconst resetDate = new Date(rateLimit.resetsAt * 1000);`,
		`\tif (rateLimit.windowDurationMins !== undefined && rateLimit.windowDurationMins < 24 * 60) {`,
		`\t\treturn localize('chatGPTShortLimitResetExact', "Resets at {0}", accountTimeFormatter.value.format(resetDate));`,
		`\t}`,
		`\treturn localize(`,
		`\t\t'chatGPTLongLimitResetExact',`,
		`\t\t"Resets on {0} at {1}",`,
		`\t\taccountFullDateFormatter.value.format(resetDate),`,
		`\t\taccountTimeFormatter.value.format(resetDate),`,
		`\t);`,
		`}`,
	], '\n\n'),

	// --- fields ---
	remove([
		`\tprivate codexPanelAvatarElement: HTMLImageElement | undefined;`,
		`\tprivate codexPanelIconElement: HTMLElement | undefined;`,
	], '\n'),
	remove([
		`\tprivate codexAvatarRequestCounter = 0;`,
		`\tprivate currentCodexAvatarUrl: string | undefined;`,
		`\tprivate loadedCodexAvatarUrl: string | undefined;`,
		`\tprivate lastCodexAccount: ICodexAccountViewInfo;`,
	], '\n'),
	remove([`\tprivate readonly codexAvatarLoadDisposable = this._register(new MutableDisposable());`], '\n'),

	// --- constructor ---
	remove([`\t\t@ICodexAccountService private readonly codexAccountService: ICodexAccountService,`], '\n'),
	remove([`\t\tthis.lastCodexAccount = this.codexAccountService.account;`], '\n'),
	remove([
		`\t\tthis._register(this.codexAccountService.onDidChangeAccount(account => {`,
		`\t\t\tif (hasCodexAccountPanelContentChanged(this.lastCodexAccount, account)) {`,
		`\t\t\t\tthis.clickPanelDisposable.clear();`,
		`\t\t\t}`,
		`\t\t\tthis.lastCodexAccount = account;`,
		`\t\t\tthis.refreshCodexAvatar();`,
		`\t\t\tthis.renderState();`,
		`\t\t}));`,
	], '\n'),
	[
		[
			`\t\t\tif (event.affectsConfiguration(AgentHostCodexAgentEnabledSettingId) || event.affectsConfiguration(ChatAIDisabledSettingId)) {`,
			`\t\t\t\tthis.clickPanelDisposable.clear();`,
			`\t\t\t\tthis.renderState();`,
			`\t\t\t}`,
			`\t\t\tif (event.affectsConfiguration(ACCOUNTS_AVATAR_SETTING)) {`,
			`\t\t\t\tthis.refreshAvatar();`,
			`\t\t\t\tthis.refreshCodexAvatar();`,
			`\t\t\t}`,
		].join('\n') + '\n',
		[
			`\t\t\tif (event.affectsConfiguration(ChatAIDisabledSettingId)) {`,
			`\t\t\t\tthis.clickPanelDisposable.clear();`,
			`\t\t\t\tthis.renderState();`,
			`\t\t\t}`,
			`\t\t\tif (event.affectsConfiguration(ACCOUNTS_AVATAR_SETTING)) {`,
			`\t\t\t\tthis.refreshAvatar();`,
			`\t\t\t}`,
		].join('\n') + '\n',
	],
	[
		`\t\tthis.refreshAccount();\n\t\tthis.refreshCodexAvatar();\n`,
		`\t\tthis.refreshAccount();\n`,
	],

	// --- renderState tail ---
	[
		`\t\tthis.badgeElement.style.display = shouldShowDotBadge ? '' : 'none';\n\t\tthis.renderCodexPanelAvatar();\n`,
		`\t\tthis.badgeElement.style.display = shouldShowDotBadge ? '' : 'none';\n`,
	],

	// --- codex avatar/panel methods ---
	remove([
		`\tprivate getCodexAvatarAltText(): string {`,
		`\t\treturn this.codexAccountService.account.email`,
		`\t\t\t? localize('chatGPTAvatarAlt', "ChatGPT profile image for {0}", this.codexAccountService.account.email)`,
		`\t\t\t: localize('chatGPTAvatarAltFallback', "ChatGPT profile image");`,
		`\t}`,
	], '\n\n'),
	remove([
		`\tprivate renderCodexPanelAvatar(): void {`,
		`\t\tif (!this.codexPanelAvatarElement || !this.codexPanelIconElement) {`,
		`\t\t\treturn;`,
		`\t\t}`,
		`\t\tconst avatarUrl = this.loadedCodexAvatarUrl;`,
		`\t\tthis.codexPanelAvatarElement.classList.toggle('hidden', !avatarUrl);`,
		`\t\tthis.codexPanelIconElement.classList.toggle('hidden', !!avatarUrl);`,
		`\t\tthis.codexPanelAvatarElement.alt = this.getCodexAvatarAltText();`,
		`\t\tif (avatarUrl) {`,
		`\t\t\tif (this.codexPanelAvatarElement.src !== avatarUrl) {`,
		`\t\t\t\tthis.codexPanelAvatarElement.src = avatarUrl;`,
		`\t\t\t}`,
		`\t\t} else {`,
		`\t\t\tthis.codexPanelAvatarElement.removeAttribute('src');`,
		`\t\t}`,
		`\t}`,
	], '\n\n'),
	remove([
		`\tprivate refreshCodexAvatar(): void {`,
		`\t\tconst account = this.codexAccountService.account;`,
		`\t\tconst avatarUrl = this.configurationService.getValue<boolean>(ACCOUNTS_AVATAR_SETTING) && account.status === 'signedIn'`,
		`\t\t\t? account.profileImageDataUri`,
		`\t\t\t: undefined;`,
		`\t\tif (avatarUrl === this.currentCodexAvatarUrl) {`,
		`\t\t\treturn;`,
		`\t\t}`,
		``,
		`\t\tthis.currentCodexAvatarUrl = avatarUrl;`,
		`\t\tthis.loadedCodexAvatarUrl = undefined;`,
		`\t\tthis.codexAvatarLoadDisposable.clear();`,
		`\t\tconst requestId = ++this.codexAvatarRequestCounter;`,
		``,
		`\t\tif (!avatarUrl) {`,
		`\t\t\tthis.renderState();`,
		`\t\t\treturn;`,
		`\t\t}`,
		``,
		`\t\tconst image = new Image();`,
		`\t\timage.referrerPolicy = 'no-referrer';`,
		`\t\tconst clearHandlers = () => {`,
		`\t\t\timage.onload = null;`,
		`\t\t\timage.onerror = null;`,
		`\t\t};`,
		`\t\timage.onload = () => {`,
		`\t\t\tif (requestId !== this.codexAvatarRequestCounter) {`,
		`\t\t\t\treturn;`,
		`\t\t\t}`,
		``,
		`\t\t\tthis.loadedCodexAvatarUrl = avatarUrl;`,
		`\t\t\tthis.renderState();`,
		`\t\t\tclearHandlers();`,
		`\t\t};`,
		`\t\timage.onerror = () => {`,
		`\t\t\tif (requestId !== this.codexAvatarRequestCounter) {`,
		`\t\t\t\treturn;`,
		`\t\t\t}`,
		``,
		`\t\t\tthis.loadedCodexAvatarUrl = undefined;`,
		`\t\t\tthis.renderState();`,
		`\t\t\tclearHandlers();`,
		`\t\t};`,
		`\t\tthis.codexAvatarLoadDisposable.value = toDisposable(() => {`,
		`\t\t\tclearHandlers();`,
		`\t\t\timage.src = '';`,
		`\t\t});`,
		`\t\timage.src = avatarUrl;`,
		`\t\tthis.renderState();`,
		`\t}`,
	], '\n\n'),

	// --- panel build: codex locals + ChatGPT account section ---
	remove([
		`\t\tconst codexAccount = this.codexAccountService.account;`,
		`\t\tconst codexAccountVisible = shouldShowCodexAccount(this.configurationService, true);`,
	], '\n'),
	remove([
		`\t\tif (hasSignedInCodexChatGPTAccount(codexAccount, codexAccountVisible)) {`,
		`\t\t\tconst accountSection = append(identities, $('section.sessions-account-titlebar-panel-provider-account', {`,
		`\t\t\t\t'aria-label': localize('chatGPTAccountSectionLabel', "ChatGPT account")`,
		`\t\t\t}));`,
		`\t\t\tconst accountIdentity = append(accountSection, $('.sessions-account-titlebar-panel-provider-identity'));`,
		`\t\t\tconst avatar = append(accountIdentity, $('img.sessions-account-titlebar-panel-provider-avatar', {`,
		`\t\t\t\talt: this.getCodexAvatarAltText(),`,
		`\t\t\t\tdraggable: 'false',`,
		`\t\t\t})) as HTMLImageElement;`,
		`\t\t\tavatar.decoding = 'async';`,
		`\t\t\tavatar.referrerPolicy = 'no-referrer';`,
		`\t\t\tconst accountIcon = append(accountIdentity, $('span.sessions-account-titlebar-panel-provider-icon', { 'aria-hidden': 'true' }));`,
		`\t\t\taccountIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.openai));`,
		`\t\t\tthis.codexPanelAvatarElement = avatar;`,
		`\t\t\tthis.codexPanelIconElement = accountIcon;`,
		`\t\t\tthis.renderCodexPanelAvatar();`,
		`\t\t\tpanelStore.add(toDisposable(() => {`,
		`\t\t\t\tif (this.codexPanelAvatarElement === avatar) {`,
		`\t\t\t\t\tthis.codexPanelAvatarElement = undefined;`,
		`\t\t\t\t}`,
		`\t\t\t\tif (this.codexPanelIconElement === accountIcon) {`,
		`\t\t\t\t\tthis.codexPanelIconElement = undefined;`,
		`\t\t\t\t}`,
		`\t\t\t}));`,
		`\t\t\tconst accountName = append(accountIdentity, $('.sessions-account-titlebar-panel-provider-name'));`,
		`\t\t\taccountName.textContent = codexAccount.email ?? localize('chatGPTAccountName', "ChatGPT");`,
		`\t\t\tconst accountActions = append(accountIdentity, $('.sessions-account-titlebar-panel-provider-actions'));`,
		`\t\t\tconst accountActionBar = panelStore.add(new ActionBar(accountActions));`,
		`\t\t\tpanelStore.add(accountActionBar.onWillRun(() => {`,
		`\t\t\t\tthis.hoverService.hideHover(true);`,
		`\t\t\t\tthis.clickPanelDisposable.clear();`,
		`\t\t\t}));`,
		`\t\t\taccountActionBar.push(panelStore.add(new Action(`,
		`\t\t\t\t'codex.manageChatGPTModels',`,
		`\t\t\t\tlocalize('manageChatGPTModels', "Manage ChatGPT Models"),`,
		`\t\t\t\tThemeIcon.asClassName(Codicon.openai),`,
		`\t\t\t\ttrue,`,
		`\t\t\t\t() => this.commandService.executeCommand(MANAGE_CHAT_COMMAND_ID, '@provider:"ChatGPT"'),`,
		`\t\t\t)), { icon: true, label: false });`,
		`\t\t\taccountActionBar.push(panelStore.add(new Action(`,
		`\t\t\t\t'codex.openAgentCustomizations',`,
		`\t\t\t\tlocalize('openCodexAgentCustomizations', "Agent Customizations for Codex"),`,
		`\t\t\t\tThemeIcon.asClassName(Codicon.settingsGear),`,
		`\t\t\t\ttrue,`,
		`\t\t\t\t() => this.commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, {`,
		`\t\t\t\t\tsessionType: SessionType.AgentHostCodex,`,
		`\t\t\t\t\tsection: AICustomizationManagementSection.HarnessSettings,`,
		`\t\t\t\t}),`,
		`\t\t\t)), { icon: true, label: false });`,
		`\t\t\taccountActionBar.push(panelStore.add(new Action(`,
		`\t\t\t\t'codex.signOutOfChatGPT',`,
		`\t\t\t\tlocalize('signOutOfChatGPT', "Sign Out"),`,
		`\t\t\t\tThemeIcon.asClassName(Codicon.signOut),`,
		`\t\t\t\ttrue,`,
		`\t\t\t\t() => this.codexAccountService.signOut(),`,
		`\t\t\t)), { icon: true, label: false });`,
		`\t\t\tthis.appendChatGPTUsage(accountSection, panelStore);`,
		`\t\t} else {`,
		`\t\t\tconst codexAccountActions = createCodexAccountMenuActions(this.codexAccountService, codexAccountVisible);`,
		`\t\t\tif (codexAccountActions.length) {`,
		`\t\t\t\tconst accountSection = append(identities, $('section.sessions-account-titlebar-panel-provider-account.signed-out', {`,
		`\t\t\t\t\t'aria-label': localize('chatGPTAccountSectionLabel', "ChatGPT account")`,
		`\t\t\t\t}));`,
		`\t\t\t\tconst accountIdentity = append(accountSection, $('.sessions-account-titlebar-panel-provider-identity'));`,
		`\t\t\t\tconst accountIcon = append(accountIdentity, $('span.sessions-account-titlebar-panel-provider-icon', { 'aria-hidden': 'true' }));`,
		`\t\t\t\taccountIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.openai));`,
		`\t\t\t\tconst signInActions = append(accountIdentity, $('.sessions-account-titlebar-panel-provider-sign-in-actions'));`,
		`\t\t\t\tconst signInActionBar = panelStore.add(new ActionBar(signInActions));`,
		`\t\t\t\tpanelStore.add(signInActionBar.onWillRun(() => {`,
		`\t\t\t\t\tthis.hoverService.hideHover(true);`,
		`\t\t\t\t\tthis.clickPanelDisposable.clear();`,
		`\t\t\t\t}));`,
		`\t\t\t\tfor (const action of codexAccountActions) {`,
		`\t\t\t\t\tsignInActionBar.push(action instanceof Action ? panelStore.add(action) : action, { icon: false, label: true });`,
		`\t\t\t\t}`,
		`\t\t\t}`,
		`\t\t}`,
	], '\n\n'),

	// --- appendChatGPTUsage method ---
	remove([
		`\tprivate appendChatGPTUsage(accountSection: HTMLElement, panelStore: DisposableStore): void {`,
		`\t\tconst account = this.codexAccountService.account;`,
		`\t\tconst usage = append(accountSection, $('.sessions-account-titlebar-panel-provider-usage'));`,
		`\t\tconst planRow = append(usage, $('.sessions-account-titlebar-panel-provider-metric-row.primary'));`,
		`\t\tappend(planRow, $('span.sessions-account-titlebar-panel-provider-plan', undefined, getCodexAccountPlanName(account)));`,
		`\t\tconst percentageFormatter = safeIntl.NumberFormat(language, { maximumFractionDigits: 0 });`,
		`\t\tfor (const rateLimit of getCodexRateLimits(account)) {`,
		`\t\t\tconst limitLabel = getCodexRateLimitLabel(rateLimit.windowDurationMins);`,
		`\t\t\tconst usedPercentage = percentageFormatter.value.format(rateLimit.usedPercent);`,
		`\t\t\tconst detailRow = append(usage, $('.sessions-account-titlebar-panel-provider-metric-row.secondary'));`,
		`\t\t\tconst description = rateLimit.resetsAt`,
		`\t\t\t\t? localize('chatGPTLimitReset', "{0} resets {1}", limitLabel, fromNow(rateLimit.resetsAt * 1000, false, true))`,
		`\t\t\t\t: limitLabel;`,
		`\t\t\tappend(detailRow, $('span.sessions-account-titlebar-panel-provider-reset', undefined, description));`,
		`\t\t\tappend(detailRow, $('span.sessions-account-titlebar-panel-provider-usage-value', {`,
		`\t\t\t\t'aria-label': localize('chatGPTWindowLimitUsedPercentage', "{0}: {1}% used", limitLabel, usedPercentage),`,
		`\t\t\t}, localize('chatGPTLimitUsedPercentage', "{0}% used", usedPercentage)));`,
		``,
		`\t\t\tconst resetHover = getChatGPTRateLimitResetHover(rateLimit);`,
		`\t\t\tif (resetHover) {`,
		`\t\t\t\tdetailRow.tabIndex = 0;`,
		`\t\t\t\tdetailRow.setAttribute('aria-label', localize('chatGPTLimitResetAria', "{0}, {1}% used. {2}", description, usedPercentage, resetHover));`,
		`\t\t\t\tpanelStore.add(this.hoverService.setupDelayedHover(detailRow, { content: resetHover }, { setupKeyboardEvents: true }));`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
	], '\n\n'),

	// --- hasCodexAccountPanelContentChanged helper ---
	remove([
		`function hasCodexAccountPanelContentChanged(previous: ICodexAccountViewInfo, current: ICodexAccountViewInfo): boolean {`,
		`\tconst previousRateLimits = getCodexRateLimits(previous);`,
		`\tconst currentRateLimits = getCodexRateLimits(current);`,
		`\treturn previous.status !== current.status`,
		`\t\t|| previous.email !== current.email`,
		`\t\t|| previous.planType !== current.planType`,
		`\t\t|| previous.requiresOpenaiAuth !== current.requiresOpenaiAuth`,
		`\t\t|| previous.authUrl !== current.authUrl`,
		`\t\t|| previous.authUrlNonce !== current.authUrlNonce`,
		`\t\t|| !equals(previousRateLimits, currentRateLimits, (a, b) => a.usedPercent === b.usedPercent && a.windowDurationMins === b.windowDurationMins && a.resetsAt === b.resetsAt);`,
		`}`,
	], '\n\n'),
];

let failed = false;
for (const [find] of edits) {
	const count = text.split(find).length - 1;
	if (count !== 1) {
		console.error(`MATCH ${count} (expected 1): ${find.slice(0, 90).replaceAll('\n', '\\n')}`);
		failed = true;
	}
}
if (failed) {
	process.exit(1);
}
for (const [find, replace] of edits) {
	text = text.replace(find, replace);
}
if (crlf) {
	text = text.replaceAll('\n', '\r\n');
}
writeFileSync(path, text);
console.log(`Applied ${edits.length} edits to ${path}`);
