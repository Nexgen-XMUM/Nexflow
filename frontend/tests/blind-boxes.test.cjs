const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../blind-boxes.js'), 'utf8');
const quote = {quote_id:'sealed-quote',price_sen:830,qty_range:{min:2,max:4},allergens:['wheat'],pickup_start:'2099-10-22T21:30:00+08:00',pickup_end:'2099-10-22T22:00:00+08:00',expires_at:'2099-10-22T22:00:00+08:00',lines:[{batch_id:'must-stay-hidden'}],cost_sen:600};
const order = {order_id:'fixed-order',user_id:'demo_mei_ling',price_sen:830,pickup_start:quote.pickup_start,pickup_end:quote.pickup_end,status:'RESERVED',pending_points:10,points_awarded:0};

function page(fetcher, storage = new Map()) {
  const nodes = new Map(), requests = [], roles = [element('role')];
  function element(id) {
    return {id,hidden:false,disabled:false,value:'',innerHTML:'',textContent:'',dataset:{},handlers:{},children:[],
      addEventListener(type,fn){this.handlers[type]=fn;},
      appendChild(child){this.children.push(child);},insertBefore(child){nodes.set(child.id,child);},
      closest(selector){return selector==='#bb-form' && id.startsWith('bb-') && !['bb-order-id','bb-donation-recipient','bb-redeem-price','bb-redeem-points'].includes(id);},
      querySelectorAll(selector){if(selector==='[data-bb="handoff"]')return [];return [...nodes.values()].filter(n=>selector==='input,select'?['bb-date','bb-slot','bb-mode','bb-like','bb-diet','bb-allergens','bb-order-id'].includes(n.id):['bb-quote','bb-new','bb-confirm'].includes(n.id));}
    };
  }
  function node(id) {
    if (id==='bb-confirm' && !nodes.get('bb-offer')?.innerHTML.includes('id="bb-confirm"')) return null;
    if(!nodes.has(id)) nodes.set(id,element(id));
    return nodes.get(id);
  }
  const ctx = vm.createContext({console,Date,Intl,JSON,AbortSignal,crypto:require('node:crypto').webcrypto,
    document:{getElementById:node,createElement:()=>element('new'),querySelector:s=>node(s),querySelectorAll:()=>roles,body:{classList:{toggle(){}}}},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    state:{role:'consumer',tab:'pos',busy:false},renderTabs(){},renderRole(){},switchTab(t){ctx.state.tab=t;},
    esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),setInterval(){},
    fetch:async(url,opts)=>{requests.push({url,body:opts.body?JSON.parse(opts.body):undefined});return fetcher(url,opts,requests);}
  });
  vm.runInContext(source,ctx); ctx.state.tab='blind';
  node('bb-date').value='2099-10-22';node('bb-slot').value='21:30';node('bb-mode').value='standard';
  return {ctx,node,requests,storage,submit:()=>node('bb-form').handlers.submit({preventDefault(){}}),
    redeem:()=>node('bb-redeem-form').handlers.submit({preventDefault(){}}),
    click:(name,id)=>node('tab-blind').handlers.click({target:{closest:()=>({dataset:{bb:name,donation:id}})}}),
    settle:async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);}};
}
const ok = data => ({ok:true,status:200,json:async()=>data});

test('customer quote displays RM, restrictions and time without internal candidate data', async()=>{
  const p=page(async()=>ok(quote));
  p.submit(); await p.settle();
  assert.match(p.node('bb-offer').innerHTML,/RM8\.30/);
  assert.match(p.node('bb-offer').innerHTML,/wheat/);
  assert.doesNotMatch(p.node('bb-offer').innerHTML,/must-stay-hidden|cost_sen|600/);
  assert.deepEqual(p.requests.map(r=>r.url),['/api/blind-boxes/quotes']);
  assert.equal(p.node('bb-date').disabled,true);
});

