# Phase 7a: sessions tests/fixtures codex removal edits.
# Line-based ops with anchor verification (verify pass, then apply pass).
# Usage: python batch7a_sessions.py [--dry]
import sys, io

FAIL = []
DRY = '--dry' in sys.argv

def load(path):
    with io.open(path, 'r', encoding='utf-8', newline='') as f:
        text = f.read()
    crlf = '\r\n' in text
    body = text.replace('\r\n', '\n')
    return body.split('\n'), crlf

def save(path, lines, crlf):
    body = '\n'.join(lines)
    if crlf:
        body = body.replace('\n', '\r\n')
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(body)

def check(name, ok, msg):
    if not ok:
        FAIL.append(f'{name}: {msg}')

class Doc:
    """Line-number keyed edits for one file; verified then applied bottom-up."""
    def __init__(self, path):
        self.path = path
        self.lines, self.crlf = load(path)
        self.deletes = []      # (start, end_inclusive, anchor_substring_at_start)
        self.replaces = []     # (line_no, old_substring, new_substring)
        self.expectations = [] # (line_no, substring) extra context checks
        self.g_repls = []      # instance-level (old, new, expected_or_None)

    def delete(self, start, end, anchor):
        self.deletes.append((start, end, anchor))

    def replace(self, line_no, old, new):
        self.replaces.append((line_no, old, new))

    def expect(self, line_no, substr):
        self.expectations.append((line_no, substr))

    def glob(self, old, new, expected=None):
        self.g_repls.append((old, new, expected))

    @property
    def name(self):
        return self.path.replace('\\', '/').split('/')[-1]

    def verify(self):
        for line_no, substr in self.expectations:
            if not (1 <= line_no <= len(self.lines)):
                check(self.name, False, f'expect line {line_no} out of bounds')
                continue
            if substr not in self.lines[line_no - 1]:
                check(self.name, False, f'expect mismatch at {line_no}: want {substr!r}, got {self.lines[line_no-1].strip()[:90]!r}')
        for start, end, anchor in self.deletes:
            if not (1 <= start <= end <= len(self.lines)):
                check(self.name, False, f'range {start}-{end} out of bounds (len={len(self.lines)})')
                continue
            line = self.lines[start - 1]
            if anchor not in line:
                check(self.name, False, f'del anchor mismatch at {start}: want {anchor!r}, got {line.strip()[:90]!r}')
        for line_no, old, _ in self.replaces:
            if not (1 <= line_no <= len(self.lines)):
                check(self.name, False, f'replace line {line_no} out of bounds')
                continue
            if old not in self.lines[line_no - 1]:
                check(self.name, False, f'replace anchor mismatch at {line_no}: want {old!r}, got {self.lines[line_no-1].strip()[:90]!r}')

    def apply(self):
        # bottom-up: process line ops sorted by descending line number
        ops = [('del', s, e, a) for s, e, a in self.deletes] + [('rep', n, o, nw) for n, o, nw in self.replaces]
        ops.sort(key=lambda op: op[1], reverse=True)   # both kinds carry the line number at index 1
        for op in ops:
            if op[0] == 'del':
                _, s, e, _ = op
                del self.lines[s - 1:e]
            else:
                _, n, old, new = op
                self.lines[n - 1] = self.lines[n - 1].replace(old, new, 1)
        # content-level replaces (whole file), applied in insertion order
        for old, new, expected in self.g_repls:
            joined = '\n'.join(self.lines)
            count = joined.count(old)
            if expected is None:
                print(f'    glob {old!r}: {count} occurrence(s)')
            else:
                check(self.name, count == expected,
                      f'global {old!r}: expected {expected} occurrence(s), found {count}')
            joined = joined.replace(old, new)
            self.lines = joined.split('\n')

def finish(docs, label):
    for d in docs:
        d.verify()
    if FAIL:
        print(f'[{label}] VERIFICATION FAILED:')
        for f in FAIL:
            print('  -', f)
        sys.exit(1)
    for d in docs:
        d.apply()
    if FAIL:
        print(f'[{label}] COUNT CHECK FAILED:')
        for f in FAIL:
            print('  -', f)
        sys.exit(1)
    if DRY:
        print(f'[{label}] DRY OK ({len(docs)} files)')
        return
    for d in docs:
        save(d.path, d.lines, d.crlf)
    print(f'[{label}] OK ({len(docs)} files)')

R = 'src/vs/sessions/'

