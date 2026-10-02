import { readFileSync } from 'node:fs';
const BS = String.fromCharCode(92);
const f = 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts';
const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');
const file = lines[133];
const find = '\t// [GeneralShellType.Codex, /' + BS + 'bcodex' + BS + 'bi], // codex does not report osc title.';
console.log('file :', JSON.stringify(file));
console.log('find :', JSON.stringify(find));
console.log('equal:', file === find);
for (let j = 0; j < Math.max(file.length, find.length); j++) {
	if (file[j] !== find[j]) { console.log('diff at', j, 'file:', JSON.stringify(file[j]), file.charCodeAt(0), 'find:', JSON.stringify(find[j]), find.charCodeAt(j)); break; }
}
const p = 'src/vs/platform/policy/common/copilotManagedSettings.ts';
const t2 = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
console.log('policy260:', JSON.stringify(t2[259]));
console.log('policy261:', JSON.stringify(t2[260]));
console.log('policy264:', JSON.stringify(t2[263]));
console.log('policy265:', JSON.stringify(t2[264]));