test('lost confirmation retains the exact key and prevents a replacement purchase',async()=>{
  let attempts=0;
  const p=page(async url=>{
    if(url.endsWith('/quotes'))return ok(quote);
    if(url.endsWith('/confirm')){if(++attempts===1)throw new Error('lost response');return ok(order);}
    return ok({points:0,orders:[order]});
  });
  p.submit();await p.settle();p.click('confirm');await p.settle();
  assert.equal(p.node('bb-new').disabled,true);
  assert.match(p.node('bb-message').textContent,/结果尚未确认/);
  const first=p.requests.at(-1).body;
  assert.deepEqual(Object.keys(first).sort(),['idempotency_key','quote_id','user_id']);
  p.click('confirm');await p.settle();
  const confirmations=p.requests.filter(r=>r.url.endsWith('/confirm'));
  assert.deepEqual(confirmations[0].body,confirmations[1].body);
  assert.match(p.node('bb-offer').innerHTML,/fixed-order/);
  assert.match(p.node('bb-orders').innerHTML,/待到账 10 分/);
  assert.equal(p.node('bb-points').textContent,'0 分');
});

test('lost quote response survives reload and retries the same request',async()=>{
  const p=page(async()=>{throw new Error('timeout');});
  p.submit();await p.settle();
  const sent=p.requests[0].body;
  assert.equal(p.node('bb-new').disabled,true);
  const restored=page(async()=>ok(quote),p.storage);
  restored.submit();await restored.settle();
  assert.deepEqual(restored.requests[0].body,sent);
});

test('business rejection unlocks selection and never creates an order',async()=>{
  const p=page(async()=>({ok:false,status:409,json:async()=>({error:{code:'NOT_RELEASED'}})}));
  p.submit();await p.settle();
  assert.match(p.node('bb-message').textContent,/21:30/);
  assert.equal(p.node('bb-new').disabled,false);
  assert.equal(p.node('bb-date').disabled,false);
  assert.equal(p.requests.length,1);
});

test('staff cannot submit quotes and does not get a blind-box entry',async()=>{
  const p=page(async()=>ok(quote));p.ctx.state.role='staff';p.ctx.renderRole();
  p.submit();await p.settle();
  assert.equal(p.requests.length,0);
  assert.equal(p.ctx.state.tab,'pos');
});


const donationRows = [
  {id:'pending-1',status:'PENDING',source_order:'missed-order',recipient:null,payload:{lines:[{batch_id:'batch-bread',qty:2}]}},
  {id:'done-1',status:'DONATED',source_order:null,recipient:'DEMO Kitchen',payload:{lines:[{batch_id:'batch-bread',qty:1}]}},
  {id:'waste-1',status:'DISCARDED',source_order:null,recipient:null,payload:{lines:[{batch_id:'batch-bread',qty:1}]}}
];
function donationReply(url, rows=donationRows) {
  if(url.endsWith('/donations'))return ok({donations:rows});
  if(url.endsWith('/inventory'))return ok({batches:[{batch_id:'batch-bread',name:'Bread <sample>',available:4,reserved:2,safe_until:quote.pickup_end}]});
  return ok({no_shows_processed:1});
}

test('donation list separates pending, handed over and discarded; escapes server labels',async()=>{
  const p=page(async url=>donationReply(url));p.ctx.state.role='owner';
  p.click('donations');await p.settle();
  const html=p.node('bb-donations').innerHTML;
  assert.match(html,/待交接|已记录交接（演示）|已记为报废/);
  assert.match(html,/Bread &lt;sample>/);
  assert.equal((html.match(/data-bb="handoff"/g)||[]).length,1);
  assert.match(html,/data-donation="pending-1"/);
  p.click('handoff','pending-1');await p.settle();
  assert.match(p.node('bb-message').textContent,/模拟接收方名称/);
  assert.equal(p.requests.filter(r=>r.url.endsWith('/handoff')).length,0);
});