# ---------------------------------------------------------------- A1 chatInput.fixture.ts
# After removing the CodexWriterLock fixtures + renderCodexWriterLock helper,
# imports on lines 6-16 have no remaining usages (verified by symbol scan).
d = Doc(R + 'contrib/chat/test/browser/chatInput.fixture.ts')
d.delete(6, 16, 'import { getWindow }')
d.delete(49, 106, '/** Drives the real input-state controller')
d.delete(144, 158, 'CodexWriterLock: defineComponentFixture({')
d.expect(48, '')
d.expect(107, 'const responsiveModel')
d.expect(143, 'defineThemedFixtureGroup')
d.expect(159, 'SessionsWindow: defineComponentFixture({')
finish([d], 'A1')

# ---------------------------------------------------------------- A2 banner fixture
d = Doc(R + 'contrib/chat/test/browser/externalSessionBanner.fixture.ts')
d.delete(23, 26, 'Codex: defineComponentFixture({')
d.expect(22, '')
d.expect(27, 'Copilot: defineComponentFixture({')
finish([d], 'A2')

# ---------------------------------------------------------------- A3 banner test
d = Doc(R + 'contrib/chat/test/browser/externalSessionBanner.test.ts')
d.expect(45, 'assert.deepStrictEqual(descriptions,')
d.replace(104, "externalSession('codex')", "externalSession('mycli')")
d.replace(96, "externalSession('codex')", "externalSession('mycli')")
d.replace(69, "externalSession('codex')", "externalSession('mycli')")
d.delete(46, 50, '{')  # first (codex) expectation object
d.expect(51, '{')
d.replace(37, "['codex', 'copilot', 'claude']", "['copilot', 'claude']")
finish([d], 'A3')

# ---------------------------------------------------------------- A4 newChatWidget
d = Doc(R + 'contrib/chat/test/browser/newChatWidget.test.ts')
d.replace(1828, "sessionTypeId: 'codex'", "sessionTypeId: 'mycli'")
d.replace(1827, "sessionTypeId: 'codex'", "sessionTypeId: 'mycli'")
finish([d], 'A4')

# ---------------------------------------------------------------- A5 sessionComparisonResult
d = Doc(R + 'contrib/chat/test/browser/sessionComparisonResult.test.ts')
d.glob('useCodex', 'attempt2Button', 4)
d.glob('codexPressed', 'attempt2Pressed', 2)
d.glob('codexLabel', 'attempt2Label', 2)
d.glob('Codex', 'MyCli', 12)
finish([d], 'A5')

# ---------------------------------------------------------------- A6 sessionModelSelection
d = Doc(R + 'contrib/chat/test/browser/sessionModelSelection.test.ts')
d.replace(436, "'new Codex sessions use the most recently selected provider model'",
             "'new agent-host sessions use the most recently selected provider model'")
d.glob('codex', 'mycli', 11)
finish([d], 'A6')

# ---------------------------------------------------------------- A7 sessionTypePicker
d = Doc(R + 'contrib/chat/test/browser/sessionTypePicker.test.ts')
d.glob('isCodexDisabled', 'isTypeDisabled', 5)
d.glob('codexDisabled', 'typeDisabled', 3)
d.glob('AgentHostCodex', 'AgentHostClaude', 2)
d.glob('Codex', 'MyCli', 3)          # displayName(461), label(471), find label(477)
d.glob("'codex'", "'mycli'", 1)
d.glob('codex', 'mycli', 3)          # const codex / ok(codex) / codex.disabled
finish([d], 'A7')

# ---------------------------------------------------------------- A8 sessionsChatAccessibilityHelp
d = Doc(R + 'contrib/chat/test/browser/sessionsChatAccessibilityHelp.test.ts')
d.glob('Codex', 'MyCli', 3)
finish([d], 'A8')

# ---------------------------------------------------------------- A9 sessionsWorkbenchFixtureUtils
d = Doc(R + 'contrib/chat/test/browser/sessionsWorkbenchFixtureUtils.ts')
d.delete(159, 162, 'instantiationService.stub(ICodexAccountService,')
d.delete(25, 25, 'ICodexAccountService')
d.expect(158, '}());')
d.expect(163, 'IQuickInputService')
finish([d], 'A9')

# ---------------------------------------------------------------- A10 agentHostAutomationStore
d = Doc(R + 'contrib/providers/agentHost/test/browser/agentHostAutomationStore.test.ts')
d.glob('agent-host-codex', 'agent-host-mycli', 1)
d.glob("'codex'", "'mycli'", 1)
finish([d], 'A10')

# ---------------------------------------------------------------- A11 permissions
d = Doc(R + 'contrib/providers/agentHost/test/browser/agentHostSessionPermissions.test.ts')
d.replace(24, "'codex'", "'mycli'")
d.delete(47, 47, 'codexAllowAll: {')
d.delete(38, 42, 'codexOptions: [')
d.delete(22, 22, 'codexAllowAll:')
d.delete(17, 17, 'codexOptions:')
d.expect(16, 'claudeOptions:')
d.expect(46, 'claudeAllowAll:')
d.expect(48, 'policyRestricted:')
finish([d], 'A11')

