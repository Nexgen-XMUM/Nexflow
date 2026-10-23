const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const script = html.replace(/<!--[\s\S]*?-->/g, '').match(/<script>([\s\S]*?)<\/script>/)[1];
// Exercise the actual API contract with local copy only, without a running server.
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const responses = JSON.parse(execFileSync(python, ['-W', 'ignore', '-c', `
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi.testclient import TestClient
from backend.main import app, create_app
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.blind_boxes.schemas import Batch
with TestClient(app) as c:
    result = {
        'products': c.get('/api/products').json(),
        'inventory': c.get('/api/inventory').json(),
        'single': c.post('/api/generate-promo', json=[{'item':'croissant','qty':10}]).json(),
        'multi': c.post('/api/generate-promo', json=[{'item':'croissant','qty':10},{'item':'chocolate_slice','qty':2},{'item':'sourdough','qty':1}]).json()
    }
with TemporaryDirectory() as folder:
    now = datetime.now(timezone(timedelta(hours=8)))
    config = Path(folder) / 'charities.json'
    config.write_text(json.dumps({'store': {'lat':2.83,'lng':101.70}, 'charities': [
        {'name':'DEMO Donation Centre','lat':2.84,'lng':101.71,'accepts':['drink','bread']}
    ]}))
    os.environ['CHARITIES_PATH'] = str(config)
    base = dict(batch_id='blind-bread',product_id='bread',name='Blind Bread',category='bread',
        main_staple=True,cost_sen=200,retail_sen=600,weight_g=80,co2e_per_kg=2.5,
        on_hand=2,safe=True,storage_verified=True,allergens=['wheat'],diets=['vegetarian'],
        safe_until=(now+timedelta(days=1)).isoformat())
    tea = base | dict(batch_id='blind-tea',product_id='tea',name='Blind Tea',category='drink',
        main_staple=False,cost_sen=100,retail_sen=400,weight_g=250,on_hand=3,allergens=[])
    result['blind'] = {}
    for name, rows in [('options',[base,tea]),('donation',[tea]),('fuel',[base | {'safe':False}]),('empty',[])]:
        repo = Repository(Path(folder) / (name + '.sqlite3'))
        if rows: repo.add_batches([Batch(**row) for row in rows])
        isolated = create_app()
        isolated.dependency_overrides[repository] = lambda: repo
        with TestClient(isolated) as c:
            inventory = c.get('/api/blind-boxes/inventory').json()
            response = c.post('/api/blind-boxes/calculate',json={'pickup_start':now.isoformat(),
                'pickup_end':(now+timedelta(hours=1)).isoformat(),'top':3})
            assert response.status_code == 200
            assert c.get('/api/blind-boxes/inventory').json() == inventory
            result['blind'][name] = {'inventory':inventory,'result':response.json()}
print(json.dumps(result))
`], { cwd: root, env: { ...process.env, AI_PROVIDER: 'local_demo', DEEPSEEK_API_KEY: '' }, encoding: 'utf8' }));

async function page() {
  const nodes = new Map(), events = {}, calls = [];
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
      // 导航项的可见性用 closest('li') 判断；假节点同样实现，避免与真实 DOM 行为不同。
      closest() { return null; },
      addEventListener(type, fn) { this[type] = fn; },
      append(...children) { this.children.push(...children); }, appendChild(child) { this.append(child); }
    });
    return nodes.get(key);
  }
  const location = { hash: '' };
  const ctx = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [node('#resetBtn'), node('#submitBtn')],
      createElement: () => node(Symbol()), addEventListener: (type, fn) => { events[type] = fn; } },
    // 角色窗口由网址决定：内联脚本在初始化时读取 window.location.hash，
    // 切换页面时用 history.replaceState 回写。假浏览器必须提供这两个 API。
    window: { matchMedia: () => ({ matches: true }), innerWidth: 1280,
      location, history: { replaceState(_state, _title, hash) { location.hash = hash; } } },
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {}, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/products') ? responses.products : responses.single };
    }
  });
  vm.runInContext(script, ctx);
  await new Promise(setImmediate);
  return { ctx, node, events, calls, run: code => vm.runInContext(code, ctx) };
}

