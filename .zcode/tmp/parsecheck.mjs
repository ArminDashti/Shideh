import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('C:/Users/armin/AppData/Roaming/npm/node_modules/openclaw/node_modules/typescript/lib/typescript.js');

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
	const text = fs.readFileSync(f, 'utf8');
	const kind = f.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
	const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2020, true, kind);
	const diags = sf.parseDiagnostics || [];
	if (diags.length) {
		bad++;
		console.log(`FAIL ${f}: ${diags.length} parse errors`);
		for (const d of diags.slice(0, 5)) {
			const pos = sf.getLineAndCharacterOfPosition(d.start);
			console.log(`  ${pos.line + 1}:${pos.character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
		}
	} else {
		console.log(`OK ${f}`);
	}
}
process.exit(bad ? 1 : 0);
