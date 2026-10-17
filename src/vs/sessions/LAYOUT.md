# Agents Window layout

> **Specification change gate:** Do not update this document for layout bug fixes, styling, dimensions, or action placement. Update it only when part ownership, workbench topology, or a cross-part contract intentionally changes.

## Scope

The Agents Window uses a Sessions-owned workbench layout optimized for agent work. This specification defines stable part ownership, composition, and presentation modes. Per-session capture and restoration are owned by [LAYOUT_CONTROLLER.md](LAYOUT_CONTROLLER.md).

Exact dimensions, styling, action placement, and regression behavior belong in code, design tokens, component fixtures, and focused tests.

## Workbench topology

Startup selects one of two concrete workbenches: `DesktopWorkbench` for every
non-phone window, and `MobileWorkbench` for mobile web windows below the phone
breakpoint. `Workbench` contains only their shared layout mechanics and is not
instantiated directly.

```text
Title bar
Content
├── Sidebar
└── Main region
    ├── Sessions Part | Custom View Grid | Editor | Auxiliary Bar
    └── Panel
```

The workbench omits the standard Activity Bar, Status Bar, and Banner. Part positions are fixed by the Agents Window rather than user settings.

| Part | Ownership |
|------|-----------|
| Title bar | Window navigation and window-scoped actions |
| Sidebar | Sessions list and Sessions-owned sidebar views |
| Sessions Part | One or more visible session surfaces |
| Editor | File, browser, diff, and other editor inputs |
| Auxiliary Bar | Session details such as changes and files |
| Panel | Terminal and other panel views |
| Custom View Grid | Full-surface contributed views that replace session content |

The Sessions Part contains its own nested two-dimensional split grid. Its leaves are not workbench editor groups, nor the chat groups inside an individual session.

## Grid behavior

The main workbench grid is non-proportional. The Sessions Part is the flexible surface that absorbs container resize and part-visibility deltas. The Sidebar, Editor, Auxiliary Bar, and Panel preserve user-established sizes within their constraints.

At most one high-priority surface is visible in the main horizontal chain: normally the Sessions Part, or the Custom View Grid while a custom view is active. This prevents fixed side parts from absorbing general window resize.

The desktop presentation may place the Auxiliary Bar inside the Editor's grid node. Consumers must distinguish the actual Editor content area from the shared grid node when interpreting visibility or size.

## Sessions Part

Each visible session has one Sessions-owned view. The view presents the active chat for that session and scopes commands, menus, and context keys to the represented session.

Chat-tab presentation is a property of the session view, not of the action that opened a chat. The view observes its configuration directly and consistently applies either tabbed or session-view presentation to every chat, including restored chats and chats opened through navigation or external entry points.

In the side-by-side single-chat presentation, pinning a chat header keeps that chat visible while new chats reuse an unpinned group. If every visible group is pinned, opening another chat creates a group; chat pins persist with the chat-grid layout.

`ISessionsService` owns:

- visible-session identity and order;
- each slot's owning part and each part's selection;
- the globally active session used by shared tools;
- which chat is active in each session;
- restoration of the visible arrangement.

The Sessions Part renders that model. Its local selection is supplied by the visibility model, not independently chosen by the renderer. Stable slot identities belong to the visible-session model; ordinary replacement transfers the slot to the new session. Retained sessions keep their views and live chat widgets across movement, reordering, and arrangement changes within one document.

Opening, closing, and directional insertion or movement operate through `ISessionsService`. The part owns the canonical split geometry and user sash sizes, using the shared grid primitive. Maximization and phone presentation project a single live view without changing that geometry. Ordinary structural edits preserve unaffected branches and sizes. Balanced tiling is an explicit arrangement operation over this grid, not a persistent mode or a comparison-specific layout.

