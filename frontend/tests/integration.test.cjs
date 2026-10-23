const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../integration.js'),'utf8');

// 冻结的六个 DOM 契约之外，旧演示面板的节点集合：集成层在这些节点不存在时必须照常工作。
const REMOVED_PANEL = ['demoSession','demoClock','demoHint','storeClockNote',
  'leftoversAction','confirmLeftoversBtn','leftoversHint','leftoversSummary',
  'endDayAction','endDayBtn','endDayHint'];

function page(options = {}) {
  const absent = new Set(options.absent || []);
  const nodes = new Map(), events = {}, messages = [], calls = [], bodies = [];
  const node = id => {
    if (absent.has(id)) return null;
    if (!nodes.has(id)) nodes.set(id,{textContent:'',value:'',disabled:false,hidden:false,dataset:{},
      focus(){this.focused=true;},select(){this.selected=true;}});
    return nodes.get(id);
  };
  const state = {role:'owner',tab:'pos',qty:{croissant:10},draft:{items:[],text:'Promo'},blind:{batches:[],result:{}}};
  const window = {location:{hash:''},history:{replaceState(_a,_b,hash){window.location.hash=hash;}},
    confirm:()=>true, // 结束营业的二次确认；各用例可按需覆盖
    addEventListener(name,fn){events[name]=fn;},NexflowRescue:{refresh:async()=>{},roleChanged(){},invalidate(){}}};
  let response = {simulated_revenue_sen:700,picked_up_qty:0,donated_qty:0,estimated_co2e_kg:0,
    conversion_rate:null,redemption_repurchase_rate:null};
  const ctx = vm.createContext({window,state,navigator:{clipboard:{writeText:async text=>{messages.push(text);}}},
    document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},addEventListener(name,fn){events['document-'+name]=fn;}},
    api:async (route,body)=>{calls.push(route);bodies.push({route,body});return typeof response==='function'?response(route,body):response;},
    switchTab(tab){state.tab=tab;window.Nexflow.onNavigate(tab);},toast:text=>messages.push(text),
    renderBlindInventory(){},renderBlindResult(){},addLog(){},roleName:()=>state.role});
  // 模块现在依赖 i18n.js：在 VM 里加载同一份字典并固定为中文，断言保持原样。
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../i18n.js'),'utf8'), ctx);
  vm.runInContext("window.NexFlowI18N.setLang('zh-CN',{silent:true})", ctx);
  vm.runInContext(source,ctx);
  return {node,state,window,ctx,messages,events,calls,api:window.Nexflow,bodies,
    setResponse(data){response=data;},setConfirm(fn){window.confirm=fn;}};
}

// 比赛演示会话：门店时间 21:35，尚未确认余货。
const sessionResponse = (extra = {}) => route => route==='/api/demo/session'
  ? {demo_only:true,now:'2026-10-22T21:35:00+08:00',leftovers_registered:false,...extra} : {simulated_revenue_sen:0};

test('backend paid income is distinct from uncompleted pickup and predicted amount', async()=>{
  const p=page(); await p.api.refreshDashboard();
  assert.equal(p.node('actualRevenue').textContent,'RM7.00');
  assert.equal(p.node('actualPickup').textContent,'0');
  assert.equal(p.node('actualCarbon').textContent,'0');
  assert.equal(p.node('conversionRate').textContent,'暂无数据');
  assert.match(p.node('rescueShare').value,/顾客已取走 0 件/);
  assert.match(p.node('rescueShare').value,/已交给公益机构 0 件/);
  assert.doesNotMatch(p.node('rescueShare').value,/RM30/);
  assert.equal(p.state.qty.croissant,10);
});

test('missing and malformed metrics never become fabricated zero or NaN', async()=>{
  const p=page();p.setResponse({simulated_revenue_sen:null,picked_up_qty:'4',donated_qty:0,estimated_co2e_kg:NaN});
  await p.api.refreshDashboard();
  assert.equal(p.node('actualRevenue').textContent,'暂无数据');
  assert.equal(p.node('actualPickup').textContent,'暂无数据');
  assert.equal(p.node('actualDonation').textContent,'0');
  assert.equal(p.node('actualCarbon').textContent,'暂无数据');
  assert.doesNotMatch(p.node('rescueShare').value,/NaN|undefined/);
});