test('real catalogue and generation responses render without invented fields or calculations', async () => {
  const p = await page();
  assert.match(p.node('#posRows').innerHTML, /Butter Croissant/);
  assert.doesNotMatch(p.node('#posRows').innerHTML, /undefined|NaN|成本|RM/);
  assert.equal('cost_price' in responses.products.products[0], false);
  assert.equal('cost_price' in responses.inventory.products[0], false);
  p.run('state.qty = {croissant: "10"}');
  await p.run('submitEOD()');
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), [{ item: 'croissant', qty: 10 }]);
  for (const amount of ['RM60.00', 'RM20.00', 'RM30.00', 'RM10.00', '2 kg']) {
    assert.ok(p.node('#draftBox').innerHTML.includes(amount), amount);
  }
  assert.equal(p.run('state.draft.text'), responses.single.promo.text);
  assert.equal(p.node('#kRec').textContent, 'RM30.00');
  assert.equal(p.node('#kFood').textContent, '10');
  p.ctx.response = responses.multi;
  p.run('state.draft = toDraft(response); renderDraft()');
  assert.match(p.node('#draftBox').innerHTML, /RM90\.00.*RM32\.00/s);
  assert.match(p.node('#draftBox').innerHTML, /RM45\.00/);
  assert.match(p.node('#draftBox').innerHTML, /3\.725 kg/);
  assert.doesNotMatch(p.node('#draftBox').innerHTML, /undefined|NaN/);
});

test('raw input, overstock and invalid quick input never submit or leave an old draft', async () => {
  const p = await page();
  for (const raw of ['1.5', '-1', '19', '9007199254740992', '']) {
    p.ctx.response = responses.single;
    p.run('state.draft = toDraft(response)');
    p.events.input({ target: { dataset: { q: 'croissant' }, value: raw } });
    assert.equal(p.run('state.qty.croissant'), raw);
    assert.equal(p.run('state.draft'), null);
    await p.run('submitEOD()');
    assert.ok(p.node('#posHint').textContent);
  }
  p.node('#quickText').value = '19 croissants';
  p.run('parseQuick()');
  assert.match(p.node('#posHint').textContent, /库存/);
  assert.equal(p.calls.length, 1);
});

test('pending request blocks duplicate/reset and respects navigation; failure clears success', async () => {
  const p = await page();
  let finish;
  p.ctx.fetch = () => { p.calls.push({ pending: true }); return new Promise(resolve => { finish = resolve; }); };
  p.run('state.qty = {croissant: 10}');
  const pending = p.run('submitEOD()');
  assert.equal(p.node('#resetBtn').disabled, true);
  await p.run('submitEOD()');
  p.node('#resetBtn').click();
  assert.equal(p.run('state.busy'), true);
  p.run('switchTab("log")');
  finish({ ok: true, json: async () => responses.single });
  await pending;
  assert.equal(p.calls.length, 2);
  assert.equal(p.run('state.tab'), 'log');
  assert.equal(p.node('#resetBtn').disabled, false);
  for (const fail of [
    async () => ({ ok: false, status: 422, json: async () => ({ error: { message: '库存不足' } }) }),
    async () => ({ ok: false, status: 503, json: async () => ({ error: { message: '服务不可用' } }) }),
    async () => { throw new Error('Failed to fetch'); },
    async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } })
  ]) {
    p.ctx.response = responses.single;
    p.run('state.draft = toDraft(response); renderDraft()');
    p.ctx.fetch = fail;
    await p.run('submitEOD()');
    assert.equal(p.run('state.draft'), null);
    assert.equal(p.run('state.result'), null);
    assert.equal(p.run('state.busy'), false);
    assert.equal(p.node('#submitBtn').disabled, false);
    assert.equal(p.node('#kRec').textContent, '暂无数据');
    assert.doesNotMatch(p.node('#draftBox').innerHTML, /RM30\.00/);
    assert.ok(p.node('#posHint').textContent);
  }
});

