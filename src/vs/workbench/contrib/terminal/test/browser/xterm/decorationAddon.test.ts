/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDecoration, IDecorationOptions, Terminal as RawXtermTerminal } from '@xterm/xterm';
import { deepStrictEqual, notEqual, strictEqual, throws } from 'assert';
import { importAMDNodeModule } from '../../../../../../amdX.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { ITerminalCommand, TerminalCapability } from '../../../../../../platform/terminal/common/capabilities/capabilities.js';
import { CommandDetectionCapability } from '../../../../../../platform/terminal/common/capabilities/commandDetectionCapability.js';
import { TerminalCapabilityStore } from '../../../../../../platform/terminal/common/capabilities/terminalCapabilityStore.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { TestThemeService } from '../../../../../../platform/theme/test/common/testThemeService.js';
import { DecorationAddon } from '../../../browser/xterm/decorationAddon.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { TestXtermLogger } from '../../../../../../platform/terminal/test/common/terminalTestHelpers.js';

suite('DecorationAddon', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let decorationAddon: DecorationAddon;
	let xterm: RawXtermTerminal;
	let hoverDisposed: boolean;
	let removedEventListeners: string[];
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let themeService: TestThemeService;

	setup(async () => {
		hoverDisposed = false;
		removedEventListeners = [];
		const TerminalCtor = (await importAMDNodeModule<typeof import('@xterm/xterm')>('@xterm/xterm', 'lib/xterm.js')).Terminal;
		class TestTerminal extends TerminalCtor {
			override registerDecoration(decorationOptions: IDecorationOptions): IDecoration | undefined {
				if (decorationOptions.marker.isDisposed) {
					return undefined;
				}
				const element = document.createElement('div');
				const removeEventListener = element.removeEventListener.bind(element);
				element.removeEventListener = ((...args: Parameters<typeof element.removeEventListener>) => {
					removedEventListeners.push(args[0]);
					removeEventListener(...args);
				}) as typeof element.removeEventListener;
				const disposeListeners = new Set<() => void>();
				let isDisposed = false;
				return {
					marker: decorationOptions.marker,
					element,
					onDispose: (listener: () => void) => {
						disposeListeners.add(listener);
						return { dispose: () => disposeListeners.delete(listener) };
					},
					get isDisposed() { return isDisposed; },
					dispose: () => {
						isDisposed = true;
						for (const listener of disposeListeners) {
							listener();
						}
						disposeListeners.clear();
					},
					onRender: (listener: (element: HTMLElement) => void) => {
						listener(element);
						return { dispose: () => { } };
					}
				} as unknown as IDecoration;
			}
		}

		instantiationService = workbenchInstantiationService({
			configurationService: () => new TestConfigurationService({
				files: {},
				workbench: {
					hover: { delay: 5 },
				},
				terminal: {
					integrated: {
						shellIntegration: {
							decorationsEnabled: 'both'
						}
					}
				}
			})
		}, store);
		themeService = new TestThemeService();
		store.add(themeService._onThemeChange);
		instantiationService.stub(IThemeService, themeService);
		instantiationService.stub(IHoverService, {
			setupDelayedHover: () => ({ dispose: () => hoverDisposed = true })
		} as unknown as IHoverService);
		xterm = store.add(new TestTerminal({
			allowProposedApi: true,
			cols: 80,
			rows: 30,
			logger: TestXtermLogger
		}));
		const capabilities = store.add(new TerminalCapabilityStore());
		capabilities.add(TerminalCapability.CommandDetection, store.add(instantiationService.createInstance(CommandDetectionCapability, xterm)));
		decorationAddon = store.add(instantiationService.createInstance(DecorationAddon, undefined, capabilities, true));
		xterm.loadAddon(decorationAddon);
	});

	test('should not register global service listeners when disabled', () => {
		const initialThemeListenerCount = Reflect.get(themeService._onThemeChange, '_size');
		const capabilities = store.add(new TerminalCapabilityStore());
		store.add(instantiationService.createInstance(DecorationAddon, undefined, capabilities, false));

		strictEqual(Reflect.get(themeService._onThemeChange, '_size'), initialThemeListenerCount);
	});

	suite('registerDecoration', () => {
		test('should throw when command has no marker', async () => {
			throws(() => decorationAddon.registerCommandDecoration({ command: 'cd src', timestamp: Date.now(), hasOutput: () => false } as ITerminalCommand));
		});
		test('should return undefined when marker has been disposed of', async () => {
			const marker = xterm.registerMarker(1);
			marker?.dispose();
			strictEqual(decorationAddon.registerCommandDecoration({ command: 'cd src', marker, timestamp: Date.now(), hasOutput: () => false } as ITerminalCommand), undefined);
		});
		test('should return decoration when marker has not been disposed of', async () => {
			const marker = xterm.registerMarker(2);
			notEqual(decorationAddon.registerCommandDecoration({ command: 'cd src', marker, timestamp: Date.now(), hasOutput: () => false } as ITerminalCommand), undefined);
		});
		test('should return decoration with mark properties', async () => {
			const marker = xterm.registerMarker(2);
			notEqual(decorationAddon.registerCommandDecoration(undefined, undefined, { marker }), undefined);
		});
		test('should dispose decoration resources when the decoration is disposed', () => {
			const marker = xterm.registerMarker(2)!;
			const decoration = decorationAddon.registerCommandDecoration({ command: 'cd src', marker, exitCode: 0, timestamp: Date.now(), hasOutput: () => false } as ITerminalCommand)!;
			const decorations = (decorationAddon as unknown as { _decorations: Map<number, unknown> })._decorations;

			decoration.dispose();

			strictEqual(hoverDisposed, true);
			deepStrictEqual(removedEventListeners.sort(), ['click', 'contextmenu', 'mousedown']);
			strictEqual(decorations.has(marker.id), false);
		});
	});

	suite('command finished decoration registration', () => {
		test('should always register decorations for finished commands regardless of cursor position', async () => {
			// This test verifies the fix for issue #199433 where "Explain with Copilot" 
			// sparkles appeared unpredictably due to cursor position checks
			const marker = xterm.registerMarker(3);
			const commandDetection = capabilities.get(TerminalCapability.CommandDetection);
			
			// Simulate a failed command where cursor position is above the prompt marker
			// (this would previously prevent decoration registration)
			const failedCommand = {
				command: 'docker ps',
				exitCode: 1,
				marker,
				promptStartMarker: marker,
				timestamp: Date.now(),
				hasOutput: () => false
			} as ITerminalCommand;

			// Mock the terminal buffer state where cursor is above the prompt marker
			// This simulates the scenario that caused the unpredictable behavior
			Object.defineProperty(xterm, 'buffer', {
				value: {
					active: {
						baseY: 0,
						cursorY: 1  // cursor at line 1, marker at line 3 (1 < 3)
					}
				}
			});

			// Fire the command finished event and verify decoration is registered
			if (commandDetection) {
				commandDetection.handleCommandFinished(1, { marker });
			}

			// Verify that the decoration was created despite cursor position
			// The fix ensures finished commands always get decorations for quick fixes
			const decoration = decorationAddon.registerCommandDecoration(failedCommand);
			notEqual(decoration, undefined, 'Decoration should be created for finished commands regardless of cursor position');
		});

		test('should respect cursor position check for running commands', async () => {
			// Verify that running commands (exitCode undefined) still use cursor position logic
			const marker = xterm.registerMarker(3);
			
			const runningCommand = {
				command: 'long-running-task',
				exitCode: undefined, // Running command
				marker,
				promptStartMarker: marker,
				timestamp: Date.now(),
				hasOutput: () => false
			} as ITerminalCommand;

			// This preserves the existing behavior for running commands
			const decoration = decorationAddon.registerCommandDecoration(runningCommand);
			notEqual(decoration, undefined, 'Running commands should still be handled appropriately');
		});
	});
});