test('failed refresh clears old success and permits a later retry', async()=>{
  const p=page();await p.api.refreshDashboard();
  p.setResponse(()=>{throw new Error('offline');});await p.api.refreshDashboard();
  assert.equal(p.node('actualRevenue').textContent,'暂无数据');
  assert.equal(p.node('rescueShare').value,'');
  assert.equal(p.node('copyRescue').disabled,true);
  assert.equal(p.node('refreshDashboard').disabled,false);
  assert.match(p.node('dashboardHint').textContent,/offline/);
  p.setResponse({donated_qty:3});await p.api.refreshDashboard();
  assert.equal(p.node('actualDonation').textContent,'3');
});

test('a stale dashboard response cannot overwrite a newer failure', async()=>{
  const p=page();let finish;
  p.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=p.api.refreshDashboard();
  p.setResponse(()=>{throw new Error('latest failed');});await p.api.refreshDashboard();
  finish({simulated_revenue_sen:99900});await pending;
  assert.equal(p.node('actualRevenue').textContent,'暂无数据');
  assert.match(p.node('dashboardHint').textContent,/latest failed/);
});

test('account balance is only supplied by the purchase adapter and checked against the selected user', async()=>{
  const p=page();await p.api.refreshBalance();
  assert.equal(p.node('accountBalance').textContent,'暂无数据');
  assert.equal(p.calls.length,0);
  let balance={user_id:'demo_mei_ling',points:0}, mounted;
  await p.api.registerPurchase({mount:async context=>{mounted=context;},getBalance:async()=>balance});
  assert.equal(p.node('accountBalance').textContent,'0 分');
  assert.equal(mounted.getContext().userId,'demo_mei_ling');
  balance={user_id:'another',points:100};await p.api.refreshBalance();
  assert.equal(p.node('accountBalance').textContent,'暂无数据');
  assert.match(p.node('balanceHint').textContent,/不匹配/);
  balance={user_id:'demo_mei_ling',points:10};await p.api.refreshBalance();
  assert.equal(p.node('accountBalance').textContent,'10 分');
  assert.equal('consumer' in p.state,false);
});

test('changing an account while its balance is pending cannot show the old balance', async()=>{
  const p=page();let finish,slow=false;
  await p.api.registerPurchase({mount:async()=>{},getBalance:id=>slow?new Promise(resolve=>{finish=resolve;}):Promise.resolve({user_id:id,points:0})});
  slow=true;const pending=p.api.refreshBalance();
  slow=false;p.node('demoCustomer').value='demo_new';p.node('selectCustomer').onclick();
  await new Promise(setImmediate);
  finish({user_id:'demo_mei_ling',points:100});await pending;
  assert.equal(p.api.getContext().userId,'demo_new');
  assert.equal(p.node('accountBalance').textContent,'0 分');
});

test('role navigation retains the draft and copies only the visible promo text', async()=>{
  const p=page(), draft=p.state.draft;
  p.state.role='consumer';p.api.roleChanged();
  assert.equal(p.state.tab,'customer');assert.equal(p.state.draft,draft);assert.equal(p.state.qty.croissant,10);
  p.node('copyBox').value='Edited promo';
  await p.events['document-click']({target:{closest:()=>({})}});
  await new Promise(setImmediate);
  assert.ok(p.messages.includes('Edited promo'));
});

test('clipboard denial selects the text for manual copy and does not claim success', async()=>{
  const p=page();p.ctx.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
  const field=p.node('rescueShare');const result=await p.api.copyText('Result',field);
  assert.equal(result,false);assert.equal(field.selected,true);assert.equal(field.focused,true);
  assert.match(p.messages.at(-1),/Ctrl\+C/);
  assert.equal(p.messages.some(x=>x.startsWith('已复制')),false);
});

