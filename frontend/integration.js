/* Unified desktop shell. Amounts and completion states come from backend responses. */
(() => {
  'use strict';
  const node = id => document.getElementById(id);
  const tabs = ['pos','dash','log','blind','customer','rescue'];
  let dashboard = null, dashboardVersion = 0, balanceVersion = 0;
  let userId = 'demo_mei_ling', purchase = null, demoTime = null, sessionBusy = false;
  let mounted = false, leftoversRegistered = false;
  const available = (n, integer = false) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && (!integer || Number.isSafeInteger(n));
  const value = (data, key, integer = false) => available(data?.[key], integer) ? data[key] : null;
  const label = n => n === null ? '暂无数据' : String(n);
  const context = () => ({role:state.role, userId, demoTime, leftoversRegistered,
    quantities:{...state.qty}, draft:state.draft ? {items:state.draft.items.map(i => ({...i})), text:state.draft.text} : null});

  function shareText(data) {
    if (!data) return '';
    const revenue = value(data,'simulated_revenue_sen',true);
    const pickup = value(data,'picked_up_qty',true), donation = value(data,'donated_qty',true);
    const carbon = value(data,'estimated_co2e_kg');
    return '【Nexflow 演示成果】当前演示账本累计：模拟已付款收入 ' +
      (revenue === null ? '暂无数据' : 'RM' + (revenue/100).toFixed(2)) +
      '；已完成取餐食品 ' + label(pickup) + (pickup === null ? '' : ' 件') +
      '；已交接捐赠食品 ' + label(donation) + (donation === null ? '' : ' 件') +
      '；已取餐与已交接食品的 CO₂e 足迹估算 ' + label(carbon) + (carbon === null ? '' : ' kg') +
      '。收入与交接均为演示记录；预计售出、待取餐和待捐赠不算已完成成果。环保数字不是经认证的减排量或碳积分。';
  }

  function paintDashboard() {
    const revenue = value(dashboard,'simulated_revenue_sen',true);
    node('actualRevenue').textContent = revenue === null ? '暂无数据' : 'RM' + (revenue/100).toFixed(2);
    node('actualPickup').textContent = label(value(dashboard,'picked_up_qty',true));
    node('actualDonation').textContent = label(value(dashboard,'donated_qty',true));
    node('actualCarbon').textContent = label(value(dashboard,'estimated_co2e_kg'));
    for (const [id,key] of [['conversionRate','conversion_rate'],['repurchaseRate','redemption_repurchase_rate']]) {
      const n = value(dashboard,key);
      node(id).textContent = n === null || n > 1 ? '暂无数据' : (n*100).toFixed(1) + '%';
    }
    node('rescueShare').value = shareText(dashboard);
    node('copyRescue').disabled = !dashboard;
  }

  async function refreshDashboard() {
    const version = ++dashboardVersion;
    dashboard = null; paintDashboard();
    node('refreshDashboard').disabled = true;
    node('dashboardHint').dataset.error = 'false';
    node('dashboardHint').textContent = '正在读取后端经营数据…';
    try {
      const result = await api('/api/blind-boxes/dashboard');
      if (version !== dashboardVersion) return;
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('经营数据格式无效');
      dashboard = result; paintDashboard();
      node('dashboardHint').textContent = '已读取当前演示数据库。未提供的指标显示暂无数据。';
    } catch (err) {
      if (version !== dashboardVersion) return;
      dashboard = null; paintDashboard();
      node('dashboardHint').dataset.error = 'true';
      node('dashboardHint').textContent = '经营数据加载失败：' + err.message + '。请点击刷新统计重试。';
    } finally {
      if (version === dashboardVersion) node('refreshDashboard').disabled = false;
    }
  }

  async function refreshBalance() {
    const version = ++balanceVersion, selected = userId;
    node('accountBalance').textContent = '暂无数据';
    node('balanceHint').dataset.error = 'false';
    if (!purchase?.getBalance) {
      node('balanceHint').textContent = '等待购买负责人提供账户接口；不维护页面虚拟余额。';
      return;
    }
    node('balanceHint').textContent = '正在读取购买模块账户余额…';
    try {
      const result = await purchase.getBalance(selected);
      if (version !== balanceVersion) return;
      if (result?.user_id !== selected || !available(result.points,true)) throw new Error('账户余额缺失或账户不匹配');
      node('accountBalance').textContent = result.points + ' 分';
      node('balanceHint').textContent = '来自购买模块账户接口；广播和预测不会增加余额。';
    } catch (err) {
      if (version !== balanceVersion) return;
      node('balanceHint').dataset.error = 'true';
      node('balanceHint').textContent = '余额读取失败：' + err.message + '。再次选择此账户可重试。';
    }
  }

  const ROLE_PAGES = {customer:'consumer', staff:'staff', boss:'owner'};
  function navigate(target) {
    if (ROLE_PAGES[target]) { enterRoleWindow(target); return; }
    if (!tabs.includes(target)) target = 'pos';
    switchTab(target);
  }
  function onNavigate(tab) {
    const hash = '#' + (rolePage || tab);
    if (window.location.hash !== hash) window.history.replaceState(null,'',hash);
    // Hide the phone only for the wide rescue workspace. Other page state stays mounted.
    node('phoneWrap').hidden = ['rescue','customer'].includes(tab);
    document.body.classList.toggle('rescue-open', ['rescue','customer'].includes(tab));
    if (tab === 'dash') refreshDashboard();
    if (tab === 'customer') refreshBalance();
    if (tab === 'rescue') window.NexflowRescue?.refresh();
  }
  function roleChanged() {
    document.body.dataset.role = state.role;
    window.NexflowRescue?.roleChanged();
    node('closeDemo').disabled = sessionBusy || state.busy || state.role === 'consumer' || !!demoTime?.includes('T22:31');
    node('registerDemoLeftovers').disabled = sessionBusy || state.busy || state.role === 'consumer' || leftoversRegistered || !!demoTime?.includes('T22:31');
    purchase?.onContextChanged?.(context());
    const home = state.role === 'consumer' ? 'customer' : state.role === 'owner' ? 'dash' : 'pos';
    switchTab(home); // 切到该角色的默认区域；不经过 navigate，避免重复进入角色窗口
  }

  async function copyText(text, field) {
    if (!text?.trim()) { toast('暂无可复制内容，请先生成或刷新数据'); return false; }
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制，可粘贴分享；未发送消息');
      return true;
    } catch {
      if (field) { field.focus(); field.select(); }
      toast(field ? '无法自动复制，已选中文字，请按 Ctrl+C 手动复制' : '无法自动复制，请从页面文案手动复制');
      return false;
    }
  }

  async function changed(kind) {
    state.blind.result = null; state.blind.batches = null;
    window.NexflowRescue?.invalidate();
    renderBlindInventory(); renderBlindResult();
    addLog(roleName(), '更新演示业务状态', String(kind || 'module'), '', 'info');
    await Promise.all([refreshDashboard(), refreshBalance()]);
  }

  function paintSession() {
    node('demoSession').hidden = !demoTime;
    node('demoClock').textContent = demoTime ? '演示门店时间：' + demoTime.replace('T',' ').replace('+08:00',' UTC+08:00') + '；不会修改电脑时间。' : '';
    node('closeDemo').disabled = sessionBusy || state.busy || state.role === 'consumer' || !!demoTime?.includes('T22:31');
    node('registerDemoLeftovers').disabled = sessionBusy || state.busy || state.role === 'consumer' || leftoversRegistered || !!demoTime?.includes('T22:31');
  }
  async function loadSession() {
    try {
      const result = await api('/api/demo/session');
      demoTime = result.demo_only === true && typeof result.now === 'string' ? result.now : null;
      leftoversRegistered = result.leftovers_registered === true;
    } catch { demoTime = null; }
    paintSession();
    // “含演示初始积分”只在比赛演示会话出现；普通服务没有初始赠送。
    (document.querySelectorAll?.('[data-demo-initial-points]') || []).forEach(el => { el.hidden = !demoTime; });
  }
  async function closeDemo() {
    if (sessionBusy || state.busy || !demoTime || state.role === 'consumer') return;
    sessionBusy = true; paintSession(); node('demoHint').textContent = '正在推进演示时钟并清算…';
    try {
      const result = await api('/api/demo/close', {});
      demoTime = result.now; paintSession();
      await changed('演示打烊清算');
      await window.NexflowRescue?.refresh();
      node('demoHint').textContent = '已推进至打烊；请在打烊去向确认待捐赠交接。';
    } catch(err) { node('demoHint').textContent = '推进失败：' + err.message; }
    finally { sessionBusy = false; paintSession(); }
  }

  async function registerLeftovers() {
    if (sessionBusy || state.busy || !demoTime || state.role === 'consumer' || leftoversRegistered) return;
    const items = state.draft?.items || state.result?.items;
    if (!items?.length) { node('demoHint').textContent = '请先提交盘点并成功生成促销草稿，再登记本次余货。'; return; }
    sessionBusy = true; paintSession();
    node('demoHint').textContent = '正在登记本次合成演示余货…';
    try {
      const result = await api('/api/demo/leftovers', items.map(item => ({item:item.item, qty:item.qty})));
      leftoversRegistered = true;
      node('demoHint').textContent = '已登记本次盘点 ' + result.registered_qty + ' 件。后续建议、清算和交接使用这些批次；无需再载入独立样本。';
      await changed('登记本次盘点为合成演示批次');
      navigate('rescue');
    } catch(err) { node('demoHint').textContent = '登记失败：' + err.message + '。可重试；同一份盘点不会重复入库。'; }
    finally { sessionBusy = false; paintSession(); }
  }

  // The purchase owner supplies the adapter; the shell never invents a balance or an order.
  async function registerPurchase(adapter) {
    if (mounted) throw new Error('购买模块已注册');
    if (!adapter || typeof adapter.mount !== 'function' || typeof adapter.getBalance !== 'function') throw new Error('购买模块需提供 mount 和 getBalance');
    mounted = true;
    try {
      await adapter.mount({purchaseRoot:node('purchaseModule'), pickupRoot:node('pickupModule'),
        api, getContext:context, navigate, changed});
      purchase = adapter;
      await refreshBalance();
    } catch(err) { mounted = false; throw err; }
  }

  window.Nexflow = {getContext:context, navigate, onNavigate, roleChanged, refreshDashboard, refreshBalance,
    registerPurchase, changed, copyText,
    resetView() {
      if (rolePage) enterRoleWindow(rolePage); // 重置后仍留在同一个角色窗口
      else { document.body.dataset.role = state.role; navigate('pos'); }
      paintSession(); window.NexflowRescue?.refresh(); refreshDashboard(); refreshBalance();
    },
    shareText, busyChanged:paintSession};
  node('refreshDashboard').onclick = refreshDashboard;
  node('copyRescue').onclick = () => copyText(node('rescueShare').value,node('rescueShare'));
  node('selectCustomer').onclick = () => {
    const selected = node('demoCustomer').value.trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(selected)) {
      node('customerHint').textContent = '账户 ID 只允许 1–80 位字母、数字、下划线或短横线。'; return;
    }
    userId = selected; node('customerHint').textContent = '当前账户：' + userId;
    refreshBalance(); purchase?.onContextChanged?.(context());
  };
  node('closeDemo').onclick = closeDemo;
  node('registerDemoLeftovers').onclick = registerLeftovers;
  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-copy-promo]')) return;
    const field = node('copyBox');
    const text = state.draft ? field?.value : state.result?.text;
    copyText(text, field || node('approvedPromoCopy'));
  });
  window.addEventListener('hashchange', () => navigate(window.location.hash.slice(1)));
  window.addEventListener('load', async () => {
    document.body.dataset.role = state.role;
    await loadSession();
    navigate(window.location.hash.slice(1));
    if (state.tab !== 'dash') refreshDashboard();
    refreshBalance();
  });
})();
