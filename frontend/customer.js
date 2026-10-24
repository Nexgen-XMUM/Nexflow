(() => {
  'use strict';
  const API='/api/blind-boxes', USER='demo_mei_ling';
  const $=id=>document.getElementById(id);
  // 三语言文案：i18n.js 先加载；缺失时退回键名，不让页面崩。
  const t=(key,vars)=>window.NexFlowI18N?window.NexFlowI18N.t(key,vars):key;
  const locale=()=>window.NexFlowI18N?window.NexFlowI18N.locale():'en-MY';
  const keys={quote:'smart-yield-customer-quote',confirm:'smart-yield-customer-confirm'};
  let accountVersion=0, pointsBalance=0, pointsBalanceVerified=false;
  let quoteState=null, confirmUncertain=false, payMax=0;
  // 提示与报价区都保存“键 + 变量”，切换语言时重新渲染，而不是保留旧语言快照。
  let lastNotice=null, lastPayError=null, lastPayBalanceHint=null, offerMode={mode:'empty'}, lastAccount=null;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=sen=>`RM${(Number(sen)/100).toFixed(2)}`;
  function paintNotice(){
    const el=$('notice'), n=lastNotice;
    el.textContent=n?t(n.key,n.vars):'';
    el.classList.toggle('show',!!n);
    el.style.background=n&&n.error?'#fff0ed':'';
  }
  const notice=(key,vars=null,error=false)=>{lastNotice=key?{key,vars,error}:null;paintNotice();};
  function paintPayError(){
    const el=$('pay-error'); if(!el) return;
    el.textContent=lastPayError?t(lastPayError.key,lastPayError.vars):'';
    if(el.dataset) el.dataset.busy=String(lastPayError?.key==='pay.processing');
  }
  const setPayError=(key,vars=null)=>{lastPayError=key?{key,vars}:null;paintPayError();};
  function paintPayBalanceHint(){
    const el=$('pay-balance-hint');
    if(el)el.textContent=lastPayBalanceHint?t(lastPayBalanceHint):'';
  }
  async function api(path,body){
    let response;try{response=await fetch(API+path,{signal:AbortSignal.timeout(30000),method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}catch(e){if(e&&e.code)throw e;throw new Error(t('common.offline'));}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){const err=data.error||data.detail||{};const e=new Error(err.message||t('pay.requestFail'));e.code=err.code||'';e.status=response.status;throw e;}
    return data;
  }
  function localDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function isoSlot(date,slot){const [y,m,d]=date.split('-').map(Number),[hh,mm]=slot.split(':').map(Number);const start=new Date(Date.UTC(y,m-1,d,hh-8,mm));const end=new Date(start.getTime()+30*60000);const fmt=x=>x.toISOString().replace('Z','+00:00');return [fmt(start),fmt(end)];}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function save(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function clear(key){localStorage.removeItem(key)}
  const idempotency=()=>crypto.randomUUID();

  function renderOfferEmpty(){
    offerMode={mode:'empty'};
    const el=$('offer');
    el.classList.add('empty');
    el.textContent=t('quote.placeholder');
  }
  function renderOfferMessage(key){
    offerMode={mode:'message',key};
    const el=$('offer');
    el.classList.remove('empty');
    el.textContent=t(key);
  }
  function renderQuote(q){
    offerMode={mode:'quote'};
    $('offer').classList.remove('empty');
    const time=new Date(q.expires_at).toLocaleTimeString(locale(),{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'});
    $('offer').innerHTML=`<div>${esc(t('quote.idLine',{id:q.quote_id.slice(0,8),reserved:t(q.stock_reserved?'quote.reserved':'quote.notReserved')}))}</div><strong>${money(q.price_sen)}</strong><div>${esc(t('quote.range',{min:q.qty_range.min,max:q.qty_range.max}))}</div><div>${esc(t('quote.allergens',{list:q.allergens.length?q.allergens.map(esc).join(', '):t('quote.none')}))}</div><div class="warning">${esc(t('quote.expiry',{time}))}</div><div class="offer-actions"><button id="confirm-button">${esc(t('quote.goPay'))}</button><button id="discard-button" class="secondary">${esc(t('quote.discard'))}</button></div>`;
    $('confirm-button').onclick=openPayment;$('discard-button').onclick=discardQuote;
  }
  function repaintOffer(){
    if(offerMode.mode==='quote'){const q=activeQuote();if(q)renderQuote(q);else renderOfferEmpty();}
    else if(offerMode.mode==='message')renderOfferMessage(offerMode.key);
    else renderOfferEmpty();
  }
  async function makeQuote(event){event.preventDefault();if($('quote-button').disabled || confirmUncertain)return;if(activeQuote()){notice('quote.activeExists',null,true);return;}notice('quote.loading');$('quote-button').disabled=true;
    try{let pending=read(keys.quote);if(!pending){const date=$('pickup-date').value,slot=$('pickup-slot').value;if(!date)throw new Error(t('quote.needDate'));const list=id=>String($(id)?.value||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);const likeList=list('likes'),dislikeList=list('dislikes');if(likeList.some(x=>dislikeList.includes(x)))throw Object.assign(new Error('clash'),{code:'LIKE_CLASH',status:400});const [pickup_start,pickup_end]=isoSlot(date,slot);pending={body:{user_id:USER,idempotency_key:idempotency(),pickup_start,pickup_end,mode:'standard',preferences:{likes:$('likes').value.split(',').map(x=>x.trim()).filter(Boolean),avoid_allergens:$('allergens').value.split(',').map(x=>x.trim()).filter(Boolean),required_diets:list('diets'),dislikes:dislikeList}}};save(keys.quote,pending);}
      // Only the explicit competition session may prepare synthetic stock automatically.
      if(window.Nexflow?.getContext?.().demoTime){
        const inventory=await api('/inventory');
        if(inventory.batches.length===0){
          try{await api('/demo-seed',{});}catch(e){if(e.status!==409)throw e;}
        }
      }
      const q=await api('/quotes',pending.body);clear(keys.quote);save('smart-yield-customer-active-quote',q);renderQuote(q);notice('quote.created');
      $('offer').scrollIntoView?.({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
    }catch(e){const rejected=e.code && e.status<500;if(rejected)clear(keys.quote);
      const known={'NO_FEASIBLE_COMBINATION':'quote.noCombo','NO_STOCK':'quote.noStock','QUOTE_EXPIRED':'quote.expired','LIKE_CLASH':'quote.likeDislikeClash'}[e.code];
      if(known){notice(known,null,true);}
      else{notice(rejected?'pay.requestFail':'quote.networkFail',{err:e.message},true);}
    }finally{$('quote-button').disabled=false;}}
  function activeQuote(){return read('smart-yield-customer-active-quote')||quoteState;}

  // 1 积分 = 1 sen；单笔最多抵扣本单报价的 30%，向下取整到整积分。
  const maxPointsFor=price=>Math.floor(Number(price)*3/10);
  function paymentPoints(){
    if(confirmUncertain){
      const pending=read(keys.confirm);
      if(pending)return Number(pending.body.points_used||0);
    }
    if(!$('pay-use-points').checked)return 0;
    const raw=$('pay-use-value').value.trim(), n=/^\d+$/.test(raw)?Number(raw):NaN;
    return Number.isSafeInteger(n)&&n<=payMax?n:0;
  }
  function paymentErrorVars(){
    if(!$('pay-use-points').checked)return null;
    const raw=$('pay-use-value').value.trim();
    if(!/^\d+$/.test(raw))return {key:'pay.errInteger'};
    const n=Number(raw);
    if(!Number.isSafeInteger(n))return {key:'pay.errInteger'};
    if(n>payMax)return {key:'pay.errMax',vars:{n:payMax}};
    return null;
  }
  function paintPayment(){
    const q=activeQuote();if(!q)return;
    const use=$('pay-use-points').checked;
    const canRedeem=pointsBalanceVerified&&payMax>0;
    $('pay-points-row').hidden=!use;
    $('pay-use-points').disabled=confirmUncertain||!canRedeem;
    $('pay-use-value').disabled=confirmUncertain||!canRedeem||!use;
    $('pay-max').disabled=confirmUncertain||!canRedeem||!use;
    const points=paymentPoints();
    $('pay-discount').textContent=money(points);
    $('pay-total').textContent=money(Math.max(0,Number(q.price_sen)-points));
    if(!confirmUncertain){const err=paymentErrorVars();setPayError(err?err.key:null,err?err.vars:null);}
  }
  async function openPayment(){
    const q=activeQuote();if(!q)return;
    notice('');
    const account=await refreshAccount(); // 只读：获取最新可用积分，不扣分、不重新抽盒。
    const pending=read(keys.confirm);
    payMax=account?Math.max(0,Math.min(pointsBalance,maxPointsFor(q.price_sen))):0;
    if(pending)payMax=Math.max(payMax,Number(pending.body.points_used||0));
    $('pay-price').textContent=money(q.price_sen);
    $('pay-points').textContent=account?t('common.points',{n:pointsBalance}):t('pay.pointsUnavailable');
    lastPayBalanceHint=!account?'pay.balanceUnavailable':payMax===0?'pay.noPoints':null;
    paintPayBalanceHint();
    $('pay-use-points').checked=false;$('pay-use-points').disabled=false;
    $('pay-use-value').value='0';$('pay-use-value').disabled=false;$('pay-max').disabled=false;
    $('pay-submit').disabled=false;
    setPayError(null);
    $('pay-dialog').hidden=false;
    confirmUncertain=!!pending;
    if(pending){
      $('pay-use-points').checked=Number(pending.body.points_used||0)>0;
      $('pay-use-points').disabled=true;
      $('pay-use-value').value=String(pending.body.points_used||0);
      $('pay-use-value').disabled=true;
      $('pay-max').disabled=true;
      setPayError('pay.uncertain');
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
      const err=paymentErrorVars();
      if(err){setPayError(err.key,err.vars);return;}
      body={quote_id:q.quote_id,user_id:USER,idempotency_key:idempotency(),points_used:paymentPoints()};
      save(keys.confirm,{body}); // 先保存再发送：网络异常时用同一请求编号重试
    }
    $('pay-submit').disabled=true;confirmUncertain=true;
    $('pay-submit').setAttribute?.('aria-busy','true');
    setPayError('pay.processing');
    try{
      await api('/quotes/confirm',body);
      clear(keys.confirm);clear('smart-yield-customer-active-quote');
      quoteState=null;confirmUncertain=false;
      closePayment();
      renderOfferMessage('pay.confirmed');
      notice('pay.orderCreated');
      await refreshAccount();
      await window.Nexflow?.changed(t('logEntry.kindLedger'));
    }catch(e){
      // 报价在当前服务里已不存在（例如演示服务重启、临时库更换）或已过期：
      // 清掉浏览器里残留的旧报价与待确认状态，提示重新报价，避免卡死。
      if(e.code==='QUOTE_NOT_FOUND'||e.code==='QUOTE_EXPIRED'){resetStaleQuote();return;}
      // 4xx 是明确拒绝：后端事务已回滚，可改用新请求重新支付。
      confirmUncertain=!e.code||e.status>=500;
      if(!confirmUncertain)clear(keys.confirm);
      setPayError(confirmUncertain?'pay.uncertainWith':'pay.failedWith',{err:e.message||t('pay.requestFail')});
      $('pay-submit').disabled=false;
      const canRedeem=pointsBalanceVerified&&payMax>0;
      $('pay-use-points').disabled=confirmUncertain||!canRedeem;
      $('pay-use-value').disabled=confirmUncertain||!canRedeem||!$('pay-use-points').checked;
      $('pay-max').disabled=confirmUncertain||!canRedeem||!$('pay-use-points').checked;
    }finally{
      $('pay-submit').setAttribute?.('aria-busy','false');
    }
  }
  function resetStaleQuote(){ // 报价已失效：清理旧报价与待确认付款，允许重新报价
    clear('smart-yield-customer-active-quote');clear(keys.quote);clear(keys.confirm);
    quoteState=null;confirmUncertain=false;
    $('pay-submit').disabled=false;
    $('pay-use-points').disabled=false;$('pay-use-value').disabled=false;$('pay-max').disabled=false;
    closePayment();
    renderOfferEmpty();
    notice('quote.stale',null,true);
  }
  function discardQuote(){if(confirmUncertain){notice('quote.payFirst',null,true);return;}clear('smart-yield-customer-active-quote');clear(keys.quote);clear(keys.confirm);quoteState=null;renderOfferEmpty();notice('quote.discarded');}
  function status(s){return ({RESERVED:t('order.statusReserved'),PICKED_UP:t('order.statusPicked'),NO_SHOW:t('order.statusNoShow')}[s]||s);}
  function orderAmounts(o){const discount=Number(o.points_discount_sen||0);const paid=Number(o.paid_sen!=null?o.paid_sen:o.price_sen);return t('order.amounts',{price:money(o.price_sen),discount:money(discount),paid:money(paid)});}
  function renderOrders(data){
    const box=$('orders');
    box.classList.remove('muted');
    if(!data.orders.length){box.textContent=t('order.none');return;}
    box.innerHTML=data.orders.map(o=>`<div class="order"><div><strong>${esc(t('order.id',{id:o.order_id.slice(0,8)}))}</strong><br><small>${esc(new Date(o.pickup_start).toLocaleString(locale(),{timeZone:'Asia/Kuala_Lumpur',hour12:false}))+' UTC+08:00'}</small><br><small>${esc(orderAmounts(o))}</small><br><small>${esc(t('order.pointsLine',{pending:o.pending_points,awarded:o.points_awarded}))}${o.payment==='simulated_paid'?' · '+esc(t('order.simulatedPaid')):''}</small></div><span class="order-status">${esc(status(o.status))}</span>${o.status==='RESERVED'?`<button data-pickup="${esc(o.order_id)}">${esc(t('order.simulatePickup'))}</button>`:''}</div>`).join('');
    box.querySelectorAll('[data-pickup]').forEach(b=>b.onclick=()=>pickup(b.dataset.pickup));
  }
  async function refreshAccount(){
    const version=++accountVersion,button=$('refresh'),orders=$('orders');
    if(button){button.disabled=true;button.setAttribute?.('aria-busy','true');}
    orders?.setAttribute?.('aria-busy','true');
    const hint=$('balanceHint');if(hint)hint.textContent=t('shop.balanceReading');
    try{
      const data=await api(`/customer/account?user_id=${encodeURIComponent(USER)}`);
      if(version!==accountVersion)return lastAccount;
      if(!Number.isSafeInteger(data?.points)||data.points<0)throw new Error(t('shop.balanceMissing'));
      pointsBalance=data.points;pointsBalanceVerified=true;lastAccount=data;
      $('balance').textContent=t('common.points',{n:data.points});
      $('pending-points').textContent=t('common.points',{n:data.pending_points});
      if(hint)hint.textContent=t('shop.balanceFromApi');
      renderOrders(data);
      return data;
    }catch(e){
      if(version!==accountVersion)return lastAccount;
      lastAccount=null;pointsBalance=0;pointsBalanceVerified=false;
      $('balance').textContent=t('order.readFail');$('pending-points').textContent=t('order.readFail');
      if(hint)hint.textContent=t('shop.balanceFail',{err:e.message});
      $('orders').textContent=t('order.listFail',{err:e.message});
      return null;
    }finally{
      if(version===accountVersion){
        if(button){button.disabled=false;button.setAttribute?.('aria-busy','false');}
        orders?.setAttribute?.('aria-busy','false');
      }
    }
  }
  async function pickup(orderId){const button=document.querySelector(`[data-pickup="${CSS.escape(orderId)}"]`);if(button?.disabled)return;if(button)button.disabled=true;try{await api('/customer/pickup',{user_id:USER,order_id:orderId});notice('order.pickupDone');await refreshAccount();await window.Nexflow?.changed(t('logEntry.kindLedger'));}catch(e){notice('order.pickupWindow',{err:e.message},true);if(button)button.disabled=false;}}

  /* 切换语言：重画报价卡、订单、提示；不重新报价、不重新下单、不请求接口。 */
  function relabel(){
    repaintOffer();
    repaintPayment();
    paintNotice();
    paintPayError();
    paintPayBalanceHint();
    if(lastAccount){
      $('balance').textContent=t('common.points',{n:lastAccount.points});
      $('pending-points').textContent=t('common.points',{n:lastAccount.pending_points});
      renderOrders(lastAccount);
    }
    else if($('orders').classList.contains('muted'))$('orders').textContent=t('shop.ordersLoading');
  }
  function repaintPayment(){
    const q=activeQuote();
    if(!q)return;
    $('pay-points').textContent=pointsBalanceVerified?t('common.points',{n:pointsBalance}):t('pay.pointsUnavailable');
    paintPayment();
  }

  $('customer-id').textContent=USER;$('pickup-date').value=localDate();$('pickup-date').min=localDate();
  $('quote-form').addEventListener('submit',makeQuote);$('refresh').onclick=refreshAccount;
  $('pay-use-points').addEventListener('change',paintPayment);
  $('pay-use-value').addEventListener('input',paintPayment);
  $('pay-max').addEventListener('click',()=>{if(!pointsBalanceVerified||payMax<=0)return;$('pay-use-points').checked=true;$('pay-use-value').value=String(payMax);paintPayment();});
  $('pay-submit').addEventListener('click',()=>confirmPayment());
  $('pay-cancel').addEventListener('click',closePayment);
  $('pay-close').addEventListener('click',closePayment);
  const saved=read('smart-yield-customer-active-quote');if(saved)renderQuote(saved);else renderOfferEmpty();
  if(read(keys.confirm)){confirmUncertain=true;const q=activeQuote();if(q)renderQuote(q);notice('pay.detectedPending',null,true);}
  if(window.NexFlowI18N) window.NexFlowI18N.onChange(relabel);
  window.Nexflow.registerPurchase({mount:async()=>{}, getBalance:user=>api(`/customer/account?user_id=${encodeURIComponent(user)}`), relabel});
  refreshAccount();
})();
