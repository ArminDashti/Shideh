---
description: Architecture documentation for VS Code AI Customization views. Use when working in `src/vs/sessions/contrib/aiCustomizationManagement` or `src/vs/sessions/contrib/aiCustomizationTreeView`
applyTo: 'src/vs/sessions/contrib/aiCustomization*/**'
---

# AI Customization Views

The AI Customization feature provides discovery and management of AI customization artifacts — files and configurations that augment LLM prompts or behavior. All implementation lives in the **sessions layer** (`src/vs/sessions/`).

Examples of artifacts: Custom Agents (.agent.md), Skills (SKILL.md), Instructions (.instructions.md), Prompts (.prompt.md), Hooks (.hooks.md), MCP Servers, and Models.

## Surfaces

There are four UI surfaces for AI customizations:

### 1. Management Editor (primary)

A singleton `EditorPane` with a SplitView (sidebar navigation + content area). Supports 7 sections: Agents, Skills, Instructions, Prompts, Hooks, MCP Servers, Models.

**Location:** `src/vs/sessions/contrib/aiCustomizationManagement/browser/`

**Key features:**
- `AICustomizationListWidget` — Grouped list (Worktree/User/Extensions) with fuzzy search, git status badges, collapsible groups
- `McpListWidget` — MCP server list with reactive connection status
- `ChatModelsWidget` — Reused from workbench chat management
- Embedded `CodeEditorWidget` for inline editing with auto-commit on back navigation
- Creation flows: manual (worktree/user) and AI-guided (opens chat with hidden system instructions)
- Context menu: Open, Run Prompt, Reveal in OS, Delete, Copy Path

### 2. Customizations Toolbar

Seven sidebar links with per-source count badges, each deep-linking to the management editor.

**Location:** `src/vs/sessions/contrib/sessions/browser/customizationsToolbar.contribution.ts`

### 3. Overview View

Compact `ViewPane` with clickable cards showing counts for Agents, Skills, Instructions, Prompts, Hooks, MCP Servers, and Models.

**Location:** `src/vs/sessions/contrib/aiCustomizationManagement/browser/aiCustomizationOverviewView.ts`

### 4. Sidebar Tree View

Hierarchical `WorkbenchAsyncDataTree`: Category → Storage Group → Files for 4 categories.

**Location:** `src/vs/sessions/contrib/aiCustomizationTreeView/browser/`

## File Structure

```
src/vs/sessions/contrib/aiCustomizationManagement/browser/
├── aiCustomizationManagement.ts              # IDs, context keys, layout constants
├── aiCustomizationManagement.contribution.ts # Editor registration, context menu actions
├── aiCustomizationManagementEditor.ts        # SplitView editor pane
├── aiCustomizationManagementEditorInput.ts   # Singleton editor input
├── aiCustomizationListWidget.ts              # Grouped list with search, git status
├── aiCustomizationOverviewView.ts            # Overview view with counts
├── customizationCreatorService.ts            # AI-guided creation flow
├── mcpListWidget.ts                          # MCP servers list widget
├── SPEC.md                                   # Feature specification
└── media/
    └── aiCustomizationManagement.css

src/vs/sessions/contrib/aiCustomizationTreeView/browser/
├── aiCustomizationTreeView.ts                # View IDs, menu IDs
├── aiCustomizationTreeView.contribution.ts   # Context menu actions (Open, Run Prompt)
├── aiCustomizationTreeViewViews.ts           # Tree data source, renderers, ViewPane
├── aiCustomizationTreeViewIcons.ts           # Shared icon registrations
├── SPEC.md                                   # Feature specification
└── media/
    └── aiCustomizationTreeView.css

src/vs/sessions/contrib/sessions/browser/
├── customizationsToolbar.contribution.ts     # Sidebar toolbar links with count badges
└── customizationCounts.ts                    # Count utility functions
```

## Key Constants

Defined in `aiCustomizationManagement.ts`:
- `AI_CUSTOMIZATION_MANAGEMENT_EDITOR_ID` / `..._INPUT_ID` — Editor pane and input type IDs
- `AICustomizationManagementSection` — 7 sections: Agents, Skills, Instructions, Prompts, Hooks, McpServers, Models
- `AICustomizationManagementItemMenuId` — Context menu ID for management editor items
- `CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_EDITOR` / `..._SECTION` — Focus and section context keys
- Layout: `SIDEBAR_DEFAULT_WIDTH` (200), `SIDEBAR_MIN_WIDTH` (150), `SIDEBAR_MAX_WIDTH` (350)
- `getActiveSessionRoot()` — Returns active worktree or repository URI

## Data Flow

All prompt-based data comes from `IPromptsService`:
- `getCustomAgents()` — Agents with parsed frontmatter
- `findAgentSkills()` — Skills with names from frontmatter
- `getPromptSlashCommands()` — Prompts with parsed metadata
- `listPromptFiles(type)` — Instructions and other types
- `parseAllHookFiles()` — Hooks parsed from hook files
- `onDidChangeCustomAgents` / `onDidChangeSlashCommands` — Refresh triggers