test('the removed demo panel leaves no dangling DOM reference', async()=>{
  const p=page({absent:REMOVED_PANEL});
  p.setResponse(sessionResponse());
  await p.events.load();                                    // 加载即会话读取 + 刷新看板
  assert.equal(p.api.getContext().demoTime,'2026-10-22T21:35:00+08:00');
  assert.doesNotThrow(()=>p.api.roleChanged());              // 角色切换不再写已删除节点
  assert.doesNotThrow(()=>p.api.resetView());
  p.state.draft={items:[{item:'croissant',name:'Croissant',qty:10}],text:'Promo'};
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00'}:
    route==='/api/demo/leftovers'?{registered_qty:10}:{simulated_revenue_sen:0});
  await p.api.confirmLeftovers();                            // 无 DOM 时业务动作仍可执行
  assert.equal(p.api.getContext().leftoversRegistered,true);
  assert.ok(p.calls.includes('/api/demo/leftovers'));
});

test('leftovers cannot be confirmed before a stocktake draft exists', async()=>{
  const p=page();p.setResponse(sessionResponse());
  await p.events.load();
  assert.equal(p.node('registerLeftoversAction').disabled,true); // 无草稿时按钮直接不可用
  await p.api.confirmLeftovers();                                // 防御性调用也不能发请求
  assert.equal(p.calls.includes('/api/demo/leftovers'),false);
  assert.match(p.node('leftoversFlowHint').textContent,/请先提交盘点/);
  assert.equal(p.node('leftoversFlowHint').dataset.error,'true');
});

test('recorded leftovers use the submitted draft quantities and cannot register twice', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00',leftovers_registered:false}:
    route==='/api/demo/leftovers'?{registered_qty:10,source:'eod_leftovers'}:{simulated_revenue_sen:0});
  await p.events.load();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  p.api.busyChanged();                                        // 草稿出现后流程卡才可用
  assert.equal(p.node('registerLeftoversAction').disabled,false);
  await p.node('registerLeftoversAction').onclick();
  const request=p.bodies.find(x=>x.route==='/api/demo/leftovers');
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)),[{item:'croissant',qty:10}]);
  assert.equal(p.api.getContext().leftoversRegistered,true);
  assert.equal(p.state.tab,'pos');                            // 确认余货留在盘点页，不跳到打烊去向
  assert.equal(p.node('registerLeftoversAction').disabled,true);
  assert.match(p.node('leftoversFlowHint').textContent,/余货已经确认 10 件/);   // 成功后回到默认提示，仍显示已登记数量
  assert.equal(p.node('leftoversFlowHint').dataset.error,'false');
  await p.node('registerLeftoversAction').onclick();
  assert.equal(p.calls.filter(x=>x==='/api/demo/leftovers').length,1);
});

test('leftovers confirmed after approval fall back to the approved items', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00'}:
    route==='/api/demo/leftovers'?{registered_qty:3}:{simulated_revenue_sen:0});
  await p.events.load();
  p.state.draft=null;p.state.result={items:[{item:'sourdough',qty:3}],text:'Approved promo'};
  await p.api.confirmLeftovers();
  assert.deepEqual(JSON.parse(JSON.stringify(p.bodies.find(x=>x.route==='/api/demo/leftovers').body)),[{item:'sourdough',qty:3}]);
  assert.equal(p.node('registerLeftoversAction').disabled,true);
});

test('registration unlocks retry after a failure and never claims success', async()=>{
  const p=page();let fail=true;
  p.setResponse(route=>{
    if(route==='/api/demo/session')return {demo_only:true,now:'2026-10-22T21:35:00+08:00'};
    if(route==='/api/demo/leftovers'){if(fail)throw new Error('offline');return {registered_qty:10};}
    return {simulated_revenue_sen:0};
  });
  await p.events.load();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  p.api.busyChanged();
  await p.node('registerLeftoversAction').onclick();
  assert.equal(p.node('registerLeftoversAction').disabled,false);
  assert.equal(p.api.getContext().leftoversRegistered,false);
  assert.match(p.node('leftoversFlowHint').textContent,/offline/);
  assert.equal(p.node('leftoversFlowHint').dataset.error,'true');
  assert.match(p.node('leftoversFlowHint').textContent,/不会重复入库/);   // 重试说明留在提示里
  fail=false;await p.node('registerLeftoversAction').onclick();
  assert.equal(p.api.getContext().leftoversRegistered,true);
  assert.equal(p.node('registerLeftoversAction').disabled,true);
  assert.equal(p.calls.filter(x=>x==='/api/demo/leftovers').length,2);    // 只有失败那次没算成功
});

