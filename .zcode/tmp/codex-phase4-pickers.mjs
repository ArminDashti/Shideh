import { readFileSync, writeFileSync } from 'node:fs';

const root = 'C:/Users/armin/GitHub/Shideh/';
const edits = [
	// ================= agentHostSessionConfigPicker.ts =================
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"import { AgentHostPermissionPickerDelegate, isWellKnownAutoApproveSchema, isWellKnownClaudePermissionModeSchema, isWellKnownCodexApprovalsSchema, isWellKnownModeSchema } from './agentHostPermissionPickerDelegate.js';",
		"import { AgentHostPermissionPickerDelegate, isWellKnownAutoApproveSchema, isWellKnownClaudePermissionModeSchema, isWellKnownModeSchema } from './agentHostPermissionPickerDelegate.js';"],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"import { AgentHostCodexApprovalsPicker } from './agentHostCodexApprovalsPicker.js';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"import { CodexSessionConfigKey } from '../../../../../platform/agentHost/common/codexSessionConfigKeys.js';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"\tif (property === ClaudeSessionConfigKey.PermissionMode && isWellKnownClaudePermissionModeSchema(schema)) {\n\t\treturn false;\n\t}\n\tif (property === CodexSessionConfigKey.PermissionsPreset && isWellKnownCodexApprovalsSchema(schema)) {\n\t\treturn false;\n\t}\n\treturn true;",
		"\tif (property === ClaudeSessionConfigKey.PermissionMode && isWellKnownClaudePermissionModeSchema(schema)) {\n\t\treturn false;\n\t}\n\treturn true;"],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"\t\tthis._register(actionViewItemService.register(\n\t\t\tMenus.NewSessionControl,\n\t\t\tNEW_SESSION_CODEX_APPROVALS_PICKER_ID,\n\t\t\t(_action, _options, scopedInstantiationService) => {\n\t\t\t\tconst { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));\n\t\t\t\treturn new PickerActionViewItem(scopedInstantiationService.createInstance(AgentHostCodexApprovalsPicker, session));\n\t\t\t},\n\t\t));\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"\t\tregisterRunningSessionPicker(\n\t\t\tRUNNING_SESSION_CODEX_APPROVALS_PICKER_ID,\n\t\t\t(_action, _options, scopedInstantiationService) => {\n\t\t\t\tconst { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));\n\t\t\t\treturn new PickerActionViewItem(scopedInstantiationService.createInstance(AgentHostCodexApprovalsPicker, session));\n\t\t\t},\n\t\t);\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"// ---- New session Codex approvals picker (NewSessionControl) ----\n// Codex-specific \"Approvals\" chip. Shares the NewSessionControl navigation\n// group with the Claude permission-mode picker (order 2); the two are\n// mutually exclusive because each hides itself when the active session's\n// schema doesn't expose its backing property.\n\nconst NEW_SESSION_CODEX_APPROVALS_PICKER_ID = 'sessions.agentHost.newSessionCodexApprovalsPicker';\n\nregisterAction2(class extends Action2 {\n\tconstructor() {\n\t\tsuper({\n\t\t\tid: NEW_SESSION_CODEX_APPROVALS_PICKER_ID,\n\t\t\ttitle: localize2('agentHostNewSessionCodexApprovalsPicker', \"Approvals\"),\n\t\t\tf1: false,\n\t\t\tmenu: [{\n\t\t\t\tid: Menus.NewSessionControl,\n\t\t\t\tgroup: 'navigation',\n\t\t\t\torder: 3,\n\t\t\t\twhen: ContextKeyExpr.or(IsActiveSessionLocalAgentHost, IsActiveSessionRemoteAgentHost),\n\t\t\t}],\n\t\t});\n\t}\n\n\toverride async run(): Promise<void> { }\n});\n\n// ---- New session mode picker (NewSessionControl) ----",
		"// ---- New session mode picker (NewSessionControl) ----"],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts',
		"// ---- Running session Codex approvals picker ----\n// Codex-specific \"Approvals\" chip for a running session. Mutually exclusive\n// with the Claude permission-mode picker (order 11) — each hides when its\n// backing property is absent from the active session's schema.\n\nconst RUNNING_SESSION_CODEX_APPROVALS_PICKER_ID = 'sessions.agentHost.runningSessionCodexApprovalsPicker';\n\nregisterAction2(class extends Action2 {\n\tconstructor() {\n\t\tsuper({\n\t\t\tid: RUNNING_SESSION_CODEX_APPROVALS_PICKER_ID,\n\t\t\ttitle: localize2('agentHostRunningSessionCodexApprovalsPicker', \"Approvals\"),\n\t\t\tf1: false,\n\t\t\tmenu: [{\n\t\t\t\tid: MenuId.ChatInput,\n\t\t\t\tgroup: 'navigation',\n\t\t\t\torder: 0.4,\n\t\t\t\twhen: ContextKeyExpr.and(ChatContextKeyExprs.isAgentHostSession, ExperimentalSessionComposerLayout),\n\t\t\t}, {\n\t\t\t\tid: MenuId.ChatInputSecondary,\n\t\t\t\tgroup: 'navigation',\n\t\t\t\torder: 12,\n\t\t\t\twhen: ContextKeyExpr.and(ChatContextKeyExprs.isAgentHostSession, ExperimentalSessionComposerLayout.negate()),\n\t\t\t}],\n\t\t});\n\t}\n\n\toverride async run(): Promise<void> { }\n});\n\n\n// ---- Running session mode picker (before approvals) ----",
		"// ---- Running session mode picker (before approvals) ----"],

	// ================= agentHostPermissionPickerDelegate.ts =================
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostPermissionPickerDelegate.ts',
		"import { narrowCodexPermissionsPreset } from '../../../../../platform/agentHost/common/codexSessionConfigKeys.js';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostPermissionPickerDelegate.ts',
		"const REQUIRED_CODEX_APPROVALS_VALUE = 'default';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostPermissionPickerDelegate.ts',
		"\n/**\n * Returns `true` when a `codex.permissionsPreset` session-config property uses\n * the Codex permissions-preset value set and includes `default`.\n *\n * Codex collapses its three security axes (sandbox × approval policy ×\n * approvals reviewer) into a single user-facing preset; this guard lets the\n * dedicated {@link AgentHostCodexApprovalsPicker} claim the property while the\n * generic per-property picker stands down.\n */\nexport function isWellKnownCodexApprovalsSchema(schema: SessionConfigPropertySchema): boolean {\n\tif (schema.type !== 'string' || !Array.isArray(schema.enum) || schema.enum.length === 0) {\n\t\treturn false;\n\t}\n\tif (!schema.enum.includes(REQUIRED_CODEX_APPROVALS_VALUE)) {\n\t\treturn false;\n\t}\n\treturn schema.enum.every(value => narrowCodexPermissionsPreset(value) !== undefined);\n}",
		''],

	// ================= agentHostSessionPermissions.ts =================
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionPermissions.ts',
		"import { CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID } from '../../../../../platform/agentHost/common/agent.js';",
		"import { CLAUDE_AGENT_PROVIDER_ID } from '../../../../../platform/agentHost/common/agent.js';"],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionPermissions.ts',
		"import { CodexSessionConfigKey, narrowCodexPermissionsPreset } from '../../../../../platform/agentHost/common/codexSessionConfigKeys.js';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionPermissions.ts',
		"\t\tcase CODEX_AGENT_PROVIDER_ID:\n\t\t\treturn [{\n\t\t\t\tid: 'default',\n\t\t\t\tlabel: localize('sessionComparison.permissions.codex.default', \"Default Permissions\"),\n\t\t\t\tdescription: localize('sessionComparison.permissions.codex.defaultDescription', \"Codex works inside the workspace sandbox and asks before broader access.\"),\n\t\t\t\tisDefault: true,\n\t\t\t}, {\n\t\t\t\tid: 'auto-review',\n\t\t\t\tlabel: localize('sessionComparison.permissions.codex.autoReview', \"Auto-Review\"),\n\t\t\t\tdescription: localize('sessionComparison.permissions.codex.autoReviewDescription', \"Approval requests are routed through the auto-reviewer instead of prompting you.\"),\n\t\t\t\tlocked: policyRestricted,\n\t\t\t\tlockedReason: policyRestricted ? policyLockedReason() : undefined,\n\t\t\t}, {\n\t\t\t\tid: 'full-access',\n\t\t\t\tlabel: localize('sessionComparison.permissions.codex.fullAccess', \"Full Access\"),\n\t\t\t\tdescription: localize('sessionComparison.permissions.codex.fullAccessDescription', \"Codex can use the internet and edit files outside the workspace without asking.\"),\n\t\t\t\tisAllowAll: true,\n\t\t\t\tlocked: policyRestricted,\n\t\t\t\tlockedReason: policyRestricted ? policyLockedReason() : undefined,\n\t\t\t}];\n\t\tdefault:\n\t\t\treturn [];",
		"\t\tdefault:\n\t\t\treturn [];"],
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionPermissions.ts',
		"\t\tcase CODEX_AGENT_PROVIDER_ID: {\n\t\t\tconst permissionsPreset = narrowCodexPermissionsPreset(permissionId);\n\t\t\treturn permissionsPreset ? {\n\t\t\t\t[SessionConfigKey.Mode]: 'interactive',\n\t\t\t\t[CodexSessionConfigKey.PermissionsPreset]: permissionsPreset,\n\t\t\t} : undefined;\n\t\t}\n\t\tdefault:\n\t\t\treturn undefined;",
		"\t\tdefault:\n\t\t\treturn undefined;"],

	// ================= baseAgentHostSessionsProvider.ts =================
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"AuthenticateResult, CODEX_AGENT_PROVIDER_ID, type IAgentCanvas",
		"AuthenticateResult, type IAgentCanvas"],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"import { readCodexAccountInfo } from '../../../../../platform/agentHost/common/codexAccount.js';\n",
		''],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		" * credentials. Note both Claude and Codex encode \"not required\" by *keeping* the\n * Copilot resource and marking it `required: false` rather than omitting it —\n * that lets the host silently forward a token to an already-signed-in user\n * without forcing sign-in on anyone else. This treats the two identically.",
		" * credentials. Note Claude encodes \"not required\" by *keeping* the\n * Copilot resource and marking it `required: false` rather than omitting it —\n * that lets the host silently forward a token to an already-signed-in user\n * without forcing sign-in on anyone else."],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"\t\tconst setupAgents = new Set(readAgentSdkSetupInfos(rootState).map(setup => setup.agent));\n\t\tconst hasSignedInCodexAccount = readCodexAccountInfo(rootState).status === 'signedIn';\n",
		"\t\tconst setupAgents = new Set(readAgentSdkSetupInfos(rootState).map(setup => setup.agent));\n"],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"canInitializeWithoutGitHub: agent.provider === CODEX_AGENT_PROVIDER_ID && hasSignedInCodexAccount,",
		"canInitializeWithoutGitHub: false,"],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"\t\tif (provider.includes('claude')) {\n\t\t\treturn Codicon.claude;\n\t\t}\n\n\t\tif (provider === 'openai' || provider.includes('codex')) {\n\t\t\treturn Codicon.openai;\n\t\t}\n",
		"\t\tif (provider.includes('claude')) {\n\t\t\treturn Codicon.claude;\n\t\t}\n"],
	['src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts',
		"\t\t// Kick off the initial config resolve and the eager backend session\n\t\t// in parallel after authentication settles. While auth is pending,\n\t\t// providers such as Codex reject both paths with AuthRequired; the\n\t\t// subclass calls _resumeNewSessionAfterAuthenticationSettles when the\n\t\t// first auth pass completes.",
		"\t\t// Kick off the initial config resolve and the eager backend session\n\t\t// in parallel after authentication settles. While auth is pending,\n\t\t// providers may reject both paths with AuthRequired; the\n\t\t// subclass calls _resumeNewSessionAfterAuthenticationSettles when the\n\t\t// first auth pass completes."],
];

const failures = [];
for (const [file, find, replace] of edits) {
	let text;
	try {
		text = readFileSync(root + file, 'utf8');
	} catch {
		failures.push(`${file}: READ FAILED`);
		continue;
	}
	let f = find;
	let r = replace;
	if (text.includes('\r\n')) {
		f = f.replaceAll('\n', '\r\n');
		r = r.replaceAll('\n', '\r\n');
	}
	const count = text.split(f).length - 1;
	if (count !== 1) {
		failures.push(`${file}: matches=${count} for ${JSON.stringify(f.slice(0, 80))}`);
		continue;
	}
	writeFileSync(root + file, text.replace(f, r), 'utf8');
	console.log('ok ' + file);
}
if (failures.length) {
	console.log('FAILURES:');
	for (const f of failures) console.log('  ' + f);
	process.exitCode = 1;
}
