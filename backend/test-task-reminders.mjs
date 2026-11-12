// Amintirile cu taskuri pentru frizeri: calculul programului zilei (cu liber/concediu scăzut), momentul și textul.
// Rulează fără server: `node test-task-reminders.mjs`.
import { build } from 'esbuild';
const out = await build({ entryPoints: ['src/taskReminders.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral', tsconfigRaw: {} });
const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const H = (h) => h * 3_600_000;
const M = (x) => x * 60_000;

// Program 10–14 și 15–20 (pauză la mijloc).
const hours = [{ s: H(10), e: H(14) }, { s: H(15), e: H(20) }];
ok(JSON.stringify(m.workSpan(hours, [])) === JSON.stringify({ s: H(10), e: H(20) }), 'span = first start, last end');
ok(m.workSpan(hours, [{ s: H(0), e: H(24) }]) === null, 'full day off → no reminders');
ok(m.workSpan([], []) === null, 'no hours that weekday → nothing');
ok(JSON.stringify(m.workSpan(hours, [{ s: H(9), e: H(12) }])) === JSON.stringify({ s: H(12), e: H(20) }), 'morning off moves the start');
ok(JSON.stringify(m.workSpan(hours, [{ s: H(15), e: H(21) }])) === JSON.stringify({ s: H(10), e: H(14) }), 'afternoon off moves the end');

const span = { s: H(10), e: H(20) };
ok(m.dueReminder(span, H(10) - M(11)) === null, '11 min before: not yet');
ok(m.dueReminder(span, H(10) - M(10)) === 'start', '10 min before: start');
ok(m.dueReminder(span, H(10) + M(10)) === 'start', 'late cron still sends start');
ok(m.dueReminder(span, H(10) + M(16)) === null, 'too late for start');
ok(m.dueReminder(span, H(19) + M(59)) === null, 'just before end: nothing');
ok(m.dueReminder(span, H(20)) === 'end', 'at end: end');
ok(m.dueReminder(span, H(20) + M(31)) === null, 'long after end: nothing');

const t = m.reminderText('start', [{ title: 'Filmează reel', due_day: '2026-11-10' }, { title: 'Comandă ceară', due_day: '2026-11-12' }, { title: 'Curăță', due_day: null }], '2026-11-12');
ok(t.title === '☀️ Ai 3 taskuri de făcut azi', 'start title ' + t.title);
ok(t.body === '• Filmează reel (întârziat)\n• Comandă ceară (azi)\n• Curăță', 'body with tags');
const e = m.reminderText('end', Array.from({ length: 6 }, (_, i) => ({ title: 'T' + i, due_day: null })), '2026-11-12');
ok(e.title === '🌙 Înainte să pleci: 6 taskuri nebifate' && e.body.endsWith('…și încă 2'), 'end title + overflow ' + e.title);
ok(m.reminderText('end', [{ title: 'X', due_day: null }], 'd').title === '🌙 Înainte să pleci: 1 task nebifat', 'singular');
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('all task reminder tests passed');