`ISessionsService` persists a versioned geometry snapshot separately from per-session chat state. Saved leaf bindings restore created sessions, the empty composer, active selection, pins, and maximization; untitled provider drafts are not recreated. Legacy ordered-session state remains readable. Restoration projects the saved topology onto available sessions and retains existing views when delayed providers arrive. Explicit navigation or grid interaction supersedes pending restoration.

### Auxiliary Sessions windows

`SessionsParts` registers the main part and auxiliary parts under stable presentation IDs. `AuxiliarySessionsPart` owns one auxiliary document, titlebar, scoped services, layout, and disposal, using the shared auxiliary-window service. Runtime window IDs are distinct from persisted part IDs.

A session has exactly one visible owner across these parts. Ordinary opening reveals that owner; an explicit move or directional drop changes ownership. Cross-document movement retains the session wrapper, chat models, inner chat-grid state, draft replies, and input text models (including undo history). Window-bound widgets are reconstructed only after their destination containers are attached. Source writers are retired before destination writers are created, and retained transfer state allows failed construction to recover in the source. An unfinished edit of a previous request vetoes transfer and auxiliary-window closure until the edit is finished or canceled.

Auxiliary windows contain a titlebar and Sessions grid. The new-session composer and companion editor, details, and terminal surfaces remain in the main window. Created sessions can move with their existing peer-chat composers; uncreated sessions are not detached. Main-window phone projection does not affect auxiliary grids.

Closing an auxiliary returns its content to main as a subtree without balancing unrelated panes or stopping requests. Empty auxiliaries close after committed removals, but opening and restoring windows are not treated as empty. Parent shutdown flushes view state, saves the separate arrangements, and closes auxiliary hosts without merging them. Multiwindow snapshots store part IDs, canonical grids, selections, pins, active-part identity, and native window state; single-grid snapshots remain readable. Failed and timed-out restores retain unresolved bindings; late provider discovery retries without taking activation from another window. Closing a partially restored window retains its unresolved bindings in the returned main layout.

If destination rendering fails after native close is irreversible, the closed part is unregistered and removed from live membership. Its flushed draft state and saved window descriptor remain available for explicit retry rather than leaving sessions assigned to a closed document.

Session geometry does not determine Editor, Details, or other side-pane visibility policy. That policy remains with the layout controllers.

## Editor presentation

All non-phone Agents windows use the desktop detail layout. Phone viewports use the dedicated mobile presentation.

The Editor and Auxiliary Bar compose one side pane next to the active session. Editor tabs choose either editor content or a details view while the layout coordinators preserve one coherent visibility model.

The main Editor supports exactly one editor group. Its shared multiple-group capability is disabled, which removes editor split/grid commands, keybindings, menus, and split drop targets; the part also rejects group creation and multi-group layout requests from open-to-side and programmatic paths. The independent chat grid remains supported.

The durable state and transition catalog lives in [DESKTOP.md](DESKTOP.md). Implementation behavior is covered by the layout-controller and desktop strategy tests.

Editors must be opened through `IEditorService`. Sessions-specific presentation must not bypass editor service behavior by opening directly on an editor group.

Chat input status-pill composition is owned by the shared workbench `ChatInputPills` and `StandardChatInputPillSources` components. The Agents Window and Agent Host editor/panel surfaces supply observable data adapters and their allowed pill kinds only; ordering, per-kind presentation, visibility, context menus, keyboard behavior, compact layout, and lifecycle rendering must not be reimplemented per surface. Per-kind visibility preferences belong to `ISessionChatPillVisibilityService`; data adapters apply them before supplying pill data and option actions to the shared renderer.

Session providers register internal per-session directories as resource label homes. URI labels render as `<home label>/<relative path>`, and breadcrumbs render the same home label as their root segment. Without a matching home formatter, existing URI-label and breadcrumb behavior is unchanged.

## Custom views

`ICustomViewService` owns the active contributed full-surface view.

A custom view is mutually exclusive with the Sessions Part, grid Editor, and Panel. The title bar and Sidebar remain available. The Auxiliary Bar is also covered by default; descriptors may opt into presenting the real Auxiliary Bar to the right of the Custom View Grid with `supportsAuxiliaryBar`.

