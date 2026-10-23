const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'frontend/rescue-module.js'), 'utf8');
// Real backend responses from a temporary database and a fixed clock; no server, no machine-time change.
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const real = JSON.parse(execFileSync(python, ['-W', 'ignore', '-c', `
import json, os
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.blind_boxes.pickup import clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.tests.test_blind_boxes import NOW, batch
TEA = dict(name='Blind Tea', category='drink', main_staple=False, cost_sen=100, retail_sen=400, weight_g=250, allergens=[])
body = {'pickup_start': NOW.isoformat(), 'pickup_end': (NOW + timedelta(minutes=30)).isoformat()}
out = {}
with TemporaryDirectory() as folder:
    config = Path(folder) / 'charities.json'
    config.write_text(json.dumps({'store': {'lat': 2.83, 'lng': 101.70}, 'charities': [
        {'name': 'Demo Orphanage A (placeholder)', 'lat': 2.84, 'lng': 101.71, 'accepts': ['bread', 'drink']}]}))
    os.environ['CHARITIES_PATH'] = str(config)
    def client(name, rows, now=NOW):
        repo = Repository(Path(folder) / (name + '.sqlite3'))
        if rows: repo.add_batches(rows)
        app = create_app()
        app.dependency_overrides[repository] = lambda: repo
        app.dependency_overrides[clock] = lambda: now
        return TestClient(app)
    for name, rows in [('options', [batch(name='Blind Bread', on_hand=4), batch('tea', **TEA, on_hand=4)]),
                       ('donation', [batch('tea', **TEA, on_hand=3), batch('stale', name='Stale Bread', safe=False, on_hand=2)]),
                       ('empty', [])]:
        c = client(name, rows)
        out[name] = {'inventory': c.get('/api/blind-boxes/inventory').json(),
                     'calculate': c.post('/api/blind-boxes/calculate', json=body).json()}
    c = client('closed', [batch('tea', **TEA, on_hand=3), batch('stale', name='Stale Bread', safe=False, on_hand=2)],
               NOW + timedelta(hours=1, minutes=1))
    flow = {'inventory': c.get('/api/blind-boxes/inventory').json(), 'dashboard': c.get('/api/blind-boxes/dashboard').json()}
    c.post('/api/blind-boxes/sweep')
    flow['pending'] = c.get('/api/blind-boxes/donations').json()
    flow['inventory_pending'] = c.get('/api/blind-boxes/inventory').json()
    pid = [d for d in flow['pending']['donations'] if d['status'] == 'PENDING'][0]['id']
    action = {'donation_id': pid, 'recipient': 'Demo Orphanage A (placeholder)'}
    flow['handoff'] = c.post('/api/blind-boxes/donations/handoff', json=action).json()
    flow['repeat'] = c.post('/api/blind-boxes/donations/handoff', json=action).json()
    conflict = c.post('/api/blind-boxes/donations/handoff', json=action | {'recipient': 'Other'})
    flow['conflict'] = {'status': conflict.status_code, 'body': conflict.json()}
    flow['done'] = c.get('/api/blind-boxes/donations').json()
    flow['inventory_done'] = c.get('/api/blind-boxes/inventory').json()
    flow['dashboard_done'] = c.get('/api/blind-boxes/dashboard').json()
    out['closed'] = flow
print(json.dumps(out))
`], { cwd: root, env: { ...process.env, AI_PROVIDER: 'local_demo', DEEPSEEK_API_KEY: '' }, encoding: 'utf8' }));

function ok(data) { return { ok: true, status: 200, json: async () => data }; }

async function page(routes) {
  const nodes = new Map(), calls = [];
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      id, innerHTML: '', textContent: '', value: '', checked: false, hidden: false, disabled: false, dataset: {},
      classList: { toggle() {}, add() {}, remove() {} }, showModal() { this.open = true; }, select() {},
    });
    return nodes.get(id);
  };
  node('top').value = '3';
  node('slot2130').checked = true;
  const p = { node, calls, routes };
  const ctx = vm.createContext({
    window: { Nexflow:{getContext:()=>({role:'owner',demoTime:null}),changed() {}} }, AbortSignal,
    document: { getElementById: id => node(id.replace(/^rescue-/,'')), addEventListener() {}, documentElement: { dataset: {} } },
    matchMedia: () => ({ matches: false }), navigator: {}, setInterval() {}, Date,
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
      const route = p.routes[url.replace('/api/blind-boxes', '')];
      if (!route) throw new Error('unexpected ' + url);
      return typeof route === 'function' ? route(options) : ok(route);
    },
  });
    // 模块现在依赖 i18n.js：在 VM 里加载同一份字典并固定为中文，断言保持原样。
    vm.runInContext(fs.readFileSync(path.join(root,'frontend/i18n.js'),'utf8'), ctx);
    vm.runInContext("window.NexFlowI18N.setLang('zh-CN',{silent:true})", ctx);
  vm.runInContext(script, ctx);
  p.run = (code) => vm.runInContext(code.replace(/\b(calculate|openHandoff|handoff|loadDonations)\(/g,'window.NexflowRescue.$1('), ctx);
  p.settle = () => new Promise(setImmediate);
  await vm.runInContext('window.NexflowRescue.refresh()',ctx);
  await p.settle();
  return p;
}