test('ending the business day advances the demo clock, sweeps, and shows the donation queue', async()=>{
  const p=page();
  const asked=[];
  p.setConfirm(message=>{asked.push(message);return true;});
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00',leftovers_registered:true}:
    route==='/api/demo/close'?{demo_only:true,temporary_database:true,now:'2026-10-22T22:31:00+08:00',leftovers_registered:true}:
    {simulated_revenue_sen:0});
  await p.events.load();
  assert.equal(p.node('finishDayAction').disabled,false);
  await p.node('finishDayAction').onclick();
  assert.equal(asked.length,1);                              // 先弹二次确认
  assert.match(asked[0],/结束当日营业/);
  assert.equal(p.calls.filter(x=>x==='/api/demo/close').length,1);
  assert.equal(p.api.getContext().demoTime,'2026-10-22T22:31:00+08:00');
  assert.equal(p.state.tab,'rescue');                          // 结束后进入打烊去向处理余货分流
  assert.equal(p.node('finishDayAction').disabled,true);       // 已结束营业，重复点击被拦住
  assert.match(p.node('finishDayHint').textContent,/已经结束/);
  assert.ok(p.calls.includes('/api/blind-boxes/dashboard'));   // 经营统计随清算一起刷新
  await p.node('finishDayAction').onclick();
  assert.equal(p.calls.filter(x=>x==='/api/demo/close').length,1);
});

test('cancelling the confirmation leaves the store open and sends no request', async()=>{
  const p=page();
  p.setConfirm(()=>false);
  p.setResponse(sessionResponse({leftovers_registered:true}));
  await p.events.load();
  await p.node('finishDayAction').onclick();
  assert.equal(p.calls.includes('/api/demo/close'),false);      // 取消不发任何请求
  assert.equal(p.api.getContext().demoTime,'2026-10-22T21:35:00+08:00');
  assert.equal(p.node('finishDayAction').disabled,false);
  assert.match(p.node('finishDayHint').textContent,/已取消/);
  assert.equal(p.node('finishDayHint').dataset.error,'false');
});

test('only the owner role may end the business day', async()=>{
  const p=page();
  const asked=[];
  p.setConfirm(message=>{asked.push(message);return true;});
  p.setResponse(sessionResponse({leftovers_registered:true}));
  await p.events.load();
  p.state.role='staff';p.api.roleChanged();                    // 店员可以确认余货，但不能结束营业
  assert.equal(p.node('finishDayAction').disabled,true);
  assert.match(p.node('finishDayHint').textContent,/结束营业由老板操作/);
  await p.api.endBusinessDay();
  assert.equal(p.calls.includes('/api/demo/close'),false);
  assert.equal(asked.length,0);                                // 权限不足时连确认弹窗都不该出现
  assert.equal(p.node('finishDayHint').dataset.error,'true');
  p.state.role='owner';p.api.roleChanged();
  assert.equal(p.node('finishDayAction').disabled,false);
});

test('staff can still confirm leftovers, the owner box is shared by both store roles', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00'}:
    route==='/api/demo/leftovers'?{registered_qty:10}:{simulated_revenue_sen:0});
  await p.events.load();
  p.state.role='staff';p.api.roleChanged();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  p.api.busyChanged();
  assert.equal(p.node('leftoversFlowCard').hidden,false);
  assert.equal(p.node('registerLeftoversAction').disabled,false);
  await p.node('registerLeftoversAction').onclick();
  assert.equal(p.api.getContext().leftoversRegistered,true);
  assert.equal(p.calls.filter(x=>x==='/api/demo/leftovers').length,1);
});

test('closing without confirmed leftovers says so instead of inventing donations', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00',leftovers_registered:false}:
    route==='/api/demo/close'?{demo_only:true,now:'2026-10-22T22:31:00+08:00',leftovers_registered:false}:
    {simulated_revenue_sen:0,donated_qty:0});
  await p.events.load();
  await p.node('finishDayAction').onclick();
  assert.match(p.node('finishDayHint').textContent,/没有确认余货/);
  assert.equal(p.node('actualDonation').textContent,'0');
});

