---
description: Guidelines for writing code using IDisposable pattern for resource management and lifecycle control
---

# IDisposable Pattern Overview

## Purpose

The IDisposable pattern in VS Code provides a standardized way to manage the lifecycle of resources that need explicit cleanup. This includes event listeners, file system watchers, providers, and other resources that could cause memory leaks if not properly disposed. The pattern ensures deterministic cleanup and prevents resource leaks by providing a consistent interface for releasing resources.

## Scope

- **Included**: Resource lifecycle management, event listener cleanup, provider registration/unregistration, memory leak prevention, automatic cleanup through disposal hierarchies
- **Out of scope**: Garbage collection, automatic memory management for regular objects, browser-specific disposal patterns
- **Integration points**: Used throughout VS Code's architecture - base layer, platform services, editor components, workbench contributions, and extensions

## Architecture

### High-Level Design

The disposable pattern follows a hierarchical cleanup model where parent disposables automatically clean up their children. The design uses composition over inheritance, with `DisposableStore` managing collections of disposables and `Disposable` base class providing automatic registration.

```
IDisposable (interface)
├── Disposable (abstract base class)
│   └── _store: DisposableStore
├── DisposableStore (collection manager)
├── MutableDisposable<T> (single mutable value)
├── DisposableMap<K,V> (key-value store)
└── Helper functions (dispose, toDisposable, combinedDisposable)
```

### Key Classes & Interfaces

- **IDisposable**: Core interface with single `dispose(): void` method for resource cleanup
- **Disposable**: Abstract base class that provides `_store` and `_register()` for automatic child management
- **DisposableStore**: Collection manager for multiple disposables with safe add/remove operations
- **MutableDisposable<T>**: Manages a single disposable value that can be replaced, automatically disposing the previous value
- **DisposableMap<K,V>**: Map that manages disposable values and automatically disposes them on replacement or removal

### Key Files

List of all key files and their purposes:

- **`src/vs/base/common/lifecycle.ts`**: Core disposable infrastructure with IDisposable interface, DisposableStore, Disposable base class, MutableDisposable, DisposableMap, and helper functions
- **`src/vs/base/test/common/lifecycle.test.ts`**: Comprehensive tests for disposable pattern including edge cases and error handling
- **`.eslint-plugin-local/code-no-potentially-unsafe-disposables.ts`**: ESLint rule to detect potentially unsafe usage of DisposableStore and MutableDisposable
- **`extensions/*/src/util/dispose.ts`**: Extension-specific disposable utilities that mirror the core pattern for extension development

## Development Guidelines

### Core Principles
- **Always dispose**: Every created disposable must be disposed either explicitly or by registering with a parent
- **Register immediately**: Use `this._register(new SomeDisposable())` pattern to ensure automatic cleanup
- **Hierarchical cleanup**: Parent disposables should clean up their children automatically
- **Error resilience**: Disposal should handle errors gracefully and continue disposing other resources

### Common Patterns
- **Base class usage**: Extend `Disposable` and use `this._register()` for automatic child management
- **Store collections**: Use `DisposableStore` for managing multiple disposables safely
- **Mutable resources**: Use `MutableDisposable<T>` for resources that may change over time
- **Helper creation**: Use `toDisposable(() => { /* cleanup */ })` for simple cleanup functions

### Anti-patterns to Avoid
- **Manual arrays**: Don't use `IDisposable[]` - use `DisposableStore` instead for better error handling
- **Self-registration**: Never register a disposable on itself
- **Double disposal**: DisposableStore handles multiple disposal attempts safely
- **Disposal after disposed**: Adding to a disposed store will leak resources

## Learnings

* `MutableDisposable` (implements `IDisposable`)
	* `value: IDisposable | undefined`
	* `clear()`
	* A value that enters a mutable disposable (at least once) will be disposed the latest when the mutable disposable is disposed (or when the value is replaced or cleared).

## Important Patterns

### Async Operations and Disposal

When working with async operations that create disposables, always check if the parent object has been disposed before calling `this._register()`:

```typescript
async myAsyncMethod() {
	await someAsyncOperation();
	
	// Check disposal state BEFORE creating new disposables
	if (this._store.isDisposed) {
		return; // Bail early to prevent leaks
	}
	
	const disposable = this._register(new SomeDisposable());
	
	await anotherAsyncOperation();
	
	// Check again after async operations
	if (this._store.isDisposed) {
		return;
	}
	
	// Continue with remaining work...
}
```

**Why this matters:** Between `await` points, the parent object may be disposed (e.g., due to virtualization, scrolling, or user navigation). Attempting to register disposables on a disposed store causes memory leaks and console warnings.

### Async Disposable Registration in Promises

When registering disposables in promise callbacks, check disposal state first:

```typescript
protected _setDetachedTerminal(detachedTerminal: Promise<IDetachedTerminalInstance>): void {
	this._detachedTerminal = detachedTerminal.then(terminal => {
		if (this._store.isDisposed) {
			terminal.dispose(); // Clean up the terminal
			throw new Error('Cannot register terminal on disposed mirror');
		}
		return this._register(terminal);
	});
}
```

Callers should wrap `await` calls in try-catch to handle disposal gracefully:

```typescript
try {
	const terminal = await this._getTerminal();
	// Use terminal...
} catch {
	// Mirror was disposed, handle gracefully
	return undefined;
}
```
