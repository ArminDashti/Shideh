# Sessions architecture

> **Specification change gate:** Do not update this document for bug fixes, implementation details, telemetry, or UI behavior. Update it only when the shared service ownership, domain contract, or lifecycle intentionally changes.

## Scope

The Sessions subsystem provides the provider-neutral model used by the Agents Window. Providers adapt backend-specific sessions and chats into shared domain objects. Sessions services aggregate those providers and own model and presentation orchestration.

This specification covers stable service ownership, domain contracts, and lifecycles. Layout, list presentation, and provider implementations have separate owning specifications in [README.md](README.md).

## Architecture

```text
Sessions UI and contributions
        |
        v
ISessionsService -------------------- visible and active state
        |
        v
ISessionsManagementService ---------- model orchestration
        |
        v
ISessionsProvidersService ----------- provider registry
        |
        +--> ISessionsProvider (Copilot Chat)
        +--> ISessionsProvider (Agent Host)
        +--> ISessionsProvider (Remote Agent Host)
        +--> ISessionsProvider (Native CLI)
```

The implementation follows [LAYERS.md](LAYERS.md). Shared Sessions code remains provider-neutral: provider implementations may consume shared contracts, but shared services and contributions must not depend on provider internals.

## Service ownership

### `ISessionsProvidersService`

The registry:

- registers and unregisters providers;
- exposes providers in stable order;
- resolves providers by identifier;
- announces registration changes.

It does not aggregate sessions, choose a provider for an operation, or own UI state.

### `ISessionsManagementService`

The model-orchestration service:

- aggregates sessions and session types;
- resolves workspaces and selects providers for new sessions;
- owns pending workspace-session, quick-chat, automation, and caller-owned drafts;
- routes model and lifecycle operations to the owning provider;
- exposes provider-neutral lookup and recency APIs;
- emits lifecycle notifications for operations initiated through the service.

It does not own active or visible session state, focus, or layout.

Sending to an existing chat does not discard the pending new-session draft. Every `onWillSendRequest` notification has a matching `onDidFinishSendRequest`, including failed or canceled attempts; successful sends additionally emit `onDidSendRequest`. Presentation followers use the attempt lifetime rather than letting a send in another session clear their state.

### `ISessionsService`

The view service:

- owns the active session and visible-session arrangement;
- opens sessions and chats;
- presents new-session and peer-chat composers;
- owns session navigation, focus, and visible-session restoration.
- owns the optional board's catalog-backed visible sessions, the requested review session/section, and the regular arrangement restored when the board closes.

It delegates model lifecycle operations to `ISessionsManagementService`.

