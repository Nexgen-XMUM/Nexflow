window.NexflowRescue = (() => {
'use strict';

const $ = (id) => document.getElementById('rescue-' + id);
const root = document.getElementById('rescueModule');
const canWrite = () => window.Nexflow.getContext().role !== 'consumer';
const BASE = '/api/blind-boxes';
const LABEL = { bread: '面包', dessert: '甜点', drink: '饮料', meal: '正餐' };
const REASON = {
  SAFETY_UNVERIFIED: '安全或储存未核验', UNKNOWN_RESTRICTIONS: '过敏原或饮食资料未知', SAFETY_WINDOW: '超过安全期限',
  ALLERGEN_CONFLICT: '含所选过敏原（仅不适合本次顾客）', DIET_CONFLICT: '不符合所选饮食（仅不适合本次顾客）', OUT_OF_STOCK: '无可用数量',
  NO_FEASIBLE_COMBINATION: '现有库存满足不了盲盒规则（至少 1 件主食、每盒 2～4 件、售价不高于原价 70%）。',
  SEARCH_LIMIT: '搜索达到上限，没有找到合格组合。',
};
const PLACEHOLDER = 'Demo recipient (placeholder)';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kg = (n) => `${Number(n || 0).toFixed(2)} kg`;
const rm = (sen) => `RM${(sen / 100).toFixed(2)}`;

const state = { names: {}, result: null, recipients: [], donations: [], donationsError:false, busy: false, inflight: new Set(), handoffId: null };

async function api(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined ? {signal:AbortSignal.timeout(30000)} : {signal:AbortSignal.timeout(30000),
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error('连不上后端。请确认 uvicorn 正在运行，然后重试。');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `请求失败（HTTP ${res.status}）`);
  if (!data) throw new Error('后端返回的内容无法读取，请重试。');
  return data;
}

function say(text, isError) {
  $('status').textContent = text;
  $('status').classList.toggle('err', !!isError);
}

function storeNow() {
  // 门店固定 UTC+08:00
  const time = window.Nexflow.getContext().demoTime;
  const d = new Date((time ? new Date(time).getTime() : Date.now()) + 8 * 3600e3);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
const nameOf = (batchId) => state.names[batchId] || batchId;
const linesText = (lines) => lines.map((l) => `${esc(nameOf(l.batch_id))} × ${l.qty}`).join('，');

async function loadInventory() {
  try {
    const { batches } = await api('/inventory');
    state.names = Object.fromEntries(batches.map((b) => [b.batch_id, b.name]));
    const recorded = window.Nexflow.getContext().leftoversRegistered;
    $('inventoryNote').textContent = recorded ? '当前批次来自本次盘点登记的合成演示余货；数量沿用盘点，安全资料使用演示档案，不代表实际核验。' : '来自独立盲盒库存；可用数量为现有数量减已预留数量。';
    const free = batches.reduce((n, b) => n + b.available, 0);
    $('stockLine').textContent = batches.length ? `${batches.length} 个批次，可用 ${free} 件。` : '盲盒库存为空。';
    $('invList').innerHTML = batches.length ? `<div class="tablewrap"><table>
      <thead><tr><th>食品</th><th>品类</th><th class="r">可用</th><th class="r">原价</th><th>安全截止</th><th>核验</th></tr></thead>
      <tbody>${batches.map((b) => `<tr>
        <td>${esc(b.name)}<br><span class="muted" style="font-size:12px">${esc(b.batch_id)}</span></td>
        <td>${esc(LABEL[b.category] || b.category)}</td><td class="r num">${b.available}</td>
        <td class="r num">${rm(b.retail_sen)}</td><td class="num">${esc(String(b.safe_until).slice(0, 16).replace('T', ' '))}</td>
        <td>${recorded ? '<span class="tag">合成演示档案</span>' : b.safe && b.storage_verified ? '<span class="tag ok">已核验</span>' : '<span class="tag bad">未核验</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">无库存：盲盒库存为空。演示时先点左侧“载入今晚演示库存”。</p>';
    return true;
  } catch (e) {
    $('stockLine').textContent = '库存加载失败。';
    $('invList').innerHTML = `<p class="empty">库存加载失败：${esc(e.message)} <button type="button" class="btn small" data-retry="inventory">重试</button></p>`;
    return false;
  }
}

$('seedBtn').onclick = async () => {
  if (window.Nexflow.getContext().leftoversRegistered) return say('当前已使用盘点批次，无需载入独立样本。', true);
  if (!canWrite()) return say('请切换店员或老板操作。', true);
  $('seedBtn').disabled = true;
  try { await api('/demo-seed', {}); window.Nexflow.changed('seed'); say('已载入面包、蛋糕、茶三种演示库存。'); }
  catch (e) { say(e.message, true); }
  finally { $('seedBtn').disabled = !canWrite() || window.Nexflow.getContext().leftoversRegistered === true; }
  loadInventory();
};

$('sweepBtn').onclick = async () => {
  if (!canWrite()) return say('请切换店员或老板操作。', true);
  $('sweepBtn').disabled = true;
  const before = state.donations.filter((d) => d.status === 'PENDING').length;
  try {
    await api('/sweep', {});
    await loadDonations();
    const added = state.donations.filter((d) => d.status === 'PENDING').length - before;
    say(added > 0 ? `清算完成，新增 ${added} 张待交接捐赠单。` : '清算完成，后端没有新增待交接捐赠单。');
  } catch (e) { say(e.message, true); }
  finally { $('sweepBtn').disabled = !canWrite(); }
  loadInventory(); loadStats(); window.Nexflow.changed('sweep');
};

function request() {
  const { date } = storeNow();
  const [start, end] = $('slot2200').checked ? ['22:00', '22:30'] : ['21:30', '22:00'];
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const top = Number($('top').value);
  return {
    pickup_start: `${date}T${start}:00+08:00`, pickup_end: `${date}T${end}:00+08:00`,
    top: Number.isInteger(top) ? top : 0,
    preferences: { avoid_allergens: list($('avoid').value), required_diets: list($('diets').value), likes: list($('likes').value), dislikes: [] },
  };
}

function clearResult() {
  state.result = null; state.recipients = [];
  $('optionsLane').hidden = true; $('fallbackLane').hidden = true;
  $('options').innerHTML = ''; $('donRows').innerHTML = ''; $('wasteRows').innerHTML = '';
  $('recipients').innerHTML = ''; $('contactCopy').value = ''; $('fuelNums').innerHTML = '';
}

async function calculate() {
  if (state.busy) return;
  clearResult();
  const body = request();
  if (body.top < 1 || body.top > 10) return say('方案数量要在 1 到 10 之间。', true);
  state.busy = true; $('calcBtn').disabled = true; say('正在计算…');
  try {
    if (!await loadInventory()) throw new Error('库存加载失败，请重试');
    const result = await api('/calculate', body);
    render(result);
    say(result.status === 'OPTIONS' ? `找到 ${result.options.length} 个盲盒方案。`
      : result.fallback.donatable.qty + result.fallback.inedible.qty ? '组不成盲盒，已列出捐赠建议和处理建议。' : '没有剩余库存。');
  } catch (e) {
    clearResult();
    say(`计算失败：${e.message}`, true);
  } finally { state.busy = false; $('calcBtn').disabled = false; }
}
$('calcForm').onsubmit = (event) => { event.preventDefault(); calculate(); };

function contactText(recipient, donatable) {
  const items = donatable.items.map((i) => `${i.name} × ${i.qty}`).join('、');
  return `【演示文案，未发送】您好，${recipient}：\n我们是 Nexflow 演示门店。今晚打烊后有 ${items}，共 ${donatable.qty} 件、约 ${kg(donatable.weight_kg)}，门店已登记为可食用并核对储存。\n请问贵机构今晚是否方便接收？接收方式和时间待双方确认。`;
}

function render(r) {
  clearResult();
  state.result = r;
  if (r.status === 'OPTIONS') {
    $('optionsLane').hidden = false;
    const best = r.options[0].scores.total || 1;
    $('options').innerHTML = r.options.map((o) => `
      <li>
        <div>
          <strong>${linesText(o.lines)}</strong>
          <div class="muted" style="font-size:13px">${o.qty} 件 · 评分 ${o.scores.total.toFixed(1)} · 碳足迹估算 ${kg(o.estimated_co2e_kg)} CO₂e${o.allergens.length ? ` · 含 ${esc(o.allergens.join('、'))}` : ''}</div>
          <div class="bar"><i style="width:${(o.scores.total / best) * 100}%"></i></div>
        </div>
        <div class="price num">${rm(o.price_sen)}<small>含包装 ${rm(o.packaging_sen)} · 原价 ${rm(o.retail_sen)}</small></div>
      </li>`).join('');
    return;
  }
  const fb = r.fallback;
  const give = fb.choices.find((c) => c.type === 'ORPHANAGE_DONATION');
  const fuel = fb.choices.find((c) => c.type === 'BIOFUEL');
  const empty = !fb.donatable.qty && !fb.inedible.qty;
  $('fallbackLane').hidden = false;
  $('fbReason').textContent = empty ? '盲盒库存里没有可用食品。' : (REASON[fb.reason] || fb.reason);
  $('emptyLeft').hidden = !empty;

  $('donateBlock').hidden = !fb.donatable.qty;
  $('donRows').innerHTML = fb.donatable.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.qty}</td>
    <td class="r num">${kg(i.weight_kg)}</td><td>${i.reason ? esc(REASON[i.reason] || i.reason) : '安全，可捐赠'}</td></tr>`).join('');
  state.recipients = give ? give.recipients.map((c) => c.name) : [];
  $('recipientBlock').hidden = !give; $('copyBlock').hidden = !give; $('copyRow').hidden = !give;
  $('noRecipient').hidden = !fb.donatable.qty || !!give;
  if (give) {
    $('recipients').innerHTML = give.recipients.map((c) => `<li>
      <strong>${esc(c.name)}</strong> <span class="tag">演示机构</span><br>
      <span class="muted" style="font-size:13px">直线距离约 ${c.distance_km} km · 接收 ${c.accepts.map((a) => esc(LABEL[a] || a)).join('、')} · 联系方式：${c.contact ? esc(c.contact) : '未核实'}</span>
    </li>`).join('');
    $('contactCopy').value = contactText(give.recipients[0].name, fb.donatable);
  }

  $('wasteBlock').hidden = !fb.inedible.qty;
  $('wasteRows').innerHTML = fb.inedible.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.qty}</td>
    <td class="r num">${kg(i.weight_kg)}</td><td><span class="tag bad">${esc(REASON[i.reason] || i.reason)}</span></td></tr>`).join('');

  $('fuelBlock').hidden = !fuel;
  if (fuel) {
    $('fuelNums').innerHTML = `
      <div><small>沼气</small><b class="num">${fuel.biogas_m3.toFixed(3)}</b><small>m³</small></div>
      <div><small>甲烷</small><b class="num">${fuel.methane_m3.toFixed(3)}</b><small>m³</small></div>
      <div><small>能量</small><b class="num">${fuel.energy_kwh.toFixed(3)}</b><small>kWh</small></div>`;
    const f = fuel.formula;
    $('fuelFormula').textContent = `估算，不是实测：${kg(fuel.weight_kg)} × ${f.biogas_m3_per_kg} m³/kg 得沼气，甲烷占 ${f.methane_share * 100}%，能量 = 沼气 × ${f.kwh_per_biogas_m3} kWh/m³。`;
  }
}

$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('contactCopy').value); say('文案已复制，未发送给任何机构。'); }
  catch { $('contactCopy').select(); say('无法自动复制，请手动复制。', true); }
};

