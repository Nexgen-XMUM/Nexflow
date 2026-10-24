window.NexflowRescue = (() => {
'use strict';

const $ = (id) => document.getElementById('rescue-' + id);
const root = document.getElementById('rescueModule');
const canWrite = () => window.Nexflow.getContext().role !== 'consumer';
const BASE = '/api/blind-boxes';
// 三语言文案：i18n.js 先加载；缺失（例如单元测试的 VM）时退回键名，不抛错。
const t = (key, vars) => (window.NexFlowI18N ? window.NexFlowI18N.t(key, vars) : key);
const LABEL = () => ({ bread: t('rescue.catBread'), dessert: t('rescue.catDessert'), drink: t('rescue.catDrink'), meal: t('rescue.catMeal') });
const REASON = () => ({
  SAFETY_UNVERIFIED: t('blind.reasonUnverified'), UNKNOWN_RESTRICTIONS: t('blind.reasonUnknown'), SAFETY_WINDOW: t('blind.reasonWindow'),
  ALLERGEN_CONFLICT: t('blind.reasonAllergen'), DIET_CONFLICT: t('blind.reasonDiet'), OUT_OF_STOCK: t('blind.reasonStock'),
  NO_FEASIBLE_COMBINATION: t('blind.reasonNoCombo'),
  SEARCH_LIMIT: t('blind.reasonSearch'),
});
const PLACEHOLDER = 'Demo recipient (placeholder)';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kg = (n) => `${Number(n || 0).toFixed(2)} kg`;
const rm = (sen) => `RM${(sen / 100).toFixed(2)}`;

const state = { names: {}, result: null, recipients: [], donations: [], donationsError:false, busy: false, inflight: new Set(), handoffId: null,
  batches: null, recorded: false, stats: null, status: null, receipt: null };

async function api(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined ? {signal:AbortSignal.timeout(30000)} : {signal:AbortSignal.timeout(30000),
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t('rescue.offline'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || t('rescue.httpFail', { status: res.status }));
  if (!data) throw new Error(t('rescue.badBody'));
  return data;
}

// 状态行保存“键 + 变量”（或后端原文），切换语言后重新渲染仍是当前语言。
function say(key, vars, isError) {
  state.status = key ? { key, vars: vars || null, error: !!isError } : null;
  paintStatus();
}
// 后端返回的原始技术错误：照原文显示，不改写业务结果。
function sayRaw(text, isError) {
  state.status = text ? { text: String(text), error: !!isError } : null;
  paintStatus();
}
function paintStatus() {
  const el = $('status'), s = state.status;
  el.textContent = s ? (s.text != null ? s.text : t(s.key, s.vars)) : '';
  el.classList.toggle('err', !!(s && s.error));
}

function storeNow() {
  // 门店固定 UTC+08:00
  const time = window.Nexflow.getContext().demoTime;
  const d = new Date((time ? new Date(time).getTime() : Date.now()) + 8 * 3600e3);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
const nameOf = (batchId) => state.names[batchId] || batchId;
const linesText = (lines) => lines.map((l) => `${esc(nameOf(l.batch_id))} × ${esc(l.qty)}`).join('，');

function renderInventory() {
  const batches = state.batches || [];
  const recorded = state.recorded;
  $('inventoryNote').textContent = recorded ? t('rescue.inventoryNoteRecorded') : t('rescue.inventoryNoteStock');
  const free = batches.reduce((n, b) => n + b.available, 0);
  $('stockLine').textContent = batches.length ? t('rescue.stockLine', { batches: batches.length, free }) : t('rescue.stockEmpty');
  $('invList').innerHTML = batches.length ? `<div class="tablewrap"><table>
      <thead><tr><th>${esc(t('rescue.thFood'))}</th><th>${esc(t('rescue.thCategory'))}</th><th class="r">${esc(t('blind.thAvailable'))}</th><th class="r">${esc(t('blind.thRetail'))}</th><th>${esc(t('rescue.thSafe'))}</th><th>${esc(t('rescue.thVerified'))}</th></tr></thead>
      <tbody>${batches.map((b) => `<tr>
        <td>${esc(b.name)}<br><span class="muted" style="font-size:12px">${esc(b.batch_id)}</span></td>
        <td>${esc(LABEL()[b.category] || b.category)}</td><td class="r num">${b.available}</td>
        <td class="r num">${rm(b.retail_sen)}</td><td class="num">${esc(String(b.safe_until).slice(0, 16).replace('T', ' '))}</td>
        <td>${recorded ? `<span class="tag">${esc(t('rescue.demoProfile'))}</span>` : b.safe && b.storage_verified ? `<span class="tag ok">${esc(t('rescue.verified'))}</span>` : `<span class="tag bad">${esc(t('rescue.unverified'))}</span>`}</td>
      </tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${esc(t('rescue.emptyStockHint'))}</p>`;
}

async function loadInventory() {
  try {
    const { batches } = await api('/inventory');
    state.names = Object.fromEntries(batches.map((b) => [b.batch_id, b.name]));
    state.batches = batches;
    state.recorded = window.Nexflow.getContext().leftoversRegistered;
    renderInventory();
    return true;
  } catch (e) {
    state.batches = [];
    $('stockLine').textContent = t('rescue.stockLoadFail');
    $('invList').innerHTML = `<p class="empty">${esc(t('rescue.stockLoadFailErr', { err: e.message }))} <button type="button" class="btn small" data-retry="inventory">${esc(t('common.retry'))}</button></p>`;
    return false;
  }
}

$('seedBtn').onclick = async () => {
  if (window.Nexflow.getContext().leftoversRegistered) return say('rescue.alreadyRecorded', null, true);
  if (!canWrite()) return say('store.roleNeeded', null, true);
  $('seedBtn').disabled = true;
  try { await api('/demo-seed', {}); window.Nexflow.changed('seed'); say('rescue.seeded'); }
  catch (e) { sayRaw(e.message, true); }
  finally { $('seedBtn').disabled = !canWrite() || window.Nexflow.getContext().leftoversRegistered === true; }
  loadInventory();
};

$('sweepBtn').onclick = async () => {
  if (!canWrite()) return say('store.roleNeeded', null, true);
  $('sweepBtn').disabled = true;
  const before = state.donations.filter((d) => d.status === 'PENDING').length;
  try {
    await api('/sweep', {});
    await loadDonations();
    const added = state.donations.filter((d) => d.status === 'PENDING').length - before;
    say(added > 0 ? 'rescue.sweptAdded' : 'rescue.sweptNone', added > 0 ? { n: added } : null);
  } catch (e) { sayRaw(e.message, true); }
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
  if (body.top < 1 || body.top > 10) return say('rescue.topRange', null, true);
  state.busy = true; $('calcBtn').disabled = true; say('rescue.calculating');
  try {
    if (!await loadInventory()) throw new Error(t('rescue.inventoryFirst'));
    const result = await api('/calculate', body);
    render(result);
    say(result.status === 'OPTIONS' ? 'rescue.foundOptions'
      : result.fallback.donatable.qty + result.fallback.inedible.qty ? 'rescue.noBoxButAdvice' : 'rescue.noStockLeft',
      result.status === 'OPTIONS' ? { n: result.options.length } : null);
  } catch (e) {
    clearResult();
    sayRaw(t('rescue.calcFail', { err: e.message }), true);
  } finally { state.busy = false; $('calcBtn').disabled = false; }
}
$('calcForm').onsubmit = (event) => { event.preventDefault(); calculate(); };

function contactText(recipient, donatable) {
  const items = donatable.items.map((i) => `${i.name} × ${i.qty}`).join(', ');
  return t('rescue.contactText', { recipient, items, qty: donatable.qty, weight: kg(donatable.weight_kg) });
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
          <div class="muted" style="font-size:13px">${esc(t('rescue.optionLine', { qty: o.qty, score: o.scores.total.toFixed(1), co2: kg(o.estimated_co2e_kg) }))}${o.allergens.length ? esc(t('rescue.optionContains', { list: o.allergens.join(', ') })) : ''}</div>
          <div class="bar"><i style="width:${(o.scores.total / best) * 100}%"></i></div>
        </div>
        <div class="price num">${rm(o.price_sen)}<small>${esc(t('rescue.optionPriceSmall', { pack: rm(o.packaging_sen), retail: rm(o.retail_sen) }))}</small></div>
      </li>`).join('');
    return;
  }
  const fb = r.fallback;
  const give = fb.choices.find((c) => c.type === 'ORPHANAGE_DONATION');
  const fuel = fb.choices.find((c) => c.type === 'BIOFUEL');
  const empty = !fb.donatable.qty && !fb.inedible.qty;
  $('fallbackLane').hidden = false;
  $('fbReason').textContent = empty ? t('rescue.emptyReason') : (REASON()[fb.reason] || fb.reason);
  $('emptyLeft').hidden = !empty;

  $('donateBlock').hidden = !fb.donatable.qty;
  $('donRows').innerHTML = fb.donatable.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.qty}</td>
    <td class="r num">${kg(i.weight_kg)}</td><td>${i.reason ? esc(REASON()[i.reason] || i.reason) : esc(t('rescue.safeDonatable'))}</td></tr>`).join('');
  state.recipients = give ? give.recipients.map((c) => c.name) : [];
  $('recipientBlock').hidden = !give; $('copyBlock').hidden = !give; $('copyRow').hidden = !give;
  $('noRecipient').hidden = !fb.donatable.qty || !!give;
  if (give) {
    $('recipients').innerHTML = give.recipients.map((c) => `<li>
      <strong>${esc(c.name)}</strong> <span class="tag">${esc(t('rescue.demoOrg'))}</span><br>
      <span class="muted" style="font-size:13px">${esc(t('rescue.recipientLine', { km: c.distance_km, accepts: c.accepts.map((a) => LABEL()[a] || a).join(', '), contact: c.contact ? c.contact : t('rescue.notVerified') }))}</span>
    </li>`).join('');
    $('contactCopy').value = contactText(give.recipients[0].name, fb.donatable);
  }

  $('wasteBlock').hidden = !fb.inedible.qty;
  $('wasteRows').innerHTML = fb.inedible.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.qty}</td>
    <td class="r num">${kg(i.weight_kg)}</td><td><span class="tag bad">${esc(REASON()[i.reason] || i.reason)}</span></td></tr>`).join('');

  $('fuelBlock').hidden = !fuel;
  if (fuel) {
    $('fuelNums').innerHTML = `
      <div><small>${esc(t('rescue.fuelBiogas'))}</small><b class="num">${fuel.biogas_m3.toFixed(3)}</b><small>m³</small></div>
      <div><small>${esc(t('rescue.fuelMethane'))}</small><b class="num">${fuel.methane_m3.toFixed(3)}</b><small>m³</small></div>
      <div><small>${esc(t('rescue.fuelEnergy'))}</small><b class="num">${fuel.energy_kwh.toFixed(3)}</b><small>kWh</small></div>`;
    const f = fuel.formula;
    $('fuelFormula').textContent = t('rescue.fuelFormula', { weight: kg(fuel.weight_kg), perKg: f.biogas_m3_per_kg,
      share: f.methane_share * 100, kwh: f.kwh_per_biogas_m3 });
  }
}

