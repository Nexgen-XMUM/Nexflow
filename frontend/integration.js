/* Unified desktop shell. Amounts and completion states come from backend responses. */
(() => {
  'use strict';
  const node = id => document.getElementById(id) || null;
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
  const status = {leftovers:{message:'',error:false}, endDay:{message:'',error:false}};
  let signature = null;

  function baseline(key) {
    if (key === 'leftovers') {
      if (!demoTime || !canOperate()) return '';
      if (leftoversRegistered) {
        const qty = Number.isSafeInteger(registeredQty) ? ' ' + registeredQty + ' 件' : '';
        return '今晚的余货已经确认' + qty + '。顾客可以购买，打烊后没卖完的会出现在待交接清单里。';
      }
      if (isClosed()) return '今天的营业已经结束，不能再确认余货。';
      if (!draftItems().length) return '提交盘点后，这里会显示今晚的余货数量。';
      return '本次盘点 ' + draftItems().length + ' 个商品、共 ' + draftQty() +
        ' 件。确认后会进入清仓促销和捐赠交接流程。';
    }
    if (!demoTime) return '';
    if (!canOperate()) return '';
    if (!canFinishDay()) return '结束营业由老板操作；请切换到 Uncle Wong 演示角色。';
    if (isClosed()) {
      return '今天的营业已经结束（门店时间 ' + storeTimeText() + '）。' +
        (leftoversRegistered ? '没卖完的余货已经进入待交接清单。' : '今天没有确认余货，所以没有可捐赠的批次。');
    }
    return leftoversRegistered
      ? '结束营业后，没卖完的余货会进入待交接清单，需要逐项确认交接。'
      : '还没确认余货；现在结束营业不会产生可捐赠的批次。';
  }

  function paintHints() {
    setHint(ui.leftoversHint(), status.leftovers.message || baseline('leftovers'), status.leftovers.error);
    setHint(ui.endDayHint(), status.endDay.message || baseline('endDay'), status.endDay.error);
  }
  // 业务状态一变就清空上一次的结果提示，避免旧错误盖住新状态。
  function syncSignature() {
    const next = [demoTime, leftoversRegistered, isClosed(), draftQty(), state.role].join('|');
    if (signature !== null && next !== signature) {
      status.leftovers = {message:'',error:false};
      status.endDay = {message:'',error:false};
    }
    signature = next;
  }
  function setStatus(key, message, error = false) {
    status[key] = {message: message || '', error: !!error};
    paintHints();
  }

  function shareText(data) {
    if (!data) return '';
    const revenue = value(data,'simulated_revenue_sen',true);
    const pickup = value(data,'picked_up_qty',true), donation = value(data,'donated_qty',true);
    const carbon = value(data,'estimated_co2e_kg');
    return '【Nexflow 今日成果】今天已收到 ' +
      (revenue === null ? '暂无数据' : 'RM' + (revenue/100).toFixed(2)) +
      '（含已付款、还没取餐的订单）；顾客已取走 ' + label(pickup) + (pickup === null ? '' : ' 件') +
      '；已交给公益机构 ' + label(donation) + (donation === null ? '' : ' 件') +
      '；这些取走和交接的食物，约减少碳排放 ' + label(carbon) + (carbon === null ? '' : ' kg') +
      '（估算）。数字来自演示账本：预计售出、待取餐和待捐赠都不算已完成；碳排是估算，不是认证减排量或碳积分。';
  }

  function paintDashboard() {
    const revenue = value(dashboard,'simulated_revenue_sen',true);
    setText(node('actualRevenue'), revenue === null ? '暂无数据' : 'RM' + (revenue/100).toFixed(2));
    setText(node('actualPickup'), label(value(dashboard,'picked_up_qty',true)));
    setText(node('actualDonation'), label(value(dashboard,'donated_qty',true)));
    setText(node('actualCarbon'), label(value(dashboard,'estimated_co2e_kg')));
    for (const [id,key] of [['conversionRate','conversion_rate'],['repurchaseRate','redemption_repurchase_rate']]) {
      const n = value(dashboard,key);
      setText(node(id), n === null || n > 1 ? '暂无数据' : (n*100).toFixed(1) + '%');
    }
    setValue(node('rescueShare'), shareText(dashboard));
    setDisabled(node('copyRescue'), !dashboard);
  }

  async function refreshDashboard() {
    const version = ++dashboardVersion;
    dashboard = null; paintDashboard();
    setDisabled(node('refreshDashboard'), true);
    const hint = node('dashboardHint');
    if (hint) hint.dataset.error = 'false';
    setText(hint, '正在加载今天的经营数据…');
    try {
      const result = await api('/api/blind-boxes/dashboard');
      if (version !== dashboardVersion) return;
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('经营数据格式无效');
      dashboard = result; paintDashboard();
      setText(hint, '已更新为最新数据。没有数据的地方会显示“暂无数据”。');
    } catch (err) {
      if (version !== dashboardVersion) return;
      dashboard = null; paintDashboard();
      if (hint) hint.dataset.error = 'true';
      setText(hint, '经营数据没有加载出来：' + err.message + '。可以点“刷新数据”再试一次。');
    } finally {
      if (version === dashboardVersion) setDisabled(node('refreshDashboard'), false);
    }
  }

  async function refreshBalance() {
    const version = ++balanceVersion, selected = userId;
    const hint = node('balanceHint');
    setText(node('accountBalance'), '暂无数据');
    if (hint) hint.dataset.error = 'false';
    if (!purchase?.getBalance) {
      setText(hint, '等待购买负责人提供账户接口；不维护页面虚拟余额。');
      return;
    }
    setText(hint, '正在读取购买模块账户余额…');
    try {
      const result = await purchase.getBalance(selected);
      if (version !== balanceVersion) return;
      if (result?.user_id !== selected || !available(result.points,true)) throw new Error('账户余额缺失或账户不匹配');
      setText(node('accountBalance'), result.points + ' 分');
      setText(hint, '来自购买模块账户接口；广播和预测不会增加余额。');
    } catch (err) {
      if (version !== balanceVersion) return;
      if (hint) hint.dataset.error = 'true';
      setText(hint, '余额读取失败：' + err.message + '。再次选择此账户可重试。');
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
      status.leftovers = {message:'',error:false}; status.endDay = {message:'',error:false}; signature = null;
    } catch {
      demoTime = null; leftoversRegistered = false; registeredQty = null;
    }
    paintSession();
    // “含演示初始积分”只在比赛演示会话出现；普通服务没有初始赠送。
    (document.querySelectorAll?.('[data-demo-initial-points]') || []).forEach(el => { el.hidden = !demoTime; });
  }

  async function confirmLeftovers() {
    if (sessionBusy || state.busy) return;
    if (!canOperate()) { setStatus('leftovers', baseline('leftovers'), true); return; }
    if (!demoTime) { setStatus('leftovers', '当前不是比赛演示会话，无法把盘点登记为演示批次。', true); return; }
    if (leftoversRegistered) { setStatus('leftovers', '今晚的余货已经确认过了，不需要重复登记。', false); return; }
    if (isClosed()) { setStatus('leftovers', '今天的营业已经结束，不能再确认余货；请重启演示会话。', true); return; }
    const items = draftItems();
    if (!items.length) { setStatus('leftovers', '请先提交盘点并生成促销草稿，再确认今晚的余货。', true); return; }
    const payload = items.map(item => ({item:item.item, qty:item.qty}));
    const before = draftQty();
    sessionBusy = true;
    setStatus('leftovers', '正在把本次盘点的 ' + before + ' 件余货登记为今晚批次…', false);
    paintSession();
    try {
      const result = await api('/api/demo/leftovers', payload);
      leftoversRegistered = true;
      registeredQty = Number.isSafeInteger(result?.registered_qty) ? result.registered_qty : before;
      setStatus('leftovers', '已确认 ' + registeredQty + ' 件余货。顾客可以购买，打烊后没卖完的会进入待交接清单。', false);
      await changed('确认今晚余货');
    } catch (err) {
      setStatus('leftovers', '确认余货失败：' + err.message +
        '。可以再点一次重试；同一份盘点不会重复入库（若已在顾客购买中生成过演示库存，请重启演示会话后重新登记）。', true);
    } finally {
      sessionBusy = false; paintSession();
    }
  }

  async function endBusinessDay() {
    if (sessionBusy || state.busy) return;
    if (!canOperate()) return;
    if (!canFinishDay()) { setStatus('endDay', baseline('endDay'), true); return; }
    if (!demoTime) { setStatus('endDay', '当前不是比赛演示会话，无法推进打烊清算。', true); return; }
    if (isClosed()) { setStatus('endDay', '今天的营业已经结束了；再点也不会重复生成待交接单。', false); return; }
    // 结束营业不可撤销，先让老板确认一次；取消时不发任何请求。
    const message = '结束当日营业并清算？\n\n· 没卖完的安全食品会进入待交接清单\n' +
      '· 未取餐的订单也会转入待交接\n· 结束后不能再确认余货';
    if (typeof window.confirm === 'function' && !window.confirm(message)) {
      setStatus('endDay', '已取消，营业继续；没有产生任何清算记录。', false);
      return;
    }
    sessionBusy = true;
    setStatus('endDay', '正在结束营业并清算未取餐订单与未售余货…', false);
    paintSession();
    try {
      const result = await api('/api/demo/close', {});
      if (result?.demo_only === true && typeof result.now === 'string') demoTime = result.now;
      if (result?.leftovers_registered === true) leftoversRegistered = true;
      await changed('结束营业并清算');
      navigate('rescue');
    } catch (err) {
      setStatus('endDay', '结束营业失败：' + err.message + '。可以再点一次重试；重复结束不会重复生成待交接单。', true);
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
      setText(hint, '账户 ID 只允许 1–80 位字母、数字、下划线或短横线。'); return;
    }
    userId = selected; setText(hint, '当前账户：' + userId);
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
    await loadSession();
    navigate(window.location.hash.slice(1));
    if (state.tab !== 'dash') refreshDashboard();
    refreshBalance();
  });
})();
