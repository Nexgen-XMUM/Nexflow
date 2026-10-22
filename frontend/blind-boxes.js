/* Local demo extension. Customer requests never fetch the internal candidate list. */
(() => {
  'use strict';
  const USER = 'demo_mei_ling', STORAGE = 'nexflow-blind-checkout-v1';
  const node = id => document.getElementById(id);
  const currency = sen => 'RM' + (Number(sen) / 100).toFixed(2);
  const when = value => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Kuala_Lumpur',hour12:false});
  const key = prefix => prefix + '-' + crypto.randomUUID();
  const statusName = status => ({RESERVED:'已模拟付款 · 等待领取',PICKED_UP:'已领取',NO_SHOW:'已错过领取时段'}[status] || status);
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(STORAGE) || '{}'); } catch (_) {}
  const checkout = {quote:null,quoteRequest:null,confirmRequest:null,order:null,...saved};
  let busy = false, account = null, operatorOrder = null, stock = [], donations = [];
  function persist() {
    try { sessionStorage.setItem(STORAGE, JSON.stringify(checkout)); }
    catch (_) { throw new Error('浏览器无法保存待确认请求。请允许本页会话存储后再试。'); }
  }
  const errors = {
    NOT_RELEASED:'盲盒在门店时间 21:30 开售，请稍后再来。',
    NO_FEASIBLE_COMBINATION:'暂时没有符合条件的盲盒，可调整偏好或联系店员。',
    INVALID_SLOT:'请选择门店今天尚未结束的领取时段。',
    STOCK_CONFLICT:'这份报价的库存已不足，请重新获取报价；没有产生新的付款。',
    QUOTE_UNAVAILABLE:'原盒子的可售条件已变化，无法确认，请重新获取报价。',
    QUOTE_CHANGED:'商品资料或过敏原已变化，请重新查看报价后再决定。',
    QUOTE_EXPIRED:'报价已过期，请重新获取报价。',
    DAILY_LIMIT:'该演示顾客今天已达到两盒限购。',
    USER_FROZEN:'该演示顾客因爽约暂时被冻结。',
    INSUFFICIENT_POINTS:'盲盒积分不足，请刷新余额后再试。',
    REDEMPTION_LIMIT:'积分抵扣不能超过本次正价消费金额的30%。',
    OUTSIDE_PICKUP_SLOT:'尚未到预约领取时间，或该时段已经结束。',
    BATCH_EXISTS:'当天演示库存已导入，不会重置现有库存。',
    UNSAFE_FOR_HANDOFF:'食品的可售或安全条件已变化，不能记录交接。请执行清算并刷新清单。',
    RECIPIENT_CONFLICT:'这笔捐赠已记录给另一个接收方，请刷新清单核对。',
    INVALID_STATE:'这笔记录的状态不允许当前操作，请刷新后核对。',
    DONATION_NOT_FOUND:'找不到这笔捐赠记录，请刷新清单。',
  };
  async function call(path, body) {
    let response, data;
    try {
      response = await fetch('/api/blind-boxes' + path, {
        signal:AbortSignal.timeout(20000),
        ...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      });
      data = await response.json();
    } catch (_) {
      const error = new Error('连接中断或超时，结果尚未确认。请使用原按钮重试，不要重新下单。');
      error.uncertain = true; throw error;
    }
    if (!response.ok) {
      const error = new Error(errors[data?.error?.code] || data?.error?.message || '请求失败，请稍后重试。');
      error.code = data?.error?.code;
      // A server failure can occur after a write committed; keep its retry key.
      error.uncertain = response.status >= 500;
      throw error;
    }
    return data;
  }
  const tabItem = document.createElement('li');
  tabItem.innerHTML = '<button type="button" class="nav-item" role="tab" data-tab="blind" aria-selected="false"><span class="nav-icon" aria-hidden="true">🎁</span><span class="nav-text">救援盲盒<span class="nav-sub">报价、领取与独立积分</span></span></button>';
  document.querySelector('.tabs').appendChild(tabItem);
  const panel = document.createElement('section');
  panel.id = 'tab-blind'; panel.className = 'panel'; panel.hidden = true;
  panel.innerHTML = `
    <header class="bb-hero"><span class="bb-eyebrow">SMART RESCUE BOX · 本地演示</span><h2 id="bb-title">给好食物一个新去处</h2><p>先确认价格与过敏原，再决定是否领取一份惊喜。</p><ol class="bb-journey"><li>01 选择条件</li><li>02 查看固定报价</li><li>03 确认模拟付款</li><li>04 到店领取</li></ol></header>
    <div id="bb-message" class="bb-status" role="status" aria-live="polite"></div>
    <div id="bb-customer" class="bb-grid" hidden>
      <div><form id="bb-form" class="card"><h3>你的盲盒偏好</h3><p class="bb-muted">演示顾客：Mei Ling。门店时间 UTC+08:00，21:30 开售，每天最多两盒。</p>
        <div class="bb-fields"><label>领取日期<input id="bb-date" type="date" required></label><label>领取时段<select id="bb-slot"><option value="21:30">21:30–22:00</option><option value="22:00">22:00–22:30</option></select></label>
        <label>搭配模式<select id="bb-mode"><option value="standard">普通款 · 更偏向高分搭配</option><option value="surprise">惊喜款 · 合格搭配更有变化</option></select></label>
        <label>喜欢的品类<select id="bb-like"><option value="">无特别偏好</option><option value="bread">面包</option><option value="dessert">甜点</option><option value="drink">饮品</option><option value="meal">餐食</option></select></label>
        <label>饮食要求<select id="bb-diet"><option value="">无额外要求</option><option value="vegetarian">素食（须有资料支持）</option></select></label>
        <label>避免的过敏原<input id="bb-allergens" placeholder="例如 wheat, milk, egg"></label></div>
        <p class="bb-muted">请用英文逗号分隔过敏原；食品资料由演示门店提供，不构成安全认证。</p>
        <div class="bb-actions"><button class="btn btn-main" id="bb-quote" type="submit">获取固定报价</button><button class="btn" id="bb-new" type="button">重新选择</button></div></form>
        <section class="card"><h3>我的盲盒订单</h3><button class="btn" data-bb="account" type="button">刷新订单与积分</button><div id="bb-orders"><p class="bb-muted">点击刷新，读取该演示顾客的后端订单。</p></div></section></div>
      <div><section class="card" id="bb-offer" aria-live="polite"></section><section class="card"><h3>盲盒积分</h3><div class="bb-price" id="bb-points">— 分</div><p class="bb-muted">隐藏款奖励 10 分，在老板核销领取后到账。与原促销页面的环保积分分开记录。</p><div class="bb-note">报价不占库存，确认时重新检查。付款与身份均为本地模拟，没有真实扣款；具体商品保持隐藏。</div></section>
      <form class="card" id="bb-redeem-form" aria-labelledby="bb-redeem-title"><span class="bb-eyebrow">POINTS REDEMPTION · 本地演示</span><h3 id="bb-redeem-title">盲盒积分抵扣</h3>
        <p class="bb-muted">100 分抵 RM1；每分抵 1 sen。本次抵扣不超过正价消费金额的30%，只使用已到账盲盒积分。</p>
        <div class="bb-fields"><label>正价消费金额（RM）<input id="bb-redeem-price" type="text" inputmode="decimal" value="1.00" placeholder="例如 1.00" required></label><label>使用积分<input id="bb-redeem-points" type="text" inputmode="numeric" value="10" placeholder="正整数" required></label></div>
        <p id="bb-redeem-limit" class="bb-muted" aria-live="polite">请先刷新订单与积分，读取可用余额。</p>
        <button class="btn btn-main" id="bb-redeem-submit" type="submit">确认模拟抵扣</button>
        <button class="btn" id="bb-redeem-new" type="button" hidden>开始下一笔模拟消费</button><div id="bb-redeem-result" aria-live="polite"></div>
        <p class="bb-note">只模拟正价消费的积分抵扣，不发生真实付款、不创建真实购买订单，也不扣减商品库存。与原促销环保积分分开。</p>
      </form></div>
    </div>
    <div id="bb-owner" hidden>
    <section class="card" aria-labelledby="bb-dashboard-title"><div class="bb-dashboard-head"><div><span class="bb-eyebrow">RESCUE OVERVIEW · 后端记录</span><h3 id="bb-dashboard-title">盲盒统计看板</h3><p class="bb-muted">仅统计盲盒模块，不合并原促销页面的数字。</p></div><button class="btn" data-bb="dashboard" type="button">刷新盲盒统计</button></div>
      <div id="bb-dashboard" aria-live="polite"><p class="bb-muted">点击刷新，读取后端统计快照。</p></div>
      <details class="bb-metric-notes"><summary>这些数字代表什么？</summary><ul><li>模拟付款金额包含全部模拟已付款盲盒订单，包括未领取订单，不代表真实收入。</li><li>已领取毛利扣除商品成本和包装费；已领取金额贡献只扣包装费，尚未扣商品成本，两者都不是净利润。</li><li>食品数量、重量和 CO₂e 估算只计入已领取或已记录交接的食品，待交接和报废不计入。</li><li>CO₂e 来自演示食品重量与系数，不是认证减排量或碳积分。转化率缺少访问及正价订单归因数据，不填成0。</li></ul></details>
    </section>
    <div class="card"><h3>盲盒库存</h3><p class="bb-muted">独立的合成批次库存，不与旧促销库存混用。导入不会重置已有批次。</p><div class="bb-actions"><button class="btn btn-main" data-bb="seed" type="button">导入当天演示库存</button><button class="btn" data-bb="inventory" type="button">刷新盲盒库存</button></div><div id="bb-inventory" class="bb-scroll"></div></div>
    <div class="card"><h3>查询与核销盲盒订单</h3><label for="bb-order-id">订单 ID（从顾客的订单页复制）</label><div class="bb-actions"><input id="bb-order-id" placeholder="输入完整订单 ID"><button class="btn" data-bb="lookup" type="button">查询订单</button></div><div id="bb-owner-order"></div></div>
    <section class="card" aria-labelledby="bb-donation-title"><span class="bb-eyebrow">FOOD HANDOFF · 本地演示</span><h3 id="bb-donation-title">盲盒捐赠管理</h3>
      <p class="bb-muted">查看未领取订单和关店余料的去向。清算按后端当前时间处理；不合格食品记为报废，不能交接。</p>
      <div class="bb-actions"><button class="btn" data-bb="donations" type="button">刷新捐赠清单</button><button class="btn" data-bb="sweep" id="bb-sweep" type="button">按当前时间执行清算</button></div>
      <p class="bb-muted">领取时段结束的未领订单转入待捐赠；22:30起处理剩余库存。已领取订单不会转入捐赠，重复清算不会重复扣减。</p>
      <div class="bb-fields"><label class="bb-wide">模拟接收方名称<input id="bb-donation-recipient" maxlength="120" placeholder="例如：DEMO Community Kitchen"></label></div>
      <div id="bb-donation-retry" aria-live="polite"></div>
      <div id="bb-donations"><p class="bb-muted">点击刷新读取后端清单。待捐赠不等于已完成交接。</p></div>
      <p class="bb-note">“确认模拟交接”只记录演示库存与状态，不发送 WhatsApp、不联系机构，也不表示运输或配送已完成。</p>
    </section></div>
    <p class="bb-muted">本地演示角色切换不构成登录认证。库存、身份及模拟付款仅用于受控演示。</p>`;
  document.querySelector('main').insertBefore(panel, document.querySelector('main .foot'));
  node('bb-date').value = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const oldTabs = renderTabs;
  renderTabs = function () { oldTabs(); panel.hidden = state.tab !== 'blind'; document.body.classList.toggle('bb-open', !panel.hidden); if (!panel.hidden && state.role === 'consumer' && !busy) void action('account'); };
  const oldRole = renderRole;
  renderRole = function () {
    oldRole();
    tabItem.hidden = state.role === 'staff';
    node('bb-customer').hidden = state.role !== 'consumer';
    node('bb-owner').hidden = state.role !== 'owner';
    node('bb-title').textContent = state.role === 'owner' ? '管理今晚的救援盲盒' : '给好食物一个新去处';
    node('bb-message').textContent = '';
    node('bb-owner-order').innerHTML = ''; operatorOrder = null;
    if (state.role === 'staff' && state.tab === 'blind') switchTab('pos');
    if (state.role === 'consumer' && state.tab === 'blind' && !busy) void action('account');
  };
  function message(text, error = false) { node('bb-message').textContent = text; node('bb-message').dataset.error = String(error); }
  function controls() {
    const locked = !!(checkout.quote || checkout.quoteRequest || checkout.confirmRequest);
    panel.querySelectorAll('input,select').forEach(el => { el.disabled = busy || (el.closest('#bb-form') && locked); });
    panel.querySelectorAll('button').forEach(el => { el.disabled = busy; });
    node('bb-quote').disabled = busy || !!checkout.quote;
    node('bb-quote').textContent = checkout.quoteRequest ? '使用原请求重试报价' : '获取固定报价';
    node('bb-new').disabled = busy || !!checkout.confirmRequest || !!checkout.quoteRequest;
    node('resetBtn').disabled = busy || state.busy;
    document.querySelectorAll('[data-role]').forEach(el => { el.disabled = busy || state.busy; });
    node('bb-donation-recipient').disabled = busy || !!checkout.donationRequest;
    node('bb-sweep').disabled = busy || !!checkout.donationRequest;
    panel.querySelectorAll('[data-bb="handoff"]').forEach(button => {
      button.disabled = busy || !!checkout.donationRequest;
    });
    node('bb-redeem-price').disabled = busy || !!checkout.redeemRequest;
    node('bb-redeem-points').disabled = busy || !!checkout.redeemRequest;
    node('bb-redeem-submit').disabled = busy || (!checkout.redeemRequest && (!!checkout.redemption || !(Number.isSafeInteger(account?.points) && account.points > 0)));
    node('bb-redeem-new').hidden = !checkout.redemption;
    node('bb-redeem-new').disabled = busy || !!checkout.redeemRequest;
    node('bb-redeem-submit').textContent = checkout.redeemRequest ? '使用原请求重试抵扣' : checkout.redemption ? '本次抵扣已记录' : '确认模拟抵扣';
    const confirm = node('bb-confirm');
    if (confirm) confirm.disabled = busy || (!checkout.confirmRequest && new Date(checkout.quote.expires_at) <= new Date());
  }
  function offer() {
    const q = checkout.quote, order = checkout.order;
    if (order) {
      node('bb-offer').innerHTML = '<span class="bb-eyebrow">模拟订单已建立</span><h3>'+esc(statusName(order.status))+'</h3><div class="bb-price">'+currency(order.price_sen)+'</div><p class="bb-muted">订单 ID</p><p style="overflow-wrap:anywhere"><code>'+esc(order.order_id)+'</code></p><p>领取：'+esc(when(order.pickup_start))+' 至 '+esc(when(order.pickup_end))+'</p><p class="bb-note">未发生真实扣款。请在预约时段向老板提供订单 ID 核销。</p>';
    } else if (q) {
      const expired = new Date(q.expires_at) <= new Date();
      node('bb-offer').innerHTML = '<span class="bb-eyebrow">'+(expired?'报价已到期':'已固定的盲盒报价')+'</span><div class="bb-price">'+currency(q.price_sen)+'</div><dl class="bb-facts"><div><dt>盒内件数</dt><dd>'+q.qty_range.min+'–'+q.qty_range.max+' 件</dd></div><div><dt>已知过敏原</dt><dd>'+esc(q.allergens.length ? q.allergens.join(', ') : '资料声明无已知项')+'</dd></div><div><dt>领取时段</dt><dd>'+esc(when(q.pickup_start))+' 至 '+esc(when(q.pickup_end))+'</dd></div><div><dt>最迟确认时间</dt><dd>'+esc(when(q.expires_at))+'</dd></div></dl><p class="bb-note">具体商品保持隐藏。此价格对应服务器已选定的盒子，确认时不会重新抽盒。报价尚未预留库存。</p><button type="button" class="btn btn-main" id="bb-confirm" data-bb="confirm">'+(checkout.confirmRequest?'使用原请求重试确认':'确认模拟付款 · '+currency(q.price_sen))+'</button>';
    } else {
      node('bb-offer').innerHTML = '<span class="bb-eyebrow">等待你的选择</span><h3>惊喜在盒里，价格先看清。</h3><p class="bb-muted">填写领取条件后，查看固定价格、件数范围与过敏原。你确认之前不会创建付款订单。</p>';
    }
    renderRedemption(); controls();
  }
  function requestBody() {
    const date = node('bb-date').value, slot = node('bb-slot').value;
    if (!date) throw new Error('请选择领取日期。');
    return {user_id:USER,idempotency_key:key('quote'),pickup_start:date+'T'+slot+':00+08:00',
      pickup_end:date+'T'+(slot==='21:30'?'22:00':'22:30')+':00+08:00',mode:node('bb-mode').value,
      preferences:{avoid_allergens:node('bb-allergens').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),required_diets:node('bb-diet').value?[node('bb-diet').value]:[],likes:node('bb-like').value?[node('bb-like').value]:[],dislikes:[]}};
  }
  async function getQuote() {
    if (busy || state.role !== 'consumer' || checkout.quote) return;
    busy = true; controls(); message('正在为你匹配盲盒…');
    try {
      checkout.quoteRequest ||= requestBody(); checkout.selection = checkout.quoteRequest; persist();
      checkout.quote = await call('/quotes', checkout.quoteRequest);
      checkout.quoteRequest = null; checkout.order = null; persist();
      message('报价已固定。请核对价格、过敏原与领取时段后，再确认模拟付款。');
    } catch (err) { if (!err.uncertain) checkout.quoteRequest = null; message(err.message, true); }
    finally { busy = false; offer(); }
  }
  async function confirm() {
    if (busy || state.role !== 'consumer' || !checkout.quote) return;
    busy = true; controls(); message('正在确认原报价并检查库存…');
    try {
      checkout.confirmRequest ||= {quote_id:checkout.quote.quote_id,user_id:USER,idempotency_key:key('confirm')}; persist();
      checkout.order = await call('/quotes/confirm', checkout.confirmRequest);
      checkout.confirmRequest = null; checkout.quote = null; persist();
      message('模拟付款成功。订单和领取信息已保存，未实际扣款。');
      try { await loadAccount(); } catch (_) { message('模拟付款已确认；订单列表暂时未刷新，请点击刷新订单与积分。'); }
    } catch (err) { if (!err.uncertain) checkout.confirmRequest = null; message(err.message, true); }
    finally { busy = false; offer(); }
  }
  async function loadAccount() {
    account = await call('/customer/account?user_id='+encodeURIComponent(USER));
    node('bb-points').textContent = account.points+' 分';
    node('bb-orders').innerHTML = account.orders.length ? account.orders.map(o=>'<article class="bb-order"><strong>'+esc(statusName(o.status))+'</strong><p>'+currency(o.price_sen)+' · '+esc(when(o.pickup_start))+'</p><code>'+esc(o.order_id)+'</code><p class="bb-muted">待到账 '+o.pending_points+' 分 · 本单已到账 '+o.points_awarded+' 分</p></article>').join('') : '<p class="bb-muted">还没有盲盒订单。</p>';
    if (checkout.order) { checkout.order = account.orders.find(o=>o.order_id===checkout.order.order_id) || checkout.order; persist(); }
  }
  async function inventory() {
    stock = (await call('/inventory')).batches;
    node('bb-inventory').innerHTML = stock.length ? '<table><thead><tr><th>商品 / 批次</th><th>可用</th><th>预留</th><th>安全期限</th></tr></thead><tbody>'+stock.map(b=>'<tr><td>'+esc(b.name)+'<br><small>'+esc(b.batch_id)+'</small></td><td>'+b.available+'</td><td>'+b.reserved+'</td><td>'+esc(when(b.safe_until))+'</td></tr>').join('')+'</tbody></table>' : '<p class="bb-muted">暂无批次。可明确导入当天演示库存。</p>';
  }
  async function lookup() {
    const id = node('bb-order-id').value.trim();
    operatorOrder = null; node('bb-owner-order').innerHTML = '';
    if (!id) throw new Error('请输入订单 ID。');
    const order = await call('/orders/'+encodeURIComponent(id));
    await inventory(); operatorOrder = order;
    node('bb-owner-order').innerHTML = '<h4>'+esc(statusName(order.status))+'</h4><p>售价 '+currency(order.price_sen)+' · 商品成本 '+currency(order.cost_sen)+'</p><ul>'+order.lines.map(l=>'<li>'+esc(stock.find(b=>b.batch_id===l.batch_id)?.name || l.batch_id)+' × '+l.qty+'</li>').join('')+'</ul><p>待到账 '+order.pending_points+' 分 · 已到账 '+order.points_awarded+' 分</p>'+(order.status==='RESERVED'?'<button class="btn btn-main" data-bb="pickup" type="button">确认到店领取（模拟核销）</button>':'');
  }
  function regularPriceSen() {
    const raw = node('bb-redeem-price').value.trim();
    if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(raw)) throw new Error('正价金额请输入最多两位小数，例如1.00；不能输入负数或科学计数。');
    const [whole, fraction=''] = raw.split('.');
    const sen = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
    if (sen < 1 || sen > 1000000) throw new Error('正价金额范围为RM0.01至RM10000.00。');
    return sen;
  }
  function renderRedemption() {
    const pending = checkout.redeemRequest;
    if (pending) {
      node('bb-redeem-price').value = (pending.regular_price_sen / 100).toFixed(2);
      node('bb-redeem-points').value = String(pending.points);
    }
    try {
      const cap = Math.floor(regularPriceSen()*30/100);
      node('bb-redeem-limit').textContent = Number.isSafeInteger(account?.points)
        ? '已到账 '+account.points+' 分；按30%规则，本次最多可用 '+Math.min(cap,account.points)+' 分。'
        : '请先刷新订单与积分，读取可用余额。';
    } catch (err) { node('bb-redeem-limit').textContent = err.message; }
    const result = checkout.redemption;
    node('bb-redeem-result').innerHTML = result ? '<section class="bb-redemption-receipt"><h4>最近一次模拟抵扣结果</h4><dl class="bb-facts"><div><dt>正价消费金额</dt><dd>'+currency(result.regular_price_sen)+'</dd></div><div><dt>使用积分</dt><dd>'+result.points_used+' 分</dd></div><div><dt>抵扣金额</dt><dd>'+currency(result.discount_sen)+'</dd></div><div><dt>抵扣后模拟应付</dt><dd>'+currency(result.paid_sen)+'</dd></div></dl><p class="bb-muted">已由后端记录，没有真实扣款。</p></section>' : '';
  }
  async function redeem() {
    if (busy || state.role !== 'consumer' || (checkout.redemption && !checkout.redeemRequest)) return;
    try {
      if (!checkout.redeemRequest) {
        if (!Number.isSafeInteger(account?.points)) throw new Error('请先刷新订单与积分，读取可用余额。');
        const regular_price_sen = regularPriceSen();
        const raw = node('bb-redeem-points').value.trim();
        if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('使用积分请输入正整数，不能使用小数或负数。');
        const points = Number(raw);
        if (points > account.points) throw new Error('盲盒积分不足，只能使用已到账的盲盒积分。');
        if (points*100 > regular_price_sen*30) throw new Error('积分抵扣不能超过本次正价消费金额的30%。');
        checkout.redeemRequest = {user_id:USER,idempotency_key:key('redeem'),regular_price_sen,points};
      }
      persist();
    } catch (err) { message(err.message,true); renderRedemption(); controls(); return; }
    busy = true; controls(); message('正在确认模拟抵扣并检查已到账积分…');
    try {
      const sent = checkout.redeemRequest;
      const result = await call('/points/redeem', sent);
      checkout.redemption = {regular_price_sen:sent.regular_price_sen,discount_sen:result.discount_sen,
        paid_sen:result.paid_sen,points_used:result.points_used};
      checkout.redeemRequest = null; persist();
      message('模拟抵扣已记录。没有真实付款或商品出库。');
      account = null; node('bb-points').textContent = '— 分';
      try { await loadAccount(); } catch (_) { message('抵扣已记录；余额暂未刷新，请点击刷新订单与积分。'); }
    } catch (err) {
      if (!err.uncertain) { checkout.redeemRequest = null; try { persist(); } catch (_) {} }
      message(err.uncertain ? '抵扣结果尚未确认，请使用原请求重试。金额与积分已固定，不会生成新的抵扣请求。' : err.message,true);
    } finally { busy = false; offer(); }
  }
  function renderDashboard(data) {
    const valid = value => typeof value === 'number' && Number.isFinite(value);
    const amount = value => valid(value) ? currency(value) : '—';
    const count = value => valid(value) ? String(value) : '—';
    const weight = value => valid(value) ? (value / 1000).toFixed(3)+' kg' : '—';
    const carbon = value => valid(value) ? value.toFixed(3)+' kg CO₂e' : '—';
    const percent = value => valid(value) ? (value * 100).toFixed(1)+'%' : '暂无数据';
    const cards = [
      ['模拟付款金额', amount(data.simulated_revenue_sen), '包括已付款但未领取的订单'],
      ['已领取毛利（演示）', amount(data.picked_up_gross_profit_sen), '扣除商品成本及包装费；非净利润'],
      ['已领取食品', count(data.picked_up_qty)+' 件', '顾客已经核销领取'],
      ['已记录交接食品', count(data.donated_qty)+' 件', '仅已交接，待交接不计入'],
      ['已领取重量', weight(data.picked_up_weight_g), '来自已领取订单'],
      ['已交接重量', weight(data.donated_weight_g), '来自已记录交接清单'],
      ['食品 CO₂e 估算', carbon(data.estimated_co2e_kg), '已领取及已交接；不是认证减排'],
      ['已领取金额贡献', amount(data.picked_up_contribution_sen), '只扣包装费，尚未扣商品成本'],
    ];
    node('bb-dashboard').innerHTML = '<div class="bb-dashboard-grid">'+cards.map(([label,value,note])=>'<article class="bb-metric"><h4>'+esc(label)+'</h4><strong>'+esc(value)+'</strong><p>'+esc(note)+'</p></article>').join('')+'</div><div class="bb-rate-grid"><p>盲盒转化率 <strong>'+esc(percent(data.conversion_rate))+'</strong></p><p>积分抵扣复购率 <strong>'+esc(percent(data.redemption_repurchase_rate))+'</strong></p></div><p class="bb-muted">数据来自后端统计快照。没有已核实的访问和正价订单归因资料时，两项比率显示“暂无数据”。</p>';
  }
  async function loadDashboard() {
    node('bb-dashboard').innerHTML = '<p class="bb-muted">正在读取后端统计…</p>';
    try { renderDashboard(await call('/dashboard')); }
    catch (err) {
      node('bb-dashboard').innerHTML = '<p class="bb-muted">统计读取失败，暂不展示旧数字。请点击刷新盲盒统计重试。</p>';
      throw err;
    }
  }
  async function refreshDashboardAfterWrite() {
    try { await loadDashboard(); } catch (_) { /* The recorded operation still succeeded. */ }
  }
  function renderDonations() {
    const pending = checkout.donationRequest;
    if (pending) node('bb-donation-recipient').value = pending.recipient;
    node('bb-donation-retry').innerHTML = pending ? '<div class="bb-note"><p>交接结果尚未确认。请重试原记录，接收方已固定为：'+esc(pending.recipient)+'</p><button type="button" class="btn btn-main" data-bb="retry-handoff">使用原请求重试交接</button></div>' : '';
    if (!donations.length) {
      node('bb-donations').innerHTML = '<p class="bb-muted">暂无捐赠记录。未到截止时间且没有未领订单时，这是正常情况。</p>';
      controls(); return;
    }
    const labels = {PENDING:'待交接',DONATED:'已记录交接（演示）',DISCARDED:'已记为报废'};
    const counts = ['PENDING','DONATED','DISCARDED'].map(status => '<span class="bb-donation-count">'+labels[status]+' <strong>'+donations.filter(d=>d.status===status).length+'</strong></span>').join('');
    const rows = donations.map(d => {
      const lines = d.payload.lines.map(line => esc(stock.find(b=>b.batch_id===line.batch_id)?.name || line.batch_id)+' × '+line.qty).join('<br>');
      const origin = d.source_order ? '未领订单 '+esc(d.source_order) : '关店余料 / 库存清算';
      const action = d.status==='PENDING' ? '<button class="btn btn-main" type="button" data-bb="handoff" data-donation="'+esc(d.id)+'">确认模拟交接</button>' : '<span class="bb-muted">'+(d.status==='DONATED'?esc(d.recipient):'不可交接')+'</span>';
      return '<tr><td><code>'+esc(d.id)+'</code><br><small>'+origin+'</small></td><td>'+lines+'</td><td><span class="bb-donation-state" data-status="'+esc(d.status)+'">'+esc(labels[d.status] || d.status)+'</span></td><td>'+action+'</td></tr>';
    }).join('');
    node('bb-donations').innerHTML = '<div class="bb-donation-counts">'+counts+'</div><div class="bb-scroll"><table><thead><tr><th>记录 / 来源</th><th>商品数量</th><th>状态</th><th>模拟交接 / 接收方</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    controls();
  }
  async function loadDonations() {
    const result = await call('/donations');
    await inventory();
    donations = result.donations;
    renderDonations();
  }
  async function handoff(id) {
    if (busy || state.role !== 'owner') return;
    const pending = checkout.donationRequest;
    if (pending && pending.donation_id !== id) {
      message('请先重试并确认上一笔交接结果。', true); return;
    }
    if (!pending && !donations.some(d=>d.id===id && d.status==='PENDING')) {
      message('请先刷新清单，并选择一笔待交接记录。', true); return;
    }
    const recipient = pending?.recipient || node('bb-donation-recipient').value.trim();
    if (!recipient || recipient.length > 120) {
      message('请填写1至120个字符的模拟接收方名称。', true); return;
    }
    busy = true; controls(); message('正在记录模拟交接并重新检查食品状态…');
    try {
      checkout.donationRequest ||= {donation_id:id,recipient}; persist();
      await call('/donations/handoff', checkout.donationRequest);
      checkout.donationRequest = null; persist();
      message('已记录模拟交接。没有联系机构或实际配送。');
      try { await loadDonations(); } catch (_) { message('模拟交接已记录；清单暂未刷新，请点击刷新捐赠清单。'); }
      await refreshDashboardAfterWrite();
    } catch (err) {
      if (!err.uncertain) {
        checkout.donationRequest = null;
        try { persist(); } catch (_) {}
      }
      message(err.uncertain ? '交接结果尚未确认。请使用原请求重试，不要更换接收方。' : err.message, true);
    } finally { busy = false; renderDonations(); offer(); }
  }
  async function action(name, donationId) {
    if (busy) return;
    if (name === 'confirm') return confirm();
    if (name === 'handoff') return handoff(donationId);
    if (name === 'retry-handoff') return handoff(checkout.donationRequest?.donation_id);
    if (name === 'account' && state.role !== 'consumer') return;
    if (['inventory','seed','lookup','pickup','donations','sweep','dashboard'].includes(name) && state.role !== 'owner') return;
    if (name === 'sweep' && checkout.donationRequest) { message('请先确认上一笔交接结果。', true); return; }
    busy = true; controls(); message('正在读取盲盒数据…');
    try {
      if (name==='dashboard') { await loadDashboard(); message('盲盒统计已从后端刷新。'); }
      if (name==='donations') { await loadDonations(); message('捐赠清单已刷新。待交接记录尚未算作完成捐赠。'); }
      if (name==='sweep') {
        const result = await call('/sweep', {});
        try { await loadDonations(); message('清算完成，本次处理 '+result.no_shows_processed+' 笔未领订单；清单已更新。'); }
        catch (_) { message('清算已完成；清单暂未刷新，请点击刷新捐赠清单。'); }
      }
      if (name==='account') { await loadAccount(); message('订单与盲盒积分已刷新。'); }
      if (name==='inventory') { await inventory(); message('库存已刷新。'); }
      if (name==='seed') { await call('/demo-seed', {}); await inventory(); message('已导入当天合成演示库存。'); }
      if (name==='lookup') { await lookup(); message('已读取完整订单（老板演示视图）。'); }
      if (name==='pickup' && operatorOrder) { await call('/pickup', {order_id:operatorOrder.order_id}); await lookup(); message('核销完成，符合条件的盲盒积分已到账。'); }
      if (['seed','pickup','sweep'].includes(name)) await refreshDashboardAfterWrite();
    } catch (err) { message(err.message, true); }
    finally { busy = false; offer(); }
  }
  node('bb-redeem-new').addEventListener('click', () => {
    if (busy || state.role !== 'consumer' || checkout.redeemRequest) return;
    checkout.redemption = null;
    try { persist(); message('可填写下一笔模拟正价消费。'); } catch (err) { message(err.message,true); }
    renderRedemption(); controls();
  });
  node('bb-redeem-form').addEventListener('submit', e => { e.preventDefault(); void redeem(); });
  ['bb-redeem-price','bb-redeem-points'].forEach(id => node(id).addEventListener('input', () => { renderRedemption(); controls(); }));
  node('bb-form').addEventListener('submit', e => { e.preventDefault(); void getQuote(); });
  node('bb-new').addEventListener('click', () => {
    if (busy || checkout.quoteRequest || checkout.confirmRequest) return;
    checkout.quote = null; checkout.order = null;
    try { persist(); message('可重新选择条件。已确认的订单仍保留在订单列表中。'); } catch (err) { message(err.message,true); }
    offer();
  });
  panel.addEventListener('click', e => { const button = e.target.closest('[data-bb]'); if (button) void action(button.dataset.bb, button.dataset.donation); });
  setInterval(() => { if (!panel.hidden && checkout.quote && !busy) controls(); }, 1000);
  if (checkout.selection) {
    const selection = checkout.selection;
    node('bb-date').value = selection.pickup_start.slice(0,10);
    node('bb-slot').value = selection.pickup_start.slice(11,16);
    node('bb-mode').value = selection.mode;
    node('bb-allergens').value = selection.preferences.avoid_allergens.join(', ');
    node('bb-diet').value = selection.preferences.required_diets[0] || '';
    node('bb-like').value = selection.preferences.likes[0] || '';
  }
  if (checkout.donationRequest) renderDonations();
  renderRole(); renderTabs(); offer();
})();