$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('contactCopy').value); say('rescue.copied'); }
  catch { $('contactCopy').select(); say('rescue.copyManual', null, true); }
};

function donationRow(d) {
  const p = d.payload;
  const source = d.source_order ? t('rescue.sourceUncollected') : t('rescue.sourceLeftover');
  const busy = state.inflight.has(d.id);
  const status = d.status === 'DONATED' ? `<span class="tag ok">${esc(t('rescue.statusDonated', { recipient: d.recipient }))}</span>`
    : d.status === 'PENDING' ? `<span class="tag pending">${esc(t('rescue.statusPending'))}</span>` : `<span class="tag bad">${esc(t('rescue.statusDiscarded'))}</span>`;
  const action = d.status === 'PENDING'
    ? `<button type="button" class="btn small give" data-handoff="${esc(d.id)}" ${busy || !canWrite() ? 'disabled' : ''}>${esc(busy ? t('rescue.handoffBusy') : t('rescue.handoffBtn'))}</button>`
    : d.status === 'DONATED'
      ? `<button type="button" class="btn small" data-receipt="${esc(d.id)}">${esc(t('rescue.receiptView'))}</button>` : '';
  return `<tr>
    <td>${linesText(p.lines)}<br><span class="muted" style="font-size:12px">${esc(source)} · ${esc(t('rescue.createdAt', { time: String(d.created).slice(11, 16) }))}</span></td>
    <td class="r num">${p.qty}</td><td class="r num">${kg(p.weight_g / 1000)}</td><td class="r num">${kg(p.estimated_co2e_kg)}</td>
    <td>${status}</td>
    <td>${action}</td>
  </tr>`;
}
const donationTable = (rows) => `<div class="tablewrap"><table>
  <thead><tr><th>${esc(t('rescue.thFood'))}</th><th class="r">${esc(t('rescue.thQty'))}</th><th class="r">${esc(t('rescue.thWeight'))}</th><th class="r">${esc(t('rescue.thCo2'))}</th><th>${esc(t('rescue.thStatus'))}</th><th></th></tr></thead>
  <tbody>${rows.map(donationRow).join('')}</tbody></table></div>`;

