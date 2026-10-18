/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parse, parseFrontMatter, parseCommaSeparatedList, YamlNode, YamlScalarNode, YamlMapNode, YamlSequenceNode, YamlParseError } from '../../common/yaml.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';


function assertValidParse(input: string[], expected: YamlNode, expectedErrors: YamlParseError[], options?: ParseOptions): void {
	const errors: YamlParseError[] = [];
	const text = input.join('\n');
	const actual1 = parse(text, errors, options);
	deepStrictEqual(actual1, expected);
	deepStrictEqual(errors, expectedErrors);
}

function pos(line: number, character: number): Position {
	return { line, character };
}

suite('YAML Parser', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('scalars', () => {

		test('numbers', () => {
			assertValidParse(['1'], { type: 'number', start: pos(0, 0), end: pos(0, 1), value: 1 }, []);
			assertValidParse(['1.234'], { type: 'number', start: pos(0, 0), end: pos(0, 5), value: 1.234 }, []);
			assertValidParse(['-42'], { type: 'number', start: pos(0, 0), end: pos(0, 3), value: -42 }, []);
		});

		test('boolean', () => {
			assertValidParse(['true'], { type: 'boolean', start: pos(0, 0), end: pos(0, 4), value: true }, []);
			assertValidParse(['false'], { type: 'boolean', start: pos(0, 0), end: pos(0, 5), value: false }, []);
		});

		test('null', () => {
			assertValidParse(['null'], { type: 'null', start: pos(0, 0), end: pos(0, 4), value: null }, []);
			assertValidParse(['~'], { type: 'null', start: pos(0, 0), end: pos(0, 1), value: null }, []);
		});

		test('string', () => {
			assertValidParse(['A Developer'], { type: 'string', start: pos(0, 0), end: pos(0, 11), value: 'A Developer' }, []);
			assertValidParse(['\'A Developer\''], { type: 'string', start: pos(0, 0), end: pos(0, 13), value: 'A Developer' }, []);
			assertValidParse(['"A Developer"'], { type: 'string', start: pos(0, 0), end: pos(0, 13), value: 'A Developer' }, []);
			assertValidParse(['*.js,*.ts'], { type: 'string', start: pos(0, 0), end: pos(0, 9), value: '*.js,*.ts' }, []);
		});
	});

	suite('objects', () => {

		test('simple properties', () => {
			assertValidParse(['name: John Doe'], {
				type: 'object', start: pos(0, 0), end: pos(0, 14), properties: [
					{
						key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
						value: { type: 'string', start: pos(0, 6), end: pos(0, 14), value: 'John Doe' }
					}
				]
			}, []);
			assertValidParse(['age: 30'], {
				type: 'object', start: pos(0, 0), end: pos(0, 7), properties: [
					{
						key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'age' },
						value: { type: 'number', start: pos(0, 5), end: pos(0, 7), value: 30 }
					}
				]
			}, []);
			assertValidParse(['active: true'], {
				type: 'object', start: pos(0, 0), end: pos(0, 12), properties: [
					{
						key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'active' },
						value: { type: 'boolean', start: pos(0, 8), end: pos(0, 12), value: true }
					}
				]
			}, []);
			assertValidParse(['value: null'], {
				type: 'object', start: pos(0, 0), end: pos(0, 11), properties: [
					{
						key: { type: 'string', start: pos(0, 0), end: pos(0, 5), value: 'value' },
						value: { type: 'null', start: pos(0, 7), end: pos(0, 11), value: null }
					}
				]
			}, []);
		});

		test('value on next line', () => {
			assertValidParse(
				[
					'name:',
					'  John Doe',
					'colors:',
					'  [ Red, Green, Blue ]',
				],
				{
					type: 'object', start: pos(0, 0), end: pos(3, 22), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
							value: { type: 'string', start: pos(1, 2), end: pos(1, 10), value: 'John Doe' }
						},
						{
							key: { type: 'string', start: pos(2, 0), end: pos(2, 6), value: 'colors' },
							value: {
								type: 'array', start: pos(3, 2), end: pos(3, 22), items: [
									{ type: 'string', start: pos(3, 4), end: pos(3, 7), value: 'Red' },
									{ type: 'string', start: pos(3, 9), end: pos(3, 14), value: 'Green' },
									{ type: 'string', start: pos(3, 16), end: pos(3, 20), value: 'Blue' }
								]
							}
						}
					]
				},
				[]
			);
		});

		test('multiple properties', () => {
			assertValidParse(
				[
					'name: John Doe',
					'age: 30'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 7), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 14), value: 'John Doe' }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 3), value: 'age' },
							value: { type: 'number', start: pos(1, 5), end: pos(1, 7), value: 30 }
						}
					]
				},
				[]
			);
		});

		test('nested object', () => {
			assertValidParse(
				[
					'person:',
					'  name: John Doe',
					'  age: 30'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(2, 9), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'person' },
							value: {
								type: 'object', start: pos(1, 2), end: pos(2, 9), properties: [
									{
										key: { type: 'string', start: pos(1, 2), end: pos(1, 6), value: 'name' },
										value: { type: 'string', start: pos(1, 8), end: pos(1, 16), value: 'John Doe' }
									},
									{
										key: { type: 'string', start: pos(2, 2), end: pos(2, 5), value: 'age' },
										value: { type: 'number', start: pos(2, 7), end: pos(2, 9), value: 30 }
									}
								]
							}
						}
					]

				},
				[]
			);
		});


		test('nested objects with address', () => {
			assertValidParse(
				[
					'person:',
					'  name: John Doe',
					'  age: 30',
					'  address:',
					'    street: 123 Main St',
					'    city: Example City'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(5, 22), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'person' },
							value: {
								type: 'object', start: pos(1, 2), end: pos(5, 22),
								properties: [
									{
										key: { type: 'string', start: pos(1, 2), end: pos(1, 6), value: 'name' },
										value: { type: 'string', start: pos(1, 8), end: pos(1, 16), value: 'John Doe' }
									},
									{
										key: { type: 'string', start: pos(2, 2), end: pos(2, 5), value: 'age' },
										value: { type: 'number', start: pos(2, 7), end: pos(2, 9), value: 30 }
									},
									{
										key: { type: 'string', start: pos(3, 2), end: pos(3, 9), value: 'address' },
										value: {
											type: 'object', start: pos(4, 4), end: pos(5, 22), properties: [
												{
													key: { type: 'string', start: pos(4, 4), end: pos(4, 10), value: 'street' },
													value: { type: 'string', start: pos(4, 12), end: pos(4, 23), value: '123 Main St' }
												},
												{
													key: { type: 'string', start: pos(5, 4), end: pos(5, 8), value: 'city' },
													value: { type: 'string', start: pos(5, 10), end: pos(5, 22), value: 'Example City' }
												}
											]
										}
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('properties without space after colon', () => {
			assertValidParse(
				['name:John'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 9), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
							value: { type: 'string', start: pos(0, 5), end: pos(0, 9), value: 'John' }
						}
					]
				},
				[]
			);

			// Test mixed: some properties with space, some without
			assertValidParse(
				[
					'config:',
					'  database:',
					'    host:localhost',
					'    port: 5432',
					'    credentials:',
					'      username:admin',
					'      password: secret123'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(6, 25), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'config' },
							value: {
								type: 'object', start: pos(1, 2), end: pos(6, 25), properties: [
									{
										key: { type: 'string', start: pos(1, 2), end: pos(1, 10), value: 'database' },
										value: {
											type: 'object', start: pos(2, 4), end: pos(6, 25), properties: [
												{
													key: { type: 'string', start: pos(2, 4), end: pos(2, 8), value: 'host' },
													value: { type: 'string', start: pos(2, 9), end: pos(2, 18), value: 'localhost' }
												},
												{
													key: { type: 'string', start: pos(3, 4), end: pos(3, 8), value: 'port' },
													value: { type: 'number', start: pos(3, 10), end: pos(3, 14), value: 5432 }
												},
												{
													key: { type: 'string', start: pos(4, 4), end: pos(4, 15), value: 'credentials' },
													value: {
														type: 'object', start: pos(5, 6), end: pos(6, 25), properties: [
															{
																key: { type: 'string', start: pos(5, 6), end: pos(5, 14), value: 'username' },
																value: { type: 'string', start: pos(5, 15), end: pos(5, 20), value: 'admin' }
															},
															{
																key: { type: 'string', start: pos(6, 6), end: pos(6, 14), value: 'password' },
																value: { type: 'string', start: pos(6, 16), end: pos(6, 25), value: 'secret123' }
															}
														]
													}
												}
											]
										}
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('inline objects', () => {
			assertValidParse(
				['{name: John, age: 30}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 21), properties: [
						{
							key: { type: 'string', start: pos(0, 1), end: pos(0, 5), value: 'name' },
							value: { type: 'string', start: pos(0, 7), end: pos(0, 11), value: 'John' }
						},
						{
							key: { type: 'string', start: pos(0, 13), end: pos(0, 16), value: 'age' },
							value: { type: 'number', start: pos(0, 18), end: pos(0, 20), value: 30 }
						}
					]
				},
				[]
			);

			// Test with different data types
			assertValidParse(
				['{active: true, score: 85.5, role: null}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 39), properties: [
						{
							key: { type: 'string', start: pos(0, 1), end: pos(0, 7), value: 'active' },
							value: { type: 'boolean', start: pos(0, 9), end: pos(0, 13), value: true }
						},
						{
							key: { type: 'string', start: pos(0, 15), end: pos(0, 20), value: 'score' },
							value: { type: 'number', start: pos(0, 22), end: pos(0, 26), value: 85.5 }
						},
						{
							key: { type: 'string', start: pos(0, 28), end: pos(0, 32), value: 'role' },
							value: { type: 'null', start: pos(0, 34), end: pos(0, 38), value: null }
						}
					]
				},
				[]
			);

			// Test empty inline object
			assertValidParse(
				['{}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 2), properties: []
				},
				[]
			);

			// Test inline object with quoted keys and values
			assertValidParse(
				['{"name": "John Doe", "age": 30}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 31), properties: [
						{
							key: { type: 'string', start: pos(0, 1), end: pos(0, 7), value: 'name' },
							value: { type: 'string', start: pos(0, 9), end: pos(0, 19), value: 'John Doe' }
						},
						{
							key: { type: 'string', start: pos(0, 21), end: pos(0, 26), value: 'age' },
							value: { type: 'number', start: pos(0, 28), end: pos(0, 30), value: 30 }
						}
					]
				},
				[]
			);

			// Test inline object without spaces
			assertValidParse(
				['{name:John,age:30}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 18), properties: [
						{
							key: { type: 'string', start: pos(0, 1), end: pos(0, 5), value: 'name' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 10), value: 'John' }
						},
						{
							key: { type: 'string', start: pos(0, 11), end: pos(0, 14), value: 'age' },
							value: { type: 'number', start: pos(0, 15), end: pos(0, 17), value: 30 }
						}
					]
				},
				[]
			);

		test('scalar offsets are correct', () => {
			const node = parseOk('hello') as YamlScalarNode;
			assert.strictEqual(node.startOffset, 0);
			assert.strictEqual(node.endOffset, 5);
		});
	});

	suite('Block mappings', () => {
		test('simple key-value pair', () => {
			const input = 'name: John Doe';
			const node = parseOk(input);
			const map = assertMap(node, 1);
			assert.strictEqual(map.properties[0].key.value, 'name');
			assertScalar(input, map.properties[0].value, { value: 'John Doe' });
		});

		test('multiple key-value pairs', () => {
			const input = [
				'name: John Doe',
				'age: 30',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assert.strictEqual(map.properties[0].key.value, 'name');
			assertScalar(input, map.properties[0].value, { value: 'John Doe' });
			assert.strictEqual(map.properties[1].key.value, 'age');
			assertScalar(input, map.properties[1].value, { value: '30' });
		});

		test('nested mappings', () => {
			const input = [
				'name: John Doe',
				'age: 30',
				'mother:',
				'  name: Susi Doe',
				'  age: 50',
				'  address:',
				'    street: 123 Main St',
				'    city: Example City',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 3);
			assert.strictEqual(map.properties[0].key.value, 'name');
			assert.strictEqual(map.properties[2].key.value, 'mother');
			const mother = assertMap(map.properties[2].value, 3);
			assert.strictEqual(mother.properties[0].key.value, 'name');
			assertScalar(input, mother.properties[0].value, { value: 'Susi Doe' });
			const address = assertMap(mother.properties[2].value, 2);
			assert.strictEqual(address.properties[0].key.value, 'street');
			assertScalar(input, address.properties[0].value, { value: '123 Main St' });
		});

		test('mapping with quoted keys and values', () => {
			const input = [
				'"name": \'John Doe\'',
				'\'age\': "30"',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assert.strictEqual(map.properties[0].key.format, 'double');
			assert.strictEqual((map.properties[0].value as YamlScalarNode).format, 'single');
		});

		test('mapping offsets', () => {
			const input = 'name: John';
			const node = parseOk(input) as YamlMapNode;
			assert.strictEqual(node.startOffset, 0);
			assert.strictEqual(node.endOffset, 10);
		});
	});

	suite('Block sequences', () => {
		test('simple sequence', () => {
			const input = [
				'- Apple',
				'- Banana',
				'- Cherry',
			].join('\n');
			const node = parseOk(input);
			const seq = assertSequence(node, 3);
			assertScalar(input, seq.items[0], { value: 'Apple' });
			assertScalar(input, seq.items[1], { value: 'Banana' });
			assertScalar(input, seq.items[2], { value: 'Cherry' });
		});

		// Spec Example 2.4. Sequence of Mappings (229Q)
		test('spec 2.4 - sequence of mappings (229Q)', () => {
			const input = [
				'-',
				'  name: Mark McGwire',
				'  hr:   65',
				'  avg:  0.278',
				'-',
				'  name: Sammy Sosa',
				'  hr:   63',
				'  avg:  0.288',
			].join('\n');
			const node = parseOk(input);
			const seq = assertSequence(node, 2);

			const first = assertMap(seq.items[0], 3);
			assert.strictEqual(first.properties[0].key.value, 'name');
			assertScalar(input, first.properties[0].value, { value: 'Mark McGwire' });
			assert.strictEqual(first.properties[1].key.value, 'hr');
			assertScalar(input, first.properties[1].value, { value: '65' });
			assert.strictEqual(first.properties[2].key.value, 'avg');
			assertScalar(input, first.properties[2].value, { value: '0.278' });

			const second = assertMap(seq.items[1], 3);
			assert.strictEqual(second.properties[0].key.value, 'name');
			assertScalar(input, second.properties[0].value, { value: 'Sammy Sosa' });
			assert.strictEqual(second.properties[1].key.value, 'hr');
			assertScalar(input, second.properties[1].value, { value: '63' });
			assert.strictEqual(second.properties[2].key.value, 'avg');
			assertScalar(input, second.properties[2].value, { value: '0.288' });
		});

		test('sequence of mappings', () => {
			const input = [
				'-',
				'  name: Mark McGwire',
				'  hr:   65',
				'  avg:  0.278',
				'-',
				'  name: Sammy Sosa',
				'  hr:   63',
				'  avg:  0.288',
			].join('\n');
			const node = parseOk(input);
			const seq = assertSequence(node, 2);
			const first = assertMap(seq.items[0], 3);
			assertScalar(input, first.properties[0].value, { value: 'Mark McGwire' });
			const second = assertMap(seq.items[1], 3);
			assertScalar(input, second.properties[0].value, { value: 'Sammy Sosa' });
		});

		test('map of sequences', () => {
			const input = [
				'american:',
				'  - Boston Red Sox',
				'  - Detroit Tigers',
				'  - New York Yankees',
				'national:',
				'  - New York Mets',
				'  - Chicago Cubs',
				'  - Atlanta Braves',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);
			const american = assertSequence(map.properties[0].value, 3);
			assertScalar(input, american.items[0], { value: 'Boston Red Sox' });
			const national = assertSequence(map.properties[1].value, 3);
			assertScalar(input, national.items[2], { value: 'Atlanta Braves' });
		});

		test('inline mapping after dash', () => {
			const input = [
				'- name: Mark McGwire',
				'  hr: 65',
				'- name: Sammy Sosa',
				'  hr: 63',
			].join('\n');
			const node = parseOk(input);
			const seq = assertSequence(node, 2);
			const first = assertMap(seq.items[0], 2);
			assertScalar(input, first.properties[0].value, { value: 'Mark McGwire' });
		});
	});

	suite('Flow mappings', () => {
		test('simple flow mapping', () => {
			const input = '{hr: 65, avg: 0.278}';
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assert.strictEqual(map.properties[0].key.value, 'hr');
			assertScalar(input, map.properties[0].value, { value: '65' });
			assert.strictEqual(map.properties[1].key.value, 'avg');
			assertScalar(input, map.properties[1].value, { value: '0.278' });
		});

		test('flow mapping offsets', () => {
			const input = '{hr: 65}';
			const node = parseOk(input) as YamlMapNode;
			assert.strictEqual(node.startOffset, 0);
			assert.strictEqual(node.endOffset, 8);
		});
	});

	suite('Flow sequences', () => {
		test('simple flow sequence', () => {
			const input = '[Sammy Sosa  , 63, 0.288]';
			const node = parseOk(input);
			const seq = assertSequence(node, 3);
			assertScalar(input, seq.items[0], { value: 'Sammy Sosa' });
			assertScalar(input, seq.items[1], { value: '63' });
			assertScalar(input, seq.items[2], { value: '0.288' });
		});

		test('flow sequence with quoted strings', () => {
			const input = `[ 'Sammy Sosa', 63, 0.288]`;
			const node = parseOk(input);
			const seq = assertSequence(node, 3);
			assertScalar(input, seq.items[0], { value: 'Sammy Sosa', format: 'single' });
		});

		test('flow sequence offsets', () => {
			const input = '[a, b]';
			const node = parseOk(input) as YamlSequenceNode;
			assert.strictEqual(node.startOffset, 0);
			assert.strictEqual(node.endOffset, 6);
		});
	});

	suite('Mixed structures', () => {
		test('object with scalars, arrays, inline objects and arrays', () => {
			const input = [
				'object:',
				'    street: 123 Main St',
				'    city: "Example City"',
				'array:',
				'  - Boston Red Sox',
				`  - 'Detroit Tigers'`,
				'inline object: {hr: 65, avg: 0.278}',
				`inline array: [ 'Sammy Sosa', 63, 0.288]`,
				'bool: false',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 5);

			// Nested object
			const obj = assertMap(map.properties[0].value, 2);
			assertScalar(input, obj.properties[0].value, { value: '123 Main St' });
			assertScalar(input, obj.properties[1].value, { value: 'Example City', format: 'double' });

			// Array
			const arr = assertSequence(map.properties[1].value, 2);
			assertScalar(input, arr.items[0], { value: 'Boston Red Sox' });
			assertScalar(input, arr.items[1], { value: 'Detroit Tigers', format: 'single' });

			// Inline object
			const inlineObj = assertMap(map.properties[2].value, 2);
			assertScalar(input, inlineObj.properties[0].value, { value: '65' });

			// Inline array
			const inlineArr = assertSequence(map.properties[3].value, 3);
			assertScalar(input, inlineArr.items[0], { value: 'Sammy Sosa', format: 'single' });

			// Boolean as scalar
			assertScalar(input, map.properties[4].value, { value: 'false' });
		});

		test('arrays of inline arrays', () => {
			const input = [
				'- [name        , hr, avg  ]',
				'- [Mark McGwire, 65, 0.278]',
				'- [Sammy Sosa  , 63, 0.288]',
			].join('\n');
			const node = parseOk(input);
			const seq = assertSequence(node, 3);

			const header = assertSequence(seq.items[0], 3);
			assertScalar(input, header.items[0], { value: 'name' });
			assertScalar(input, header.items[1], { value: 'hr' });
			assertScalar(input, header.items[2], { value: 'avg' });

			const row1 = assertSequence(seq.items[1], 3);
			assertScalar(input, row1.items[0], { value: 'Mark McGwire' });
		});
	});

	suite('Comments', () => {
		test('comment-only lines are ignored', () => {
			const input = [
				'# This is a comment',
				'name: John',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 1);
			assert.strictEqual(map.properties[0].key.value, 'name');
		});

		test('inline comment after value', () => {
			const input = [
				'hr: # 1998 hr ranking',
				'  - Mark McGwire',
				'  - Sammy Sosa',
				'rbi:',
				'  # 1998 rbi ranking',
				'  - Sammy Sosa',
				'  - Ken Griffey#part of the value, not a comment',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);

			const hr = assertSequence(map.properties[0].value, 2);
			assertScalar(input, hr.items[0], { value: 'Mark McGwire' });

			const rbi = assertSequence(map.properties[1].value, 2);
			// '#' without leading space is part of the value
			assertScalar(input, rbi.items[1], { value: 'Ken Griffey#part of the value, not a comment' });
		});
	});

	suite('Error handling', () => {
		test('missing value emits error and creates empty scalar', () => {
			const errors: YamlParseError[] = [];
			const input = [
				'name:',
				'age: 30',
			].join('\n');
			const node = parse(input, errors);
			const map = assertMap(node, 2);
			assertScalar(input, map.properties[0].value, { value: '' });
			assert.ok(errors.some(e => e.code === 'missing-value'));
		});

		test('duplicate keys emit errors', () => {
			const errors: YamlParseError[] = [];
			const input = [
				'name: John',
				'name: Jane',
			].join('\n');
			const node = parse(input, errors);
			assertMap(node, 2);
			assert.ok(errors.some(e => e.code === 'duplicate-key'));
		});

		test('duplicate keys allowed with option', () => {
			const errors: YamlParseError[] = [];
			const input = [
				'name: John',
				'name: Jane',
			].join('\n');
			const node = parse(input, errors, { allowDuplicateKeys: true });
			assertMap(node, 2);
			assert.strictEqual(errors.length, 0);
		});

		test('wrong indentation emits error but still parses', () => {
			const errors: YamlParseError[] = [];
			const input = [
				'parent:',
				'  child1: a',
				'    child2: b',
			].join('\n');
			const node = parse(input, errors);
			assert.ok(node);
			// Should have produced an indentation error
			assert.ok(errors.some(e => e.code === 'unexpected-indentation'));
		});
	});

	suite('Offset tracking', () => {
		test('scalar offsets in mapping', () => {
			const input = 'key: value';
			const map = parseOk(input) as YamlMapNode;
			assert.strictEqual(map.properties[0].key.startOffset, 0);
			assert.strictEqual(map.properties[0].key.endOffset, 3);
			const val = map.properties[0].value as YamlScalarNode;
			assert.strictEqual(val.startOffset, 5);
			assert.strictEqual(val.endOffset, 10);
		});

		test('offsets are zero-based and endOffset is exclusive', () => {
			const input = '"hi"';
			const node = parseOk(input) as YamlScalarNode;
			assert.strictEqual(node.startOffset, 0);
			assert.strictEqual(node.endOffset, 4);
			assert.strictEqual(node.value, 'hi');
			assert.strictEqual(node.rawValue, '"hi"');
		});

		test('sequence item offsets', () => {
			const input = [
				'- a',
				'- b',
			].join('\n');
			const seq = parseOk(input) as YamlSequenceNode;
			const first = seq.items[0] as YamlScalarNode;
			assert.strictEqual(first.startOffset, 2);
			assert.strictEqual(first.endOffset, 3);
		});
	});

	suite('Nested sequences', () => {
		test('block sequence in block sequence (dash-dash)', () => {
			const input = [
				'- - s1_i1',
				'  - s1_i2',
				'- s2',
			].join('\n');
			const outer = assertSequence(parseOk(input), 2);
			const inner = assertSequence(outer.items[0], 2);
			assertScalar(input, inner.items[0], { value: 's1_i1' });
			assertScalar(input, inner.items[1], { value: 's1_i2' });
			assertScalar(input, outer.items[1], { value: 's2' });
		});

		test('sequence at same indent as parent mapping key', () => {
			const input = [
				'one:',
				'- 2',
				'- 3',
				'four: 5',
			].join('\n');
			const map = assertMap(parseOk(input), 2);
			assertScalar(input, map.properties[0].key, { value: 'one' });
			const seq = assertSequence(map.properties[0].value, 2);
			assertScalar(input, seq.items[0], { value: '2' });
			assertScalar(input, seq.items[1], { value: '3' });
			assertScalar(input, map.properties[1].key, { value: 'four' });
			assertScalar(input, map.properties[1].value, { value: '5' });
		});

		test('sequence indented under mapping key', () => {
			const input = [
				'foo:',
				'  - 42',
				'bar:',
				'  - 44',
			].join('\n');
			const map = assertMap(parseOk(input), 2);
			const seq1 = assertSequence(map.properties[0].value, 1);
			assertScalar(input, seq1.items[0], { value: '42' });
			const seq2 = assertSequence(map.properties[1].value, 1);
			assertScalar(input, seq2.items[0], { value: '44' });
		});
	});

	suite('Multiline plain scalars', () => {
		test('multiline scalar in mapping value', () => {
			const input = [
				'a: b',
				' c',
			].join('\n');
			const map = assertMap(parseOk(input), 1);
			assertScalar(input, map.properties[0].value, { value: 'b c' });
		});

		test('multiline scalar with multiple continuation lines', () => {
			const input = [
				'plain:',
				'  This unquoted scalar',
				'  spans many lines.',
			].join('\n');
			const map = assertMap(parseOk(input), 1);
			assertScalar(input, map.properties[0].value, { value: 'This unquoted scalar spans many lines.' });
		});

		test('multiline scalar at top level', () => {
			const input = [
				'a',
				'b',
				'  c',
				'd',
			].join('\n');
			const result = parseOk(input);
			assertScalar(input, result, { value: 'a b c d' });
		});

		test('multiline scalar with empty line preserves newline', () => {
			const input = [
				'a: val1',
				' val2',
				'',
				' val3',
			].join('\n');
			const map = assertMap(parseOk(input), 1);
			// Empty line between val2 and val3 becomes \n
			assertScalar(input, map.properties[0].value, { value: 'val1 val2\nval3' });
		});

		test('multiline scalar stops at same indent as mapping', () => {
			const input = [
				'a: b',
				' c',
				'd: e',
			].join('\n');
			const map = assertMap(parseOk(input), 2);
			assertScalar(input, map.properties[0].value, { value: 'b c' });
			assertScalar(input, map.properties[1].value, { value: 'e' });
		});

		test('multiline scalar value on next line', () => {
			const input = [
				'a:',
				'  b',
				'  c',
			].join('\n');
			const map = assertMap(parseOk(input), 1);
			assertScalar(input, map.properties[0].value, { value: 'b c' });
		});

		test('multiline scalar stops at comment', () => {
			const input = [
				'value1',
				'# a comment',
				'value2',
			].join('\n');
			// Comment terminates the scalar continuation, so value2 is not part of value1
			const result = parseOk(input);
			assertScalar(input, result, { value: 'value1' });
		});

		test('multiline scalar with multiple mappings', () => {
			const input = [
				'a: b',
				' c',
				'd:',
				' e',
				'  f',
			].join('\n');
			const map = assertMap(parseOk(input), 2);
			assertScalar(input, map.properties[0].value, { value: 'b c' });
			assertScalar(input, map.properties[1].value, { value: 'e f' });
		});
	});

	suite('Edge cases', () => {
		test('colon in unquoted value', () => {
			const input = 'url: http://example.com';
			const map = parseOk(input) as YamlMapNode;
			assertScalar(input, map.properties[0].value, { value: 'http://example.com' });
		});

		test('trailing whitespace is trimmed from unquoted scalars', () => {
			const input = 'name: John   ';
			const map = parseOk(input) as YamlMapNode;
			assertScalar(input, map.properties[0].value, { value: 'John' });
		});

		test('empty flow map', () => {
			const node = parseOk('{}');
			const map = assertMap(node, 0);
			assert.strictEqual(map.startOffset, 0);
			assert.strictEqual(map.endOffset, 2);
		});

		test('empty flow sequence', () => {
			const node = parseOk('[]');
			const seq = assertSequence(node, 0);
			assert.strictEqual(seq.startOffset, 0);
			assert.strictEqual(seq.endOffset, 2);
		});

		test('CRLF line endings', () => {
			const input = 'name: John\r\nage: 30';
			const map = parseOk(input) as YamlMapNode;
			assertMap(map, 2);
			assertScalar(input, map.properties[0].value, { value: 'John' });
			assertScalar(input, map.properties[1].value, { value: '30' });
		});

		test('multiple --- document separators: only first document is parsed', () => {
			const input = [
				'---',
				'key1: value1',
				'key2: value2',
				'---',
				'key3: value3',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assertScalar(input, map.properties[0].key, { value: 'key1' });
			assertScalar(input, map.properties[0].value, { value: 'value1' });
			assertScalar(input, map.properties[1].key, { value: 'key2' });
			assertScalar(input, map.properties[1].value, { value: 'value2' });
		});
	});

	suite('Old test suite', () => {

		test('mapping value on next line', () => {
			const input = [
				'name:',
				'  John Doe',
				'colors:',
				'  [ Red, Green, Blue ]',
			].join('\n');
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assertScalar(input, map.properties[0].value, { value: 'John Doe' });
			const colors = assertSequence(map.properties[1].value, 3);
			assertScalar(input, colors.items[0], { value: 'Red' });
			assertScalar(input, colors.items[1], { value: 'Green' });
			assertScalar(input, colors.items[2], { value: 'Blue' });
		});

		test('flow map with different data types', () => {
			const input = '{active: true, score: 85.5, role: null}';
			const node = parseOk(input);
			const map = assertMap(node, 3);
			assertScalar(input, map.properties[0].key, { value: 'active' });
			assertScalar(input, map.properties[0].value, { value: 'true' });
			assertScalar(input, map.properties[1].key, { value: 'score' });
			assertScalar(input, map.properties[1].value, { value: '85.5' });
			assertScalar(input, map.properties[2].key, { value: 'role' });
			assertScalar(input, map.properties[2].value, { value: 'null' });
		});

		test('flow map with quoted keys and values', () => {
			const input = '{"name": "John Doe", "age": 30}';
			const node = parseOk(input);
			const map = assertMap(node, 2);
			assertScalar(input, map.properties[0].key, { value: 'name', format: 'double' });
			assertScalar(input, map.properties[0].value, { value: 'John Doe', format: 'double' });
			assertScalar(input, map.properties[1].key, { value: 'age', format: 'double' });
			assertScalar(input, map.properties[1].value, { value: '30' });
		});

		test('special characters in values', () => {
			// Test values with special characters
			assertValidParse(
				[`key: value with \t special chars`],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 31), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'string', start: pos(0, 5), end: pos(0, 31), value: `value with \t special chars` }
						}
					]
				},
				[]
			);
		});

		test('various whitespace types', () => {
			// Test different types of whitespace
			assertValidParse(
				[`key:\t \t \t value`],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 15), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'string', start: pos(0, 10), end: pos(0, 15), value: 'value' }
						}
					]
				},
				[]
			);
		});
	});

	suite('arrays', () => {


		test('arrays', () => {
			assertValidParse(
				[
					'- Boston Red Sox',
					'- Detroit Tigers',
					'- New York Yankees'
				],
				{
					type: 'array', start: pos(0, 0), end: pos(2, 18), items: [
						{ type: 'string', start: pos(0, 2), end: pos(0, 16), value: 'Boston Red Sox' },
						{ type: 'string', start: pos(1, 2), end: pos(1, 16), value: 'Detroit Tigers' },
						{ type: 'string', start: pos(2, 2), end: pos(2, 18), value: 'New York Yankees' }
					]

				},
				[]
			);
		});


		test('inline arrays', () => {
			assertValidParse(
				['[Apple, Banana, Cherry]'],
				{
					type: 'array', start: pos(0, 0), end: pos(0, 23), items: [
						{ type: 'string', start: pos(0, 1), end: pos(0, 6), value: 'Apple' },
						{ type: 'string', start: pos(0, 8), end: pos(0, 14), value: 'Banana' },
						{ type: 'string', start: pos(0, 16), end: pos(0, 22), value: 'Cherry' }
					]

				},
				[]
			);
		});

		test('inline array with internal comment line', () => {
			assertValidParse(
				['[one # comment about two', ',two, three]'],
				{
					type: 'array', start: pos(0, 0), end: pos(1, 12), items: [
						{ type: 'string', start: pos(0, 1), end: pos(0, 4), value: 'one' },
						{ type: 'string', start: pos(1, 1), end: pos(1, 4), value: 'two' },
						{ type: 'string', start: pos(1, 6), end: pos(1, 11), value: 'three' }
					]
				},
				[]
			);
		});

		test('multi-line inline arrays', () => {
			assertValidParse(
				[
					'[',
					'    geen, ',
					'    yello, red]'
				],
				{
					type: 'array', start: pos(0, 0), end: pos(2, 15), items: [
						{ type: 'string', start: pos(1, 4), end: pos(1, 8), value: 'geen' },
						{ type: 'string', start: pos(2, 4), end: pos(2, 9), value: 'yello' },
						{ type: 'string', start: pos(2, 11), end: pos(2, 14), value: 'red' }
					]
				},
				[]
			);
		});

		test('arrays of arrays', () => {
			assertValidParse(
				[
					'-',
					'  - Apple',
					'  - Banana',
					'  - Cherry'
				],
				{
					type: 'array', start: pos(0, 0), end: pos(3, 10), items: [
						{
							type: 'array', start: pos(1, 2), end: pos(3, 10), items: [
								{ type: 'string', start: pos(1, 4), end: pos(1, 9), value: 'Apple' },
								{ type: 'string', start: pos(2, 4), end: pos(2, 10), value: 'Banana' },
								{ type: 'string', start: pos(3, 4), end: pos(3, 10), value: 'Cherry' }
							]
						}
					]
				},
				[]
			);
		});

		test('inline arrays of inline arrays', () => {
			assertValidParse(
				[
					'[',
					'  [ee], [ff, gg]',
					']',
				],
				{
					type: 'array', start: pos(0, 0), end: pos(2, 1), items: [
						{
							type: 'array', start: pos(1, 2), end: pos(1, 6), items: [
								{ type: 'string', start: pos(1, 3), end: pos(1, 5), value: 'ee' },
							],
						},
						{
							type: 'array', start: pos(1, 8), end: pos(1, 16), items: [
								{ type: 'string', start: pos(1, 9), end: pos(1, 11), value: 'ff' },
								{ type: 'string', start: pos(1, 13), end: pos(1, 15), value: 'gg' },
							],
						}
					]
				},
				[]
			);
		});

		test('object with array containing single object', () => {
			assertValidParse(
				[
					'items:',
					'- name: John',
					'  age: 30'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(2, 9), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 5), value: 'items' },
							value: {
								type: 'array', start: pos(1, 0), end: pos(2, 9), items: [
									{
										type: 'object', start: pos(1, 2), end: pos(2, 9), properties: [
											{
												key: { type: 'string', start: pos(1, 2), end: pos(1, 6), value: 'name' },
												value: { type: 'string', start: pos(1, 8), end: pos(1, 12), value: 'John' }
											},
											{
												key: { type: 'string', start: pos(2, 2), end: pos(2, 5), value: 'age' },
												value: { type: 'number', start: pos(2, 7), end: pos(2, 9), value: 30 }
											}
										]
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('arrays of objects', () => {
			assertValidParse(
				[
					'-',
					'  name: one',
					'- name: two',
					'-',
					'  name: three'
				],
				{
					type: 'array', start: pos(0, 0), end: pos(4, 13), items: [
						{
							type: 'object', start: pos(1, 2), end: pos(1, 11), properties: [
								{
									key: { type: 'string', start: pos(1, 2), end: pos(1, 6), value: 'name' },
									value: { type: 'string', start: pos(1, 8), end: pos(1, 11), value: 'one' }
								}
							]
						},
						{
							type: 'object', start: pos(2, 2), end: pos(2, 11), properties: [
								{
									key: { type: 'string', start: pos(2, 2), end: pos(2, 6), value: 'name' },
									value: { type: 'string', start: pos(2, 8), end: pos(2, 11), value: 'two' }
								}
							]
						},
						{
							type: 'object', start: pos(4, 2), end: pos(4, 13), properties: [
								{
									key: { type: 'string', start: pos(4, 2), end: pos(4, 6), value: 'name' },
									value: { type: 'string', start: pos(4, 8), end: pos(4, 13), value: 'three' }
								}
							]
						}
					]
				},
				[]
			);
		});
	});

	suite('complex structures', () => {

		test('array of objects', () => {
			assertValidParse(
				[
					'products:',
					'  - name: Laptop',
					'    price: 999.99',
					'    in_stock: true',
					'  - name: Mouse',
					'    price: 25.50',
					'    in_stock: false'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(6, 19), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 8), value: 'products' },
							value: {
								type: 'array', start: pos(1, 2), end: pos(6, 19), items: [
									{
										type: 'object', start: pos(1, 4), end: pos(3, 18), properties: [
											{
												key: { type: 'string', start: pos(1, 4), end: pos(1, 8), value: 'name' },
												value: { type: 'string', start: pos(1, 10), end: pos(1, 16), value: 'Laptop' }
											},
											{
												key: { type: 'string', start: pos(2, 4), end: pos(2, 9), value: 'price' },
												value: { type: 'number', start: pos(2, 11), end: pos(2, 17), value: 999.99 }
											},
											{
												key: { type: 'string', start: pos(3, 4), end: pos(3, 12), value: 'in_stock' },
												value: { type: 'boolean', start: pos(3, 14), end: pos(3, 18), value: true }
											}
										]
									},
									{
										type: 'object', start: pos(4, 4), end: pos(6, 19), properties: [
											{
												key: { type: 'string', start: pos(4, 4), end: pos(4, 8), value: 'name' },
												value: { type: 'string', start: pos(4, 10), end: pos(4, 15), value: 'Mouse' }
											},
											{
												key: { type: 'string', start: pos(5, 4), end: pos(5, 9), value: 'price' },
												value: { type: 'number', start: pos(5, 11), end: pos(5, 16), value: 25.50 }
											},
											{
												key: { type: 'string', start: pos(6, 4), end: pos(6, 12), value: 'in_stock' },
												value: { type: 'boolean', start: pos(6, 14), end: pos(6, 19), value: false }
											}
										]
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('inline array mixed primitives', () => {
			assertValidParse(
				['vals: [1, true, null, "str"]'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 28), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'vals' },
							value: {
								type: 'array', start: pos(0, 6), end: pos(0, 28), items: [
									{ type: 'number', start: pos(0, 7), end: pos(0, 8), value: 1 },
									{ type: 'boolean', start: pos(0, 10), end: pos(0, 14), value: true },
									{ type: 'null', start: pos(0, 16), end: pos(0, 20), value: null },
									{ type: 'string', start: pos(0, 22), end: pos(0, 27), value: 'str' }
								]
							}
						}
					]
				},
				[]
			);
		});

		test('mixed inline structures', () => {
			assertValidParse(
				['config: {env: "prod", settings: [true, 42], debug: false}'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 57), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'config' },
							value: {
								type: 'object', start: pos(0, 8), end: pos(0, 57), properties: [
									{
										key: { type: 'string', start: pos(0, 9), end: pos(0, 12), value: 'env' },
										value: { type: 'string', start: pos(0, 14), end: pos(0, 20), value: 'prod' }
									},
									{
										key: { type: 'string', start: pos(0, 22), end: pos(0, 30), value: 'settings' },
										value: {
											type: 'array', start: pos(0, 32), end: pos(0, 42), items: [
												{ type: 'boolean', start: pos(0, 33), end: pos(0, 37), value: true },
												{ type: 'number', start: pos(0, 39), end: pos(0, 41), value: 42 }
											]
										}
									},
									{
										key: { type: 'string', start: pos(0, 44), end: pos(0, 49), value: 'debug' },
										value: { type: 'boolean', start: pos(0, 51), end: pos(0, 56), value: false }
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('with comments', () => {
			assertValidParse(
				[
					`# This is a comment`,
					'name: John Doe  # inline comment',
					'age: 30'
				],
				{
					type: 'object', start: pos(1, 0), end: pos(2, 7), properties: [
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 4), value: 'name' },
							value: { type: 'string', start: pos(1, 6), end: pos(1, 14), value: 'John Doe' }
						},
						{
							key: { type: 'string', start: pos(2, 0), end: pos(2, 3), value: 'age' },
							value: { type: 'number', start: pos(2, 5), end: pos(2, 7), value: 30 }
						}
					]
				},
				[]
			);
		});
	});

	suite('edge cases and error handling', () => {


		// Edge cases
		test('duplicate keys error', () => {
			assertValidParse(
				[
					'key: 1',
					'key: 2'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 6), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'number', start: pos(0, 5), end: pos(0, 6), value: 1 }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 3), value: 'key' },
							value: { type: 'number', start: pos(1, 5), end: pos(1, 6), value: 2 }
						}
					]
				},
				[
					{
						message: 'Duplicate key \'key\'',
						code: 'duplicateKey',
						start: pos(1, 0),
						end: pos(1, 3)
					}
				]
			);
		});

		test('duplicate keys allowed with option', () => {
			assertValidParse(
				[
					'key: 1',
					'key: 2'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 6), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'number', start: pos(0, 5), end: pos(0, 6), value: 1 }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 3), value: 'key' },
							value: { type: 'number', start: pos(1, 5), end: pos(1, 6), value: 2 }
						}
					]
				},
				[],
				{ allowDuplicateKeys: true }
			);
		});

		test('unexpected indentation error with recovery', () => {
			// Parser reports error but still captures the over-indented property.
			assertValidParse(
				[
					'key: 1',
					'    stray: value'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 16), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'number', start: pos(0, 5), end: pos(0, 6), value: 1 }
						},
						{
							key: { type: 'string', start: pos(1, 4), end: pos(1, 9), value: 'stray' },
							value: { type: 'string', start: pos(1, 11), end: pos(1, 16), value: 'value' }
						}
					]
				},
				[
					{
						message: 'Unexpected indentation',
						code: 'indentation',
						start: pos(1, 0),
						end: pos(1, 16)
					}
				]
			);
		});

		test('empty values and inline empty array', () => {
			assertValidParse(
				[
					'empty:',
					'array: []'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 9), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 5), value: 'empty' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 6), value: '' }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 5), value: 'array' },
							value: { type: 'array', start: pos(1, 7), end: pos(1, 9), items: [] }
						}
					]
				},
				[]
			);
		});



		test('nested empty objects', () => {
			// Parser should create nodes for both parent and child, with child having empty string value.
			assertValidParse(
				[
					'parent:',
					'  child:'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 8), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 6), value: 'parent' },
							value: {
								type: 'object', start: pos(1, 2), end: pos(1, 8), properties: [
									{
										key: { type: 'string', start: pos(1, 2), end: pos(1, 7), value: 'child' },
										value: { type: 'string', start: pos(1, 8), end: pos(1, 8), value: '' }
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('empty object with only colons', () => {
			// Test object with empty values
			assertValidParse(
				['key1:', 'key2:', 'key3:'],
				{
					type: 'object', start: pos(0, 0), end: pos(2, 5), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'key1' },
							value: { type: 'string', start: pos(0, 5), end: pos(0, 5), value: '' }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 4), value: 'key2' },
							value: { type: 'string', start: pos(1, 5), end: pos(1, 5), value: '' }
						},
						{
							key: { type: 'string', start: pos(2, 0), end: pos(2, 4), value: 'key3' },
							value: { type: 'string', start: pos(2, 5), end: pos(2, 5), value: '' }
						}
					]
				},
				[]
			);
		});

		test('large input performance', () => {
			// Test that large inputs are handled efficiently
			const input = Array.from({ length: 1000 }, (_, i) => `key${i}: value${i}`);
			const expectedProperties = Array.from({ length: 1000 }, (_, i) => ({
				key: { type: 'string' as const, start: pos(i, 0), end: pos(i, `key${i}`.length), value: `key${i}` },
				value: { type: 'string' as const, start: pos(i, `key${i}: `.length), end: pos(i, `key${i}: value${i}`.length), value: `value${i}` }
			}));

			const start = Date.now();
			assertValidParse(
				input,
				{
					type: 'object',
					start: pos(0, 0),
					end: pos(999, 'key999: value999'.length),
					properties: expectedProperties
				},
				[]
			);
			const duration = Date.now() - start;

			ok(duration < 100, `Parsing took ${duration}ms, expected < 100ms`);
		});

		test('deeply nested structure performance', () => {
			// Test that deeply nested structures are handled efficiently
			const lines = [];
			for (let i = 0; i < 50; i++) {
				const indent = '  '.repeat(i);
				lines.push(`${indent}level${i}:`);
			}
			lines.push('  '.repeat(50) + 'deepValue: reached');

			const start = Date.now();
			const errors: YamlParseError[] = [];
			const result = parse(lines.join('\n'), errors);
			const duration = Date.now() - start;

			ok(result);
			strictEqual(result.type, 'object');
			strictEqual(errors.length, 0);
			ok(duration < 100, `Parsing took ${duration}ms, expected < 100ms`);
		});

		test('malformed array with position issues', () => {
			// Test malformed arrays that might cause position advancement issues
			assertValidParse(
				[
					'key: [',
					'',
					'',
					'',
					''
				],
				{
					type: 'object', start: pos(0, 0), end: pos(5, 0), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'array', start: pos(0, 5), end: pos(5, 0), items: [] }
						}
					]
				},
				[]
			);
		});

		test('self-referential like structure', () => {
			// Test structures that might appear self-referential
			assertValidParse(
				[
					'a:',
					'  b:',
					'    a:',
					'      b:',
					'        value: test'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(4, 19), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 1), value: 'a' },
							value: {
								type: 'object', start: pos(1, 2), end: pos(4, 19), properties: [
									{
										key: { type: 'string', start: pos(1, 2), end: pos(1, 3), value: 'b' },
										value: {
											type: 'object', start: pos(2, 4), end: pos(4, 19), properties: [
												{
													key: { type: 'string', start: pos(2, 4), end: pos(2, 5), value: 'a' },
													value: {
														type: 'object', start: pos(3, 6), end: pos(4, 19), properties: [
															{
																key: { type: 'string', start: pos(3, 6), end: pos(3, 7), value: 'b' },
																value: {
																	type: 'object', start: pos(4, 8), end: pos(4, 19), properties: [
																		{
																			key: { type: 'string', start: pos(4, 8), end: pos(4, 13), value: 'value' },
																			value: { type: 'string', start: pos(4, 15), end: pos(4, 19), value: 'test' }
																		}
																	]
																}
															}
														]
													}
												}
											]
										}
									}
								]
							}
						}
					]
				},
				[]
			);
		});

		test('array with empty lines', () => {
			// Test arrays spanning multiple lines with empty lines
			assertValidParse(
				['arr: [', '', 'item1,', '', 'item2', '', ']'],
				{
					type: 'object', start: pos(0, 0), end: pos(6, 1), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'arr' },
							value: {
								type: 'array', start: pos(0, 5), end: pos(6, 1), items: [
									{ type: 'string', start: pos(2, 0), end: pos(2, 5), value: 'item1' },
									{ type: 'string', start: pos(4, 0), end: pos(4, 5), value: 'item2' }
								]
							}
						}
					]
				},
				[]
			);
		});

		test('whitespace advancement robustness', () => {
			// Test that whitespace advancement works correctly
			assertValidParse(
				[`key:      value`],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 15), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 3), value: 'key' },
							value: { type: 'string', start: pos(0, 10), end: pos(0, 15), value: 'value' }
						}
					]
				},
				[]
			);
		});


		test('missing end quote in string values', () => {
			// Test unclosed double quote - parser treats it as bare string with quote included
			assertValidParse(
				['name: "John'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 11), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 11), value: 'John' }
						}
					]
				},
				[]
			);

			// Test unclosed single quote - parser treats it as bare string with quote included
			assertValidParse(
				['description: \'Hello world'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 25), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 11), value: 'description' },
							value: { type: 'string', start: pos(0, 13), end: pos(0, 25), value: 'Hello world' }
						}
					]
				},
				[]
			);

			// Test unclosed quote in multi-line context
			assertValidParse(
				[
					'data: "incomplete',
					'next: value'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(1, 11), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'data' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 17), value: 'incomplete' }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 4), value: 'next' },
							value: { type: 'string', start: pos(1, 6), end: pos(1, 11), value: 'value' }
						}
					]
				},
				[]
			);

			// Test properly quoted strings for comparison
			assertValidParse(
				['name: "John"'],
				{
					type: 'object', start: pos(0, 0), end: pos(0, 12), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'name' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 12), value: 'John' }
						}
					]
				},
				[]
			);
		});

		test('comment in inline array #269078', () => {
			// Test malformed array with comment-like content - should not cause endless loop
			assertValidParse(
				[
					'mode: agent',
					'tools: [#r'
				],
				{
					type: 'object', start: pos(0, 0), end: pos(2, 0), properties: [
						{
							key: { type: 'string', start: pos(0, 0), end: pos(0, 4), value: 'mode' },
							value: { type: 'string', start: pos(0, 6), end: pos(0, 11), value: 'agent' }
						},
						{
							key: { type: 'string', start: pos(1, 0), end: pos(1, 5), value: 'tools' },
							value: { type: 'array', start: pos(1, 7), end: pos(2, 0), items: [] }
						}
					]
				},
				[]
			);
		});


	});

	suite('parseMarkdown', () => {

		test('no frontmatter returns undefined header and full input as body', () => {
			const input = 'Just some markdown text\nwithout frontmatter.';
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.strictEqual(result.header, undefined);
			assert.strictEqual(result.body, input);
		});

		test('empty input returns undefined header and empty body', () => {
			const result = parseFrontMatter('');
			assert.ok(result);
			assert.strictEqual(result.header, undefined);
			assert.strictEqual(result.body, '');
		});

		test('frontmatter with body', () => {
			const input = [
				'---',
				'title: Hello',
				'author: World',
				'---',
				'# Heading',
				'Body text here.',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			const map = assertMap(result.header, 2);
			assert.strictEqual((map.properties[0].value as YamlScalarNode).value, 'Hello');
			assert.strictEqual((map.properties[1].value as YamlScalarNode).value, 'World');
			assert.strictEqual(result.getStringValue('title'), 'Hello');
			assert.strictEqual(result.getStringValue('author'), 'World');
			assert.strictEqual(result.body, '# Heading\nBody text here.');
		});

		test('frontmatter only, no body', () => {
			const input = [
				'---',
				'key: value',
				'---',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			const map = assertMap(result.header, 1);
			assert.strictEqual((map.properties[0].value as YamlScalarNode).value, 'value');
			assert.strictEqual(result.getStringValue('key'), 'value');
			assert.strictEqual(result.body, '');
		});

		test('empty frontmatter strips delimiters', () => {
			const input = [
				'---',
				'---',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.strictEqual(result.header, undefined);
			assert.strictEqual(result.body, '');
		});

		test('comment-only frontmatter strips delimiters and preserves body', () => {
			const input = [
				'---',
				'# note',
				'---',
				'Body text here.',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.strictEqual(result.header, undefined);
			assert.strictEqual(result.body, 'Body text here.');
		});

		test('getStringValue returns the scalar for a known key', () => {
			const input = [
				'---',
				'name: my-agent',
				'tools: foo, bar',
				'---',
				'body content',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.strictEqual(result.getStringValue('name'), 'my-agent');
			assert.deepStrictEqual(result.getStringArrayValue('tools'), ['foo', 'bar']);
		});

		test('getStringArrayValue returns array for a sequence key', () => {
			const input = [
				'---',
				'tags:',
				'  - foo',
				'  - bar',
				'  - baz',
				'---',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.deepStrictEqual(result.getStringArrayValue('tags'), ['foo', 'bar', 'baz']);
		});

		test('getStringArrayValue splits comma-separated scalar into array', () => {
			const input = [
				'---',
				'tags: foo, bar, baz',
				'---',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.deepStrictEqual(result.getStringArrayValue('tags'), ['foo', 'bar', 'baz']);
		});

		test('getStringArrayValue wraps quoted scalars in a single-element array', () => {
			const input = [
				'---',
				'tags: "foo, bar"',
				'---',
			].join('\n');
			const result = parseFrontMatter(input);
			assert.ok(result);
			assert.deepStrictEqual(result.getStringArrayValue('tags'), ['foo, bar']);
		});

	});

	suite('parseCommaSeparatedList', () => {

		test('empty string produces empty array', () => {
			const items = parseCommaSeparatedList('');
			assert.deepStrictEqual(items, []);
		});

		test('single unquoted item', () => {
			const items = parseCommaSeparatedList('hello', 0);
			assert.strictEqual(items.length, 1);
			assert.strictEqual(items[0].value, 'hello');
			assert.strictEqual(items[0].format, 'none');
		});

		test('multiple unquoted items', () => {
			const items = parseCommaSeparatedList('foo, bar, baz');
			assert.deepStrictEqual(items.map(i => i.value), ['foo', 'bar', 'baz']);
		});

		test('double-quoted items', () => {
			// Value is: "hello", "world"  — pass it directly as a string with known offset.
			const items = parseCommaSeparatedList('"hello", "world"', 0);
			assert.strictEqual(items.length, 2);
			assert.strictEqual(items[0].value, 'hello');
			assert.strictEqual(items[0].format, 'double');
			assert.strictEqual(items[1].value, 'world');
			assert.strictEqual(items[1].format, 'double');
		});

		test('single-quoted items', () => {
			const items = parseCommaSeparatedList(`'foo', 'bar'`, 0);
			assert.strictEqual(items.length, 2);
			assert.strictEqual(items[0].value, 'foo');
			assert.strictEqual(items[0].format, 'single');
			assert.strictEqual(items[1].value, 'bar');
			assert.strictEqual(items[1].format, 'single');
		});

		test('mixed quoted and unquoted items', () => {
			const items = parseCommaSeparatedList(`plain, "double", 'single'`);
			assert.strictEqual(items.length, 3);
			assert.deepStrictEqual([items[0].value, items[0].format], ['plain', 'none']);
			assert.deepStrictEqual([items[1].value, items[1].format], ['double', 'double']);
			assert.deepStrictEqual([items[2].value, items[2].format], ['single', 'single']);
		});

		test('trailing whitespace trimmed from unquoted items', () => {
			const items = parseCommaSeparatedList('  foo  ,  bar  ');
			assert.strictEqual(items.length, 2);
			assert.strictEqual(items[0].value, 'foo');
			assert.strictEqual(items[1].value, 'bar');
		});

		test('offsets are relative to the provided offset', () => {
			const value = 'a, b, c';
			const offset = 10;
			const items = parseCommaSeparatedList(value, offset);
			assert.strictEqual(items.length, 3);
			// Each item's rawValue should appear at startOffset within `offset + value`
			const doc = ' '.repeat(offset) + value;
			for (const item of items) {
				assert.strictEqual(doc.substring(item.startOffset, item.endOffset), item.rawValue);
			}
		});

		test('whitespace-only string produces empty array', () => {
			const items = parseCommaSeparatedList('   ');
			assert.deepStrictEqual(items, []);
		});
	});
});

suite('YAML Stringify', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('primitives', () => {

		test('null and undefined', () => {
			strictEqual(stringify(null), 'null');
			strictEqual(stringify(undefined), 'null');
		});

		test('booleans', () => {
			strictEqual(stringify(true), 'true');
			strictEqual(stringify(false), 'false');
		});

		test('numbers', () => {
			strictEqual(stringify(42), '42');
			strictEqual(stringify(3.14), '3.14');
			strictEqual(stringify(-17), '-17');
			strictEqual(stringify(0), '0');
			strictEqual(stringify(Infinity), '.inf');
			strictEqual(stringify(-Infinity), '-.inf');
			strictEqual(stringify(NaN), '.nan');
		});

		test('strings', () => {
			strictEqual(stringify('hello'), 'hello');
			strictEqual(stringify(''), '""');
			strictEqual(stringify('true'), '"true"');
			strictEqual(stringify('false'), '"false"');
			strictEqual(stringify('null'), '"null"');
			strictEqual(stringify('123'), '"123"');
			strictEqual(stringify('hello world'), 'hello world');
		});

		test('strings needing quotes', () => {
			strictEqual(stringify('line1\nline2'), '"line1\\nline2"');
			strictEqual(stringify('with:colon'), '"with:colon"');
			strictEqual(stringify(' leading space'), '" leading space"');
			strictEqual(stringify('trailing space '), '"trailing space "');
			strictEqual(stringify('-dash'), '"-dash"');
		});
	});

	suite('arrays', () => {

		test('empty array', () => {
			strictEqual(stringify([]), '[]');
		});

		test('simple primitive arrays', () => {
			strictEqual(stringify(['a', 'b', 'c']), '[a, b, c]');
			strictEqual(stringify([1, 2, 3]), '[1, 2, 3]');
			strictEqual(stringify([true, false]), '[true, false]');
			strictEqual(stringify([1, 'two', true, null]), '[1, two, true, null]');
		});

		test('arrays with quoted strings', () => {
			strictEqual(stringify(['hello', 'true', '123']), '[hello, "true", "123"]');
		});
	});

	suite('objects', () => {

		test('empty object', () => {
			strictEqual(stringify({}), '{}');
		});

		test('simple object', () => {
			strictEqual(stringify({ name: 'John' }), 'name: John');
			strictEqual(stringify({ age: 30 }), 'age: 30');
			strictEqual(stringify({ active: true }), 'active: true');
		});

		test('object with multiple properties', () => {
			const result = stringify({ name: 'John', age: 30 });
			strictEqual(result, 'name: John\nage: 30');
		});

		test('object with array property', () => {
			const result = stringify({ tools: ['a', 'b', 'c'] });
			strictEqual(result, 'tools: [a, b, c]');
		});

		test('object with string that needs escaping', () => {
			const result = stringify({ description: 'line1\nline2' });
			strictEqual(result, 'description: "line1\\nline2"');
		});
	});

	suite('complex structures', () => {

		test('nested objects', () => {
			const obj = {
				person: {
					name: 'John',
					age: 30
				}
			};
			const result = stringify(obj);
			strictEqual(result, 'person:\n  name: John\n  age: 30');
		});

		test('array of objects (block style)', () => {
			const arr = [
				{ label: 'Test', agent: 'myAgent' },
				{ label: 'Another', agent: 'otherAgent' }
			];
			const result = stringify(arr);
			strictEqual(result, '- label: Test\n  agent: myAgent\n- label: Another\n  agent: otherAgent');
		});

		test('object with array of objects', () => {
			const obj = {
				handoffs: [
					{ label: 'Do task', agent: 'agent1', prompt: 'Hello' },
					{ label: 'Other', agent: 'agent2', prompt: 'World' }
				]
			};
			const result = stringify(obj);
			const expected = 'handoffs:\n  - label: Do task\n    agent: agent1\n    prompt: Hello\n  - label: Other\n    agent: agent2\n    prompt: World';
			strictEqual(result, expected);
		});
	});

	suite('roundtrip', () => {

		test('simple object roundtrip', () => {
			const obj = { name: 'John', age: 30, active: true };
			const yaml = stringify(obj);
			const errors: YamlParseError[] = [];
			const parsed = parse(yaml, errors);

			strictEqual(errors.length, 0);
			ok(parsed);
			strictEqual(parsed.type, 'object');
			if (parsed.type === 'object') {
				strictEqual(parsed.properties.length, 3);
				strictEqual(parsed.properties[0].key.value, 'name');
				strictEqual(parsed.properties[0].value.type, 'string');
				if (parsed.properties[0].value.type === 'string') {
					strictEqual(parsed.properties[0].value.value, 'John');
				}
			}
		});

		test('object with array roundtrip', () => {
			const obj = { tools: ['fetch', 'search', 'terminal'] };
			const yaml = stringify(obj);
			const errors: YamlParseError[] = [];
			const parsed = parse(yaml, errors);

			strictEqual(errors.length, 0);
			ok(parsed);
			strictEqual(parsed.type, 'object');
			if (parsed.type === 'object') {
				strictEqual(parsed.properties.length, 1);
				strictEqual(parsed.properties[0].key.value, 'tools');
				strictEqual(parsed.properties[0].value.type, 'array');
			}
		});
	});

});
