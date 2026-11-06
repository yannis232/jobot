'use strict';
importScripts('cloud-origin.js','outbox.js');
const VERSION='8.0.0';
const HOSTS={indeed:['fr.indeed.com'],francetravail:['candidat.francetravail.fr'],hellowork:['www.hellowork.com','hellowork.com'],linkedin:['www.linkedin.com','fr.linkedin.com'],meteojob:['www.meteojob.com','meteojob.com'],adecco:['www.adecco.com'],manpower:['www.manpower.fr'],randstad:['www.randstad.fr']};
let task=null;
let activeAccount='';
let research={owner:null,queue:[],active:{},paused:false,blocked_hosts:[]};
const initialized=chrome.storage.session.get(['task','research','jobbotAccount']).then(data=>{task=data.task||null;research=data.research||research;activeAccount=data.jobbotAccount||'';});
const storeTask=()=>chrome.storage.session.set({task});
const storeResearch=()=>chrome.storage.session.set({research});
const LOGIN_URLS={indeed:'https://secure.indeed.com/auth',francetravail:'https://candidat.francetravail.fr/espacepersonnel/',hellowork:'https://www.hellowork.com/fr-fr/',linkedin:'https://www.linkedin.com/login',gmail:'https://mail.google.com/',yahoo:'https://mail.yahoo.com/',meteojob:'https://www.meteojob.com/',adecco:'https://www.adecco.com/fr-fr',manpower:'https://www.manpower.fr/',randstad:'https://www.randstad.fr/'};

