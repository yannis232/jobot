'use strict';
let deliveryRecords={},deliveryPayloads={};
const deliveryInitialized=chrome.storage.session.get('jobbotDeliveries').then(r=>{deliveryRecords=r.jobbotDeliveries||{};});
const persistDeliveries=()=>chrome.storage.session.set({jobbotDeliveries:deliveryRecords});
async function resetDeliveryAccount(){await deliveryInitialized;deliveryRecords={};deliveryPayloads={};await persistDeliveries();}
function deliveryHost(record,url){
  try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(record.kind==='application'?u.hostname===new URL(record.url).hostname:(record.provider==='linkedin'?['www.linkedin.com','fr.linkedin.com'].includes(u.hostname):record.provider==='yahoo'?u.hostname==='mail.yahoo.com':u.hostname==='mail.google.com'));}catch{return false;}
}
async function deliveryOwner(record,message){
  const answer=await chrome.tabs.sendMessage(record.owner,message);
  if(answer?.error)throw new Error('MoneyScout ne peut pas enregistrer cette étape.');
  return answer;
}
async function fullDelivery(record){
  if(record.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
  if(deliveryPayloads[record.id])return deliveryPayloads[record.id];
  const answer=await deliveryOwner(record,{kind:'DELIVERY_FETCH',id:record.id});
  if(record.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
  if(answer?.task?.id!==record.id||answer.task.nonce!==record.nonce)throw new Error('Préparation non reconnue.');
  deliveryPayloads[record.id]=answer.task;return answer.task;
}
async function deliveryReport(record,status,message,verified=false){
  if(record.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
  await deliveryOwner(record,{kind:'DELIVERY_UPDATE',payload:{id:record.id,nonce:record.nonce,status,message,verified}});
  record.status=status;await persistDeliveries();
}
async function deliveryHandle(message,sender){
  await deliveryInitialized;
  if(['DELIVERY_PREPARE','DELIVERY_SEND','DELIVERY_FOCUS'].includes(message.kind)){
    if(!isApp(sender))throw new Error('Ouvre MoneyScout dans son onglet local.');
    if(message.kind==='DELIVERY_PREPARE'){
      const t=message.task;
      if(!t||!/^[a-f0-9]{32}$/.test(t.id)||!['email','linkedin','application'].includes(t.kind)||!(t.kind==='application'?HOSTS[t.provider]?.includes(new URL(t.url).hostname):['yahoo','gmail','linkedin'].includes(t.provider))||!deliveryHost(t,t.url)||!t.nonce)throw new Error('Préparation incorrecte.');
      let r=deliveryRecords[t.id];
      if(r){if(r.owner!==sender.tab.id)throw new Error('Cette préparation appartient à un autre onglet MoneyScout.');await chrome.tabs.update(r.tab,{active:true}).catch(()=>{});if(!r.sendRequested)await chrome.tabs.sendMessage(r.tab,{kind:'DELIVERY_RETRY'}).catch(()=>{});return {ok:true};}
      r={id:t.id,nonce:t.nonce,kind:t.kind,provider:t.provider,url:t.url,owner:sender.tab.id,accountScope:activeAccount,created:Date.now(),status:'preparing',sendRequested:false,tab:null};
      deliveryPayloads[t.id]=t;deliveryRecords[t.id]=r;await persistDeliveries();
      try{
        const tab=await chrome.tabs.create({url:t.url,active:false});r.tab=tab.id;await persistDeliveries();
        if(r.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
        await deliveryReport(r,'preparing','Préparation du message et des pièces jointes dans le compte connecté…');
        await chrome.alarms.create('jobbot-delivery',{periodInMinutes:.5});return {ok:true};
      }catch(error){delete deliveryRecords[t.id];await persistDeliveries();throw error;}
    }
    const r=deliveryRecords[message.id];
    if(!r||r.owner!==sender.tab.id)return {not_clicked:true,message:'Cet onglet de préparation n’est plus disponible. Aucun clic d’envoi n’a été effectué.'};
    if(message.kind==='DELIVERY_FOCUS'){const tab=await chrome.tabs.update(r.tab,{active:true});await chrome.windows.update(tab.windowId,{focused:true});return {ok:true};}
    if(r.nonce!==message.nonce||r.sendRequested)return {not_clicked:!r.sendRequested,message:'Envoi non déclenché : vérifie la préparation et son état.'};
    const authorization=await deliveryOwner(r,{kind:'DELIVERY_CHECK',id:r.id}).catch(()=>null);
    if(r.accountScope!==activeAccount)return {not_clicked:true,message:'Le compte MoneyScout a changé. Aucun envoi effectué.'};
    if(authorization?.status!=='sending')return {not_clicked:true,message:'La confirmation d’envoi n’a pas été enregistrée par MoneyScout. Aucun clic effectué.'};
    const tab=await chrome.tabs.get(r.tab).catch(()=>null);
    if(!tab||!deliveryHost(r,tab.url))return {not_clicked:true,message:'Le site de messagerie a changé ou a été fermé. Aucun envoi effectué.'};
    // Cet état est persisté AVANT de transmettre le clic. Un redémarrage du
    // module ne doit jamais provoquer un deuxième clic d’envoi.
    r.sendRequested=true;r.requestedAt=Date.now();r.status='sending';await persistDeliveries();
    if(r.accountScope!==activeAccount)return {not_clicked:true,message:'Le compte MoneyScout a changé. Aucun envoi effectué.'};
    try{await chrome.tabs.sendMessage(r.tab,{kind:'DELIVERY_COMMIT',id:r.id,nonce:r.nonce});return {ok:true};}
    catch{return {uncertain:true,message:'Le résultat n’est pas confirmé. Vérifie le site avant de recommencer.'};}
  }
  const r=Object.values(deliveryRecords).find(item=>item.tab===sender.tab?.id);
  if(!r||r.accountScope!==activeAccount||!deliveryHost(r,sender.url))return {ignored:true};
  if(message.kind==='DELIVERY_READY'){
    if(r.sendRequested)return r.kind==='application'&&r.status==='sending'?{task:await fullDelivery(r),awaiting:true}:{ignored:true};
    return {task:await fullDelivery(r)};
  }
  if(message.kind==='DELIVERY_REPORT'){
    if(message.id!==r.id||message.nonce!==r.nonce)return {ignored:true};
    if(['sent','uncertain','not_clicked'].includes(message.status)&&!r.sendRequested)return {ignored:true};
    await deliveryReport(r,message.status,String(message.message||'').slice(0,700),message.verified===true);
    if(message.status==='not_clicked'){r.sendRequested=false;r.status='ready';await persistDeliveries();}
    if(message.status==='sent')delete deliveryPayloads[r.id];
    return {ok:true};
  }
  return {ignored:true};
}
chrome.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name!=='jobbot-delivery')return;await deliveryInitialized;
  for(const r of Object.values(deliveryRecords)){
    if(r.status==='sending'&&Date.now()-r.requestedAt>90000)await deliveryReport(r,'uncertain','Le site n’a pas confirmé l’envoi. Vérifie les messages envoyés ; MoneyScout ne renverra pas ce message.').catch(()=>{});
    else if(['queued','preparing'].includes(r.status)&&Date.now()-r.created>60000)await deliveryReport(r,'needs_user','Ouvre l’onglet de préparation : connecte-toi si nécessaire. Aucun envoi n’a été effectué.').catch(()=>{});
  }
});
