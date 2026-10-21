const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../indexnew.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Check the complete inline script's syntax too.
const quantity = script.slice(script.indexOf('function quantity('), script.indexOf('/* ================== 后端数据'));
const quick = script.slice(script.indexOf('function parseQuick('), script.indexOf('/* ================== 事件'));
const draft = script.slice(script.indexOf('function toDraft('), script.indexOf('/* ================== 渲染'));

function context() {
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/inventory.json')));
  const fields = { '#quickText': { value: '' }, '#posHint': { textContent: '' } };
  const ctx = vm.createContext({ products: inventory.products, state: { qty: { croissant: 7 } },
    $: selector => fields[selector], renderPOS() {} });
  vm.runInContext(quantity + quick + draft, ctx);
  return { ctx, fields };
}

test('quantity never silently turns decimals or negatives into different integers', () => {
  const { ctx } = context();
  for (const invalid of ['1.5', '-1', '1e2', 'abc', '', '9007199254740992']) {
    assert.equal(ctx.quantity(invalid), null);
  }
  assert.equal(ctx.quantity('10'), 10);
  assert.equal(ctx.quantity('0'), 0);
});

test('quick entry uses shared aliases and rejects the whole invalid selection', () => {
  const { ctx, fields } = context();
  for (const invalid of ['-1 croissants', '1.5 croissants', '1 pizza', '1 croissant, 2 croissants', '1 croissant, typo']) {
    fields['#quickText'].value = invalid;
    ctx.parseQuick();
    assert.equal(ctx.state.qty.croissant, 7);
    assert.ok(fields['#posHint'].textContent);
  }
  fields['#quickText'].value = '10 croissants, 2 chocolate slices, 1 sourdough';
  ctx.parseQuick();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.qty)), { croissant: 10, chocolate_slice: 2, sourdough: 1 });
  assert.equal(fields['#posHint'].textContent, '');
});

test('draft preserves backend decimal strings and warnings without an invented food weight', () => {
  const { ctx } = context();
  const result = ctx.toDraft({ totals: { clearance_total: '30.00', gross_profit_total: '-2.00', estimated_co2e_kg: '3.725' },
    items: [], promo: { text: 'Local copy', source: 'local_demo' }, carbon: { is_estimate: true },
    warnings: [{ code: 'BELOW_COST', message: 'Below cost' }] });
  assert.equal(result.rev, '30.00');
  assert.equal(result.profit, '-2.00');
  assert.equal(result.co2, '3.725');
  assert.equal(result.warnings[0].code, 'BELOW_COST');
  assert.equal(result.source, 'local_demo');
  assert.equal('kg' in result, false);
});

test('draft keeps AI fallback distinct from deliberately selected local mode', () => {
  const { ctx } = context();
  for (const [source, is_fallback] of [['local_demo', false], ['local_demo', true], ['deepseek', false]]) {
    const result = ctx.toDraft({ totals: {}, items: [],
      promo: { text: 'Copy', source, is_fallback }, carbon: { is_estimate: true }, warnings: [] });
    assert.equal(result.source, source);
    assert.equal(result.is_fallback, is_fallback);
  }
});