test('handoff sends only the selected donation and trimmed recipient; refresh removes its action',async()=>{
  let handed=false;
  const p=page(async(url,opts)=>{
    if(url.endsWith('/handoff')){handed=true;return ok({status:'DONATED'});}
    return donationReply(url,donationRows.map(d=>d.id==='pending-1'&&handed?{...d,status:'DONATED',recipient:'DEMO Kitchen'}:d));
  });p.ctx.state.role='owner';p.click('donations');await p.settle();
  p.node('bb-donation-recipient').value='  DEMO Kitchen  ';
  p.click('handoff','pending-1');await p.settle();
  assert.deepEqual(p.requests.find(r=>r.url.endsWith('/handoff')).body,{donation_id:'pending-1',recipient:'DEMO Kitchen'});
  assert.doesNotMatch(p.node('bb-donations').innerHTML,/data-bb="handoff"/);
  assert.match(p.node('bb-message').textContent,/没有联系机构/);
});

test('uncertain handoff retains recipient across reload and retries exactly the same record',async()=>{
  const p=page(async url=>{if(url.endsWith('/handoff'))throw new Error('response lost');return donationReply(url);});
  p.ctx.state.role='owner';p.click('donations');await p.settle();
  p.node('bb-donation-recipient').value='DEMO Kitchen';p.click('handoff','pending-1');await p.settle();
  const sent=p.requests.at(-1).body;
  assert.equal(p.node('bb-donation-recipient').disabled,true);
  assert.equal(p.node('bb-sweep').disabled,true);
  assert.match(p.node('bb-donation-retry').innerHTML,/原请求重试/);
  const restored=page(async url=>donationReply(url),p.storage);restored.ctx.state.role='owner';
  restored.node('bb-donation-recipient').value='changed recipient';
  restored.click('retry-handoff');await restored.settle();
  assert.deepEqual(restored.requests.find(r=>r.url.endsWith('/handoff')).body,sent);
});

test('consumer and staff cannot run donation writes',async()=>{
  const p=page(async url=>donationReply(url));
  for(const role of ['consumer','staff']){
    p.ctx.state.role=role;
    for(const action of ['donations','sweep','handoff','retry-handoff'])p.click(action,'pending-1');
    await p.settle();
  }
  assert.equal(p.requests.length,0);
});

test('unsafe handoff surfaces the backend rejection and never reports success',async()=>{
  const p=page(async url=>url.endsWith('/handoff')?{ok:false,status:409,json:async()=>({error:{code:'UNSAFE_FOR_HANDOFF'}})}:donationReply(url));
  p.ctx.state.role='owner';p.click('donations');await p.settle();
  p.node('bb-donation-recipient').value='DEMO Kitchen';p.click('handoff','pending-1');await p.settle();
  assert.match(p.node('bb-message').textContent,/不能记录交接/);
  assert.doesNotMatch(p.node('bb-message').textContent,/已记录模拟交接/);
  assert.equal(p.node('bb-donation-recipient').disabled,false);
});

test('explicit sweep uses backend time and refreshes the list',async()=>{
  const p=page(async url=>donationReply(url));p.ctx.state.role='owner';
  p.click('sweep');await p.settle();
  assert.deepEqual(p.requests[0],{url:'/api/blind-boxes/sweep',body:{}});
  assert.match(p.node('bb-message').textContent,/处理 1 笔未领订单/);
  assert.ok(p.requests.some(r=>r.url.endsWith('/donations')));
});


const dashboardData = {simulated_revenue_sen:1090,picked_up_gross_profit_sen:240,picked_up_contribution_sen:1040,
  picked_up_qty:4,donated_qty:9,picked_up_weight_g:530,donated_weight_g:2250,estimated_co2e_kg:6.95,
  conversion_rate:null,redemption_repurchase_rate:null,users:[{id:'private-user',points:100}]};

