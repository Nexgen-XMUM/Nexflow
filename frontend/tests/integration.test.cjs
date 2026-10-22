const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../integration.js'),'utf8');

function page() {
  const nodes = new Map(), events = {}, messages = [], calls = [], bodies = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{textContent:'',value:'',disabled:false,hidden:false,dataset:{},
      focus(){this.focused=true;},select(){this.selected=true;}});
    return nodes.get(id);
  };
  const state = {role:'owner',tab:'pos',qty:{croissant:10},draft:{items:[],text:'Promo'},blind:{batches:[],result:{}}};
  const window = {location:{hash:''},history:{replaceState(_a,_b,hash){window.location.hash=hash;}},
    addEventListener(name,fn){events[name]=fn;},NexflowRescue:{refresh:async()=>{},roleChanged(){},invalidate(){}}};
  let response = {simulated_revenue_sen:700,picked_up_qty:0,donated_qty:0,estimated_co2e_kg:0,
    conversion_rate:null,redemption_repurchase_rate:null};
  const ctx = vm.createContext({window,state,navigator:{clipboard:{writeText:async text=>{messages.push(text);}}},
    document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},addEventListener(name,fn){events['document-'+name]=fn;}},
    api:async (route,body)=>{calls.push(route);bodies.push({route,body});return typeof response==='function'?response(route,body):response;},
    switchTab(tab){state.tab=tab;window.Nexflow.onNavigate(tab);},toast:text=>messages.push(text),
    renderBlindInventory(){},renderBlindResult(){},addLog(){},roleName:()=>state.role});
  vm.runInContext(source,ctx);
  return {node,state,window,ctx,messages,events,calls,api:window.Nexflow,bodies,setResponse(data){response=data;}};
}

test('backend paid income is distinct from uncompleted pickup and predicted amount', async()=>{
  const p=page(); await p.api.refreshDashboard();
  assert.equal(p.node('actualRevenue').textContent,'RM7.00');
  assert.equal(p.node('actualPickup').textContent,'0');
  assert.equal(p.node('actualCarbon').textContent,'0');
  assert.equal(p.node('conversionRate').textContent,'暂无数据');
  assert.match(p.node('rescueShare').value,/已完成取餐食品 0 件/);
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
  let balance={user_id:'demo_mei',points:0}, mounted;
  await p.api.registerPurchase({mount:async context=>{mounted=context;},getBalance:async()=>balance});
  assert.equal(p.node('accountBalance').textContent,'0 分');
  assert.equal(mounted.getContext().userId,'demo_mei');
  balance={user_id:'another',points:100};await p.api.refreshBalance();
  assert.equal(p.node('accountBalance').textContent,'暂无数据');
  assert.match(p.node('balanceHint').textContent,/不匹配/);
  balance={user_id:'demo_mei',points:10};await p.api.refreshBalance();
  assert.equal(p.node('accountBalance').textContent,'10 分');
  assert.equal('consumer' in p.state,false);
});

test('changing an account while its balance is pending cannot show the old balance', async()=>{
  const p=page();let finish,slow=false;
  await p.api.registerPurchase({mount:async()=>{},getBalance:id=>slow?new Promise(resolve=>{finish=resolve;}):Promise.resolve({user_id:id,points:0})});
  slow=true;const pending=p.api.refreshBalance();
  slow=false;p.node('demoCustomer').value='demo_new';p.node('selectCustomer').onclick();
  await new Promise(setImmediate);
  finish({user_id:'demo_mei',points:100});await pending;
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


test('recorded leftovers use the submitted draft quantities and cannot register twice', async()=>{
  const p=page();
  p.setResponse(route=>route==='/api/demo/session'?{demo_only:true,now:'2026-10-22T21:35:00+08:00',leftovers_registered:false}:
    route==='/api/demo/leftovers'?{registered_qty:10}:{simulated_revenue_sen:0});
  await p.events.load();
  p.state.draft={items:[{item:'croissant',qty:10}],text:'Promo'};
  await p.node('registerDemoLeftovers').onclick();
  const request=p.bodies.find(x=>x.route==='/api/demo/leftovers');
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)),[{item:'croissant',qty:10}]);
  assert.equal(p.api.getContext().leftoversRegistered,true);
  assert.equal(p.state.tab,'rescue');
  assert.equal(p.node('registerDemoLeftovers').disabled,true);
  await p.node('registerDemoLeftovers').onclick();
  assert.equal(p.calls.filter(x=>x==='/api/demo/leftovers').length,1);
});

test('registration requires a successful draft and unlocks retry after a failure', async()=>{
  const p=page();let fail=true;
  p.setResponse(route=>{
    if(route==='/api/demo/session')return {demo_only:true,now:'2026-10-22T21:35:00+08:00'};
    if(route==='/api/demo/leftovers'){if(fail)throw new Error('offline');return {registered_qty:10};}
    return {};
  });
  await p.events.load();p.state.draft=null;
  await p.node('registerDemoLeftovers').onclick();
  assert.match(p.node('demoHint').textContent,/请先提交盘点/);
  p.state.result={items:[{item:'croissant',qty:10}],text:'Approved promo'};
  await p.node('registerDemoLeftovers').onclick();
  assert.equal(p.node('registerDemoLeftovers').disabled,false);
  assert.match(p.node('demoHint').textContent,/offline/);
  fail=false;await p.node('registerDemoLeftovers').onclick();
  assert.equal(p.api.getContext().leftoversRegistered,true);
});
