import {SOURCES,norm,terms,compare,rankCV,now,CONTRACTS} from './core.mjs';
import {readCatalogue,readOffer} from './sources.mjs';

export const SEARCH_ENGINE=2;
const RETAIL=new Set(['GroupementMousquetaires','METROMAKRO','AccorHotel','HanaGroup','SIXT','Eurofins','JYSK','HMGroup','KIABI']);
const WEAK=new Set('polyvalent polyvalente junior senior debutant debutante confirme confirmee alternance apprentissage stage cdi cdd interim temps partiel plein'.split(' '));
function stem(word){const aliases={employee:'employe',employees:'employe',employes:'employe',equipiere:'equipier',equipieres:'equipier',vendeuse:'vendeur',vendeuses:'vendeur',preparatrice:'preparateur',preparatrices:'preparateur',caissiere:'caissier',caissieres:'caissier',technicienne:'technicien',developpeuse:'developpeur',electricienne:'electricien'};return aliases[word]||word.replace(/s$/,'');}
const words=text=>terms(text).map(stem);
export const retailQuery=query=>/(?:employe|equipier).*(?:polyvalen|commerc|magasin|libre.service)|(?:employe polyvalent|polyvalent magasin)/.test(norm(query));
export function queryRelevance(offer,query){
  const requested=words(query).filter(w=>!WEAK.has(w));if(!requested.length)return 60;
  const title=norm(offer.title),titleWords=new Set(words(offer.title));
  if(retailQuery(query)){
    if(/\b(manager|responsable|directeur|directrice|ingenieur|ingenieure|chef|cheffe|lead|senior)\b/.test(title))return 0;
    if(/employe.*polyvalen|equipier.*polyvalen/.test(title))return 100;
    if(/employe|equipier|vendeur|vendeuse|caissier|caissiere|hote.*caisse|hotesse.*caisse|preparat.*(?:drive|command)|manutentionnaire|magasinier|plongeur|agent.*(?:polyvalen|entretien)|commis|serveur|serveuse/.test(title))return 78;
    return 0;
  }
  const hits=requested.filter(w=>titleWords.has(w));
  if(hits.length===requested.length)return 100;
  if(hits.length/requested.length>=0.5)return 60+Math.round(25*hits.length/requested.length);
  if(offer.descriptionKind==='full'){
    const body=new Set(words(offer.description||''));
    if(requested.every(w=>body.has(w)))return 40;
  }
  return 0;
}
const comparisonCache=new WeakMap();
function cachedComparison(offer,cvs){let cache=comparisonCache.get(offer);if(!cache){cache=new WeakMap();comparisonCache.set(offer,cache);}return cvs.map(cv=>{let hit=cache.get(cv);if(!hit||hit.text!==cv.text||hit.title!==offer.title||hit.description!==offer.description||hit.kind!==offer.descriptionKind){hit={text:cv.text,title:offer.title,description:offer.description,kind:offer.descriptionKind,result:rankCV(offer,cv)};cache.set(cv,hit);}return {...hit.result,label:cv.label||cv.name};}).sort((a,b)=>(b.score??-1)-(a.score??-1));}
export function rankedOffers(items,query,cvs=[],{order='match',filter='',cvId=''}={}){
  const text=norm(filter),selected=cvId?cvs.filter(cv=>cv.id===cvId):cvs;
  return items.map(o=>({offer:o,relevance:queryRelevance(o,query)})).filter(({offer:o,relevance})=>relevance>0&&(!text||norm(o.title+' '+o.company+' '+o.location+' '+o.description).includes(text))).map(({offer:o,relevance})=>({...o,relevance,comparison:cachedComparison(o,selected)})).sort((a,b)=>order==='date'?String(b.posted).localeCompare(String(a.posted)):(b.comparison[0]?.score??-1)-(a.comparison[0]?.score??-1)||b.relevance-a.relevance||String(b.posted).localeCompare(String(a.posted)));
}
export function queryVariants(query){return retailQuery(query)?[...new Set([query.trim(),'équipier','vendeur'])]:[query.trim()];}