test('dashboard renders backend sen, grams and nullable metrics without inventing results',async()=>{
  const p=page(async()=>ok(dashboardData));p.ctx.state.role='owner';
  p.click('dashboard');await p.settle();
  const html=p.node('bb-dashboard').innerHTML;
  for(const value of ['RM10.90','RM2.40','RM10.40','4 件','9 件','0.530 kg','2.250 kg','6.950 kg CO₂e']) assert.ok(html.includes(value),value);
  assert.equal((html.match(/<strong>暂无数据<\/strong>/g)||[]).length,2);
  assert.doesNotMatch(html,/0\.0%|private-user|undefined|NaN/);
  assert.deepEqual(p.requests,[{url:'/api/blind-boxes/dashboard',body:undefined}]);
});

test('zero is a known statistic while missing fields remain unknown',async()=>{
  const p=page(async()=>ok({simulated_revenue_sen:0,picked_up_qty:0,conversion_rate:0}));p.ctx.state.role='owner';
  p.click('dashboard');await p.settle();
  const html=p.node('bb-dashboard').innerHTML;
  assert.match(html,/RM0\.00/);assert.match(html,/>0 件</);assert.match(html,/>0\.0%</);
  assert.match(html,/<strong>—<\/strong>/);
  assert.doesNotMatch(html,/undefined|NaN/);
});

test('failed dashboard refresh clears old figures and leaves a retryable read',async()=>{
  let failed=false;
  const p=page(async()=>{if(failed)throw new Error('offline');return ok(dashboardData);});p.ctx.state.role='owner';
  p.click('dashboard');await p.settle();assert.match(p.node('bb-dashboard').innerHTML,/RM10\.90/);
  failed=true;p.click('dashboard');await p.settle();
  assert.doesNotMatch(p.node('bb-dashboard').innerHTML,/RM10\.90/);
  assert.match(p.node('bb-dashboard').innerHTML,/统计读取失败/);
});

test('dashboard requests are restricted to the owner role in the demo UI',async()=>{
  const p=page(async()=>ok(dashboardData));
  for(const role of ['consumer','staff']){p.ctx.state.role=role;p.click('dashboard');await p.settle();}
  assert.equal(p.requests.length,0);
});

test('recorded handoff remains successful when its following dashboard refresh fails',async()=>{
  const p=page(async url=>{if(url.endsWith('/dashboard'))throw new Error('stats offline');return donationReply(url);});
  p.ctx.state.role='owner';p.click('donations');await p.settle();
  p.node('bb-donation-recipient').value='DEMO Kitchen';p.click('handoff','pending-1');await p.settle();
  assert.match(p.node('bb-message').textContent,/已记录模拟交接/);
  assert.match(p.node('bb-dashboard').innerHTML,/统计读取失败/);
  assert.ok(p.requests.some(r=>r.url.endsWith('/dashboard')));
});


async function fundedPage(balance=10, fetcher) {
  const p=page(fetcher || (async url=>url.includes('/customer/account')?ok({points:balance,orders:[]}):ok({discount_sen:10,paid_sen:90,points_used:10})));
  p.node('bb-redeem-price').value='1.00';p.node('bb-redeem-points').value='10';
  p.click('account');await p.settle();
  return p;
}

test('redemption uses integer sen, backend receipt and refreshed earned balance',async()=>{
  let redeemed=false;
  const p=await fundedPage(10,async(url,opts)=>{
    if(url.endsWith('/points/redeem')){redeemed=true;return ok({discount_sen:10,paid_sen:90,points_used:10});}
    return ok({points:redeemed?0:10,orders:[]});
  });
  p.redeem();await p.settle();
  const body=p.requests.find(r=>r.url.endsWith('/points/redeem')).body;
  assert.equal(body.regular_price_sen,100);assert.equal(body.points,10);assert.equal(body.user_id,'demo_mei_ling');
  for(const amount of ['RM1.00','RM0.10','RM0.90'])assert.ok(p.node('bb-redeem-result').innerHTML.includes(amount),amount);
  assert.equal(p.node('bb-points').textContent,'0 分');
  assert.equal(p.node('bb-redeem-submit').disabled,true);
});

