(() => {
  'use strict';
  const token=document.querySelector('meta[name="jobbot-token"]')?.content;
  if(!token||document.querySelector('meta[name="jobbot-app"]')?.content!=='8.0.0')return;
  const publish=data=>window.postMessage({channel:'jobbot-bridge',...data},location.origin);
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='jobbot-request')return;
    const {id,command,payload}=event.data;
    if(!['HELLO','START','FOCUS','RESUME','ENRICH','CONNECT_SITE','PAUSE_ENRICH','DELIVERY_PREPARE','DELIVERY_SEND','DELIVERY_FOCUS'].includes(command))return;
    try{
      const response=await chrome.runtime.sendMessage({...payload,kind:command});
      publish({kind:'response',id,result:response});
    }catch{publish({kind:'response',id,result:{error:'Le navigateur JobBot doit être rouvert depuis le programme.'}});}
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.kind==='DELIVERY_CHECK'){
      fetch('/api/outbox/task?id='+encodeURIComponent(message.id)+'&meta=1',{headers:{'X-JobBot-Token':token}}).then(async r=>{const t=await r.json();if(!r.ok)throw new Error();respond({status:t.status});}).catch(()=>respond({error:true}));return true;
    }
    if(message.kind==='DELIVERY_FETCH'){
      fetch('/api/outbox/task?id='+encodeURIComponent(message.id),{headers:{'X-JobBot-Token':token}}).then(async r=>{const task=await r.json();if(!r.ok)throw new Error();respond({task});}).catch(()=>respond({error:true}));return true;
    }
    if(message.kind==='DELIVERY_UPDATE'){
      fetch('/api/outbox/results',{method:'POST',headers:{'Content-Type':'application/json','X-JobBot-Token':token},body:JSON.stringify(message.payload)}).then(async r=>{const delivery=await r.json();if(!r.ok)throw new Error();publish({kind:'delivery',delivery});respond({ok:true});}).catch(()=>respond({error:true}));return true;
    }
    if(!['BOARD_UPDATE','ENRICH_UPDATE'].includes(message.kind))return;
    const enrichment=message.kind==='ENRICH_UPDATE';
    fetch(enrichment?'/api/enrich/results':'/api/search/results',{method:'POST',headers:{'Content-Type':'application/json','X-JobBot-Token':token},body:JSON.stringify(message.payload)})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Lecture interrompue.');
        publish(enrichment?{kind:'enrichment',...data}:{kind:'feed',feed:data});respond({ok:true});
      }).catch(error=>{publish({kind:'error',message:error.message,search_id:message.payload.search_id});respond({error:true});});
    return true;
  });
  publish({kind:'ready',version:'8.0.0'});
})();
