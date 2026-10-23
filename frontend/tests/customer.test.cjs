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
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../customer.js'),'utf8'),context);
  return {node,calls,storage,setHandler:f=>handler=f,changed:()=>changed};
}
const event={preventDefault(){}};
const quote={quote_id:'quote-123',price_sen:700,qty_range:{min:2,max:4},allergens:['wheat'],expires_at:'2026-10-23T22:00:00+08:00',stock_reserved:false};
test('customer quote confirm uses same request after uncertainty and notifies the shell',async()=>{
  const p=page();await new Promise(setImmediate);
  p.node('pickup-slot').value='21:30';p.setHandler(async()=>quote);await p.node('quote-form').submit(event);
  assert.match(p.node('offer').innerHTML,/RM7.00/);
  p.setHandler(async()=>{throw new Error('offline');});await p.node('confirm-button').onclick();
  const first=p.calls.at(-1).body;
  p.node('discard-button').onclick();assert.match(p.node('notice').textContent,/结果未明/);
  p.setHandler(async url=>url.endsWith('/confirm')?{order_id:'order-123',price_sen:700,status:'RESERVED',pickup_start:'today'}:{points:0,pending_points:0,orders:[]});
  await p.node('confirm-button').onclick();
  assert.deepEqual(p.calls.findLast(c=>c.url.endsWith('/confirm')).body,first);
  assert.equal(p.changed(),1);assert.equal(p.storage.has('smart-yield-customer-confirm'),false);
  assert.match(p.node('offer').textContent,/报价已确认/);
});
test('redemption rejects fractional points and recovers locked fields after an uncertain retry',async()=>{
  const p=page();await new Promise(setImmediate);
  p.node('regular-price').value='10.00';p.node('redeem-points').value='1.5';
  await p.node('redeem-form').submit(event);assert.match(p.node('notice').textContent,/正整数/);
  p.node('redeem-points').value='5';p.setHandler(async()=>{throw new Error('offline');});
  await p.node('redeem-form').submit(event);assert.equal(p.node('regular-price').disabled,true);
  const first=p.calls.findLast(c=>c.url.endsWith('/redeem')).body;
  p.setHandler(async url=>url.endsWith('/redeem')?{discount_sen:5,paid_sen:995}:{points:5,pending_points:0,orders:[]});
  await p.node('redeem-form').submit(event);
  assert.deepEqual(p.calls.findLast(c=>c.url.endsWith('/redeem')).body,first);
  assert.equal(p.node('regular-price').disabled,false);assert.match(p.node('receipt').textContent,/RM0.05.*RM9.95/);
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