test('invalid money and point formats never send a redemption request',async()=>{
  const p=await fundedPage(100);
  for(const raw of ['1.001','-1','1e2','0','10000.01']){
    p.node('bb-redeem-price').value=raw;p.redeem();await p.settle();
  }
  p.node('bb-redeem-price').value='1.00';
  for(const raw of ['1.5','-1','0','1e1']){p.node('bb-redeem-points').value=raw;p.redeem();await p.settle();}
  assert.equal(p.requests.filter(r=>r.url.endsWith('/points/redeem')).length,0);
});

test('redemption rejects over balance and over 30 percent before submission',async()=>{
  const p=await fundedPage(100);
  p.node('bb-redeem-points').value='101';p.redeem();await p.settle();
  assert.match(p.node('bb-message').textContent,/积分不足/);
  p.node('bb-redeem-points').value='31';p.redeem();await p.settle();
  assert.match(p.node('bb-message').textContent,/30%/);
  assert.equal(p.requests.filter(r=>r.url.endsWith('/points/redeem')).length,0);
});

test('30 percent cap rounds down in sen instead of rounding the discount up',async()=>{
  const p=await fundedPage(100);
  p.node('bb-redeem-price').value='0.03';p.node('bb-redeem-points').value='1';p.redeem();await p.settle();
  assert.match(p.node('bb-message').textContent,/30%/);
  assert.equal(p.requests.filter(r=>r.url.endsWith('/points/redeem')).length,0);
});

test('lost redemption reply survives reload and retries the original immutable request',async()=>{
  const p=await fundedPage(10,async url=>{if(url.endsWith('/points/redeem'))throw new Error('lost');return ok({points:10,orders:[]});});
  p.redeem();await p.settle();const original=p.requests.at(-1).body;
  assert.equal(p.node('bb-redeem-price').disabled,true);
  assert.equal(p.node('bb-redeem-points').disabled,true);
  assert.equal(p.node('bb-redeem-submit').disabled,false);
  const restored=page(async url=>url.endsWith('/points/redeem')?ok({discount_sen:10,paid_sen:90,points_used:10}):ok({points:0,orders:[]}),p.storage);
  restored.node('bb-redeem-price').value='9.00';restored.node('bb-redeem-points').value='20';
  restored.redeem();await restored.settle();
  assert.deepEqual(restored.requests.find(r=>r.url.endsWith('/points/redeem')).body,original);
});

test('backend insufficient-points rejection refreshes neither a fake receipt nor a fake balance',async()=>{
  const p=await fundedPage(10,async url=>url.endsWith('/points/redeem')?{ok:false,status:409,json:async()=>({error:{code:'INSUFFICIENT_POINTS'}})}:ok({points:10,orders:[]}));
  p.redeem();await p.settle();assert.match(p.node('bb-message').textContent,/积分不足/);
  assert.equal(p.node('bb-redeem-result').innerHTML,'');
  assert.equal(p.node('bb-points').textContent,'10 分');
});

test('owner and staff cannot submit customer point redemptions',async()=>{
  const p=await fundedPage(10);const reads=p.requests.length;
  for(const role of ['owner','staff']){p.ctx.state.role=role;p.redeem();await p.settle();}
  assert.equal(p.requests.length,reads);
});


test('a completed redemption cannot be resubmitted without starting a new simulated purchase',async()=>{
  const p=await fundedPage(30);
  p.redeem();await p.settle();p.redeem();await p.settle();
  assert.equal(p.requests.filter(r=>r.url.endsWith('/points/redeem')).length,1);
  assert.equal(p.node('bb-redeem-submit').disabled,true);
  p.node('bb-redeem-new').handlers.click();p.redeem();await p.settle();
  const sends=p.requests.filter(r=>r.url.endsWith('/points/redeem'));
  assert.equal(sends.length,2);
  assert.notEqual(sends[0].body.idempotency_key,sends[1].body.idempotency_key);
});
