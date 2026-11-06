const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function setup() {
  const storage = {};
  const tabs = new Map();
  let next = 100;
  const listener = { addListener() {} };
  const context = vm.createContext({ URL, console, setTimeout() {}, importScripts() {},
    chrome: {
      storage: { session: { async get() { return structuredClone(storage); }, async set(value) { Object.assign(storage, structuredClone(value)); } } },
      runtime: { onMessage: listener }, alarms: { onAlarm: listener, async create() {} },
      windows: { async update() {} },
      tabs: { onRemoved: listener, async create(value) { const tab = { id: next++, ...value }; tabs.set(tab.id, tab); return tab; }, async get(id) { return tabs.get(id); }, async update(id, value) { return Object.assign(tabs.get(id), value); }, async sendMessage() { return { ok: true, status: 'sending' }; }, async remove(id) { tabs.delete(id); } }
    }
  });
  vm.runInContext("globalThis.JOBBOT_CLOUD_ORIGIN='https://jobbot.example';", context);
  for (const file of ['outbox.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8'), context);
  await vm.runInContext('initialized', context);
  const sender = { url: 'https://jobbot.example/', tab: { id: 7 } };
  return { context, storage, tabs, call(message, from = sender) { return context.handle(message, from); } };
}

test('switching accounts clears old tasks and cached CV attachments', async () => {
  const app = await setup(), a = 'a'.repeat(64), b = 'b'.repeat(64);
  assert.equal((await app.call({ kind: 'HELLO', accountScope: a })).account_scope, a);
  const task = { id: 'c'.repeat(32), nonce: 'nonce-fictive', kind: 'email', provider: 'yahoo', url: 'https://mail.yahoo.com/', attachments: [{ content: 'CV PRIVE DU COMPTE A' }] };
  await app.call({ kind: 'DELIVERY_PREPARE', task, accountScope: a });
  const record = app.storage.jobbotDeliveries[task.id];
  const reader = { url: 'https://mail.yahoo.com/', tab: { id: record.tab } };
  assert.equal((await app.call({ kind: 'DELIVERY_READY' }, reader)).task.attachments[0].content, 'CV PRIVE DU COMPTE A');
  await app.call({ kind: 'HELLO', accountScope: b });
  assert.equal(Object.keys(app.storage.jobbotDeliveries).length, 0);
  assert.equal((await app.call({ kind: 'DELIVERY_READY' }, reader)).ignored, true);
  await assert.rejects(app.call({ kind: 'DELIVERY_SEND', id: task.id, nonce: task.nonce, accountScope: a }), /compte JobBot a changé/);
  const result = await app.call({ kind: 'DELIVERY_SEND', id: task.id, nonce: task.nonce, accountScope: b });
  assert.equal(result.not_clicked, true);
});

test('logout stops collection and rejects pages without an account scope', async () => {
  const app = await setup(), scope = 'd'.repeat(64);
  await assert.rejects(app.call({ kind: 'HELLO' }), /mets à jour/);
  await app.call({ kind: 'HELLO', accountScope: scope });
  await app.call({ kind: 'START', accountScope: scope, search_id: 'e'.repeat(32), sites: [{ id: 'indeed', url: 'https://fr.indeed.com/jobs' }] });
  const tab = Object.values(app.storage.task.tabs)[0];
  await app.call({ kind: 'ACCOUNT_LOGOUT', accountScope: scope });
  assert.equal(app.storage.task, null);
  assert.equal(app.storage.jobbotAccount, '');
  const result = await app.call({ kind: 'COLLECTOR_READY' }, { url: 'https://fr.indeed.com/jobs', tab: { id: tab.tab_id } });
  assert.equal(result.ignored, true);
});
