# Remove Codex from Shideh

Complete removal of the Codex agent integration (~1,100 file deletions + ~150 targeted edits). The working tree currently holds **unrelated pending changes** (sessions welcome/sign-in-dialog removal) — those are preserved untouched.

## Scope decisions (best judgment)

- **Remove both Codex features**: (a) the agent-host Codex provider, (b) the external `openai-codex` session type (`SessionType.Codex`, `chat.editor.codex.preferAgentHost`, cloud-session Codex descriptor).
- **Keep the GPT-5-Codex model family** in `extensions/copilot` (prompts, capabilities, snapshots, `gpt-5*-codex` model IDs, `copilotcli-gpt-5-codex` captures, mock-LLM model IDs) — backend model names, not the agent.
- **Active docs scrubbed** (.github/skills, READMEs, KNOWN_ISSUES, AGENTS.md, specs); **historical untouched** (CHANGELOG, claude phase plans/roadmaps).
- **No commits** — user has unrelated uncommitted work.

## Phase 1 — Delete exclusive Codex trees (tracked, via `git rm`)

- `src/vs/platform/agentHost/node/codex/` (~858 files incl. `protocol/generated/`), `node/codexCompactCommand.ts`
- `src/vs/platform/agentHost/common/codexAccount.ts`, `common/codexSessionConfigKeys.ts`, `common/meta/codexAccount.ts`
- `src/vs/platform/agentHost/browser/codexApprovalsPicker.ts` + `media/codexApprovalsPicker.css`
- Tests: `test/node/codex/` (37), `test/common/codexAccount.test.ts`, `providerIntegration/codex*` (3), `e2e/providers/codex*` + `codexTestConfiguration.ts`, `__snapshots__/Agent_Host_E2E___Codex_*` (16), `e2e/captures/codex-*.yaml` (~150; **not** `copilotcli-gpt-5-codex*`)
- Workbench: `services/agentHost/browser/codexAccountService.ts` + test, `chatStatus/codexStatusEntry.ts` + `codexStatusDashboard.ts` + test + `componentFixtures/chat/codexStatusDashboard.fixture.ts`, `workbench/contrib/chat/electron-browser/codexCustomizationSettings.contribution.ts`, `sessions/.../codexCustomizationSettings.contribution.ts` + `agentHostCodexApprovalsPicker.ts`
- Outside src: `build/codex/`, `build/agent-sdk/agents/codex/`

