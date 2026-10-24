/* Unified desktop shell. Amounts and completion states come from backend responses. */
(() => {
  'use strict';
  const node = id => document.getElementById(id) || null;
  // 三语言文案：i18n.js 先于本文件加载；测试环境没有该全局时退回键名，避免抛错。
  const t = (key, vars) => (window.NexFlowI18N ? window.NexFlowI18N.t(key, vars) : key);
  // 业务卡片可能整体被删除：所有 DOM 写入都走空安全工具，避免空引用异常。
  const setText = (el, next) => { if (el) el.textContent = next; };
  const setValue = (el, next) => { if (el) el.value = next; };
  const setDisabled = (el, flag) => { if (el) el.disabled = !!flag; };
  const setHidden = (el, flag) => { if (el) el.hidden = !!flag; };
  const setHint = (el, message, isError) => {
    if (!el) return;
    el.dataset.error = isError ? 'true' : 'false';
    el.textContent = message;
  };
  const bind = (el, handler) => { if (el) el.onclick = handler; };
  // 角色窗口状态由 index.html 的内联脚本持有；测试或独立挂载时没有该全局变量。
  const currentRolePage = () => (typeof rolePage === 'undefined' ? null : rolePage);

  const tabs = ['pos','dash','log','blind','customer','rescue'];
  let dashboard = null, dashboardVersion = 0, balanceVersion = 0;
  let userId = 'demo_mei_ling', purchase = null, demoTime = null, sessionBusy = false;
  let mounted = false, leftoversRegistered = false, registeredQty = null;
  const available = (n, integer = false) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && (!integer || Number.isSafeInteger(n));
  const value = (data, key, integer = false) => available(data?.[key], integer) ? data[key] : null;
  const label = n => n === null ? '暂无数据' : String(n);
  const context = () => ({role:state.role, userId, demoTime, leftoversRegistered,
    quantities:{...state.qty}, draft:state.draft ? {items:state.draft.items.map(i => ({...i})), text:state.draft.text} : null});

  /* ---------------- 门店动作的节点约定（合同 v1.1） ----------------
     打烊盘点页：registerLeftoversAction / leftoversFlowCard / leftoversFlowHint
     打烊去向页：finishDayAction / finishDayCard / finishDayHint
     六个节点全部缺失时页面照常工作，只是不显示这两个动作。 */
  const ui = {
    leftoversBox: () => node('leftoversFlowCard'),
    leftoversBtn: () => node('registerLeftoversAction'),
    leftoversHint: () => node('leftoversFlowHint'),
    endDayBox: () => node('finishDayCard'),
    endDayBtn: () => node('finishDayAction'),
    endDayHint: () => node('finishDayHint'),
  };

  const canOperate = () => state.role !== 'consumer'; // 确认余货：店员与老板都能做
  const canFinishDay = () => state.role === 'owner';  // 结束营业：只允许老板演示角色
  const storeMinutes = () => {
    const match = /T(\d{2}):(\d{2})/.exec(String(demoTime || ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const isClosed = () => { const minutes = storeMinutes(); return minutes !== null && minutes >= 22 * 60 + 30; };
  const storeTimeText = () => {
    const match = /T(\d{2}:\d{2})/.exec(String(demoTime || ''));
    return match ? match[1] + ' UTC+08:00' : '未知';
  };
  // 已提交盘点（草稿）或已审批结果都能确认余货；被拒绝时没有 items，不能登记。
  const draftItems = () => {
    const draft = Array.isArray(state.draft?.items) ? state.draft.items : null;
    if (draft?.length) return draft;
    return Array.isArray(state.result?.items) ? state.result.items : [];
  };
  const draftQty = () => draftItems().reduce((sum, item) => sum + (Number.isSafeInteger(item.qty) ? item.qty : 0), 0);
  const leftoversOpen = () => canOperate() && !!demoTime && !leftoversRegistered && !isClosed();
  const endDayOpen = () => canFinishDay() && !!demoTime && !isClosed();

  /* ---------------- 业务提示：默认文案 + 本次操作的结果 ---------------- */
  const status = {leftovers:{key:'', vars:null, error:false}, endDay:{key:'', vars:null, error:false}};
  let signature = null;

  function baseline(key) {
    if (key === 'leftovers') {
      if (!demoTime || !canOperate()) return '';
      if (leftoversRegistered) {
        const qty = Number.isSafeInteger(registeredQty) ? t('store.baseQty', {n:registeredQty}) : '';
        return t('store.baseRegistered', {qty});
      }
      if (isClosed()) return t('store.baseClosed');
      if (!draftItems().length) return t('store.baseNeedDraft');
      return t('store.baseReady', {items:draftItems().length, qty:draftQty()});
    }
    if (!demoTime) return '';
    if (!canOperate()) return '';
    if (!canFinishDay()) return t('store.finishOwnerOnly');
    if (isClosed()) {
      return t('store.endDayClosed', {time:storeTimeText()}) +
        (leftoversRegistered ? t('store.endDayWith') : t('store.endDayWithout'));
    }
    return leftoversRegistered ? t('store.endDayReady') : t('store.endDayNoLeftovers');
  }

  function paintHints() {
    const left = status.leftovers.key ? t(status.leftovers.key, status.leftovers.vars) : baseline('leftovers');
    const end = status.endDay.key ? t(status.endDay.key, status.endDay.vars) : baseline('endDay');
    setHint(ui.leftoversHint(), left, status.leftovers.error);
    setHint(ui.endDayHint(), end, status.endDay.error);
  }
  // 业务状态一变就清空上一次的结果提示，避免旧错误盖住新状态。
  function syncSignature() {
    const next = [demoTime, leftoversRegistered, isClosed(), draftQty(), state.role].join('|');
    if (signature !== null && next !== signature) {
      status.leftovers = {key:'', vars:null, error:false};
      status.endDay = {key:'', vars:null, error:false};
    }
    signature = next;
  }
  // 提示以“键 + 变量”保存，切换语言后重新渲染仍是当前语言，而不是旧语言的快照。
  function setStatus(key, messageKey, vars, error = false) {
    status[key] = {key: messageKey || '', vars: vars || null, error: !!error};
    paintHints();
  }

  function shareText(data) {
    if (!data) return '';
    const revenue = value(data,'simulated_revenue_sen',true);
    const pickup = value(data,'picked_up_qty',true), donation = value(data,'donated_qty',true);
    const carbon = value(data,'estimated_co2e_kg');
    return '【' + t('dash.sharePrefix') + '】' + t('dash.shareBody', {
      revenue: revenue === null ? t('common.noData') : 'RM' + (revenue/100).toFixed(2),
      pickup: pickup === null ? t('common.noData') : t('common.items', {n:pickup}),
      donation: donation === null ? t('common.noData') : t('common.items', {n:donation}),
      carbon: carbon === null ? t('common.noData') : carbon + ' kg'
    });
  }

  function paintDashboard() {
    const revenue = value(dashboard,'simulated_revenue_sen',true);
    setText(node('actualRevenue'), revenue === null ? t('common.noData') : 'RM' + (revenue/100).toFixed(2));
    setText(node('actualPickup'), label(value(dashboard,'picked_up_qty',true)));
    setText(node('actualDonation'), label(value(dashboard,'donated_qty',true)));
    setText(node('actualCarbon'), label(value(dashboard,'estimated_co2e_kg')));
    for (const [id,key] of [['conversionRate','conversion_rate'],['repurchaseRate','redemption_repurchase_rate']]) {
      const n = value(dashboard,key);
      setText(node(id), n === null || n > 1 ? t('common.noData') : (n*100).toFixed(1) + '%');
    }
    setValue(node('rescueShare'), shareText(dashboard));
    setDisabled(node('copyRescue'), !dashboard);
  }

  // 看板状态行同样以“键 + 变量”保存，切换语言后可重新渲染。
  let dashHint = {key:'dash.hintLoading', vars:null, error:false};
  function paintDashHint() {
    const el = node('dashboardHint');
    setHint(el, t(dashHint.key, dashHint.vars), dashHint.error);
  }

  async function refreshDashboard() {
    const version = ++dashboardVersion;
    dashboard = null; paintDashboard();
    setDisabled(node('refreshDashboard'), true);
    dashHint = {key:'dash.hintLoading', vars:null, error:false};
    paintDashHint();
    try {
      const result = await api('/api/blind-boxes/dashboard');
      if (version !== dashboardVersion) return;
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(t('dash.badFormat'));
      dashboard = result; paintDashboard();
      dashHint = {key:'dash.hintOk', vars:null, error:false};
      paintDashHint();
    } catch (err) {
      if (version !== dashboardVersion) return;
      dashboard = null; paintDashboard();
      dashHint = {key:'dash.hintFail', vars:{err:err.message}, error:true};
      paintDashHint();
    } finally {
      if (version === dashboardVersion) setDisabled(node('refreshDashboard'), false);
    }
  }

  async function refreshBalance() {
    const version = ++balanceVersion, selected = userId;
    const hint = node('balanceHint');
    setText(node('accountBalance'), t('common.noData'));
    if (hint) hint.dataset.error = 'false';
    if (!purchase?.getBalance) {
      setText(hint, t('shop.balanceWaiting'));
      return;
    }
    setText(hint, t('shop.balanceReading'));
    try {
      const result = await purchase.getBalance(selected);
      if (version !== balanceVersion) return;
      if (result?.user_id !== selected || !available(result.points,true)) throw new Error(t('shop.balanceMissing'));
      setText(node('accountBalance'), t('common.points', {n:result.points}));
      setText(hint, t('shop.balanceFromApi'));
    } catch (err) {
      if (version !== balanceVersion) return;
      if (hint) hint.dataset.error = 'true';
      setText(hint, t('shop.balanceFail', {err:err.message}));
    }
  }

  const ROLE_PAGES = {customer:'consumer', staff:'staff', boss:'owner'};
  function navigate(target) {
    if (ROLE_PAGES[target]) {
      if (typeof enterRoleWindow === 'function') enterRoleWindow(target);
      return;
    }
    if (!tabs.includes(target)) target = 'pos';
    switchTab(target);
  }
  function onNavigate(tab) {
    const hash = '#' + (currentRolePage() || tab);
    if (window.location.hash !== hash) window.history.replaceState(null,'',hash);
    // Hide the phone only for the wide rescue workspace. Other page state stays mounted.
    setHidden(node('phoneWrap'), ['rescue','customer'].includes(tab));
    document.body.classList.toggle('rescue-open', ['rescue','customer'].includes(tab));
    if (tab === 'dash') refreshDashboard();
    if (tab === 'customer') refreshBalance();
    if (tab === 'rescue') window.NexflowRescue?.refresh();
  }
  function roleChanged() {
    document.body.dataset.role = state.role;
    window.NexflowRescue?.roleChanged();
    paintSession();
    purchase?.onContextChanged?.(context());
    const home = state.role === 'consumer' ? 'customer' : state.role === 'owner' ? 'dash' : 'pos';
    switchTab(home); // 切到该角色的默认区域；不经过 navigate，避免重复进入角色窗口
  }

  // 演示账户提示：切换语言后仍然显示当前语言（选定账户后改用通用措辞）。
  function paintCustomerHint() {
    const fixed = userId === 'demo_mei_ling';
    setText(node('customerHint'), t(fixed ? 'shop.currentAccountDemo' : 'shop.currentAccount', { id: userId }));
  }

  async function copyText(text, field) {
    if (!text?.trim()) { toast(t('toast.copyEmpty')); return false; }
    try {
      await navigator.clipboard.writeText(text);
      toast(t('toast.copied'));
      return true;
    } catch {
      if (field) { field.focus(); field.select(); }
      toast(field ? t('toast.copyManual') : t('toast.copyManualPage'));
      return false;
    }
  }

  async function changed(kind) {
    state.blind.result = null; state.blind.batches = null;
    window.NexflowRescue?.invalidate();
    renderBlindInventory(); renderBlindResult();
    addLog(roleName(), t('logEntry.updated'), String(kind || 'module'), '', 'info');
    await Promise.all([refreshDashboard(), refreshBalance()]);
  }

  /* ---------------- 门店动作：确认余货 / 结束营业（只由用户点击触发） ---------------- */
  function paintSession() {
    const session = !!demoTime, items = draftItems();
    syncSignature();
    // 两张流程卡只在比赛演示会话里出现；顾客角色不显示任何门店操作入口。
    const showLeftovers = session && canOperate() && (items.length > 0 || leftoversRegistered);
    setHidden(ui.leftoversBox(), !showLeftovers);
    setHidden(ui.endDayBox(), !(session && canOperate()));
    setDisabled(ui.leftoversBtn(), !(session && leftoversOpen() && items.length > 0));
    setDisabled(ui.endDayBtn(), !(session && endDayOpen()));
    paintHints();
  }

  async function loadSession() {
    try {
      const result = await api('/api/demo/session');
      demoTime = result.demo_only === true && typeof result.now === 'string' ? result.now : null;
      leftoversRegistered = result.leftovers_registered === true;
      if (!leftoversRegistered) registeredQty = null;
      status.leftovers = {key:'',vars:null,error:false}; status.endDay = {key:'',vars:null,error:false}; signature = null;
    } catch {
      demoTime = null; leftoversRegistered = false; registeredQty = null;
    }
    paintSession();
    // “含演示初始积分”只在比赛演示会话出现；普通服务没有初始赠送。
    (document.querySelectorAll?.('[data-demo-initial-points]') || []).forEach(el => { el.hidden = !demoTime; });
  }

  async function confirmLeftovers() {
    if (sessionBusy || state.busy) return;
    if (!canOperate()) { setStatus('leftovers', 'store.baseConsumerLeftovers', null, true); return; }
    if (!demoTime) { setStatus('leftovers', 'store.notDemo', null, true); return; }
    if (leftoversRegistered) { setStatus('leftovers', 'store.leftoversDone', null, false); return; }
    if (isClosed()) { setStatus('leftovers', 'store.closedLeftovers', null, true); return; }
    const items = draftItems();
    if (!items.length) { setStatus('leftovers', 'store.needDraft', null, true); return; }
    const payload = items.map(item => ({item:item.item, qty:item.qty}));
    const before = draftQty();
    sessionBusy = true;
    setStatus('leftovers', 'store.registering', {n:before}, false);
    paintSession();
    try {
      const result = await api('/api/demo/leftovers', payload);
      leftoversRegistered = true;
      registeredQty = Number.isSafeInteger(result?.registered_qty) ? result.registered_qty : before;
      setStatus('leftovers', 'store.registered', {n:registeredQty}, false);
      await changed(t('logEntry.kindLeftovers'));
      navigate('rescue');
      toast(t('store.registered', {n:registeredQty}));
    } catch (err) {
      setStatus('leftovers', 'store.registerFail', {err:err.message}, true);
    } finally {
      sessionBusy = false; paintSession();
    }
  }

  async function endBusinessDay() {
    if (sessionBusy || state.busy) return;
    if (!canOperate()) return;
    if (!canFinishDay()) { setStatus('endDay', 'store.finishOwnerOnly', null, true); return; }
    if (!demoTime) { setStatus('endDay', 'store.notDemoFinish', null, true); return; }
    if (isClosed()) { setStatus('endDay', 'store.alreadyClosed', null, false); return; }
    // 结束营业不可撤销，先让老板确认一次；取消时不发任何请求。
    const message = t('store.confirmClose');
    if (typeof window.confirm === 'function' && !window.confirm(message)) {
      setStatus('endDay', 'store.closeCancelled', null, false);
      return;
    }
    sessionBusy = true;
    setStatus('endDay', 'store.closing', null, false);
    paintSession();
    try {
      const result = await api('/api/demo/close', {});
      if (result?.demo_only === true && typeof result.now === 'string') demoTime = result.now;
      if (result?.leftovers_registered === true) leftoversRegistered = true;
      await changed(t('logEntry.kindClose'));
      navigate('rescue');
    } catch (err) {
      setStatus('endDay', 'store.closeFail', {err:err.message}, true);
    } finally {
      sessionBusy = false; paintSession();
    }
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
    registerPurchase, changed, copyText, confirmLeftovers, endBusinessDay,
    // 切换语言后重画本文件负责的动态文案（不重新请求、不重建订单）
    relabel() { paintDashboard(); paintDashHint(); paintSession(); paintCustomerHint(); },
    resetView() {
      const page = currentRolePage();
      if (page && typeof enterRoleWindow === 'function') enterRoleWindow(page); // 重置后仍留在同一个角色窗口
      else { document.body.dataset.role = state.role; navigate('pos'); }
      paintSession(); window.NexflowRescue?.refresh(); refreshDashboard(); refreshBalance();
    },
    shareText, busyChanged:paintSession};
  bind(node('refreshDashboard'), refreshDashboard);
  bind(node('copyRescue'), () => copyText(node('rescueShare')?.value, node('rescueShare')));
  bind(node('selectCustomer'), () => {
    const selected = String(node('demoCustomer')?.value ?? '').trim();
    const hint = node('customerHint');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(selected)) {
      setText(hint, t('shop.accountIdRule')); return;
    }
    userId = selected; paintCustomerHint();
    refreshBalance(); purchase?.onContextChanged?.(context());
  });
  bind(ui.endDayBtn(), endBusinessDay);
  bind(ui.leftoversBtn(), confirmLeftovers);
  paintSession(); // 会话结果回来之前先收起两张流程卡，普通服务里不会闪出演示动作
  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-copy-promo]')) return;
    const field = node('copyBox');
    const text = state.draft ? field?.value : state.result?.text;
    copyText(text, field || node('approvedPromoCopy'));
  });
  window.addEventListener('hashchange', () => navigate(window.location.hash.slice(1)));
  window.addEventListener('load', async () => {
    document.body.dataset.role = state.role;
    paintCustomerHint();
    await loadSession();
    navigate(window.location.hash.slice(1));
    if (state.tab !== 'dash') refreshDashboard();
    refreshBalance();
  });
  // 切换语言：只重画本模块负责的文案，不重新请求数据、不重建业务状态。
  if (window.NexFlowI18N) {
    window.NexFlowI18N.onChange(() => { paintDashboard(); paintDashHint(); paintSession(); paintCustomerHint(); purchase?.relabel?.(); });
  }
})();