Visible-session slots have stable identities independent of list position and window. One visibility model owns their wrappers and partitions membership, local selection, and replacement candidates by Sessions part. `activeSession` is workbench-wide; `visibleSessions` spans all parts, while `mainVisibleSessions` scopes main-window layout policy. Navigation cancellation is part-scoped, and a later movement of the same session supersedes an earlier in-flight move. Explicit batch opening resolves and prepares its sessions before committing a visibility change. Geometry and layout operations remain independent of providers and comparison membership. See [LAYOUT.md](LAYOUT.md#sessions-part) for rendering, transfer, and restoration ownership.

### Scoped session context

Surfaces that can represent a session other than the workbench-global active session use `ISessionContext`. Commands and menus resolve their target through that scope rather than assuming the active session. Peer-chat composers additionally bind their exact chat, including model selection and persisted draft state, rather than borrowing another group's active chat.

The shared draft-state module owns workspace storage for new-session and per-chat composers. Empty drafts are removed; permanent chat or session deletion clears the corresponding peer drafts after presentation teardown, including saved drafts whose chat catalogue has not loaded.

Session context keys follow the same ownership: the global projection describes the explicitly activated session for shared tools, while each Sessions part, session view, and chat group overrides it with its own selection. Grid context keys (visibility, focus, multiple panes, maximization, and picker availability) are local to each part and mirrored globally from the focused window for Command Palette consumers. Auxiliary-window identity remains locally scoped; a separate focused-window key enables global window commands without exposing auxiliary actions in the main window.

### Input drafts

`ISessionInputDraftService` owns lightweight Sessions input drafts keyed by chat resource. Reading or editing an unloaded draft does not acquire a chat model. When a native model is already loaded, the service shares text and attachments through its public `IInputModel` state; pending local edits are handed to that model when it is created. Model listeners have model-scoped lifetimes. Canonical session replacement rebinds the main-chat draft, including existing draft handles, to the replacement resource.

Compact board inputs and the review composer use that shared draft contract. The existing Sessions composer accepts a host-owned draft instead of using the new-session composer's private storage. Explicit result references remain in the draft until removed or successfully sent; changing the viewed artifact, diff, or pull request does not replace them.

The native new-session input accepts an optional host-owned draft binding. The dashboard's creation input uses its own stable blank-input resource; accepted requests open the existing review composer bound to the committed chat. The regular standalone composer retains its ordinary draft behavior and does not adopt that experimental draft. Send completion clears only the submitted draft, not another input that became current while the request was being accepted. Failure to open the review view does not turn an accepted request into an unsent draft.

### Work overview and review checkpoints

The optional work overview is a metadata projection of the management service's catalog, not another provider or session store. Structured view criteria, saved filters, and promoted automatic collections belong to `ISessionsBoardService`; old card-mode preferences migrate to the unified overview. All groups use the same compact card presentation. Conversation models are acquired only by visible expanded cards or visible cards waiting for input, never by search or catalog enumeration. Automatic loading does not change active-session selection or record human interaction. Searching only filters known title/workspace metadata; it neither invokes a model nor performs a session operation.

`ISessionWorkTrackingService` owns local opening/interaction timestamps, explicit result-review checkpoints, and dismissed archive suggestions. These are client-local presentation records, separate from provider activity timestamps, read/unread state, runtime status, and approval. Missing historical use data remains unknown. Explicit session opens and successful replies from the board/review UI update the timestamp; catalog discovery, background streaming, and unattributed programmatic sends do not imply that the user opened or reviewed a result.

Archive recommendations distinguish suggested, excluded, and uncertain work. They consume known metadata without loading conversation history or polling external services. An archive operation captures an explicit selection, confirms provider/worktree/grouping effects, and revalidates the selected sessions before routing through management. Query changes cannot add sessions to an already-confirmed batch.

Queued-request checks may inspect already-loaded chat models, but missing models remain unknown rather than triggering hydration. File-change or produced-PR sessions require inspection when publication state cannot be verified without resolving provider GitHub presentation. This does not replace the existing per-session merged-PR archive nudge.

## Domain model

Provider-neutral interfaces live in `services/sessions/common/session.ts`.

### Identity

An `ISession` has a provider-owned resource URI, provider identifier, session type, and globally unique session identifier. An `IChat` has its own provider-owned resource URI. Consumers compare resource identity and do not parse provider URI formats.

Providers may publish `resourceAliases` for other resources identifying the same underlying session. Management resolves these aliases to the owning facade and suppresses duplicate imported rows. This lets a native terminal session remain canonical when its CLI history is also discovered by a chat provider.

### Observable state

`ISession` and `IChat` are stable facades. Mutable state is exposed through `IObservable`, including status, title, workspace, chats, model, changes, archive state, capabilities, and optional provider-retained usage totals. Usage remains provider-neutral and optional; providers map available token and billed-credit data without shared consumers inferring backend semantics.

Consumers derive state from those observables. Provider events announce catalog membership changes; they are not a parallel state store.

Drafts may expose `preparationProgress` with a startup phase, an action to open the existing log, and cancellation. This is transient provider-owned state, not chat history. Management retains the submitted input for the lifetime of the in-flight first request. The preparation view uses that snapshot in a view-owned chat model to render the request and progress with the normal transcript renderer, without registering, persisting, or sending that model. The chat composer remains visible with editing disabled and Stop available; the original new-session composer is retained so failed or canceled preparation preserves the submitted prompt and attachments.

Sessions backed by a remote agent host may expose `remoteConnectionStatus`, derived from their backing provider; it is absent when the session has no remote host. Its session-facing disconnected variant may include a machine-readable failure reason.

Providers may expose immutable creation provenance when a session was created by
another session. `createdBySession` identifies the creating session and may also
identify its chat and turn. The reference is observable so list presentation can
keep related sessions together when creation metadata arrives after discovery.
Creation paths that know the reference include it in the initial session
publication.

### Sessions and chats

A session groups one or more chats and exposes a main chat. Providers advertise multi-chat, fork, side-chat, and other operations through observable capabilities. Shared code gates affordances on those capabilities rather than provider identifiers.

Chat origin and interactivity describe whether a chat is user-created, tool-created, interactive, read-only, or hidden. Presentation code uses those contracts instead of inferring behavior from resource shape.

### Presentation

Session types and sessions may declare `presentation: 'terminal'`; omission means the existing chat presentation. Terminal types require an explicit selection and never become the default for ordinary chat creation. Both presentations retain the same workspace, identity, lifecycle, and side-panel contracts.

`ISessionTerminalService` registers provider-owned terminal state for the Sessions view factory. The provider owns launch, restoration, and termination; the view owns attachment, layout, visibility, and focus. Switching or closing a visible surface detaches its terminal without terminating the session's process. The shared terminal service routes focus, reveal, and accessibility to the embedded surface rather than moving it into the panel.

A native runtime and a conversation facade have separate lifetimes. A CLI can select another native conversation without replacing its process. The provider transfers runtime ownership between stable facades and routes foreground selection through `ISessionsService`; the outgoing view must not detach a terminal already attached elsewhere. Persisted ownership distinguishes detached conversations from live reconnection targets. Activity describes native work or input waits, not merely process liveness.

### Workspaces and quick chats

`ISession.workspace` describes the complete workspace in which a session operates. `IChat.workspace` describes the effective workspace available to that chat and may be a subset of the session workspace. Each folder of a chat's workspace reports that folder's own repository and pull request information, so chats sharing a folder share its pull requests. Each folder also has its own Agent Merge settings: Agent Merge actions and indicators for the focused conversation follow the folder `IActiveSession.activeChat` works in, while session-wide surfaces such as the sessions list use the session folder (the main chat's). A folder that is a VS Code-created worktree (`<repo>.worktrees/<name>`) reports its repository as the folder's project, so a chat working in such a worktree shows that project. Filesystem-facing UI and actions for the focused conversation use `IActiveSession.activeChat.workspace`; session lifecycle, creation, and list presentation continue to use the aggregate session workspace. In the compact sessions list, a chat row shows the folder its chat works in, on hover or focus, when the session spans more than one project and the chat works in exactly one folder. A quick chat is workspace-less by product intent and is identified through `ISession.isQuickChat`. An absent workspace alone does not prove that a session is a quick chat because workspace state may still be hydrating.

`ISessionsRecentWorkspacesService` owns persistent workspace dismissals shared by the new-session pickers. Provider-derived workspaces require a non-archived, non-external session; dismissals also prevent automatic selection and survive provider refreshes and reloads. Only a successful send from the new-session composer clears a dismissal, using the selected workspace captured before session preparation; browsing or sessions created elsewhere do not clear it.

The intent contribution owns bounded workspace discovery and reviewed setup proposals. Recommendations contain validated paths and revisions, not execution authority. Discovery does not acquire conversation history, start execution, or establish access to a remote or cloud target. Native questions, tool approval, trust, workspace conversion, and continuation remain owned by the existing chat/provider/host path.

`IDashboardWorkService` owns the experimental workspace-less conversation, its independent draft, and links to execution sessions. Only conversations created through that service receive its orchestration context and client-tool definitions. Ordinary Quick Chat creation, prompts, tools, draft state, and private composer lifecycle remain separate.

Dashboard-owned replies retain that orchestration route when sent from shared cards or focused review. Response cancellation captures and validates the selected chat rather than using a window-global active chat; callers omitting a chat retain main-chat cancellation.

The shared active-client service can overlay tool definitions for one chat resource while retaining shared provider/workspace customization scopes. The session handler supplies trusted caller identity separately from rendered request context, so read-only operations can run without a mounted card. Dashboard tool implementations validate that identity against their owned conversations; model-supplied parameters cannot enroll an ordinary chat. Hiding AI features removes the experimental registrations and blocks operations.

The dashboard agent can discover eligible local, known remote, and concrete cloud targets; clone through provider-owned setup actions; start a separate worker through management; and explicitly read or wait for its bounded recent output. Worker creation sends only the explicit task, without copying the parent's history, attachments, or permission grants. A different execution target creates another session rather than migrating the live conversation. Runtime approval and managed-policy enforcement remain authoritative, and provider, workspace, and isolation eligibility are rechecked before execution.

Conversation membership and execution records are client-owned persisted state, not a portable task scheduler. Canonical publication rebinds their source and destination resources. Stable operation IDs prevent repeated starts; an interrupted start restores as uncertain, not as authority to retry. Discovery revisions and approvals are not restored. Control operations require the client connection even though started workers run through their own providers. Unsent text, evidence, and collection intent remain independently restorable without consuming the regular pending draft.

### Capabilities

Capabilities describe operations supported by the backing provider and remain observable when support may change during hydration. Provider-specific checks belong in the provider; shared services and UI consume the capability contract.

### Changes

Sessions expose compact aggregate change summaries; chats own file changes and selectable changeset catalogues. A provider may project a session-owned changeset into each chat catalogue, using the changeset resource to identify equivalent projections across chats. Every chat publishes a changeset observable; `undefined` means its catalogue has not been published yet and an empty array is an authoritative empty catalogue. The Changes editor shows the active chat's catalogue, including projected session-owned entries, and preserves its order. Transport, reconciliation, and backend metadata stay in the provider. Presentation stays in the owning changes and layout contributions.

Changeset operations are scoped to the changeset channel that advertises them. In a multi-repository session, each chat's Branch Changes and Uncommitted Changes channels identify that chat's concrete repository/worktree and may advertise repository-mutating operations for that target. This lets repository-wide operations such as Commit and Create PR, as well as resource-scoped operations such as Discard Changes, resolve through the active chat's repository. Aggregate changesets keep session context but omit changeset-scoped mutations when more than one repository could be affected; resource- and range-scoped operations may remain when their target is unambiguous.

Features may extend individual changeset operation descriptors through contribution-owned contracts, keeping feature-specific capabilities out of `ISessionChangeset`. The Changes contribution defines the Create PR operation's preparation and submission contract and owns its form; providers attach that capability only to supported operations and own generation, creation, and transport. Preparation is read-only and returns repository and branch identity for submission to revalidate before mutations. Submission uses confirmed values, saving any Agent Merge configuration as session-only overrides after creation.

The form also supports requesting creation in the chat whose changes it was opened from, through the normal send lifecycle, without invoking programmatic PR creation. The provider validates the same prepared identity without regenerating details before the message is sent. That message contains the PR details and GitHub merge instructions; submission choices travel separately as provider-owned request metadata. A host chat contribution applies Agent Merge choices only after the creation turn is admitted and while it is still active, so monitoring cannot capture the old branch during client-side request preparation. The Changes contribution remembers form options and the last-used submission method across sessions in profile storage; remembering choices does not itself change session configuration or retain PR content.

Turn-level file changes route through `IChatResponseFileChangesService`. The editor workbench opens its standard multi-diff presentation; the Agents Window registers `SessionsChatResponseFileChangesService` to select its canonical Changes editor. Providers expose the data but do not choose the presentation.

### Artifacts, references, and customizations

Sessions may expose the artifacts and references recorded by the agent. Both categories are told apart by `isArtifact`: an artifact is something the session produced that is not an ordinary workspace edit, while a reference is something it only points the user at. `recordedArtifacts` contains the complete set for aggregate consumers; `artifacts` contains the generic-pill presentation and may omit entries promoted into dedicated UI. Providers that do not distinguish the two may expose only `artifacts`. Chats may expose the customizations used or read during their turns; these are chat-scoped. Providers that cannot determine either may omit the corresponding observable.

The Agents Window and editor-window Agent Host inputs use the same workbench-owned pill catalog, renderer, customization presentation, and subagent grouping and filtering. Surface adapters supply session state and navigation, not separate pill implementations or visibility preferences.

Providers may advertise `supportsRemoveArtifacts` and implement `removeSessionArtifact`. User-initiated removal routes through `ISessionsManagementService` to the owning provider, which persists and publishes the updated artifact list. Removing a record does not remove independent session associations or alter the linked resource.

Chats may expose live model-opened canvases through an observable provider-neutral collection when the session advertises canvas support. Each entry carries stable identity, presentation metadata, availability, and a read-only source resolver; transient source URLs and provider process details remain inside the provider. Durable local Copilot sessions always admit the extension and canvas runtime, while ephemeral and remote sessions expose no canvas capability. Closing presentation does not invoke provider operations or persist canvas membership.

Recorded GitHub issue and pull request artifacts are resolved from `ISession.artifacts` independently of workspace or repository availability, alongside the repository-discovered associations of the focused chat's workspace (or the session workspace for session-wide consumers). Recorded references never enter the dedicated pull request and issue pills, even when a provider echoes them into its GitHub metadata; they always stay in the references pill. A chat's pull request pill shows the pull requests of its folders' repositories; recorded pull requests from other repositories remain in the artifacts list. The dedicated pills, artifact de-duplication, and pull-request polling share this resolution. Promoted entries retain their optional recorded-reference ID; presentation uses that ID for per-item removal, names the removal after whether the record is an artifact or a reference, and never infers record identity from a title or URL.

## Provider contract

`ISessionsProvider` is defined in `services/sessions/common/sessionsProvider.ts`. A provider represents one compute environment. A provider may advertise multiple session types, and multiple providers may advertise the same logical type.

### Discovery and catalog

A provider exposes:

- stable identity and presentation metadata;
- supported session types and their changes;
- the current session catalog and catalog changes;
- workspace browsing and resolution;
- provider capabilities.

Catalog events distinguish added, removed, and changed facades. Facade replacement is a separate `onDidReplaceSession` lifecycle notification; the management service also translates it into an ordinary catalog refresh. Mutable fields on a facade remain observable.

A provider that supersedes sessions from another provider may implement `resolveSessionResource`. Open paths use this hook to redirect persisted or linked resources before lookup. Providers decline unfamiliar resources, in which case callers retain the original resource.

A provider that must establish backend state before presenting a session may implement `prepareSessionForOpen`. Explicit opens await preparation; startup restoration invokes it asynchronously only for the active session so inactive restored slots stay lazy and one slow provider cannot block the grid.

### Drafts

`createNewSession` and `createQuickChat` return untitled drafts. A draft remains `Untitled` while its first request is prepared; `isNewSessionRequestInProgress` separately lets the UI present that activity without treating the session as committed. Draft preparation receives the first query so a provider can materialize query-dependent execution state before replacing the draft. A draft enters the committed catalog when its first request is sent or its workflow is durably admitted. The management service owns the currently presented draft; the provider owns its backend resources. `deleteNewSession` disposes an abandoned draft.

An editor-window draft handoff fills the existing New Session composer only when its input and attachments are empty. The handoff preserves occupied live or restored drafts, including their workspace, and yields to newer input or navigation while awaiting setup or workspace creation. It never sends a request or clears the source editor's draft.

The product protocol link `<product-protocol>://agents/new?prompt=<encoded text>&workspace=<optional encoded URI>` opens the Agents Window and applies its prompt and optional workspace through the same draft handoff. When `workspace` is omitted, the handoff explicitly selects No Workspace. Opening the link never submits the prompt, and an occupied composer remains unchanged.

For terminal presentation, workspace, harness, presentation, and account selection only configure an uncommitted draft. The explicit start action commits it by opening its interactive CLI with an empty query, without submitting a model request. Account configuration belongs to the creation surface and is fixed once the process launches; the running session surface contains only the native interaction and session chrome.

Native providers complete initial screen readiness during draft preparation, before management clears the creation surface. The creation UI owns a hidden terminal warmup view for layout and terminal-query handling; the provider owns the unpublished process and cancels it with the draft. Only the subsequent send commits the prepared session, so startup errors never publish an empty or stopped session.

Automation editing uses an independent draft so it cannot replace the ordinary New Session composer. Providers advertise `supportsAutomationSessionConfiguration` when they restore `ISessionsProviderCreateSessionOptions.automationConfiguration` before the draft's first configuration resolution and implement `getAutomationSessionConfiguration` to capture the current template. The management service rejects canonical templates for providers without this capability, while deprecated flat aliases continue through ordinary model, mode, and permission operations. It distinguishes unsupported capture from a valid empty template, a replaced draft, and capture failure.

Provider-specific configuration remains opaque to shared Sessions code. Scoped Automation and New Session surfaces consume the same provider menu contributions and `ISessionContext`; providers may advertise presentation capabilities such as a combined phone Mode/Model picker without exposing provider identity checks to shared UI.

The chat composer overlay has an independent draft that can switch between a
workspace-less quick chat and a workspace-backed session, so opening it cannot
replace a draft in the regular composer. Providers own the backend resources
behind those drafts.

### Operations

Providers implement only operations advertised by their contracts, including request sending, model selection, rename, archive, read state, deletion, chat creation, and optional worktree disk-usage measurement. Shared cleanup UI consumes the optional measurement through the management service and remains independent of provider transport or filesystem details. Capability checks happen before invocation. Once invoked, an operation returns a defined result or rejects; unsupported behavior must not be reported as a success-shaped fallback.

### Provider ownership

Backend state, transport, URI formats, recovery, and authentication remain inside provider contributions. Providers adapt those details into `ISession`, `IChat`, and shared operations.

Native CLI sessions persist their catalog, repository baseline, and account selection in machine-local profile storage; the CLI owns model selection, approvals, native configuration, and conversation history. A Copilot-backed launch can choose a compatible initial default without a separate model-selection step; resume preserves the native model choice. Native account selection inherits the CLI's authentication unchanged. Copilot account selection uses a local agent-host management service to lease an isolated loopback proxy; upstream credentials never enter the CLI or persisted session metadata. Leases survive renderer reconnection, expire without renewal, and are released when their terminal stops. Loss of the selected account route never falls back to another billing source.

Live terminals reconnect across window reloads when terminal persistence is enabled; with it disabled the process is terminated on reload and the session offers a resume instead. After an application restart, the provider resumes through the CLI rather than letting terminal process revival replay the original launch command. If an exact native conversation identifier is unavailable, the CLI's own resume picker is used instead of guessing the most recent conversation. Archiving or deleting a terminal session stops its process but does not delete CLI-owned history.

Provider-specific contracts are documented in:

- [Copilot Chat provider](contrib/providers/copilotChatSessions/COPILOT_CHAT_SESSIONS_PROVIDER.md)
- [Agent Host provider](contrib/providers/agentHost/AGENT_HOST_SESSIONS_PROVIDER.md)
- [Remote Agent Host provider](contrib/providers/remoteAgentHost/REMOTE_AGENT_HOST_SESSIONS_PROVIDER.md)
- [Native CLI provider](contrib/providers/nativeCli/README.md)

## Principal lifecycle

### Registration

```text
provider contribution loads
    -> registerProvider(provider)
    -> management subscribes to provider state
    -> aggregated types and sessions update
    -> consumers react through services and observables
```

Registration does not imply backend readiness. Providers publish usable types and capabilities as their backend becomes ready. Consumers that support partial state create the best available model and react to later capability changes.

### New session

```text
user chooses a workspace and session type
    -> ISessionsService presents the flow
    -> ISessionsManagementService resolves trust and provider
    -> provider creates a draft
    -> management owns the pending draft
    -> view service presents it
```

On first send, the provider creates or selects the chat, sends the request, and commits the session. Providers may preserve the draft facade or notify the management service through the separate replacement lifecycle. Consumers follow that lifecycle rather than assuming one strategy or a replacement field on a catalog event.

Providers may expose an `ISessionConfigurationSnapshot` of resolved draft configuration. Providers normalize common properties, such as isolation, and retain the full provider-specific values separately in `providerConfig`. Management captures the snapshot before draft preparation or replacement and includes it in the successful first-request notification without interpreting provider values. Consumers use the typed common properties without knowing provider keys; the full snapshot is not a telemetry payload.

### Existing session

Requests route through `ISessionsManagementService` to the provider identified by the session. Providers update chat and session observables. Foreground sends may update view state through lifecycle notifications; background sends do not implicitly steal focus.

Attaching a workflow retains the existing conversation and workspace and requires an explicit task and stopping point. Starting after an active turn is an explicit choice. Inspection and checkpoint navigation do not start or resume execution; extending a stopping point requires Apply. Archiving pauses execution, restoring does not resume it, and deletion revokes the owning runtime's work.

### Multiple chats

Creating or forking a chat is a capability-gated provider operation routed by the management service. Opening an existing chat is view orchestration: `ISessionsService` activates the session, resolves the chat from `session.chats`, and updates visible and active state. Chat-tab presentation remains view-owned configuration and is not carried through service open options.

### Remote delegation

The Remote Sessions contribution exposes `list_agent_hosts`, `create_remote_session`, `get_remote_session`, and `send_remote_message` as client tools in the Agents Window. The window owns connected-host selection and cross-host routing; hosts do not discover or authenticate to one another. Creation uses the management service's background lifecycle and does not replace the current composer or change focus.

The originating chat supplies creation provenance and a return address, not a workspace or permission grant. Omitting the workspace creates a workspace-less session. An explicit target directory must already exist and be trusted; requested worktree isolation must be supported rather than silently downgraded. Repository cloning and transfer of the source checkout are not part of this creation contract.

Remote creation provenance preserves host-qualified session and chat identity. Replies address the originating chat even if the active chat changes, retain agent authorship, and queue behind a busy destination. The coordinating window must remain connected; persisted provenance supports restoration, not offline delivery. Tool approval and AI/remote-host enablement apply independently of host selection.

The contribution retains background chat models while initial or queued requests are running, independently of which chat is visible. Before queueing a follow-up it explicitly prepares the destination's client tools; ordinary history browsing does not claim them. Model references are released when the chat and its queue become idle, or when the host disconnects. Programmatic creation awaits its preparation callback before applying configuration and sending the first request.

Inspection is a one-shot read of verified protocol state for the exact host-qualified session or chat, independent of whether its workbench chat model is loaded. It returns the chat state and bounded latest-turn response or error, not a full transcript or a delivery acknowledgement. It does not claim client tools, mark the chat read, approve input, reconnect, or send a turn. Unavailable targets are reported explicitly rather than returning stale content; temporary subscriptions are released after the read.

## Implementation comparisons

The opt-in `sessions.comparison.enabled` feature is owned by the Comparison
contribution in the Agents Window. It associates independently created sessions
with one shared prompt and base branch or commit; it does not introduce another
session provider or agent execution path. Launches use
`ISessionsManagementService.createAndSendNewChatRequest`, require advertised
worktree configuration support, and request a new isolated branch per attempt.
Normal provider model availability, workspace trust, permissions, and billing
continue to apply.

Comparison history stores the prompt, target models, session resources, launch
outcomes, and the user's preferred attempt in workspace-local machine storage.
Results remain live views of their sessions, not immutable evaluation snapshots.
Restoring history never resends a prompt; unfinished launches are marked
interrupted. Choosing a preference neither merges changes nor deletes, archives,
or cancels the other sessions. Session navigation and change review continue
through `ISessionsService` and the existing editor services.

### Transient side questions

`/btw` and the response-selection side-question affordance create normal
provider-backed side chats. The experiment-driven
`chat.agentSessions.transientSideChat` setting defaults to false.
`ISideChatOrchestrationService` owns the shared create, presentation, and send
sequence for slash-command, selection, and generic side-chat entry points.
When it is enabled and the source `ChatView` has a live transient host, the new
chat is closed with `skipHistory` and represented by an in-memory answer card
above the unchanged source composer. Its send uses `preserveActiveChat`, so
normal send lifecycle notifications and failures still propagate without
navigating away from the source chat. When the setting is disabled or no
transient host is available, the side chat opens in a group beside the source
before sending.

The card is an in-flow child of `ChatInputPart`, after the fixed-height floating
persistent-content lane and before the banners and composer. Variable-height
answers therefore participate in input layout without changing the status-pill
overlay contract.

Closing the card removes only its transient presentation; the side chat remains
recoverable from Closed chats. **Open Full Chat** reopens the same chat in the
normal chat UI. Transient state stores resource identities and resolves current
provider facades reactively from `session.chats`, so removed or replaced chats
cannot leave a stale card. A replacement is scoped to the source chat, and
asynchronous presentation, promotion, or failure handling must revalidate a
monotonic ownership token after each await without removing a newer card.
Disabling the setting, disposing the final host, or making the source chat
read-only removes its live transient state, so a later send failure falls back
to the caller's normal error surface rather than claiming that an invisible
card handled it.
Transient send failures are reported by the card; full-chat failures propagate
to their caller.
The card grows to its content up to 60% of the source view height, then scrolls
internally without the full-chat go-to-bottom control. Escape dismissal is a
scoped keybinding that works while focus is in the card; from the source input it
yields to active requests, suggestions, confirmations, elicitation, hovers,
editing, and dictation, and from card code blocks it yields to editor selections.

## State propagation

Use the narrowest mechanism that represents a change:

- observables for mutable session or chat state;
- provider events for catalog membership;
- management events for operation lifecycle notifications, including send start
  and settlement paired by a service-issued request id;
- direct service calls for orchestration and control flow.

Do not mirror observable state with events or use storage and provider internals as side channels between components.

## Provider checklist

1. Implement `ISessionsProvider` under `contrib/providers/<provider>/browser/`, or `electron-browser/` when the provider needs desktop-only services.
2. Adapt backend state into stable `ISession` and `IChat` facades.
3. Advertise types and capabilities truthfully and reactively.
4. Register through the appropriate `sessions.*.main.ts` entry point.
5. Keep shared contracts provider-neutral.
6. Add focused lifecycle and failure tests.
7. Update this specification only when the shared contract or ownership model changes.

## Related specifications

- [Documentation index](README.md)
- [Layer rules](LAYERS.md)
- [Layout](LAYOUT.md)
- [Layout controller](LAYOUT_CONTROLLER.md)
- [Sessions list](SESSIONS_LIST.md)
- [Mobile](MOBILE.md)