test('a failed closing keeps the old store time and can be retried', async()=>{
  const p=page();let fail=true;
  p.setResponse(route=>{
    if(route==='/api/demo/session')return {demo_only:true,now:'2026-10-22T21:35:00+08:00'};
    if(route==='/api/demo/close'){if(fail)throw new Error('backend offline');return {demo_only:true,now:'2026-10-22T22:31:00+08:00'};}
    return {simulated_revenue_sen:0};
  });
  await p.events.load();
  await p.node('finishDayAction').onclick();
  assert.equal(p.api.getContext().demoTime,'2026-10-22T21:35:00+08:00');
  assert.equal(p.node('finishDayAction').disabled,false);
  assert.equal(p.node('finishDayHint').dataset.error,'true');
  assert.match(p.node('finishDayHint').textContent,/backend offline/);
  fail=false;await p.node('finishDayAction').onclick();
  assert.equal(p.api.getContext().demoTime,'2026-10-22T22:31:00+08:00');
});

test('the consumer role cannot register leftovers or end the business day', async()=>{
  const p=page();p.setResponse(sessionResponse());
  await p.events.load();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  p.state.role='consumer';p.api.roleChanged();
  await p.api.confirmLeftovers();
  await p.api.endBusinessDay();
  assert.equal(p.calls.includes('/api/demo/leftovers'),false);
  assert.equal(p.calls.includes('/api/demo/close'),false);
  assert.equal(p.node('leftoversFlowCard').hidden,true);       // 顾客看不到门店操作入口
  assert.equal(p.node('finishDayCard').hidden,true);
  assert.equal(p.node('registerLeftoversAction').disabled,true);
  assert.equal(p.node('finishDayAction').disabled,true);
});

test('registration after closing is blocked before it reaches the backend', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T22:31:00+08:00'}:{});
  await p.events.load();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  await p.api.confirmLeftovers();
  assert.equal(p.calls.includes('/api/demo/leftovers'),false);
  assert.match(p.node('leftoversFlowHint').textContent,/不能再确认余货/);
  assert.equal(p.node('finishDayAction').disabled,true);
});

test('a normal (non-demo) service never exposes the store actions', async()=>{
  const p=page();
  p.setResponse(()=>{throw new Error('后端错误 404');});
  await p.events.load();
  assert.equal(p.api.getContext().demoTime,null);
  assert.equal(p.node('registerLeftoversAction').disabled,true);
  assert.equal(p.node('finishDayAction').disabled,true);
  assert.equal(p.node('leftoversFlowCard').hidden,true);
  assert.equal(p.node('finishDayCard').hidden,true);
  assert.equal(p.node('leftoversFlowHint').textContent,'');
  assert.equal(p.node('finishDayHint').textContent,'');
});

test('the action containers follow the draft state instead of staying empty', async()=>{
  const p=page();p.setResponse(sessionResponse());
  await p.events.load();
  assert.equal(p.node('leftoversFlowCard').hidden,true);     // 没有盘点结果时不显示空卡片
  assert.equal(p.node('finishDayCard').hidden,false);        // 结束营业与盘点结果无关，随时可操作
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  p.api.busyChanged();
  assert.equal(p.node('leftoversFlowCard').hidden,false);
  assert.match(p.node('leftoversFlowHint').textContent,/共 10 件/);
});

test('the served page provides the six frozen store-action targets', ()=>{
  // 面板被 UI 改动后，这六个 ID 是唯一的合同；缺失会导致按钮静默失效。
  const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for (const id of ['leftoversFlowCard','registerLeftoversAction','leftoversFlowHint',
    'finishDayCard','finishDayAction','finishDayHint']) {
    assert.ok(html.includes('id="'+id+'"'),'页面缺少门店动作节点：'+id);
  }
  // 旧演示面板的 ID 不应再出现在页面上，避免两套入口同时生效。
  for (const id of ['demoSession','confirmLeftoversBtn','endDayBtn','leftoversAction','endDayAction']) {
    assert.equal(html.includes('id="'+id+'"'),false,'页面仍残留旧节点：'+id);
  }
});