const base = (s) => ({ '/inventory': real[s].inventory, '/calculate': real[s].calculate,
  '/donations': { demo_only: true, donations: [] }, '/dashboard': real.closed.dashboard });
const mutating = (p) => p.calls.filter((c) => /sweep|handoff|orders|pickup|seed/.test(c.url));

test('with boxes: options use inventory names and backend sen prices, nothing is reserved', async () => {
  const p = await page(base('options'));
  await p.run('calculate()');
  const r = real.options.calculate;
  assert.equal(r.status, 'OPTIONS');
  assert.equal(p.node('optionsLane').hidden, false);
  assert.equal(p.node('fallbackLane').hidden, true);
  const out = p.node('options').innerHTML;
  assert.match(out, /Blind Bread × \d/);
  for (const o of r.options) assert.ok(out.includes(`RM${(o.price_sen / 100).toFixed(2)}`));
  assert.doesNotMatch(out, /undefined|NaN/);
  assert.deepEqual(mutating(p), []);
});

test('no box: donatable and inedible stay separate; recommendation is never shown as delivered', async () => {
  const p = await page(base('donation'));
  await p.run('calculate()');
  assert.equal(p.node('donateBlock').hidden, false);
  assert.match(p.node('donRows').innerHTML, /Blind Tea/);
  assert.doesNotMatch(p.node('donRows').innerHTML, /Stale Bread/);
  assert.equal(p.node('wasteBlock').hidden, false);
  assert.match(p.node('wasteRows').innerHTML, /Stale Bread/);
  assert.match(p.node('wasteRows').innerHTML, /安全或储存未核验/);
  assert.doesNotMatch(p.node('wasteRows').innerHTML, /Blind Tea/);
  assert.match(p.node('recipients').innerHTML, /Demo Orphanage A \(placeholder\).*演示机构/s);
  assert.match(p.node('contactCopy').value, /演示文案，未发送/);
  assert.match(p.node('contactCopy').value, /Blind Tea × 3/);
  const fuel = real.donation.calculate.fallback.choices.find((c) => c.type === 'BIOFUEL');
  assert.ok(p.node('fuelNums').innerHTML.includes(fuel.energy_kwh.toFixed(3)));
  assert.match(p.node('fuelFormula').textContent, /估算/);
  const all = [...['donRows', 'recipients', 'wasteRows', 'fuelNums'].map((id) => p.node(id).innerHTML), p.node('status').textContent].join();
  assert.doesNotMatch(all, /已送达|已交接|签收/);
  assert.deepEqual(mutating(p), []);
});

test('empty inventory shows an explicit no-stock state', async () => {
  const p = await page(base('empty'));
  assert.match(p.node('invList').innerHTML, /无库存/);
  await p.run('calculate()');
  assert.equal(p.node('emptyLeft').hidden, false);
  assert.equal(p.node('donateBlock').hidden, true);
  assert.equal(p.node('wasteBlock').hidden, true);
  assert.equal(p.node('fuelBlock').hidden, true);
  assert.match(p.node('status').textContent, /没有剩余库存/);
});

test('failure clears the old plan and allows retry; double click sends one calculation', async () => {
  const p = await page(base('donation'));
  await p.run('calculate()');
  p.routes['/calculate'] = async () => { throw new Error('offline'); };
  await p.run('calculate()');
  assert.equal(p.node('fallbackLane').hidden, true);
  assert.equal(p.node('fallbackLane').hidden, true);
  assert.equal(p.node('contactCopy').value, '');
  assert.match(p.node('status').textContent, /计算失败.*连不上后端/);
  assert.equal(p.node('calcBtn').disabled, false);
  p.routes['/calculate'] = async () => ({ ok: false, status: 422, json: async () => ({ error: { message: 'Invalid request' } }) });
  await p.run('calculate()');
  assert.match(p.node('status').textContent, /Invalid request/);
  let finish;
  p.routes['/calculate'] = () => new Promise((resolve) => { finish = resolve; });
  const before = p.calls.filter((c) => c.url.endsWith('/calculate')).length;
  const first = p.run('calculate()');
  await p.settle();
  await p.run('calculate()');
  finish(ok(real.donation.calculate));
  await first;
  assert.equal(p.calls.filter((c) => c.url.endsWith('/calculate')).length - before, 1);
  assert.equal(p.node('donateBlock').hidden, false);
});