# ---------------------------------------------------------------- A12 remoteSessionService
d = Doc(R + 'contrib/remoteSessions/test/browser/remoteSessionService.test.ts')
d.glob("'codex'", "'mycli'", 5)
finish([d], 'A12')

# ---------------------------------------------------------------- A13 sessionsActions
d = Doc(R + 'contrib/sessions/test/browser/sessionsActions.test.ts')
d.replace(658, 'copilotcli|claude-agent|codex|copilotcloud', 'copilotcli|claude-agent|copilotcloud')
finish([d], 'A13')

# ---------------------------------------------------------------- A14 sessionsList
d = Doc(R + 'contrib/sessions/test/browser/sessionsList.test.ts')
d.replace(4243, '`Codex ${index}`', '`Peer ${index}`')
finish([d], 'A14')

# ---------------------------------------------------------------- A15 sessions agentHostCustomizationService.test
d = Doc(R + 'services/agentHost/test/browser/agentHostCustomizationService.test.ts')
d.replace(30, "'agents window exposes Codex workspace skills", "'agents window exposes workspace skills")
d.glob('createCodexSkillCustomizations', 'createSkillCustomizations', 2)   # import + call site
d.glob('assertCodexSkillItems', 'assertSkillItems', 2)                     # import + call site
d.glob('agent-host-codex', 'agent-host-mycli', 1)
finish([d], 'A15')

# ---------------------------------------------------------------- A16 skill discovery utils
d = Doc('src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostSkillDiscoveryTestUtils.ts')
d.glob('createCodexSkillCustomizations', 'createSkillCustomizations', 1)   # definition only
d.glob('assertCodexSkillItems', 'assertSkillItems', 1)                     # definition only
d.glob('.codex', '.claude', 4)
d.glob('codex-described', 'claude-described', 3)
d.glob('codex-skills', 'workspace-skills', 2)
finish([d], 'A16')

# ---------------------------------------------------------------- B0 workbench agentHostCustomizationService.test
d = Doc('src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostCustomizationService.test.ts')
d.replace(802, "'editor window exposes Codex workspace skills", "'editor window exposes workspace skills")
d.replace(803, "createReadinessSut('codex')", "createReadinessSut('mycli')")
d.glob('createCodexSkillCustomizations', 'createSkillCustomizations', 2)   # import + call site
d.glob('assertCodexSkillItems', 'assertSkillItems', 2)                     # import + call site
finish([d], 'B0')

# ---------------------------------------------------------------- A17 localAgentHostSessionsProvider.test
d = Doc(R + 'contrib/providers/agentHost/test/browser/localAgentHostSessionsProvider.test.ts')
# imports (become unused once regions below are deleted)
d.replace(21, 'CODEX_AGENT_PROVIDER_ID, ', '')
d.delete(22, 22, 'agentSdkSetupStatusKey')            # only use was inside region B
d.replace(23, 'AgentHostCodexAgentEnabledSettingId, ', '')
d.delete(26, 26, 'CODEX_ACCOUNT_META_KEY')
# region B: codex-account-driven initialization test (canInitializeWithoutGitHub now vestigial)
d.delete(857, 890, "test('session types publish provider-neutral selection-time initialization'")
d.expect(891, "test('shares the root-state listener")
# region C: discovery-notification loop no longer needs the deleted enablement setting
d.delete(967, 968, 'const configurationService = new TestConfigurationService();')
d.replace(969, 'createProvider(disposables, agentHost, undefined, { configurationService });',
             'createProvider(disposables, agentHost);')
# region D: gating test for the deleted AgentHostCodexAgentEnabledSettingId
d.delete(1172, 1196, "test('gates agent-host Codex in the Agents window on the provider enablement setting'")
d.expect(1197, "test('getSessions includes agent-host Claude sessions'")
# region E: refresh-survival test drops the enablement config
d.delete(1672, 1673, 'const configurationService = new TestConfigurationService();')
d.replace(1677, 'createProvider(disposables, agentHost, undefined, { configurationService });',
             'createProvider(disposables, agentHost);')
# region F: comment names a removed provider
d.replace(9261, 'Providers such as Codex reject those calls', 'Some providers reject those calls')
# region G: mid-send foreign-type regression test drops the enablement config
d.delete(9358, 9359, 'const configurationService = new TestConfigurationService();')
d.delete(9362, 9362, 'configurationService,')
d.expect(9357, ']);')
d.expect(9361, 'openSession: true,')
d.expect(9363, 'sendRequest: async resource => {')
# relabel remaining codex references (provider id, session ids, display names, schema keys)
d.glob('codex', 'mycli')
d.glob('Codex', 'MyCli', 7)
finish([d], 'A17')

print('ALL BATCH A DONE')