function donationRow(d) {
  const p = d.payload;
  const source = d.source_order ? '未领取盲盒' : '打烊余料';
  const busy = state.inflight.has(d.id);
  const status = d.status === 'DONATED' ? `<span class="tag ok">已交接（模拟）· ${esc(d.recipient)}</span>`
    : d.status === 'PENDING' ? '<span class="tag pending">待交接</span>' : '<span class="tag bad">已报废</span>';
  return `<tr>
    <td>${linesText(p.lines)}<br><span class="muted" style="font-size:12px">${source} · 建立 ${esc(String(d.created).slice(11, 16))}</span></td>
    <td class="r num">${p.qty}</td><td class="r num">${kg(p.weight_g / 1000)}</td><td class="r num">${kg(p.estimated_co2e_kg)}</td>
    <td>${status}</td>
    <td>${d.status === 'PENDING' ? `<button type="button" class="btn small give" data-handoff="${esc(d.id)}" ${busy || !canWrite() ? 'disabled' : ''}>${busy ? '提交中…' : '确认交接'}</button>` : ''}</td>
  </tr>`;
}
const donationTable = (rows) => `<div class="tablewrap"><table>
  <thead><tr><th>食品</th><th class="r">件数</th><th class="r">重量</th><th class="r">CO₂e 估算</th><th>状态</th><th></th></tr></thead>
  <tbody>${rows.map(donationRow).join('')}</tbody></table></div>`;