`ICustomViewService.auxiliaryBarVisible` and `setAuxiliaryBarVisible` own this transient presentation for the active opted-in view. The state resets on hide, replacement, or unregistration and is not restored across reloads. Auxiliary-bar open and toggle requests affect this presentation instead of the underlying session layout. In single-pane mode, the shared editor grid node hosts the Auxiliary Bar while editor content and tabs remain hidden.

Covered parts retain desired visibility and sizes separately from effective grid visibility. Custom-view presentation must not change session preferences, editor working sets, or persisted layout; leaving it restores the desired layout. The custom-view contribution owns any pane-composite selection and restoration associated with its auxiliary content.

Explicit session and chat open actions dismiss the active custom view. Reactive fallback opens driven by session or chat lifecycle changes preserve the custom view while reconciling the hidden Sessions grid. On phone layouts, custom views participate in mobile navigation so platform back navigation dismisses them.

Custom views normally use the shared title, description and actions header. A descriptor may hide that chrome when the surface provides its own section structure and supply `commandCenterTitle`; the standard workspace/session command-center control remains in place and substitutes only that title while the view is active.

Manage Sessions (`contrib/worktrees/browser/agentsDashboardEditor.ts`) is a full-width, headerless custom view with Sessions and Dashboard tabs and a right-aligned Refresh action in the shared tab bar. While it is active, the standard command-center control remains in place without a leading workspace icon and substitutes **Manage Sessions** as its title. Sessions is the initial tab and directly contains a compact table with title, every working-directory path and its folder or worktree icon, on-disk worktree size, billed credits, session status, and per-row archive, unarchive, and delete actions. Clicking a session row expands it to show start-to-completion activity across ordinary peer chats, including requests, delegated messages between chats, and pull-request creation; double-clicking or pressing Enter opens the session. Dashboard remains aggregate-only and combines the operational summary with graphs for session throughput, pull-request outcomes, completion time, total worktree disk usage, and median versus largest per-session worktree storage. Window-wide management surfaces belong in the user menu; the sessions-list header is reserved for actions that directly operate on that list.

## Part lifecycle

The workbench:

1. creates the fixed grid and part instances;
2. restores persisted workbench part sizes and visibility;
3. starts the applicable layout controller;
4. reacts to visible-session, editor, and contributed-view state;
5. persists state through the owning services during shutdown.

Part instances and listeners are disposables. Repeatedly created per-session or per-view state is owned by a scoped disposable store.

## Layout-controller boundary

Layout controllers translate session activation into part capture and restoration. They do not own session identity or the visible-session model.

Mobile and desktop presentations intentionally use different strategies where their compositions differ. Shared behavior belongs in the base controller; presentation-specific behavior stays in the relevant controller or strategy.

See [LAYOUT_CONTROLLER.md](LAYOUT_CONTROLLER.md) for rule tags, persistence, and test ownership.

## Mobile boundary

Phone layouts replace selected parts and pickers with mobile subclasses while preserving the same service and provider contracts. Mobile composition and navigation are specified in [MOBILE.md](MOBILE.md).

## Contributions and loading

Layout contributions register through the appropriate `sessions.*.main.ts` entry point. Shared workbench code should change only when the capability is useful outside the Agents Window; Sessions-specific policy stays under `vs/sessions`.

## Change policy

Update this specification only when part ownership, grid topology, presentation families, or a cross-part invariant changes. Do not update it for:

- pixel values, styling, icons, or action placement;
- individual view or editor behavior;
- bug narratives and rejected implementations;
- per-session restoration scenarios already owned by controller rules and tests.

## Related specifications

- [Documentation index](README.md)
- [Sessions architecture](SESSIONS.md)
- [Layout controllers](LAYOUT_CONTROLLER.md)
- [Desktop scenarios](DESKTOP.md)
- [Mobile layout](MOBILE.md)