function renderDonations() {
  const live = state.donations.filter((d) => d.status !== 'DISCARDED');
  const discarded = state.donations.filter((d) => d.status === 'DISCARDED');
  $('donations').innerHTML = live.length ? donationTable(live)
    : `<p class="empty">${esc(t('rescue.donationsEmpty'))}</p>`;
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
    $('donations').innerHTML = `<p class="empty">${esc(t('rescue.donationsFail', { err: e.message }))} <button type="button" class="btn small" data-retry="donations">${esc(t('common.retry'))}</button></p>`;
  }
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $('stats').innerHTML = `
      <div><small>${esc(t('rescue.statQty'))}</small><b class="num">${s.donated_qty}</b></div>
      <div><small>${esc(t('rescue.statWeight'))}</small><b class="num">${kg(s.donated_weight_g / 1000)}</b></div>
      <div><small>${esc(t('rescue.statPending'))}</small><b class="num">${state.donations.filter((d) => d.status === 'PENDING').length}</b></div>`;
  $('statNote').textContent = t('rescue.statNote', { co2: kg(s.estimated_co2e_kg) });
}

function normalizeReceipt(row) {
  if (!row || row.status !== 'DONATED' || !row.id || typeof row.recipient !== 'string') return null;
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) return null;
  return { ...row, payload };
}