function renderDonations() {
  const live = state.donations.filter((d) => d.status !== 'DISCARDED');
  const discarded = state.donations.filter((d) => d.status === 'DISCARDED');
  $('donations').innerHTML = live.length ? donationTable(live)
    : '<p class="empty">暂无捐赠单。打烊（22:30）后点“打烊清算”，未售出的安全食品会出现在这里。</p>';
  $('discardBlock').hidden = !discarded.length;
  $('discarded').innerHTML = discarded.length ? donationTable(discarded) : '';
}

async function loadDonations() {
  try {
    state.donations = (await api('/donations')).donations;
    state.donationsError = false;
    renderDonations();
  } catch (e) {
    state.donations = []; state.donationsError = true;
    $('discardBlock').hidden = true;
    $('donations').innerHTML = `<p class="empty">捐赠清单加载失败：${esc(e.message)} <button type="button" class="btn small" data-retry="donations">重试</button></p>`;
  }
}

async function loadStats() {
  try {
    const s = await api('/dashboard');
    $('stats').innerHTML = `
      <div><small>已交接件数</small><b class="num">${s.donated_qty}</b></div>
      <div><small>已交接重量</small><b class="num">${kg(s.donated_weight_g / 1000)}</b></div>
      <div><small>待交接单数</small><b class="num">${state.donations.filter((d) => d.status === 'PENDING').length}</b></div>`;
    $('statNote').textContent = `已领取盲盒与已交接捐赠的食物碳足迹估算合计 ${kg(s.estimated_co2e_kg)} CO₂e。只是估算，不是经认证的减排量或碳信用。`;
  } catch (e) {
    $('stats').innerHTML = '';
    $('statNote').innerHTML = `统计加载失败：${esc(e.message)} <button type="button" class="btn small" data-retry="stats">重试</button>`;
  }
}