test('source labels, warnings and simulation preserve backend text and totals', async () => {
  const p = await page();
  for (const [source, is_fallback, label] of [
    ['local_demo', false, '未调用 AI'], ['deepseek', false, 'DeepSeek'], ['local_demo', true, '回退']
  ]) {
    p.ctx.response = { ...responses.single,
      promo: { text: '<copy & only>', source, is_fallback },
      warnings: [{ message: '低于成本警告' }] };
    p.run('state.draft = toDraft(response); renderDraft()');
    assert.ok(p.node('#draftBox').innerHTML.includes(label));
    assert.match(p.node('#draftBox').innerHTML, /&lt;copy &amp; only&gt;/);
    assert.match(p.node('#draftBox').innerHTML, /低于成本警告/);
    assert.match(p.node('#draftBox').innerHTML, /不是经认证减排量或碳积分/);
  }
  p.node('#copyBox').value = 'Edited copy only';
  await p.run('approve()');
  assert.equal(p.calls.length, 1, 'approval must not call the server');
  assert.equal(p.node('#waBody').children[1].children[0].textContent, 'Edited copy only');
  assert.match(p.node('#draftBox').innerHTML, /模拟广播已完成/);
  assert.match(p.node('#draftBox').innerHTML, /未扣库存、未实际发送/);
  assert.equal(p.run('state.kpi.promos'), 1);
  assert.doesNotMatch(p.node('#kRec').textContent, /NaN/);
  p.node('#resetBtn').click();
  await new Promise(setImmediate);
  assert.equal(p.run('state.draft'), null);
  assert.equal(p.run('state.kpi.promos'), 0);
  assert.equal(p.run('state.busy'), false);
});

test('catalogue failure can be retried by reset and leaves no enabled stale result', async () => {
  const p = await page();
  p.ctx.fetch = async () => { throw new Error('offline'); };
  p.node('#resetBtn').click();
  await new Promise(setImmediate);
  assert.equal(p.node('#posRows').innerHTML, '');
  assert.match(p.node('#posHint').textContent, /商品加载失败/);
  assert.equal(p.node('#resetBtn').disabled, false);
  p.ctx.fetch = async () => ({ ok: true, json: async () => responses.products });
  p.node('#resetBtn').click();
  await new Promise(setImmediate);
  assert.match(p.node('#posRows').innerHTML, /Butter Croissant/);
  assert.equal(p.node('#posHint').textContent, '');
});

test('stepper does not rewrite invalid values and role controls remain simulated', async () => {
  const p = await page();
  const click = dataset => p.events.click({ target: { closest: () => ({ dataset }) } });
  p.run('state.qty.croissant = "1.5"');
  click({ inc: 'croissant' });
  assert.equal(p.run('state.qty.croissant'), '1.5');
  assert.match(p.node('#posHint').textContent, /非负整数/);
  p.run('state.qty.croissant = "10"');
  click({ inc: 'croissant' });
  assert.equal(p.run('state.qty.croissant'), 11);
  click({ dec: 'croissant' });
  assert.equal(p.run('state.qty.croissant'), 10);
  await p.run('submitEOD()');
  click({ role: 'staff' });
  assert.match(p.node('#draftBox').innerHTML, /data-act="approve" disabled/);
  await p.run('approve()');
  assert.ok(p.run('state.draft'));
  click({ role: 'owner' });
  p.run('reject()');
  assert.equal(p.run('state.result.rejected'), true);
  assert.equal(p.calls.length, 2);
});

function blindFetch(p, scenario) {
  p.ctx.fetch = async (url, options) => {
    p.calls.push({url, options});
    return {ok:true, json:async () => responses.blind[scenario][url.endsWith('/inventory') ? 'inventory' : 'result']};
  };
}

test('official page includes new design and reads independent blind inventory with sen formatting', async () => {
  const p = await page();
  assert.match(html, /id="tab-blind"/);
  assert.match(html, /id="consumerShop"/);
  assert.match(html, /class="promo-head"/);
  assert.equal(p.run('senMoney(440)'), 'RM4.40');
  const clearanceCatalogue = p.node('#posRows').innerHTML;
  blindFetch(p, 'options');
  await p.run('loadBlindInventory()');
  assert.match(p.node('#blindInventory').innerHTML, /Blind Bread/);
  assert.match(p.node('#blindInventory').innerHTML, /RM6\.00/);
  assert.equal(p.node('#posRows').innerHTML, clearanceCatalogue);
  p.node('#blindAllergens').value = ' milk, egg ';
  await p.run('calculateBlind()');
  const request = JSON.parse(p.calls.at(-1).options.body);
  assert.deepEqual(request.preferences.avoid_allergens, ['milk','egg']);
  assert.match(request.pickup_end, /T22:00:00\+08:00$/);
  assert.equal(request.top, 3);
  assert.match(p.node('#promotionBox').innerHTML, /Blind Bread/);
  assert.match(p.node('#promotionBox').innerHTML, /Blind Tea/);
  for (const option of responses.blind.options.result.options) {
    assert.ok(p.node('#promotionBox').innerHTML.includes(`RM${(option.price_sen/100).toFixed(2)}`));
  }
  assert.doesNotMatch(p.node('#promotionBox').innerHTML, /undefined|NaN/);
  assert.equal(p.node('#rescuePanel').hidden, true);
  assert.equal(p.run('"consumer" in state'), false);
  assert.ok(p.calls.slice(1).every(c => ['/api/blind-boxes/inventory','/api/blind-boxes/calculate'].includes(c.url)));
});