const locationCache=new Map();
async function geoJSON(path,signal){if(signal?.aborted)throw new DOMException('Recherche annulée.','AbortError');const own=new AbortController(),abort=()=>own.abort(),timer=setTimeout(abort,8000);signal?.addEventListener('abort',abort,{once:true});try{const r=await fetch('https://geo.api.gouv.fr/'+path,{signal:own.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw new Error('Commune indisponible.');const raw=await r.text();if(raw.length>2_000_000)throw new Error('Réponse géographique trop longue.');return JSON.parse(raw);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
const km=(a,b)=>{const rad=n=>n*Math.PI/180,dy=rad(b.latitude-a.latitude),dx=rad(b.longitude-a.longitude),h=Math.sin(dy/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dx/2)**2;return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));};
export async function searchLocations(city,{nearby=true,signal}={}){
 const text=String(city||'').trim();if(!text)return {primary:'',names:[''],nearby:[],resolved:false};
 const primaryKey=norm(text)+'|false',cacheKey=norm(text)+'|'+nearby;
 if(locationCache.has(cacheKey))return structuredClone(locationCache.get(cacheKey));
 let base=locationCache.get(primaryKey);
 if(!base){try{const postal=/^\d{5}$/.test(text),name=text.replace(/\s+\d{5}$/,'');const params=new URLSearchParams({[postal?'codePostal':'nom']:postal?text:name,fields:'nom,code,codeDepartement,centre,population',boost:'population',limit:'5'});const rows=await geoJSON('communes?'+params,signal),match=rows.find(r=>norm(r.nom)===norm(name))||rows[0];if(!match?.centre?.coordinates)return {primary:text,names:[text],nearby:[],resolved:false};const primary=match.nom.replace(/\s+\d+(?:e|er|eme)\s+arrondissement$/i,'');base={primary,names:[primary],nearby:[],resolved:true,code:match.code,department:match.codeDepartement,centre:{longitude:match.centre.coordinates[0],latitude:match.centre.coordinates[1]}};locationCache.set(primaryKey,base);}catch{if(signal?.aborted)throw new DOMException('Recherche annulée.','AbortError');return {primary:text,names:[text],nearby:[],resolved:false};}}
 if(!nearby||!base.department)return structuredClone(base);
 try{const around=await geoJSON('departements/'+encodeURIComponent(base.department)+'/communes?'+new URLSearchParams({fields:'nom,code,centre,population'}),signal);const neighbours=around.filter(r=>r.code!==base.code&&r.centre?.coordinates&&norm(r.nom)!==norm(base.primary)).map(r=>({...r,distance:km(base.centre,{longitude:r.centre.coordinates[0],latitude:r.centre.coordinates[1]})})).filter(r=>r.distance<=15&&(r.population||0)>=10000).sort((a,b)=>(b.population||0)-(a.population||0)).slice(0,3).map(r=>r.nom);const result={...base,names:[base.primary,...neighbours],nearby:neighbours};locationCache.set(cacheKey,result);return structuredClone(result);}catch{if(signal?.aborted)throw new DOMException('Recherche annulée.','AbortError');return {...base,nearbyUnavailable:true};}
}

export async function discoverOffers(query,city,{kind='all',nearby=true,cvs=[],signal,onProgress=()=>{},locations:providedLocations}={}){
  kind=Object.hasOwn(CONTRACTS,kind)?kind:'all';query=String(query||'').trim();city=String(city||'').trim();
  const started=Date.now(),controller=new AbortController(),abort=()=>controller.abort();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;abort();},35000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const sources=Object.keys(SOURCES).map(id=>({id,label:SOURCES[id],ok:false,pending:true,count:0,read:0,failed:0,total:0,message:'En attente…'}));
  const candidates=new Map(),items=new Map(),seenTasks=new Set();let completed=0,locations={primary:city,names:[city],nearby:[],resolved:false},phase='catalogues';
  const visible=()=>rankedOffers([...items.values()],query,cvs).slice(0,500).map(o=>items.get(o.id));
  function progress(){const current=visible();for(const source of sources){source.count=current.filter(o=>o.source===source.id).length;source.message=source.pending?'Lecture en cours…':source.ok?source.count+' annonce(s) pour le métier'+(source.failed?' · accès partiel':''):source.failed?'Lecture indisponible, résultat inconnu.':'Non consulté : recherche interrompue.';}onProgress({engine:SEARCH_ENGINE,items:current,sources:sources.map(s=>({...s})),query,city,kind,locations:locations.names,phase,completed,planned:tasks.length,checkedAt:'',hasMore:false});}
  const tasks=[];
  function addTask(source,phrase,place,offset=0){const key=[source,phrase,place,offset].join('|');if(seenTasks.has(key)||tasks.length>=90)return;seenTasks.add(key);tasks.push({source,phrase,place,offset});}
  try{
    locations=providedLocations||await searchLocations(city,{nearby:false,signal:controller.signal});
    for(const source of Object.keys(SOURCES))addTask(source,query,locations.primary);
    const variants=queryVariants(query).slice(1);
    for(const source of Object.keys(SOURCES))if(RETAIL.has(source)&&retailQuery(query))for(const phrase of variants)addTask(source,phrase,locations.primary);
    const regionalSources=retailQuery(query)?Object.keys(SOURCES).filter(id=>RETAIL.has(id)):Object.keys(SOURCES);
    for(const place of locations.nearby)for(const source of regionalSources)addTask(source,query,place);
    let planningDone=true,regionPromise=Promise.resolve();
    if(!providedLocations&&nearby&&city&&locations.resolved){planningDone=false;regionPromise=searchLocations(city,{nearby:true,signal:controller.signal}).then(region=>{locations=region;for(const place of region.nearby)for(const source of regionalSources)addTask(source,query,place);progress();}).catch(()=>{locations.nearbyUnavailable=true;}).finally(()=>{planningDone=true;});}
    let cursor=0;progress();
    await Promise.all(Array.from({length:4},async()=>{while(!controller.signal.aborted){if(cursor>=tasks.length){if(planningDone)break;await regionPromise;continue;}const task=tasks[cursor++],source=sources.find(s=>s.id===task.source);try{const page=await readCatalogue(task.source,task.phrase,task.place,{kind,signal:controller.signal,limit:30,offset:task.offset});source.ok=true;source.read++;source.total+=page.total;for(const offer of page.items){if(candidates.size>=750)break;candidates.set(offer.id,offer);if(queryRelevance(offer,query)>0&&items.size<500)items.set(offer.id,offer);}if(!task.offset&&page.total>page.scanned&&page.scanned===30&&tasks.length<90)addTask(task.source,task.phrase,task.place,30);}catch{if(!controller.signal.aborted)source.failed++;}completed++;source.pending=tasks.slice(cursor).some(t=>t.source===source.id);progress();}}));
    await regionPromise;
    // Descriptions of the most promising titles first; all reads remain bounded.
    phase='descriptions';const queue=[...candidates.values()].map(o=>({offer:o,relevance:queryRelevance(o,query),score:Math.max(-1,...cachedComparison(o,cvs).map(c=>c.score??-1))})).sort((a,b)=>b.relevance-a.relevance||b.score-a.score).slice(0,60).map(r=>r.offer);cursor=0;progress();
    await Promise.all(Array.from({length:4},async()=>{while(cursor<queue.length&&!controller.signal.aborted){const original=queue[cursor++];try{const offer=await readOffer(original,controller.signal);if(queryRelevance(offer,query)>0&&items.size<500)items.set(offer.id,offer);else items.delete(original.id);}catch(error){if(error.code==='CLOSED')items.delete(original.id);}progress();}}));
    for(const source of sources)source.pending=false;
    phase='termine';progress();const result=visible();
    return {engine:SEARCH_ENGINE,items:result,sources,query,city,kind,nearby,locations:locations.names,variants:queryVariants(query),hasMore:false,scopeWarning:!!(nearby&&city&&(!locations.resolved||locations.nearbyUnavailable)),partial:timedOut||signal?.aborted||tasks.length>=90||result.length>=500,interrupted:!!signal?.aborted,timedOut,checkedAt:now(),elapsedMs:Date.now()-started};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
