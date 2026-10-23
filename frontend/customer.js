(() => {
  'use strict';
  const API='/api/blind-boxes', USER='demo_mei_ling';
  const $=id=>document.getElementById(id);
  const keys={quote:'smart-yield-customer-quote',confirm:'smart-yield-customer-confirm'};
  let accountVersion=0, pointsBalance=0;
  let quoteState=null, confirmUncertain=false, payMax=0;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=sen=>`RM${(Number(sen)/100).toFixed(2)}`;
  const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('show',!!message);$('notice').style.background=error?'#fff0ed':'';};
  async function api(path,body){
    const response=await fetch(API+path,{signal:AbortSignal.timeout(30000),method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){const err=data.error||data.detail||{};const e=new Error(err.message||'请求失败，请重试');e.code=err.code||'';e.status=response.status;throw e;}
    return data;
  }
  function localDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function isoSlot(date,slot){const [y,m,d]=date.split('-').map(Number),[hh,mm]=slot.split(':').map(Number);const start=new Date(Date.UTC(y,m-1,d,hh-8,mm));const end=new Date(start.getTime()+30*60000);const fmt=x=>x.toISOString().replace('Z','+00:00');return [fmt(start),fmt(end)];}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function save(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function clear(key){localStorage.removeItem(key)}
  const idempotency=()=>crypto.randomUUID();
  function renderQuote(q){quoteState=q;$('offer').classList.remove('empty');$('offer').innerHTML=`<div>报价编号 <code>${esc(q.quote_id.slice(0,8))}</code> · ${q.stock_reserved?'库存已预留':'尚未预留库存'}</div><strong>${money(q.price_sen)}</strong><div>盲盒约 ${q.qty_range.min}–${q.qty_range.max} 件</div><div>已申报过敏原：${q.allergens.length?q.allergens.map(esc).join(', '):'无'}</div><div class="warning">报价到 ${esc(new Date(q.expires_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'}))} 失效。内容不会在页面公开。</div><div class="offer-actions"><button id="confirm-button">去付款</button><button id="discard-button" class="secondary">放弃此报价</button></div>`;$('confirm-button').onclick=openPayment;$('discard-button').onclick=discardQuote;}
  async function makeQuote(event){event.preventDefault();if($('quote-button').disabled || confirmUncertain)return;if(activeQuote()){notice('先确认当前报价，或选择“放弃此报价”后再获取新报价。',true);return;}notice('');$('quote-button').disabled=true;
    try{let pending=read(keys.quote);if(!pending){const date=$('pickup-date').value,slot=$('pickup-slot').value;if(!date)throw new Error('请选择取餐日期');const [pickup_start,pickup_end]=isoSlot(date,slot);pending={body:{user_id:USER,idempotency_key:idempotency(),pickup_start,pickup_end,mode:'standard',preferences:{likes:$('likes').value.split(',').map(x=>x.trim()).filter(Boolean),avoid_allergens:$('allergens').value.split(',').map(x=>x.trim()).filter(Boolean),required_diets:[],dislikes:[]}}};save(keys.quote,pending);}
      // Only the explicit competition session may prepare synthetic stock automatically.
      if(window.Nexflow?.getContext?.().demoTime){
        const inventory=await api('/inventory');
        if(inventory.batches.length===0){
          try{await api('/demo-seed',{});}catch(e){if(e.status!==409)throw e;}
        }
      }
      const q=await api('/quotes',pending.body);clear(keys.quote);save('smart-yield-customer-active-quote',q);renderQuote(q);notice('报价已生成。确认前不会占用库存。');
    }catch(e){const rejected=e.code && e.status<500;if(rejected)clear(keys.quote);const message=({'NO_FEASIBLE_COMBINATION':'目前库存无法组成盲盒，请稍后再试；选填留空已按不限偏好处理。','NO_STOCK':'当前盲盒已售完，请稍后再试。'})[e.code]||e.message;notice(message+(rejected?'':'。网络异常，可直接重试原请求。'),true);}finally{$('quote-button').disabled=false;}}
  function activeQuote(){return read('smart-yield-customer-active-quote')||quoteState;}

  // 1 积分 = 1 sen；单笔最多抵扣本单报价的 30%，向下取整到整积分。
  const maxPointsFor=price=>Math.floor(Number(price)*3/10);
  function paymentPoints(){
    if(!$('pay-use-points').checked)return 0;
    const raw=$('pay-use-value').value.trim(), n=/^\d+$/.test(raw)?Number(raw):NaN;
    return Number.isSafeInteger(n)&&n<=payMax?n:0;
  }
  function paymentError(){
    if(!$('pay-use-points').checked)return '';
    const raw=$('pay-use-value').value.trim();
    if(!/^\d+$/.test(raw))return '使用积分需为非负整数';
    const n=Number(raw);
    if(!Number.isSafeInteger(n))return '使用积分需为非负整数';
    if(n>payMax)return `本单最多可使用 ${payMax} 分`;
    return '';
  }
  function paintPayment(){
    const q=activeQuote();if(!q)return;
    const use=$('pay-use-points').checked;
    $('pay-points-row').hidden=!use;
    const points=paymentPoints();
    $('pay-discount').textContent=money(points);
    $('pay-total').textContent=money(Math.max(0,Number(q.price_sen)-points));
    if(!confirmUncertain)$('pay-error').textContent=paymentError();
  }
  async function openPayment(){
    const q=activeQuote();if(!q)return;
    notice('');
    await refreshAccount(); // 只读：获取最新可用积分，不扣分、不重新抽盒。
    payMax=Math.max(0,Math.min(pointsBalance,maxPointsFor(q.price_sen)));
    $('pay-price').textContent=money(q.price_sen);
    $('pay-points').textContent=`${pointsBalance} 分`;
    $('pay-use-points').checked=false;$('pay-use-points').disabled=false;
    $('pay-use-value').value='0';$('pay-use-value').disabled=false;$('pay-max').disabled=false;
    $('pay-submit').disabled=false;
    $('pay-error').textContent='';
    $('pay-dialog').hidden=false;
    const pending=read(keys.confirm);
    confirmUncertain=!!pending;
    if(pending){
      $('pay-use-points').checked=Number(pending.body.points_used||0)>0;
      $('pay-use-points').disabled=true;
      $('pay-use-value').value=String(pending.body.points_used||0);
      $('pay-use-value').disabled=true;
      $('pay-max').disabled=true;
      $('pay-error').textContent='上次付款结果未知。请用原付款参数重试；不要修改积分数额。';
    }
    paintPayment();
  }
  function closePayment(){$('pay-dialog').hidden=true;}
  async function confirmPayment(){
    const q=activeQuote();if(!q)return;
    if($('pay-submit').disabled)return;
    const pending=read(keys.confirm);
    let body=pending&&pending.body;
    if(!body){
      const err=paymentError();
      if(err){$('pay-error').textContent=err;return;}
      body={quote_id:q.quote_id,user_id:USER,idempotency_key:idempotency(),points_used:paymentPoints()};
      save(keys.confirm,{body}); // 先保存再发送：网络异常时用同一请求编号重试
    }
    $('pay-submit').disabled=true;confirmUncertain=true;$('pay-error').textContent='';
    try{
      await api('/quotes/confirm',body);
      clear(keys.confirm);clear('smart-yield-customer-active-quote');
      quoteState=null;confirmUncertain=false;
      closePayment();
      $('offer').textContent='报价已确认，请在下方查看订单。';
      notice('订单已建立：模拟付款完成，库存已预留。');
      await refreshAccount();
      await window.Nexflow?.changed('顾客账本更新');
    }catch(e){
      // 4xx 是明确拒绝：后端事务已回滚，可改用新请求重新支付。
      confirmUncertain=!e.code||e.status>=500;
      if(!confirmUncertain)clear(keys.confirm);
      $('pay-error').textContent=(confirmUncertain?'结果未知，请用原付款参数重试；不要修改积分数额。':'')+(e.message||'请求失败');
      $('pay-submit').disabled=false;
      $('pay-use-points').disabled=confirmUncertain;$('pay-use-value').disabled=confirmUncertain;$('pay-max').disabled=confirmUncertain;
    }
  }
  function discardQuote(){if(confirmUncertain){notice('付款结果未明，先重试原付款以避免重复下单。',true);return;}clear('smart-yield-customer-active-quote');clear(keys.quote);clear(keys.confirm);quoteState=null;$('offer').classList.add('empty');$('offer').textContent='报价会显示在这里。';notice('已放弃报价，没有创建订单。');}
  function status(s){return ({RESERVED:'待取餐',PICKED_UP:'已取餐',NO_SHOW:'未按时取餐'}[s]||s);}
  function orderAmounts(o){const discount=Number(o.points_discount_sen||0);const paid=Number(o.paid_sen!=null?o.paid_sen:o.price_sen);return `${money(o.price_sen)} · 积分抵扣 ${money(discount)} · 实付 ${money(paid)}`;}
  async function refreshAccount(){const version=++accountVersion;try{const data=await api(`/customer/account?user_id=${encodeURIComponent(USER)}`);if(version!==accountVersion)return;pointsBalance=data.points;$('balance').textContent=`${data.points} 分`;$('pending-points').textContent=`${data.pending_points} 分`;$('orders').classList.remove('muted');if(!data.orders.length){$('orders').textContent='还没有盲盒订单。';return;}const orderMarkup=data.orders.map(o=>`<div class="order"><div><strong>订单 ${esc(o.order_id.slice(0,8))}</strong><br><small>${esc(new Date(o.pickup_start).toLocaleString('zh-CN',{timeZone:'Asia/Kuala_Lumpur',hour12:false}))+' UTC+08:00'}</small><br><small>${orderAmounts(o)}</small><br><small>待到账 ${o.pending_points} 分 · 已到账 ${o.points_awarded} 分${o.payment==='simulated_paid'?' · 模拟已付款':''}</small></div><span class="order-status">${esc(status(o.status))}</span>${o.status==='RESERVED'?`<button data-pickup="${esc(o.order_id)}">模拟取餐</button>`:''}</div>`).join('');$('orders').innerHTML=orderMarkup;$('orders').querySelectorAll('[data-pickup]').forEach(b=>b.onclick=()=>pickup(b.dataset.pickup));}
    catch(e){if(version!==accountVersion)return;$('balance').textContent='读取失败';$('pending-points').textContent='读取失败';$('orders').textContent=`订单读取失败：${e.message}。点击刷新重试。`;}}
  async function pickup(orderId){const button=document.querySelector(`[data-pickup="${CSS.escape(orderId)}"]`);if(button?.disabled)return;if(button)button.disabled=true;try{await api('/customer/pickup',{user_id:USER,order_id:orderId});notice('取餐已核销（演示）。库存已扣减；本次可到账积分已写入后端账本。');await refreshAccount();await window.Nexflow?.changed('顾客账本更新');}catch(e){notice(`${e.message}。只能在预约取餐时段内核销。`,true);if(button)button.disabled=false;}}
  $('customer-id').textContent=USER;$('pickup-date').value=localDate();$('pickup-date').min=localDate();
  $('quote-form').addEventListener('submit',makeQuote);$('refresh').onclick=refreshAccount;
  $('pay-use-points').addEventListener('change',paintPayment);
  $('pay-use-value').addEventListener('input',paintPayment);
  $('pay-max').addEventListener('click',()=>{$('pay-use-value').value=String(payMax);paintPayment();});
  $('pay-submit').addEventListener('click',()=>confirmPayment());
  $('pay-cancel').addEventListener('click',closePayment);
  $('pay-close').addEventListener('click',closePayment);
  const saved=read('smart-yield-customer-active-quote');if(saved)renderQuote(saved);
  if(read(keys.confirm)){confirmUncertain=true;const q=activeQuote();if(q)renderQuote(q);notice('检测到尚未确认的付款，点“去付款”会用原付款参数重试。',true);}
  window.Nexflow.registerPurchase({mount:async()=>{}, getBalance:user=>api(`/customer/account?user_id=${encodeURIComponent(user)}`)});
  refreshAccount();
})();
