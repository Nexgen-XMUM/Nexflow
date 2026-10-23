const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function page(demoTime=null){
  const nodes=new Map(), storage=new Map(), calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(e,f){this[e]=f;},querySelectorAll(){return[];},insertAdjacentHTML(){}});return nodes.get(id);};
  let handler=async url=>({user_id:'demo_mei_ling',points:0,pending_points:0,orders:[]}), changed=0;
  const context={document:{getElementById:node,querySelector:()=>node('pickup')},window:{Nexflow:{getContext:()=>({demoTime}),registerPurchase(){},async changed(){changed++;}}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=>String(calls.length)},CSS:{escape:x=>x},Intl,Date,AbortSignal,
    fetch:async(url,opts)=>{calls.push({url,body:opts.body&&JSON.parse(opts.body)});const data=await handler(url,opts);return {ok:true,json:async()=>data};}};
    // 模块现在依赖 i18n.js：在 VM 里加载同一份字典并固定为中文，断言保持原样。
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../i18n.js'),'utf8'),context);
    vm.runInNewContext("window.NexFlowI18N.setLang('zh-CN',{silent:true})",context);
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../customer.js'),'utf8'),context);
  return {node,calls,storage,setHandler:f=>handler=f,changed:()=>changed};
}
const event={preventDefault(){}};
const quote={quote_id:'quote-123',price_sen:700,qty_range:{min:2,max:4},allergens:['wheat'],expires_at:'2026-10-23T22:00:00+08:00',stock_reserved:false};
test('customer quote confirm uses same request after uncertainty and notifies the shell',async()=>{
  const p=page();await new Promise(setImmediate);
  p.node('pickup-slot').value='21:30';
  p.setHandler(async url=>url.endsWith('/quotes')?quote:{user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]});
  await p.node('quote-form').submit(event);
  assert.match(p.node('offer').innerHTML,/RM7.00/);
  await p.node('confirm-button').onclick();                 // 去付款：只读账户，不扣积分
  assert.equal(p.node('pay-dialog').hidden,false);
  assert.match(p.node('pay-price').textContent,/RM7\.00/);
  assert.match(p.node('pay-points').textContent,/30 分/);
  p.setHandler(async url=>{if(url.endsWith('/confirm'))throw new Error('offline');
    return {user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]};});
  await p.node('pay-submit').click();                     // 网络异常：保留原请求编号
  const first=p.calls.findLast(c=>c.url.endsWith('/confirm')).body;
  p.node('discard-button').onclick();assert.match(p.node('notice').textContent,/未明/);
  p.setHandler(async url=>url.endsWith('/confirm')
    ?{order_id:'order-123',price_sen:700,status:'RESERVED',pickup_start:'today'}
    :{user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]});
  await p.node('pay-submit').click();
  assert.deepEqual(p.calls.findLast(c=>c.url.endsWith('/confirm')).body,first);
  assert.equal(p.changed(),1);assert.equal(p.storage.has('smart-yield-customer-confirm'),false);
  assert.match(p.node('offer').textContent,/报价已确认/);
  assert.equal(p.node('pay-dialog').hidden,true);
});
test('payment dialog rejects invalid points and retries the same redemption after uncertainty',async()=>{
  const p=page();await new Promise(setImmediate);
  p.node('pickup-slot').value='21:30';
  p.setHandler(async url=>url.endsWith('/quotes')?quote:{user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]});
  await p.node('quote-form').submit(event);
  await p.node('confirm-button').onclick();
  p.node('pay-use-points').checked=true;
  p.node('pay-use-value').value='1.5';p.node('pay-use-value').input();
  assert.match(p.node('pay-error').textContent,/非负整数/);
  const before=p.calls.length;
  await p.node('pay-submit').click();
  assert.equal(p.calls.length,before,'小数积分不能提交');
  p.node('pay-use-value').value='999';p.node('pay-use-value').input();
  assert.match(p.node('pay-error').textContent,/最多可使用 30 分/);
  await p.node('pay-submit').click();
  assert.equal(p.calls.length,before,'超过本单上限不能提交');
  p.node('pay-use-value').value='5';p.node('pay-use-value').input();
  assert.match(p.node('pay-discount').textContent,/RM0\.05/);
  assert.match(p.node('pay-total').textContent,/RM6\.95/);
  let fail=true;
  p.setHandler(async url=>{
    if(url.endsWith('/confirm')){if(fail)throw new Error('offline');return {order_id:'order-123',status:'RESERVED'};}
    return {user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]};
  });
  await p.node('pay-submit').click();
  const first=p.calls.findLast(c=>c.url.endsWith('/confirm')).body;
  assert.equal(first.points_used,5);
  assert.equal(p.node('pay-use-value').disabled,true,'结果未明时锁住积分数额');
  fail=false;await p.node('pay-submit').click();
  assert.deepEqual(p.calls.findLast(c=>c.url.endsWith('/confirm')).body,first);
  assert.equal(p.calls.filter(c=>c.url.endsWith('/confirm')).length,2);
  assert.equal(p.storage.has('smart-yield-customer-confirm'),false);
});
test('an expired quote is cleared instead of leaving the pay dialog stuck',async()=>{
  const p=page();await new Promise(setImmediate);
  p.node('pickup-slot').value='21:30';
  p.setHandler(async url=>url.endsWith('/quotes')?quote:{user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]});
  await p.node('quote-form').submit(event);
  await p.node('confirm-button').onclick();
  const expired=Object.assign(new Error('Quote expired; request a new quote'),{code:'QUOTE_EXPIRED',status:409});
  p.setHandler(async url=>{if(url.endsWith('/confirm'))throw expired;
    return {user_id:'demo_mei_ling',points:30,pending_points:0,orders:[]};});
  await p.node('pay-submit').click();
  assert.match(p.node('notice').textContent,/报价已失效/);
  assert.equal(p.node('pay-dialog').hidden,true);
  assert.equal(p.node('pay-submit').disabled,false);
  assert.equal(p.storage.has('smart-yield-customer-active-quote'),false);
  assert.equal(p.node('offer').textContent,'报价会显示在这里。');
});

test('blank optional fields quote directly and prepare only an empty demo inventory',async()=>{
  const p=page('2026-10-23T21:35:00+08:00');await new Promise(setImmediate);
  p.node('pickup-slot').value='21:30';
  p.setHandler(async url=>url.endsWith('/inventory')?{batches:[]}:url.endsWith('/demo-seed')?{imported:3}:quote);
  await p.node('quote-form').submit(event);
  assert.deepEqual(p.calls.slice(1).map(c=>c.url),['/api/blind-boxes/inventory','/api/blind-boxes/demo-seed','/api/blind-boxes/quotes']);
  assert.deepEqual(p.calls.at(-1).body.preferences,{likes:[],avoid_allergens:[],required_diets:[],dislikes:[]});
  assert.match(p.node('offer').innerHTML,/RM7.00/);
  p.node('discard-button').onclick();
  p.setHandler(async url=>url.endsWith('/inventory')?{batches:[{available:0}]}:quote);
  await p.node('quote-form').submit(event);
  assert.equal(p.calls.filter(c=>c.url.endsWith('/demo-seed')).length,1);
});
