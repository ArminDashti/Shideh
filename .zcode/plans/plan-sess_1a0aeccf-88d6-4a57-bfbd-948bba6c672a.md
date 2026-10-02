## Goal

Add a **settings button (gear icon)** to the header (title bar) of the sessions/Agents window, positioned at the **top/leftmost spot of the header's left toolbar** so it's the first action in the header row.

## Context

- The header is `TitlebarPart` (`src/vs/sessions/browser/parts/titlebarPart.ts`). Its left section renders `Menus.TitleBarLeftLayout` into `.left-toolbar-container` (created at `titlebarPart.ts:204`), and that container uses CSS `order: 2` so it appears right of the window controls — visually "on top" of the header's left side.
- Existing left-layout actions: sidebar toggle (`order 0`), new session (`order 1`), update entry (`order 2`) — registered in `src/vs/sessions/browser/layoutActions.ts:50-57` and `newSessionAction.ts`.
- `workbench.action.openSettings` is already registered for this window: `sessions.common.main.ts:210` imports `preferences.contribution`, and the account menu already references the same command id (`account.contribution.ts:172-182`) with `Codicon.settingsGear`.

## Change (single file)

Edit `src/vs/sessions/browser/layoutActions.ts`, alongside the existing `MenuRegistry.appendMenuItem(Menus.TitleBar…)` calls:

```ts
MenuRegistry.appendMenuItem(Menus.TitleBarLeftLayout, {
    command: {
        id: 'workbench.action.openSettings',
        title: localize('openSettings', "Settings"),
        icon: Codicon.settingsGear,
    },
    group: 'navigation',
    order: -1,   // before sidebar toggle (0) → leftmost/topmost header action
    when: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), IsPhoneLayoutContext.negate()),
});
```

Notes:
- `order: -1` puts the gear **first** in the left toolbar, ahead of the sidebar toggle — i.e. at the very start/top of the header.
- `when` gates match the other title-bar actions (hidden in auxiliary windows and phone layout, same guard the account-menu settings entry uses).
- No DOM/CSS work needed: `MenuWorkbenchToolBar` renders it as a standard `.action-item .codicon-settings-gear`, inherits header icon/hover styling, and participates in the existing overflow management automatically.
- The button duplicates the account-menu Settings entry by design (fast access); the command runs unchanged.

## Verification

Per this checkout's constraint (no dev dependencies — `tsc`/tests can't run locally), verify with source-level checks:
- Parse the changed file with the TypeScript compiler available at `C:/Users/armin/AppData/Roaming/npm/node_modules/openclaw/node_modules/typescript` (syntax + `noUnusedLocals`-style review).
- Confirm no new imports are unused and all relative imports still resolve.
- Grep that `Menus.TitleBarLeftLayout` item orders don't collide in a way that changes existing behavior (sidebar/new-session/update orders untouched).