function renderReceipt() {
  const d = state.receipt;
  if (!d) return false;
  const p = d.payload;
  const numeric = (value) => value === null || value === undefined || value === '' ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const qty = numeric(p.qty);
  const weight = numeric(p.weight_g);
  const impact = numeric(p.estimated_co2e_kg);
  const created = Date.parse(d.created || '');
  const createdText = Number.isFinite(created)
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(created)) : '—';
  const lines = p.lines.map((line) =>
    `<li><span>${esc(nameOf(line.batch_id))}</span><b>${esc(line.qty)}</b></li>`).join('');
  $('receiptContent').innerHTML = `
    <header class="receipt-header">
      <p class="receipt-brand">Orbyte Smart Yield <span>· Nexgen</span></p>
      <span class="receipt-stamp">${esc(t('rescue.receiptConfirmed'))}</span>
      <h2 id="rescue-receiptTitle">${esc(t('rescue.receiptTitle'))}</h2>
      <p>${esc(t('rescue.receiptSubtitle'))}</p>
    </header>
    <dl class="receipt-meta">
      <div><dt>${esc(t('rescue.receiptReference'))}</dt><dd class="receipt-ref">${esc(d.id)}</dd></div>
      <div><dt>${esc(t('rescue.receiptRecipient'))}</dt><dd>${esc(d.recipient)}</dd></div>
      <div><dt>${esc(t('rescue.receiptCreated'))}</dt><dd>${esc(createdText)}</dd></div>
    </dl>
    <section class="receipt-items">
      <h3>${esc(t('rescue.receiptItems'))}</h3>
      <ul>${lines}</ul>
    </section>
    <dl class="receipt-totals">
      <div><dt>${esc(t('rescue.receiptQuantity'))}</dt><dd>${qty === null ? '—' : esc(qty)}</dd></div>
      <div><dt>${esc(t('rescue.receiptWeight'))}</dt><dd>${weight === null ? '—' : esc(kg(weight / 1000))}</dd></div>
      <div><dt>${esc(t('rescue.receiptImpact'))}</dt><dd>${impact === null ? '—' : esc(kg(impact))}</dd></div>
    </dl>
    <p class="receipt-estimate">${esc(t('rescue.receiptEstimateNote'))}</p>
    <p class="receipt-disclaimer">${esc(t('rescue.receiptNotice'))}</p>`;
  return true;
}