test('pending handoff: operator confirms once, repeat clicks send one request, stats come from backend', async () => {
  const f = real.closed;
  const routes = { '/inventory': f.inventory_pending, '/donations': f.pending, '/dashboard': f.dashboard };
  const p = await page(routes);
  const pending = f.pending.donations.find((d) => d.status === 'PENDING');
  assert.match(p.node('donations').innerHTML, /待交接/);
  assert.match(p.node('donations').innerHTML, new RegExp(`data-handoff="${pending.id}"`));
  assert.doesNotMatch(p.node('donations').innerHTML, /Stale Bread/);
  assert.equal(p.node('discardBlock').hidden, false);
  assert.match(p.node('discarded').innerHTML, /Stale Bread.*已报废/s);
  assert.doesNotMatch(p.node('discarded').innerHTML, /data-handoff/);
  assert.match(p.node('stats').innerHTML, /已交接件数<\/small><b class="num">0/);

  // Dialog requires the acknowledgement before it can submit.
  p.run(`openHandoff(${JSON.stringify(pending.id)})`);
  assert.equal(p.node('handoffDialog').open, true);
  assert.equal(p.node('hoOk').disabled, true);
  assert.equal(p.node('hoRecipient').value, 'Demo recipient (placeholder)');

  let finish;
  routes['/donations/handoff'] = () => new Promise((resolve) => { finish = resolve; });
  const first = p.run(`handoff(${JSON.stringify(pending.id)}, 'Demo Orphanage A (placeholder)')`);
  await p.run(`handoff(${JSON.stringify(pending.id)}, 'Demo Orphanage A (placeholder)')`);
  p.run(`openHandoff(${JSON.stringify(pending.id)})`);  // ignored while in flight
  assert.match(p.node('donations').innerHTML, /disabled>提交中/);
  Object.assign(routes, { '/donations': f.done, '/inventory': f.inventory_done, '/dashboard': f.dashboard_done });
  finish(ok(f.handoff));
  await first;
  assert.equal(p.calls.filter((c) => c.url.endsWith('/handoff')).length, 1);
  assert.deepEqual(p.calls.find((c) => c.url.endsWith('/handoff')).body,
    { donation_id: pending.id, recipient: 'Demo Orphanage A (placeholder)' });
  assert.match(p.node('status').textContent, /模拟交接.*不代表运输已完成/);
  assert.match(p.node('donations').innerHTML, /已交接（模拟）· Demo Orphanage A/);
  assert.doesNotMatch(p.node('donations').innerHTML, /data-handoff/);
  assert.match(p.node('stats').innerHTML, new RegExp(`已交接件数</small><b class="num">${f.dashboard_done.donated_qty}<`));

  // Backend is idempotent: the repeat returns the same record and stock/stats moved only once.
  assert.deepEqual(f.repeat, f.handoff);
  assert.equal(f.dashboard_done.donated_qty, pending.payload.qty);
  const tea = (inv) => inv.batches.find((b) => b.batch_id === 'tea');
  assert.equal(tea(f.inventory).on_hand - tea(f.inventory_done).on_hand, pending.payload.qty);
  p.node('handoffDialog').open = false;
  p.run(`openHandoff(${JSON.stringify(pending.id)})`);
  assert.equal(p.node('handoffDialog').open, false, 'a handed-over donation cannot be confirmed again');
});

test('handoff conflict and list failure show errors, unlock the button and offer retry', async () => {
  const f = real.closed;
  const routes = { '/inventory': f.inventory_pending, '/donations': f.pending, '/dashboard': f.dashboard,
    '/donations/handoff': async () => ({ ok: false, status: f.conflict.status, json: async () => f.conflict.body }) };
  const p = await page(routes);
  const pending = f.pending.donations.find((d) => d.status === 'PENDING');
  await p.run(`handoff(${JSON.stringify(pending.id)}, 'Other')`);
  assert.equal(f.conflict.status, 409);
  assert.match(p.node('status').textContent, /交接失败.*another recipient/);
  assert.doesNotMatch(p.node('donations').innerHTML, /disabled/);
  routes['/donations'] = async () => { throw new Error('offline'); };
  await p.run('loadDonations()');
  assert.match(p.node('donations').innerHTML, /加载失败.*data-retry="donations"/);
  assert.doesNotMatch(p.node('donations').innerHTML, /data-handoff/);
});

test('refresh and role repaint preserve a donation-list error instead of reporting empty success', async () => {
  const routes = base('empty');
  routes['/donations'] = async () => { throw new Error('offline'); };
  const p = await page(routes);
  assert.match(p.node('donations').innerHTML, /加载失败.*data-retry="donations"/);
  await p.run('window.NexflowRescue.roleChanged()');
  assert.match(p.node('donations').innerHTML, /加载失败/);
});