In the sessions window, `AgenticPromptsService` overrides `IPromptsService` to scope discovery to the active session's worktree.

Active session scoping comes from `ISessionsManagementService`:
- `activeSession` observable — triggers refresh on session change
- `getActiveSession()` — returns `{ worktree, repository }` URIs
- `commitWorktreeFiles()` — auto-commit on embedded editor close

## Context Menu Actions

**Management editor** (`AICustomizationManagementItemMenuId`):
- Open, Run Prompt (prompts only), Reveal in OS, Delete, Copy Full Path, Copy Relative Path

**Tree view** (`AICustomizationItemMenuId`):
- Open, Run Prompt (prompts only)

Actions handle context as `URI | string | { uri, name, promptType, storage }`.

## Icons

Shared registrations in `aiCustomizationTreeViewIcons.ts`:
- Types: `agentIcon`, `skillIcon`, `instructionsIcon`, `promptIcon`, `hookIcon`
- Storage: `workspaceIcon`, `userIcon`, `extensionIcon`
- Actions: `addIcon`, `runIcon`
- View: `aiCustomizationViewIcon`

## Integration Points

- `IPromptsService` — Prompt discovery and metadata
- `ISessionsManagementService` — Active session and worktree scoping
- `ISCMService` — Git status badges on worktree items
- `IMcpService` / `IMcpWorkbenchService` — MCP server lifecycle
- `ChatModelsWidget` — Chat models management (reused from workbench)
- `ITextModelService` / `IFileService` — Embedded editor I/O
- `ChatContextKeys.enabled` — AI feature gating

## Registration

Imported in `sessions.desktop.main.ts`:
```typescript
import './contrib/aiCustomizationTreeView/browser/aiCustomizationTreeView.contribution.js';
import './contrib/aiCustomizationManagement/browser/aiCustomizationManagement.contribution.js';
```

## Permissions Area

The management editor's sidebar has two groups: `CUSTOMIZATIONS` (what shapes the agent) and
`PERMISSIONS` (what governs it). The permissions group is gated by
`chat.customizations.permissions.enabled` (default `false`) and contributes three sections —
Terminal, Files and Network.

### Render-only contract

**The Copilot runtime is the source of truth for permissions.** It owns the rule DSL, the matcher,
and the precedence between managed policy, configured rules, location grants and session grants.
Everything under `browser/aiCustomization/permissions/` and `common/permissions/` exists to
*display* the provenance the runtime reports.

Consequently:

- No code here decides whether an operation is permitted, and none of it re-implements matching.
- `chatPermissionRuleSyntax.ts` only splits `Kind(argument)` for display; it must never drive a
  decision.
- Domains exist only for the rule families the runtime accepts — `Shell`/`Bash`/`PowerShell`,
  `Read`, `Edit`/`Write`, `Domain`. MCP servers and built-in tools are governed by different
  contracts and deliberately have no domain until the runtime can report rules for them.

### Files

```
common/permissions/
├── chatPermissions.ts               # Rule, scope, effect, ceiling and snapshot types
├── chatPermissionRuleSyntax.ts      # Display-only rule splitting
└── chatPermissionSnapshotService.ts # Provider interface

browser/permissions/
└── chatPermissionSnapshotService.ts # Current implementation (managed scope only)

browser/aiCustomization/permissions/
├── chatPermissionDomainRegistry.ts  # IChatPermissionDomain + registry
├── chatPermissionDomains.ts         # The Terminal / Files / Network domains
├── chatPermissionsSectionWidget.ts  # One generic widget for any domain
├── chatPermissions.contribution.ts  # Registers the sections
└── media/chatPermissions.css
```

### Snapshot states

`ChatPermissionSnapshot` is `loading | unavailable | error | available`. `unavailable` is a distinct
state on purpose: rendering an empty rule list when the runtime was never consulted would assert
"nothing governs this agent", which is the opposite of the truth in a fail-closed enterprise
deployment. For the same reason, an `available` snapshot carries `resolvedScopes`, and the widget
names the layers it could not read rather than omitting them silently.

The runtime currently exposes no read API for its full effective rule set — only the managed slice,
via the managed-settings diagnostics probe. `browser/permissions/chatPermissionSnapshotService.ts`
therefore reports only `ChatPermissionScope.Managed`. When the runtime gains an
effective-permissions projection, **that file is the only thing that changes**.

### Adding a domain

Add an entry to `CHAT_PERMISSION_DOMAINS` and a section id to
`AICustomizationManagementSection` / `AI_CUSTOMIZATION_PERMISSION_SECTIONS`. The section widget is
generic, so no UI changes are required.

---

*Update this file when making architectural changes to the AI Customization views.*