function openReceipt(idOrRow) {
  const row = typeof idOrRow === 'string' ? state.donations.find((d) => d.id === idOrRow) : idOrRow;
  const receipt = normalizeReceipt(row);
  if (!receipt) return say('rescue.receiptUnavailable', null, true);
  state.receipt = receipt;
  renderReceipt();
  $('receiptDialog').showModal();
}

$('receiptPrint').onclick = () => {
  const body = document.body;
  body?.classList?.add('receipt-printing');
  try { window.print?.(); } finally {
    setTimeout(() => body?.classList?.remove('receipt-printing'), 0);
  }
};

async function loadStats() {
  try {
    state.stats = await api('/dashboard');
    $('stats').dataset.error = 'false';
    renderStats();
  } catch (e) {
    state.stats = null;
    $('stats').innerHTML = '';
    $('statNote').innerHTML = `${esc(t('rescue.statsFail', { err: e.message }))} <button type="button" class="btn small" data-retry="stats">${esc(t('common.retry'))}</button>`;
  }
}

function openHandoff(id) {
  if (!canWrite()) return say('rescue.needStaffHandoff', null, true);
  const d = state.donations.find((x) => x.id === id);
  if (!d || d.status !== 'PENDING' || state.inflight.has(id)) return;
  state.handoffId = id;
  $('hoBody').innerHTML = esc(t('rescue.handoffBody', { items: linesText(d.payload.lines), qty: d.payload.qty, weight: kg(d.payload.weight_g / 1000) }));
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
  if (!canWrite()) return say('rescue.needStaffHandoff', null, true);
  if (!id || state.inflight.has(id)) return;
  state.inflight.add(id); renderDonations();
  try {
    const row = await api('/donations/handoff', { donation_id: id, recipient });
    window.Nexflow.changed('donation');
    say('rescue.handoffDone', { recipient: row.recipient });
    const receipt = normalizeReceipt(row);
    if (receipt) {
      state.receipt = receipt;
      renderReceipt();
      $('receiptDialog').showModal();
    } else {
      say('rescue.receiptUnavailable', null, true);
    }
  } catch (e) {
    sayRaw(t('rescue.handoffFail', { err: e.message }), true);
  } finally {
    state.inflight.delete(id);
    await loadDonations();
    await Promise.all([loadInventory(), loadStats()]);
  }
}

document.addEventListener('click', (event) => {
  if (!root.contains(event.target)) return;
  const el = event.target.closest?.('[data-handoff],[data-retry],[data-receipt]');
  if (!el) return;
  if (el.dataset.receipt) return openReceipt(el.dataset.receipt);
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

// 切换语言：用已缓存的数据重画，不再请求接口、不改动业务状态。
function relabel() {
  paintStatus();
  if (state.batches) renderInventory();
  if (!state.donationsError) renderDonations();
  if (state.stats) renderStats();
  if (state.result) render(state.result);
  if (state.receipt) renderReceipt();
  if ($('handoffDialog')?.open && state.handoffId) {
    const d = state.donations.find((x) => x.id === state.handoffId);
    if (d) $('hoBody').innerHTML = esc(t('rescue.handoffBody', { items: linesText(d.payload.lines), qty: d.payload.qty, weight: kg(d.payload.weight_g / 1000) }));
  }
}
if (window.NexFlowI18N) window.NexFlowI18N.onChange(relabel);

return {refresh, roleChanged, calculate, openHandoff, handoff, loadDonations, openReceipt, relabel, invalidate:clearResult };

})();