function openHandoff(id) {
  if (!canWrite()) return say('请切换店员或老板确认交接。', true);
  const d = state.donations.find((x) => x.id === id);
  if (!d || d.status !== 'PENDING' || state.inflight.has(id)) return;
  state.handoffId = id;
  $('hoBody').innerHTML = `${linesText(d.payload.lines)}，共 ${d.payload.qty} 件、${kg(d.payload.weight_g / 1000)}。`;
  $('hoRecipient').value = state.recipients[0] || PLACEHOLDER;
  $('hoAck').checked = false; $('hoOk').disabled = true;
  $('handoffDialog').showModal();
}
$('hoAck').onchange = () => { $('hoOk').disabled = !$('hoAck').checked; };
$('handoffDialog').onclose = () => {
  const id = state.handoffId; state.handoffId = null;
  if ($('handoffDialog').returnValue === 'ok' && $('hoAck').checked) handoff(id, $('hoRecipient').value.trim() || PLACEHOLDER);
};

async function handoff(id, recipient) {
  if (!canWrite()) return say('请切换店员或老板确认交接。', true);
  if (!id || state.inflight.has(id)) return;
  state.inflight.add(id); renderDonations();
  try {
    const row = await api('/donations/handoff', { donation_id: id, recipient });
    window.Nexflow.changed('donation');
    say(`已记录模拟交接给 ${row.recipient}。这不代表运输已完成或机构已签收。`);
  } catch (e) {
    say(`交接失败：${e.message}`, true);
  } finally {
    state.inflight.delete(id);
    await loadDonations();
    await Promise.all([loadInventory(), loadStats()]);
  }
}

document.addEventListener('click', (event) => {
  if (!root.contains(event.target)) return;
  const el = event.target.closest?.('[data-handoff],[data-retry]');
  if (!el) return;
  if (el.dataset.handoff) return openHandoff(el.dataset.handoff);
  ({ inventory: loadInventory, donations: () => loadDonations().then(loadStats), stats: loadStats })[el.dataset.retry]?.();
});

async function refresh() {
  await Promise.all([loadInventory(), loadDonations().then(loadStats)]);
  roleChanged();
}
function roleChanged() {
  $('seedBtn').disabled = !canWrite() || window.Nexflow.getContext().leftoversRegistered === true; $('sweepBtn').disabled = !canWrite();
  if (!state.donationsError) renderDonations();
  if (!canWrite()) $('handoffDialog').close?.('cancel');
}
return {refresh, roleChanged, calculate, openHandoff, handoff, loadDonations, invalidate:clearResult};

})();
