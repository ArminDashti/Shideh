/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeKeybinding, createSimpleKeybinding, KeyCodeChord } from '../../../../base/common/keybindings.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { OS } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ContextKeyExpr, ContextKeyExpression, IContext } from '../../../contextkey/common/contextkey.js';
import { KeybindingResolver, ResultKind } from '../../common/keybindingResolver.js';
import { ResolvedKeybindingItem } from '../../common/resolvedKeybindingItem.js';
import { USLayoutResolvedKeybinding } from '../../common/usLayoutResolvedKeybinding.js';
import { createUSLayoutResolvedKeybinding } from './keybindingsTestUtils.js';

function createContext(ctx: any) {
	return {
		getValue: (key: string) => {
			return ctx[key];
		}
	};
}

suite('KeybindingResolver', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function kbItem(keybinding: number | number[], command: string, commandArgs: any, when: ContextKeyExpression | undefined, isDefault: boolean): ResolvedKeybindingItem {
		const resolvedKeybinding = createUSLayoutResolvedKeybinding(keybinding, OS);
		return new ResolvedKeybindingItem(
			resolvedKeybinding,
			[{ command, args: commandArgs }],
			when,
			isDefault,
			null,
			false
		);
	}

	function getDispatchStr(chord: KeyCodeChord): string {
		return USLayoutResolvedKeybinding.getDispatchStr(chord)!;
	}

	test('resolve key', () => {
		const keybinding = KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ;
		const runtimeKeybinding = createSimpleKeybinding(keybinding, OS);
		const contextRules = ContextKeyExpr.equals('bar', 'baz');
		const keybindingItem = kbItem(keybinding, 'yes', null, contextRules, true);

		assert.strictEqual(contextRules.evaluate(createContext({ bar: 'baz' })), true);
		assert.strictEqual(contextRules.evaluate(createContext({ bar: 'bz' })), false);

		const resolver = new KeybindingResolver([keybindingItem], [], () => { });
		assert.strictEqual(resolver.resolve(createContext({ bar: 'baz' }), null, getDispatchStr(runtimeKeybinding))?.commands[0].command, 'yes');
		assert.strictEqual(resolver.resolve(createContext({ bar: 'bz' }), null, getDispatchStr(runtimeKeybinding)), null);
	});

	test('resolve key with arguments', () => {
		const commandArgs = { text: 'no' };
		const keybinding = KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ;
		const runtimeKeybinding = createSimpleKeybinding(keybinding, OS);
		const contextRules = ContextKeyExpr.equals('bar', 'baz');
		const keybindingItem = kbItem(keybinding, 'yes', commandArgs, contextRules, true);

		const resolver = new KeybindingResolver([keybindingItem], [], () => { });
		assert.strictEqual(resolver.resolve(createContext({ bar: 'baz' }), null, getDispatchStr(runtimeKeybinding))?.commands[0].args, commandArgs);
	});

	suite('handle keybinding removals', () => {

		test('simple 1', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), false),
			]);
		});

		test('simple 2', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyC, 'yes3', null, ContextKeyExpr.equals('3', 'c'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true),
				kbItem(KeyCode.KeyC, 'yes3', null, ContextKeyExpr.equals('3', 'c'), false),
			]);
		});

		test('removal with not matching when', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-yes1', null, ContextKeyExpr.equals('1', 'b'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('removal with not matching keybinding', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyB, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('removal with matching keybinding and when', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('removal with unspecified keybinding', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(0, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('removal with unspecified when', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-yes1', null, undefined, false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('removal with unspecified when and unspecified keybinding', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(0, '-yes1', null, undefined, false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('issue #138997 - removal in default list', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'yes1', null, undefined, true),
				kbItem(KeyCode.KeyB, 'yes2', null, undefined, true),
				kbItem(0, '-yes1', null, undefined, false)
			];
			const overrides: ResolvedKeybindingItem[] = [];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, undefined, true)
			]);
		});

		test('issue #612#issuecomment-222109084 cannot remove keybindings for commands with ^', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, '^yes1', null, ContextKeyExpr.equals('1', 'a'), true),
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-yes1', null, undefined, false)
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
			]);
		});

		test('issue #140884 Unable to reassign F1 as keybinding for Show All Commands', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-command1', null, undefined, false),
				kbItem(KeyCode.KeyA, 'command1', null, undefined, false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'command1', null, undefined, false)
			]);
		});

		test('issue #141638: Keyboard Shortcuts: Change When Expression might actually remove keybinding in Insiders', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.equals('a', '1'), false),
				kbItem(KeyCode.KeyA, '-command1', null, undefined, false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.equals('a', '1'), false)
			]);
		});

		test('issue #157751: Auto-quoting of context keys prevents removal of keybindings via UI', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.deserialize(`editorTextFocus && activeEditor != workbench.editor.notebook && editorLangId in julia.supportedLanguageIds`), true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.deserialize(`editorTextFocus && activeEditor != 'workbench.editor.notebook' && editorLangId in 'julia.supportedLanguageIds'`), false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, []);
		});

		test('issue #293802: removal still matches when default when clause becomes more specific', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.and(ContextKeyExpr.has('inChatInput'), ContextKeyExpr.not('withinEditSessionDiff')), true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.has('inChatInput'), false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, []);
		});

		test('removal with more specific when clause does not match broader default', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.has('inChatInput'), true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.and(ContextKeyExpr.has('inChatInput'), ContextKeyExpr.not('withinEditSessionDiff')), false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, [
				kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.has('inChatInput'), true),
			]);
		});

		test('issue #160604: Remove keybindings with when clause does not work', () => {
			const defaults = [
				kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
			];
			const overrides = [
				kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.true(), false),
			];
			const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
			assert.deepStrictEqual(actual, []);
		});

		test('contextIsEntirelyIncluded', () => {
			const toContextKeyExpression = (expr: ContextKeyExpression | string | null) => {
				if (typeof expr === 'string' || !expr) {
					return ContextKeyExpr.deserialize(expr);
				}
				return expr;
			};
			const assertIsIncluded = (a: ContextKeyExpression | string | null, b: ContextKeyExpression | string | null) => {
				assert.strictEqual(KeybindingResolver.whenIsEntirelyIncluded(toContextKeyExpression(a), toContextKeyExpression(b)), true);
			};
			const assertIsNotIncluded = (a: ContextKeyExpression | string | null, b: ContextKeyExpression | string | null) => {
				assert.strictEqual(KeybindingResolver.whenIsEntirelyIncluded(toContextKeyExpression(a), toContextKeyExpression(b)), false);
			};

			assertIsIncluded(null, null);
			assertIsIncluded(null, ContextKeyExpr.true());
			assertIsIncluded(ContextKeyExpr.true(), null);
			assertIsIncluded(ContextKeyExpr.true(), ContextKeyExpr.true());
			assertIsIncluded('key1', null);
			assertIsIncluded('key1', '');
			assertIsIncluded('key1', 'key1');
			assertIsIncluded('key1', ContextKeyExpr.true());
			assertIsIncluded('!key1', '');
			assertIsIncluded('!key1', '!key1');
			assertIsIncluded('key2', '');
			assertIsIncluded('key2', 'key2');
			assertIsIncluded('key1 && key1 && key2 && key2', 'key2');
			assertIsIncluded('key1 && key2', 'key2');
			assertIsIncluded('key1 && key2', 'key1');
			assertIsIncluded('key1 && key2', '');
			assertIsIncluded('key1', 'key1 || key2');
			assertIsIncluded('key1 || !key1', 'key2 || !key2');
			assertIsIncluded('key1', 'key1 || key2 && key3');

			assertIsNotIncluded('key1', '!key1');
			assertIsNotIncluded('!key1', 'key1');
			assertIsNotIncluded('key1 && key2', 'key3');
			assertIsNotIncluded('key1 && key2', 'key4');
			assertIsNotIncluded('key1', 'key2');
			assertIsNotIncluded('key1 || key2', 'key2');
			assertIsNotIncluded('', 'key2');
			assertIsNotIncluded(null, 'key2');
		});
	});

	test('KeybindingResolver.handleRemovals simple 2', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyC, 'yes3', null, ContextKeyExpr.equals('3', 'c'), false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true),
			kbItem(KeyCode.KeyC, 'yes3', null, ContextKeyExpr.equals('3', 'c'), false),
		]);
	});

	test('KeybindingResolver.handleRemovals removal with not matching when', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-yes1', null, ContextKeyExpr.equals('1', 'b'), false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('KeybindingResolver.handleRemovals removal with not matching keybinding', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyB, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('KeybindingResolver.handleRemovals removal with matching keybinding and when', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('KeybindingResolver.handleRemovals removal with unspecified keybinding', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(0, '-yes1', null, ContextKeyExpr.equals('1', 'a'), false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('KeybindingResolver.handleRemovals removal with unspecified when', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-yes1', null, undefined, false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('KeybindingResolver.handleRemovals removal with unspecified when and unspecified keybinding', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(0, '-yes1', null, undefined, false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('issue #138997 KeybindingResolver.handleRemovals removal in default list', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'yes1', null, undefined, true),
			kbItem(KeyCode.KeyB, 'yes2', null, undefined, true),
			kbItem(0, '-yes1', null, undefined, false)
		];
		const overrides: ResolvedKeybindingItem[] = [];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, undefined, true)
		]);
	});

	test('issue #612#issuecomment-222109084 cannot remove keybindings for commands with ^', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, '^yes1', null, ContextKeyExpr.equals('1', 'a'), true),
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-yes1', null, undefined, false)
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyB, 'yes2', null, ContextKeyExpr.equals('2', 'b'), true)
		]);
	});

	test('issue #140884 Unable to reassign F1 as keybinding for Show All Commands', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-command1', null, undefined, false),
			kbItem(KeyCode.KeyA, 'command1', null, undefined, false),
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyA, 'command1', null, undefined, false)
		]);
	});

	test('issue #141638: Keyboard Shortcuts: Change When Expression might actually remove keybinding in Insiders', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
		];
		const overrides = [
			kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.equals('a', '1'), false),
			kbItem(KeyCode.KeyA, '-command1', null, undefined, false),
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, [
			kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.equals('a', '1'), false)
		]);
	});

	test('issue #157751: Auto-quoting of context keys prevents removal of keybindings via UI', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'command1', null, ContextKeyExpr.deserialize(`editorTextFocus && activeEditor != workbench.editor.notebook && editorLangId in julia.supportedLanguageIds`), true),
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.deserialize(`editorTextFocus && activeEditor != 'workbench.editor.notebook' && editorLangId in 'julia.supportedLanguageIds'`), false),
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, []);
	});

	test('issue #160604: Remove keybindings with when clause does not work', () => {
		const defaults = [
			kbItem(KeyCode.KeyA, 'command1', null, undefined, true),
		];
		const overrides = [
			kbItem(KeyCode.KeyA, '-command1', null, ContextKeyExpr.true(), false),
		];
		const actual = KeybindingResolver.handleRemovals([...defaults, ...overrides]);
		assert.deepStrictEqual(actual, []);
	});

	test('contextIsEntirelyIncluded', () => {
		const toContextKeyExpression = (expr: ContextKeyExpression | string | null) => {
			if (typeof expr === 'string' || !expr) {
				return ContextKeyExpr.deserialize(expr);
			}
			return expr;
		};
		const assertIsIncluded = (a: ContextKeyExpression | string | null, b: ContextKeyExpression | string | null) => {
			assert.strictEqual(KeybindingResolver.whenIsEntirelyIncluded(toContextKeyExpression(a), toContextKeyExpression(b)), true);
		};
		const assertIsNotIncluded = (a: ContextKeyExpression | string | null, b: ContextKeyExpression | string | null) => {
			assert.strictEqual(KeybindingResolver.whenIsEntirelyIncluded(toContextKeyExpression(a), toContextKeyExpression(b)), false);
		};

		assertIsIncluded(null, null);
		assertIsIncluded(null, ContextKeyExpr.true());
		assertIsIncluded(ContextKeyExpr.true(), null);
		assertIsIncluded(ContextKeyExpr.true(), ContextKeyExpr.true());
		assertIsIncluded('key1', null);
		assertIsIncluded('key1', '');
		assertIsIncluded('key1', 'key1');
		assertIsIncluded('key1', ContextKeyExpr.true());
		assertIsIncluded('!key1', '');
		assertIsIncluded('!key1', '!key1');
		assertIsIncluded('key2', '');
		assertIsIncluded('key2', 'key2');
		assertIsIncluded('key1 && key1 && key2 && key2', 'key2');
		assertIsIncluded('key1 && key2', 'key2');
		assertIsIncluded('key1 && key2', 'key1');
		assertIsIncluded('key1 && key2', '');
		assertIsIncluded('key1', 'key1 || key2');
		assertIsIncluded('key1 || !key1', 'key2 || !key2');
		assertIsIncluded('key1', 'key1 || key2 && key3');

		assertIsNotIncluded('key1', '!key1');
		assertIsNotIncluded('!key1', 'key1');
		assertIsNotIncluded('key1 && key2', 'key3');
		assertIsNotIncluded('key1 && key2', 'key4');
		assertIsNotIncluded('key1', 'key2');
		assertIsNotIncluded('key1 || key2', 'key2');
		assertIsNotIncluded('', 'key2');
		assertIsNotIncluded(null, 'key2');
	});

	test('resolve command', () => {

		function _kbItem(keybinding: number | number[], command: string, when: ContextKeyExpression | undefined): ResolvedKeybindingItem {
			return kbItem(keybinding, command, null, when, true);
		}

		const items = [
			// This one will never match because its "when" is always overwritten by another one
			_kbItem(
				KeyCode.KeyX,
				'first',
				ContextKeyExpr.and(
					ContextKeyExpr.equals('key1', true),
					ContextKeyExpr.notEquals('key2', false)
				)
			),
			// This one always overwrites first
			_kbItem(
				KeyCode.KeyX,
				'second',
				ContextKeyExpr.equals('key2', true)
			),
			// This one is a secondary mapping for `second`
			_kbItem(
				KeyCode.KeyZ,
				'second',
				undefined
			),
			// This one sometimes overwrites first
			_kbItem(
				KeyCode.KeyX,
				'third',
				ContextKeyExpr.equals('key3', true)
			),
			// This one is always overwritten by another one
			_kbItem(
				KeyMod.CtrlCmd | KeyCode.KeyY,
				'fourth',
				ContextKeyExpr.equals('key4', true)
			),
			// This one overwrites with a chord the previous one
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyY, KeyCode.KeyZ),
				'fifth',
				undefined
			),
			// This one has no keybinding
			_kbItem(
				0,
				'sixth',
				undefined
			),
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU),
				'seventh',
				undefined
			),
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyK),
				'seventh',
				undefined
			),
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU),
				'uncomment lines',
				undefined
			),
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyC),
				'comment lines',
				undefined
			),
			_kbItem(
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyG, KeyMod.CtrlCmd | KeyCode.KeyC),
				'unreachablechord',
				undefined
			),
			_kbItem(
				KeyMod.CtrlCmd | KeyCode.KeyG,
				'eleven',
				undefined
			),
			_kbItem(
				[KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyA, KeyCode.KeyB],
				'long multi chord',
				undefined
			),
		];

		const resolver = new KeybindingResolver(items, [], () => { });

		const testKey = (commandId: string, expectedKeys: number[] | number[][]) => {
			// Test lookup
			const lookupResult = resolver.lookupKeybindings(commandId);
			assert.strictEqual(lookupResult.length, expectedKeys.length, 'Length mismatch @ commandId ' + commandId);
			for (let i = 0, len = lookupResult.length; i < len; i++) {
				const expected = createUSLayoutResolvedKeybinding(expectedKeys[i], OS)!;

				assert.strictEqual(lookupResult[i].resolvedKeybinding!.getUserSettingsLabel(), expected.getUserSettingsLabel(), 'value mismatch @ commandId ' + commandId);
			}
		};

		const testResolve = (ctx: IContext, _expectedKey: number | number[], commandId: string) => {
			const expectedKeybinding = decodeKeybinding(_expectedKey, OS)!;

			let previousChord: string[] | null = null;
			for (let i = 0, len = expectedKeybinding.chords.length; i < len; i++) {
				const chord = getDispatchStr(<KeyCodeChord>expectedKeybinding.chords[i]);
				const result = resolver.resolve(ctx, previousChord, chord);
				if (i === len - 1) {
					// if it's the final chord, then we should find a valid command,
					// and there should not be a chord.
					assert.ok(result !== null, `Enters multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.commands[0].command, commandId, `Enters multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.enterMultiChord, false, `Enters multi chord for ${commandId} at chord ${i}`);
				} else if (i > 0) {
					// if this is an intermediate chord, we should not find a valid command,
					// and there should be an open chord we continue.
					assert.ok(result !== null, `Continues multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.commandId, null, `Continues multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.enterMultiChord, false, `Is already in multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.leaveMultiChord, false, `Does not leave multi chord for ${commandId} at chord ${i}`);
				} else {
					// if it's not the final chord and not an intermediate, then we should not
					// find a valid command, and we should enter a chord.
					assert.ok(result !== null, `Enters multi chord for ${commandId} at chord ${i}`);
					assert.deepStrictEqual(result!.commands, [], `Enters multi chord for ${commandId} at chord ${i}`);
					assert.strictEqual(result!.enterMultiChord, true, `Enters multi chord for ${commandId} at chord ${i}`);
				}
				if (previousChord === null) {
					previousChord = [];
				}
				previousChord.push(chord);
			}
		};

		testKey('first', []);

		testKey('second', [KeyCode.KeyZ, KeyCode.KeyX]);
		testResolve(createContext({ key2: true }), KeyCode.KeyX, 'second');
		testResolve(createContext({}), KeyCode.KeyZ, 'second');

		testKey('third', [KeyCode.KeyX]);
		testResolve(createContext({ key3: true }), KeyCode.KeyX, 'third');

		testKey('fourth', []);

		testKey('fifth', [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyY, KeyCode.KeyZ)]);
		testResolve(createContext({}), KeyChord(KeyMod.CtrlCmd | KeyCode.KeyY, KeyCode.KeyZ), 'fifth');

		testKey('seventh', [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyK)]);
		testResolve(createContext({}), KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyK), 'seventh');

		testKey('uncomment lines', [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU)]);
		testResolve(createContext({}), KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU), 'uncomment lines');

		testKey('comment lines', [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyC)]);
		testResolve(createContext({}), KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyC), 'comment lines');

		testKey('unreachablechord', []);

		testKey('eleven', [KeyMod.CtrlCmd | KeyCode.KeyG]);
		testResolve(createContext({}), KeyMod.CtrlCmd | KeyCode.KeyG, 'eleven');

		testKey('sixth', []);

		testKey('long multi chord', [[KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyA, KeyCode.KeyB]]);
		testResolve(createContext({}), [KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyA, KeyCode.KeyB], 'long multi chord');
	});
});