(Note: `codexAgent.ts` / `codexModelRefresh.test.ts` have pending comment-only diffs — they're deleted anyway.)

## Phase 2 — Host-process wiring (`platform/agentHost/node`, `electron-main`)

- `agentHostMain.ts`, `agentHostServerMain.ts`: drop Codex imports, `createCodexProviderConfiguration`, `registerCodexIfEnabled()` gate + root-config listener, `--codex-sdk-root` flag/option, `'CodexAgent registered'` log
- `nodeAgentHostStarter.ts`, `electronAgentHostStarter.ts`: remove 4 `chat.agentHost.codexAgent.*` settings reads + env forwarding
- `agentHostContributions.ts`: remove `CodexCompactCompletionProvider` registration
- `agentHostServices.ts`: remove `ICodexProxyService`/`CodexProxyService` DI entry
- Telemetry: `agentHostTurnTelemetryContext.ts` (`agent.id === 'codex'`), `agentHostTelemetryReporter.ts` (CodexAccount classification/fields, `report.provider === 'codex'` emissions), `agentHostAutomationTelemetry.ts` (`'codex'` union member + `case 'codex'`/`'openai-codex'`), `agentHostStartupPerformance.ts` (`codexSessionCount`, `codexRegistered`, `StartupProvider`), `otel/agentHostOTelService.ts` (codex-app-server service, auth-span filters, log counters)
- `agentSdkDownloader.ts`: `CodexSdkPackage`, SKU mapping, `product.agentSdks.codex`
- `chatContributions/chatInput/chatInputContribution.ts`: `errorType === 'CodexThreadInUse'` branch
- Comment-only cleanups in `shared/*` (proxyChatError `CodexError`, copilotApiService, workspacelessInstructions, …)

## Phase 3 — Shared contract (`platform/agentHost/common`)

- `agent.ts`: `CODEX_AGENT_PROVIDER_ID` + doc mentions (`AgentProvider = string` stays — no union breakage)
- `agentService.ts`: codex setting/env constants (L159–344), `shouldSurfaceLocalAgentHostProvider` `case CODEX_AGENT_PROVIDER_ID`, `buildAgentSdkEnv` codex fan-out (L645–683)
- `agentHostSchema.ts`: `codexAgentEnabled`/`codexMultiRootEnabled` keys + schema props
- `agentHostStarter.config.contribution.ts`: 4 setting registrations incl. **`Codex3PIntegration` policy** + `codexAgentEnabled.policy`
- `agentHostTelemetry.ts`: `ICodexAccountTelemetryContext` / `codex?` field; comment mentions in Enablement/Customization/agentSdkSetup/reasoningEffort/meta/otel

## Phase 4 — Sessions window (`src/vs/sessions`)

- `accountMenu/account.contribution.ts` — **careful: has unrelated pending edits; targeted Edits only**. Remove codex account panel (~74 matches): rate-limit hover, `shouldShowCodexAccount`, sign-in/out actions, `SessionType.AgentHostCodex` items, `AgentHostCodexAgentEnabledSettingId` listener
- `sessionsAccountTelemetry.ts`: `chatgptAccountState`/quota fields
- `customizationsToolbar.contribution.ts`: "Codex" harness button + `AgentHostCodex` gate
- `providers/agentHost/agentHostSessionPermissions.ts`: `case CODEX_AGENT_PROVIDER_ID` presets
- `agentHostSessionConfigPicker.ts`: Approvals picker instantiation + 2 command registrations; `agentHostPermissionPickerDelegate.ts`: `isWellKnownCodexApprovalsSchema`/`narrowCodexPermissionsPreset`
- `baseAgentHostSessionsProvider.ts`: imports, `canInitializeWithoutGitHub` codex check (L3930), `iconForAgentProvider` codex branch (L3964)
- `localAgentHost.contribution.ts`: side-effect import of codex customization contribution
- `externalSessionBanner.ts` `case 'codex'`; `sessionsChatAccessibilityHelp.ts` strings; comment mentions (modePicker, tour, session.ts, spec)

## Phase 5 — Workbench (`src/vs/workbench`)

- `globalCompositeBar.ts`: codex account menu actions + `ICodexAccountService` param
- `chat.shared.contribution.ts`: `CodexPreferAgentHostEditorSettingId` import, `chat.editor.codex.preferAgentHost` registration, `CodexStatusBarEntry` registration
- `chat/electron-browser/chat.contribution.ts`: side-effect import of codex settings contribution
- `chatSessions.contribution.ts`: `codexExtensionHostAvailableWhen`, `applyCodexAgentHostPreference()`, `SessionType.Codex` branch
- `agentSessions/agentSessions.ts`: `AgentSessionProviders` enum members + label/icon/description/first-party switches (both Codex kinds)
- `agentHostChatContribution.ts`: `ownerVendor: 'agent-host-codex'`
- `agentHostChatInputPicker.contribution.ts` + `.ts`: approvals-picker action/registration + helpers
- `agentHostChatInputState.ts`, `agentHostSessionHandler.ts`: `codexWriterLockMessage`, `CodexThreadInUse`, `CODEX_AGENT_PROVIDER_ID` branch (L6564)
- `agentHostMcpServerSupport.ts`: `new Set(['copilotcli','claude','codex'])`
- `chatStatus/media/chatStatus.css`: `.codex-*` styles
- Input/UI: `chatInputPart.ts` (session-type checks + picker width map), `sessionTargetPickerActionItem.ts` (`'codex'` category, account gate), `delegationSessionPickerActionItem.ts` (`ICodexAccountService`), `modelProviderIcons.ts` codex icon heuristic, `chatRequestOriginPart.ts`, `chatContinueInAction.ts`, `chatAccessibilityHelp.ts`
- `common/`: `constants.ts` `'openai-codex'` scheme, `editorChatUsage.ts` provider mapping, `chatContextKeys.ts` doc comment, `chatErrorMessages.ts`, `chatServiceTelemetry.ts` comment
- `relauncher.contribution.ts`: `chat.editor.codex.preferAgentHost` watch; `services/agentHost/agentSdkSetupService.ts`: `_codexAccountService.signIn()` wiring
- `chatSessionsService.ts`: `SessionType.Codex` + `SessionType.AgentHostCodex` constants

## Phase 6 — Terminal & platform misc

- `platform/terminal/common/terminal.ts` `GeneralShellType.Codex`; `node/windowsShellHelper.ts` `codex.exe` detection; `terminalInstance.ts`; `terminalConfiguration.ts` description; sticky-scroll allow-list; `terminalTelemetry.ts`; `runInTerminalToolTelemetry.ts`
- `platform/chat/common/chatSettings.ts`: `**/.codex/*` watcher excludes; `platform/policy/copilotManagedSettings.ts` policy comments; `telemetry/languageModelToolTelemetry.ts` comment

## Phase 7 — Mixed tests

- `platform/agentHost/test`: `agentService.test.ts` (~80 matches — delete codex-specific cases, relabel generic `new MockAgent('codex')` / provider-loop strings to a neutral id), `common/agentService.test.ts` (`shouldSurfaceLocalAgentHostProvider('codex')` cases), `serverIntegrationTestHelpers.ts` (`codexSdkRoot`/`codexHomeDir`/env wiring), `providerTestEnvironment.ts` (`CODEX_HOME`), telemetry/startup/state/sessionPermissions/sessionServerTools (`codex:/` URIs)/prompt-registry tests, `claudeAgent.test.ts` + `copilotAgent.test.ts` codex cases, `agentHostSessionOpenTelemetry.test.ts` provider list, `agentSdkDownloader.test.ts`, e2e harness (`agentHostE2ETestHarness.ts`, `agentHostTarget.ts`, `capiStubs.ts`, `capiWireCodec.ts`, suites: core/providerError/workingDirectories/…, `coverage/summary.json`, `KNOWN_ISSUES.md`, `README.md`)
- Sessions/workbench tests & fixtures: `localAgentHostSessionsProvider.test.ts`, `accountMenu.fixture.ts`, `sessionTypePicker.test.ts`, `chatInput.fixture.ts`, `externalSessionBanner.{fixture,test}.ts`, `sessionsAccountTelemetry.test.ts`, `sessionTargetPickerActionItem.test.ts`, `relauncher.test.ts`, `editorChatUsage.test.ts`, `agentSessionViewModel.test.ts`, plus remaining fixture/test codex references

## Phase 8 — Outside `src/`

- **package.json**: remove `codex:gen-protocol` + `codex:check-protocol` scripts and `"@openai/codex"` devDependency; refresh `package-lock.json` (`npm install --package-lock-only --ignore-scripts`; fallback: mechanical removal of the 28 lock entries)
- **build/**: `build/package.json` test glob (drop `codex`); `agent-sdk/package.ts` (codex branch + CLI validation), `upload.ts` regex, `common.ts` comment, `README.md`; `azure-pipelines/checkNativeOptionalDeps.ts` (`'@openai/codex'`); `filters.ts` (3 protocol exclusion lines); `lib/policies/policyData.jsonc` (`Codex3PIntegration` block)
- **.github/**: `workflows/pr.yml` "Check Codex protocol client is in sync" step; skills docs (agent-host-e2e-tests, customizations, otel, policy, smoke, flaky-smoke)
- **Dotfiles**: `.eslint-allowed-bracket-notation-files` (12 lines), `.eslint-allowed-javascript-files`, `.eslint-ignore`, `eslint.config.js`, `.vscode/settings.json`, `ThirdPartyNotices.txt` codex Apache-2.0 block
- **scripts/**: `test-agent-host-e2e.ts` (codex suite object), `agent-host-e2e-coverage.ts`
- **test/**: `smoke/agentsWindow.test.ts` (codex describe block + `warmUpCodexModel` + CODEX_* constants), `smoke/remoteDevContainerFixtures.ts`, `smoke/utils.ts` (`CODEX_HOME`), `automation/agentsWindow.ts` comment
- **extensions/copilot (agent-integration only)**: `cgmanifest.json` codex component, `package.json` `"codex"` keyword, `copilotToken.ts` `codexAgentEnabled`, `copilotTokenManager.ts`, `lmProxyContrib.ts` gate, `oaiLanguageModelServer.ts` `'vscode_codex'`, `sessionUtils.ts` `Codex` constant, `copilotCloudSessionsProvider.ts` Codex descriptor, `shellQuoting.ts` `agentCliShells`

## Phase 9 — Verification (source-level; no tsc in this checkout per memory)

1. **Syntax parse**: every changed/created `.ts` via the TypeScript at `C:/Users/armin/AppData/Roaming/npm/node_modules/openclaw/node_modules/typescript` (`createSourceFile` + parse diagnostics).
2. **Import-resolution sweep**: parse all relative import specifiers under `src/`, `scripts/`, `extensions/copilot/src`; assert each target file exists (catches imports of deleted modules).
3. **Residual grep**: `git grep -in codex` — remaining hits must be only the whitelisted keep-set (gpt-5*-codex model family, CHANGELOG/historical roadmaps, kept docs text); report the residual table.
4. **Lockfile check**: `package-lock.json` contains zero `@openai/codex`.
5. Report a final summary (files deleted/edited, residual matches). **No commit** unless asked.