test('no-options, donation, biofuel and empty inventory render backend advice and estimates', async () => {
  const p = await page();
  for (const scenario of ['donation','fuel','empty']) {
    blindFetch(p, scenario);
    await p.run('calculateBlind()');
    assert.match(p.node('#promotionBox').innerHTML, /NO_FEASIBLE_COMBINATION/);
    assert.equal(p.node('#rescuePanel').hidden, false);
    assert.match(p.node('#rescuePanel').innerHTML, /机构为演示数据/);
    assert.doesNotMatch(p.node('#rescuePanel').innerHTML, /undefined|NaN/);
    if (scenario === 'donation') {
      assert.match(p.node('#rescuePanel').innerHTML, /DEMO Donation Centre（演示机构）/);
      assert.match(p.node('#rescuePanel').innerHTML, /Blind Tea × 3/);
    } else if (scenario === 'fuel') {
      assert.match(p.node('#promotionBox').innerHTML, /SAFETY_UNVERIFIED/);
      assert.match(p.node('#rescuePanel').innerHTML, /生物能源建议（估算）/);
      assert.match(p.node('#rescuePanel').innerHTML, /0\.1152 kWh/);
    } else {
      assert.match(p.node('#blindInventory').innerHTML, /盲盒库存为空/);
      assert.match(p.node('#promotionBox').innerHTML, /空库存/);
      assert.match(p.node('#rescuePanel').innerHTML, /没有返回可执行/);
    }
  }
});

test('blind failure clears previous advice, unlocks retry, and pending results respect navigation', async () => {
  const p = await page();
  blindFetch(p, 'donation');
  await p.run('calculateBlind()');
  p.ctx.fetch = async () => { throw new Error('offline'); };
  await p.run('calculateBlind()');
  assert.equal(p.run('state.blind.result'), null);
  assert.equal(p.node('#rescuePanel').hidden, true);
  assert.doesNotMatch(p.node('#promotionBox').innerHTML, /DEMO Donation/);
  assert.match(p.node('#blindHint').textContent, /失败.*offline/);
  assert.equal(p.node('#resetBtn').disabled, false);
  await p.run('loadBlindInventory()');
  assert.match(p.node('#blindHint').textContent, /库存加载失败/);
  let finish, count = 0;
  p.ctx.fetch = async url => {
    count++;
    if (url.endsWith('/inventory')) return {ok:true,json:async () => responses.blind.options.inventory};
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = p.run('calculateBlind()');
  await new Promise(setImmediate);
  await p.run('calculateBlind()');
  p.node('#resetBtn').click();
  assert.equal(p.run('state.busy'), true);
  p.run('switchTab("log")');
  finish({ok:true,json:async () => responses.blind.options.result});
  await pending;
  assert.equal(count, 2);
  assert.equal(p.run('state.tab'), 'log');
  assert.match(p.node('#promotionBox').innerHTML, /盲盒候选组合/);
  p.ctx.fetch = async url => url.endsWith('/inventory')
    ? {ok:true,json:async () => responses.blind.options.inventory}
    : {ok:false,status:422,json:async () => ({error:{message:'Invalid preferences'}})};
  await p.run('calculateBlind()');
  assert.match(p.node('#blindHint').textContent, /Invalid preferences/);
  assert.equal(p.run('state.blind.result'), null);
});

test('consumer entry no longer maintains or redeems an independent business balance', async () => {
  const p = await page();
  p.run('state.role="consumer"; renderConsumerShop()');
  assert.match(p.node('#consumerShop').innerHTML, /顾客账户/);
  assert.match(p.node('#consumerShop').innerHTML, /data-tab="customer"/);
  assert.equal(p.run('"consumer" in state'), false);
  assert.doesNotMatch(script, /POINTS_PER_CO2_KG|REDEMPTION_ITEMS|state\.consumer/);
  assert.equal(p.calls.length, 1);
  assert.equal(p.run('state.blind.result'), null);
});
