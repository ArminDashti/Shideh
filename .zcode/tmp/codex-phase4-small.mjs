import { readFileSync, writeFileSync } from 'node:fs';

const root = 'C:/Users/armin/GitHub/Shideh/';
const edits = [
	// --- customizationsToolbar.contribution.ts ---
	['src/vs/sessions/contrib/sessions/browser/customizationsToolbar.contribution.ts',
		"\t{\n\t\tid: 'sessions.customization.harnessSettings',\n\t\tlabel: localize('harnessSettings', \"Codex\"),\n\t\ticon: Codicon.openai,\n\t\tsection: AICustomizationManagementSection.HarnessSettings,\n\t},\n];",
	'];'],
	['src/vs/sessions/contrib/sessions/browser/customizationsToolbar.contribution.ts',
		"\t\t\tconst activeHarness = harnessService.activeHarness.read(reader);\n\t\t\tharnessService.availableHarnesses.read(reader);\n\t\t\tconst descriptor = harnessService.getActiveDescriptor();\n\t\t\tconst hidden = new Set(descriptor.hiddenSections ?? []);\n\t\t\tfor (const config of CUSTOMIZATION_ITEMS) {\n\t\t\t\tif (!config.section) {\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\t\t\t\tconst supported = config.section !== AICustomizationManagementSection.HarnessSettings || activeHarness === SessionType.AgentHostCodex;\n\t\t\t\tvisibilityKeys.get(config.section)!.set(!hidden.has(config.section) && supported);\n\t\t\t}",
		"\t\t\tharnessService.availableHarnesses.read(reader);\n\t\t\tconst descriptor = harnessService.getActiveDescriptor();\n\t\t\tconst hidden = new Set(descriptor.hiddenSections ?? []);\n\t\t\tfor (const config of CUSTOMIZATION_ITEMS) {\n\t\t\t\tif (!config.section) {\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\t\t\t\tvisibilityKeys.get(config.section)!.set(!hidden.has(config.section));\n\t\t\t}"],
	['src/vs/sessions/contrib/sessions/browser/customizationsToolbar.contribution.ts',
		"import { SessionType } from '../../../../workbench/contrib/chat/common/chatSessionsService.js';\n",
		''],
	// --- externalSessionBanner.ts ---
	['src/vs/sessions/contrib/chat/browser/externalSessionBanner.ts',
		"\t\tswitch (sessionType) {\n\t\t\tcase 'codex':\n\t\t\t\treturn localize('externalSessionBanner.continue.codex', \"You can continue this session here with your ChatGPT or Copilot subscription. Choose your subscription in the model picker.\");\n\t\t\tcase 'claude':",
		"\t\tswitch (sessionType) {\n\t\t\tcase 'claude':"],
	// --- session.ts ---
	['src/vs/sessions/services/sessions/common/session.ts',
		'fixed trait (Claude and Codex both move between values as their own\n\t * credentials come and go).',
		'fixed trait (Claude moves between values as its own\n\t * credentials come and go).'],
	// --- agentHostModePicker.ts ---
	['src/vs/sessions/contrib/providers/agentHost/browser/agentHostModePicker.ts',
		'option descriptions are long (e.g. the Codex approvals presets) return a',
		'option descriptions are long return a'],
	// --- newSessionViewTour.ts ---
	['src/vs/sessions/contrib/onboardingTours/browser/tours/newSessionViewTour.ts',
		'The harness picker — choose Copilot, Claude or Codex, each running the',
		'The harness picker — choose Copilot or Claude, each running the'],
	// --- spec ---
	['src/vs/sessions/copilot-customizations-spec.md',
		'| Codex / OpenAI | `{repo}/AGENTS.md` | OpenAI model convention |\n',
		''],
	// --- localAgentHost.contribution.ts side-effect import ---
	['src/vs/sessions/contrib/providers/agentHost/browser/localAgentHost.contribution.ts',
		"import './codexCustomizationSettings.contribution.js';\n",
		''],
	// --- accessibility help ---
	['src/vs/sessions/contrib/chat/browser/sessionsChatAccessibilityHelp.ts',
		'banner explains that you can continue it here. Codex sessions can use your ChatGPT or Copilot subscription, selected in the model picker. Claude sessions use your Copilot subscription.',
		'banner explains that you can continue it here. Claude sessions use your Copilot subscription.'],
	['src/vs/sessions/contrib/chat/browser/sessionsChatAccessibilityHelp.ts',
		'such as Manual permissions and Allow all for Copilot, Ask Before Edits and Bypass Permissions for Claude, or Default Permissions and Full Access for Codex. In comparisons,',
		'such as Manual permissions and Allow all for Copilot, or Ask Before Edits and Bypass Permissions for Claude. In comparisons,'],
];

const failures = [];
for (const [file, find, replace] of edits) {
	let text;
	try {
		text = readFileSync(root + file, 'utf8');
	} catch (e) {
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
		failures.push(`${file}: matches=${count} for ${JSON.stringify(f.slice(0, 70))}`);
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