async function deliverWork(work,payload){
  if(work.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
  if(!research.owner)throw new Error('La fenêtre MoneyScout est fermée.');
  const response=await chrome.tabs.sendMessage(research.owner,{kind:'ENRICH_UPDATE',payload:{task_id:work.id,...payload}});
  if(work.accountScope!==activeAccount)throw new Error('Le compte MoneyScout a changé.');
  if(response?.error)throw new Error('Le serveur MoneyScout n’a pas enregistré le résultat.');
}
function workURL(work){
  try{
    const u=new URL(work.url);
    if(u.protocol!=='https:'||u.username||u.password||!/^[a-f0-9]{24}$/.test(work.id))return false;
    if(['people','email'].includes(work.kind))return u.hostname==='www.bing.com'&&u.pathname==='/search';
    if(work.kind!=='detail'||!Object.values(HOSTS).flat().includes(u.hostname))return false;
    return /\/jobs\/view\/|\/viewjob$|\/offres\/recherche\/detail\/|\/fr-fr\/emplois\/\d+\.html$|^\/jobs\/\d+$|^\/fr-fr\/offres-emploi\/.+\/[^/]+$|^\/offers\/details\/\d+$|^\/emploi\/[^/]+_[^/]+_[^/]+\/?$/.test(u.pathname);
  }catch{return false;}
}
function workPageMatches(work,current){
  try{
    const a=new URL(work.url),b=new URL(current);
    if(b.protocol!=='https:')return false;
    if(work.kind!=='detail')return b.hostname==='www.bing.com'&&b.pathname==='/search'&&b.searchParams.get('q')===a.searchParams.get('q');
    const group=host=>Object.keys(HOSTS).find(key=>HOSTS[key].includes(host));
    const source=group(a.hostname);if(!source||source!==group(b.hostname))return false;
    if(source==='indeed')return !!a.searchParams.get('jk')&&a.searchParams.get('jk')===b.searchParams.get('jk');
    if(source==='linkedin'){
      const id=url=>url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{5,20})\/?$/)?.[1];
      return !!id(a)&&id(a)===id(b);
    }
    return a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'');
  }catch{return false;}
}
let pumping=false;
async function pumpWork(){
  if(pumping)return;pumping=true;
  try{
    while(Object.keys(research.active).length<2&&research.queue.length){
      const index=research.queue.findIndex(t=>(!research.paused||t.manual)&&(!(research.blocked_hosts||[]).includes(new URL(t.url).hostname)||t.manual));
      if(index<0)break;
      const work=research.queue.splice(index,1)[0];
      const record={...work,tab_id:null,started:Date.now()};
      research.active[work.id]=record;await storeResearch();
      try{
        await deliverWork(work,{status:'running'});
        const tab=await chrome.tabs.create({url:work.url,active:false});
        record.tab_id=tab.id;await storeResearch();
        if(record.kind!=='detail')setTimeout(async()=>{
          if(research.active[record.id]&&!record.reader_ready)await finishWork(record,{status:'needs_user',message:'Opera bloque la lecture des résultats de recherche. Dans Démarrage > Tes sites d’emploi, ouvre les réglages du module MoneyScout et autorise l’accès aux résultats de recherche, puis relance cette fiche.'});
        },9000);
      }catch{delete research.active[work.id];await storeResearch();}
    }
  }finally{pumping=false;}
}
async function finishWork(record,result){
  if(record.accountScope!==activeAccount)return;
  const host=new URL(record.url).hostname;
  research.blocked_hosts=research.blocked_hosts||[];
  if(result.status==='needs_user'&&!research.blocked_hosts.includes(host))research.blocked_hosts.push(host);
  if(result.status==='done')research.blocked_hosts=research.blocked_hosts.filter(h=>h!==host);
  try{await deliverWork(record,result);}catch{}
  delete research.active[record.id];await storeResearch();
  const tab=record.tab_id?await chrome.tabs.get(record.tab_id).catch(()=>null):null;
  // Seuls les onglets auxiliaires restés en arrière-plan à l'adresse demandée
  // sont fermés. Une page que l'utilisateur consulte ou modifie reste ouverte.
  const keepForUser=result.status==='needs_user'&&!String(result.message||'').startsWith('Opera bloque');
  if(tab&&!keepForUser&&!tab.active&&tab.url===record.url)await chrome.tabs.remove(tab.id).catch(()=>{});
  await pumpWork();
}
const isApp=sender=>{try{const u=new URL(sender.url);return !!globalThis.JOBBOT_CLOUD_ORIGIN&&u.origin===globalThis.JOBBOT_CLOUD_ORIGIN&&u.pathname==='/';}catch{return false;}};
function siteURL(source,url){
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||!HOSTS[source]?.includes(u.hostname))return false;
    if(source==='manpower')return u.pathname.startsWith('/offre-emploi/');
    if(source==='randstad')return u.pathname.startsWith('/emploi/');
    return ({meteojob:'/jobs',adecco:'/fr-fr/offres-emploi',indeed:'/jobs',francetravail:'/offres/recherche',hellowork:'/fr-fr/emploi/recherche.html',linkedin:'/jobs/search/'})[source]===u.pathname;
  }catch{return false;}
}
async function deliver(record,data){
  if(!task||task.accountScope!==activeAccount||record.accountScope!==activeAccount||record.search_id!==task.search_id)return;
  const update={search_id:task.search_id,source_id:record.source,...data};
  record.status=data.status;
  await storeTask();
  // Les informations passent par la page locale ; aucune clé Yahoo, aucun
  // cookie et aucun jeton de session d'un site ne sont transmis.
  await chrome.tabs.sendMessage(task.owner,{kind:'BOARD_UPDATE',payload:update}).catch(()=>{});
}
async function start(message,sender){
  if(!/^[a-f0-9]{32}$/.test(message.search_id)||!Array.isArray(message.sites)||message.sites.length>8)throw new Error('Recherche incorrecte.');
  const seen=new Set();
  for(const site of message.sites){
    if(seen.has(site.id)||!siteURL(site.id,site.url))throw new Error('Site de recherche incorrect.');
    seen.add(site.id);
  }
  const next={owner:sender.tab.id,accountScope:activeAccount,search_id:message.search_id,started_at:Date.now(),tabs:{}};
  task=next;
  await storeTask();
  // Les huit navigations démarrent ensemble, sans attendre les résultats
  // d'un premier site avant d'ouvrir les autres.
  await Promise.all(message.sites.map(async site=>{
    const record={source:site.id,url:site.url,status:'opening',tab_id:null,accountScope:next.accountScope,search_id:next.search_id};
    try{
      const tab=await chrome.tabs.create({url:site.url,active:false});
      record.tab_id=tab.id;
      next.tabs[tab.id]=record;
      if(task!==next)return;
      await storeTask();
    }catch{
      if(task!==next)return;
      await deliver(record,{status:'unavailable',message:'L’onglet n’a pas pu être ouvert. Reprends ce site.',offers:[]});
    }
  }));
  if(task===next){await storeTask();await chrome.alarms.create('jobbot-timeout',{delayInMinutes:1});}
  return {ok:true,version:VERSION};
}
async function handle(message,sender){
  await initialized;
  if(isApp(sender)){
    if(!/^[a-f0-9]{64}$/.test(message.accountScope||''))throw new Error('Recharge ton MoneyScout et mets à jour son module de navigateur.');
    if(message.kind==='HELLO'&&activeAccount!==message.accountScope){
      task=null;research={owner:null,queue:[],active:{},paused:false,blocked_hosts:[]};
      await resetDeliveryAccount();activeAccount=message.accountScope;
      await chrome.storage.session.set({task,research,jobbotAccount:activeAccount});
    }
    if(activeAccount!==message.accountScope)throw new Error('Le compte MoneyScout a changé. Recharge la page avant de continuer.');
    if(message.kind==='ACCOUNT_LOGOUT'){
      task=null;research={owner:null,queue:[],active:{},paused:true,blocked_hosts:[]};
      await resetDeliveryAccount();activeAccount='';
      await chrome.storage.session.set({task,research,jobbotAccount:''});return {ok:true};
    }
  }
  if(String(message.kind||'').startsWith('DELIVERY_'))return deliveryHandle(message,sender);
  if(['HELLO','START','FOCUS','RESUME','ENRICH','CONNECT_SITE','PAUSE_ENRICH','ACCOUNT_LOGOUT'].includes(message.kind)){
    if(!isApp(sender))throw new Error('Ouvre MoneyScout dans sa fenêtre locale.');
    if(message.kind==='HELLO'){
      research.paused=message.pause_enrichment===true;
      research.owner=sender.tab.id;await storeResearch();
      if(task&&message.search_id===task.search_id){task.owner=sender.tab.id;await storeTask();}
      return {ok:true,version:VERSION,account_scope:activeAccount,search_id:task?.search_id||''};
    }
    if(message.kind==='PAUSE_ENRICH'){
      research.paused=message.paused===true;await storeResearch();if(!research.paused)pumpWork();return {ok:true};
    }
    if(message.kind==='CONNECT_SITE'){
      const url=message.site==='extension'?'opera://extensions/?id='+chrome.runtime.id:LOGIN_URLS[message.site];if(!url)throw new Error('Choisis un des sites proposés.');
      await chrome.tabs.create({url,active:true});return {ok:true};
    }
    if(message.kind==='ENRICH'){
      if(!Array.isArray(message.tasks)||message.tasks.length>16)throw new Error('Recherche incorrecte.');
      research.owner=sender.tab.id;
      const known=new Set([...research.queue.map(t=>t.id),...Object.keys(research.active)]);
      for(const work of message.tasks){
        if(!workURL(work))throw new Error('Source de recherche incorrecte.');
        if(!known.has(work.id)){research.queue.push({...work,accountScope:activeAccount,manual:message.manual===true});known.add(work.id);}
        else for(const queued of research.queue)if(queued.id===work.id){queued.priority=Math.min(queued.priority??5,work.priority??5);if(message.manual)queued.manual=true;}
      }
      research.queue.sort((a,b)=>(a.priority??5)-(b.priority??5));
      await storeResearch();await chrome.alarms.create('jobbot-research',{periodInMinutes:0.5});
      pumpWork();return {ok:true};
    }
    if(message.kind==='START')return start(message,sender);
    if(!task||message.search_id!==task.search_id||sender.tab.id!==task.owner)throw new Error('Relance la recherche dans cette fenêtre.');
    const record=Object.values(task.tabs).find(r=>r.source===message.source_id);
    if(!record)throw new Error('Relance la recherche pour rouvrir ce site.');
    let tab=await chrome.tabs.get(record.tab_id).catch(()=>null);
    if(!tab){
      tab=await chrome.tabs.create({url:record.url,active:true});
      delete task.tabs[record.tab_id];record.tab_id=tab.id;task.tabs[tab.id]=record;await storeTask();
    }else{
      await chrome.tabs.update(tab.id,{active:true});
      await chrome.windows.update(tab.windowId,{focused:true});
      if(message.kind==='RESUME'){
        const alive=await chrome.tabs.sendMessage(tab.id,{kind:'RESUME'}).catch(()=>null);
        if(!alive)await chrome.tabs.update(tab.id,{url:record.url});
      }
    }
    return {ok:true};
  }
  const working=Object.values(research.active).find(r=>r.tab_id===sender.tab?.id);
  if(message.kind==='WORK_READY'){
    if(working){working.reader_ready=true;await storeResearch();return {work:working};}
    return {ignored:true};
  }
  if(message.kind==='WORK_RESULT'&&working&&working.id===message.task_id){
    if(message.status==='done'&&!workPageMatches(working,sender.url)){
      await finishWork(working,{status:'unavailable',message:'L’onglet a changé d’annonce ou de recherche. Ses coordonnées n’ont pas été attribuées à cette offre.'});
      return {ok:true};
    }
    // Le contenu de la page est une donnée : seules les propriétés attendues
    // sont transférées, jamais un ordre ou un appel fourni par le site.
    await finishWork(working,{status:message.status,message:String(message.message||'').slice(0,400),description:String(message.description||'').slice(0,40000),full:message.full===true,people:Array.isArray(message.people)?message.people.slice(0,5):[],results:Array.isArray(message.results)?message.results.slice(0,8):[]});
    return {ok:true};
  }
  const record=task?.tabs?.[sender.tab?.id];
  if(!record)return {ignored:true};
  try{if(!HOSTS[record.source].includes(new URL(sender.url).hostname))return {ignored:true};}catch{return {ignored:true};}
  if(message.kind==='COLLECTOR_READY')return {source:record.source,search_id:task.search_id,target_url:record.url};
  if(message.kind==='COLLECT'&&message.search_id===task.search_id){
    await deliver(record,{status:message.status,offers:Array.isArray(message.offers)?message.offers.slice(0,30):[],message:String(message.message||'').slice(0,400),partial:!!message.partial});
    return {ok:true};
  }
  return {ignored:true};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  handle(message||{},sender).then(respond).catch(error=>respond({error:error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name==='jobbot-research'){
    await initialized;
    for(const record of Object.values(research.active))if(Date.now()-record.started>90000)await finishWork(record,{status:'unavailable',message:'La lecture n’a pas abouti. Tu peux relancer cette recherche depuis la fiche.'});
    await pumpWork();return;
  }
  if(alarm.name!=='jobbot-timeout')return;
  await initialized;
  if(!task)return;
  for(const record of Object.values(task.tabs)){
    if(['opening','reading'].includes(record.status))await deliver(record,{status:'unavailable',offers:[],partial:true,message:'Le site ne répond pas encore. Ouvre son onglet puis clique sur Reprendre ce site.'});
  }
});
chrome.tabs.onRemoved.addListener(async id=>{
  await initialized;
  const record=task?.tabs?.[id];
  if(record&&['opening','reading'].includes(record.status))await deliver(record,{status:'unavailable',offers:[],partial:true,message:'L’onglet a été fermé avant la fin de la lecture.'});
});
