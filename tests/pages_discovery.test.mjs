import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {SOURCES,cleanHTML} from '../pages/assets/core.mjs';
import {queryRelevance,rankedOffers,queryVariants,discoverOffers,searchLocations} from '../pages/assets/discovery.mjs';

test('employé polyvalent privilégie le poste demandé et écarte les managers sans rapport',()=>{
  const exact={id:'a',title:'INTERMARCHE – EMPLOYE POLYVALENT H/F',posted:'2025-10-09'};
  const shop={id:'b',title:'Équipier commercial H/F',posted:'2026-11-01'};
  const wrong={id:'c',title:'Manager Full Stack',description:'Nos employés sont polyvalents.',descriptionKind:'full',posted:'2026-11-06'};
  assert.equal(queryRelevance(wrong,'employé polyvalent'),0);
  assert.equal(queryRelevance({title:'Responsable technique Biodiversité'},'employé polyvalent'),0);
  assert(queryRelevance(exact,'employé polyvalent')>queryRelevance(shop,'employé polyvalent'));
  assert.deepEqual(rankedOffers([wrong,shop,exact],'employé polyvalent').map(o=>o.id),['a','b']);
  assert.deepEqual(queryVariants('employé polyvalent'),['employé polyvalent','équipier','vendeur']);
});

test('la recherche garde les métiers libres, les variantes féminines et les compétences demandées',()=>{
  assert(queryRelevance({title:'Électricienne bâtiment'},'électricien')>0);
  assert(queryRelevance({title:'Développeuse JavaScript'},'développeur JavaScript')>0);
  assert(queryRelevance({title:'Ingénieur web',description:'Développement React.',descriptionKind:'full'},'React')>0);
  assert.equal(queryRelevance({title:'Ingénieur web',description:'Notre comptable gère la facturation.',descriptionKind:'excerpt'},'comptable'),0);
  assert.deepEqual(queryVariants('infirmier de nuit'),['infirmier de nuit']);
});

test('la comparaison se recalcule si un CV change, et un CV ne ramène pas une offre hors métier',()=>{
  const offer={id:'a',title:'Technicien Windows',description:'Support et diagnostic Windows.',descriptionKind:'full'};
  const cv={id:'cv',text:'Accueil et service en restauration, préparation des tables et encaissement. Expérience en salle.'};
  const before=rankedOffers([offer],'Windows',[cv])[0].comparison[0].score;
  cv.text='Technicien Windows. Support et diagnostic Windows, assistance utilisateurs, installation de postes et suivi des incidents.';
  assert(rankedOffers([offer],'Windows',[cv])[0].comparison[0].score>before);
  assert.equal(rankedOffers([{...offer,title:'Manager Full Stack'}],'employé polyvalent',[cv]).length,0);
});

test('les entités HTML numériques deviennent du texte lisible sans exécuter de balise',()=>{
  assert.equal(cleanHTML('Rayon&#xa0;frais &#233;t&#233;'),'Rayon frais été');
  assert.equal(cleanHTML('<script>danger()</script>Bonjour'),'Bonjour');
});

test('la collecte interroge automatiquement tous les catalogues et les intitulés proches',async()=>{
  const original=globalThis.fetch,queries=[];
  globalThis.fetch=async url=>{const u=new URL(url);if(/\/postings\//.test(u.pathname)){const id=u.pathname.split('/').at(-1);return Response.json({id,name:id==='100001'?'Employé polyvalent':'Vendeur polyvalent',location:{city:'Lyon',country:'fr'},jobAd:{sections:{jobDescription:{text:'Accueil des clients, mise en rayon et encaissement. '.repeat(4)}}}});}queries.push({source:u.pathname.split('/')[3],q:u.searchParams.get('q'),city:u.searchParams.get('city')});return Response.json({totalFound:3,content:[{id:'100001',name:'Employé polyvalent',location:{country:'fr',city:'Lyon'}},{id:'100002',name:'Manager Full Stack',location:{country:'fr',city:'Lyon'}},{id:'100003',name:'Vendeur polyvalent',location:{country:'fr',city:'Lyon'}}]});};
  try{
    const feed=await discoverOffers('employé polyvalent','Lyon',{locations:{primary:'Lyon',names:['Lyon','Villeurbanne'],nearby:['Villeurbanne']}});
    assert.equal(feed.sources.filter(s=>s.ok).length,Object.keys(SOURCES).length);
    assert(queries.some(q=>q.q==='équipier'));
    assert(queries.some(q=>q.q==='vendeur'));
    assert(queries.some(q=>q.city==='Villeurbanne'));
    assert(feed.items.length>0);
    assert(feed.items.every(o=>!o.title.includes('Manager')));
    assert.equal(new Set(feed.items.map(o=>o.id)).size,feed.items.length);
    assert.equal(feed.hasMore,false);
    assert.deepEqual(feed.locations,['Lyon','Villeurbanne']);
  }finally{globalThis.fetch=original;}
});

test('un refus réseau est présenté comme indisponible, jamais comme un catalogue vide consulté',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new TypeError('Network error');};
  try{const feed=await discoverOffers('comptable','Lyon',{locations:{primary:'Lyon',names:['Lyon'],nearby:[]}});assert.equal(feed.items.length,0);assert(feed.sources.every(s=>!s.ok&&s.failed>0));assert(feed.sources.every(s=>s.message.includes('inconnu')));}finally{globalThis.fetch=original;}
});

test('une annonce clôturée entre la recherche et sa lecture est retirée des résultats',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{const u=new URL(url);return /\/postings\//.test(u.pathname)?Response.json({active:false}):Response.json({totalFound:1,content:[{id:'123456',name:'Employé polyvalent',location:{country:'fr',city:'Lyon'}}]});};
  try{const feed=await discoverOffers('employé polyvalent','Lyon',{locations:{primary:'Lyon',names:['Lyon'],nearby:[]}});assert.equal(feed.items.length,0);assert(feed.sources.every(s=>s.ok));}finally{globalThis.fetch=original;}
});

test('l’arrêt avant la recherche ne lance aucun accès aux catalogues',async()=>{
  const original=globalThis.fetch,controller=new AbortController();let calls=0;controller.abort();
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network');};
  try{const feed=await discoverOffers('comptable','Lyon',{signal:controller.signal,locations:{primary:'Lyon',names:['Lyon'],nearby:[]}});assert.equal(calls,0);assert(feed.interrupted);assert(feed.partial);}finally{globalThis.fetch=original;}
});

test('un code postal est converti en commune et les communes proches restent bornées',async()=>{
  const original=globalThis.fetch;let first='';
  globalThis.fetch=async url=>{const u=new URL(url);if(!first)first=u.href;return Response.json(u.searchParams.has('codePostal')?[{nom:'Lyon',code:'69123',codeDepartement:'69',centre:{coordinates:[4.84,45.76]}}]:[{nom:'Lyon',code:'69123',centre:{coordinates:[4.84,45.76]},population:500000},{nom:'Villeurbanne',code:'69266',centre:{coordinates:[4.88,45.76]},population:160000},{nom:'Paris',code:'75056',centre:{coordinates:[2.35,48.85]},population:2100000}]);};
  try{const result=await searchLocations('69007');assert(new URL(first).searchParams.has('codePostal'));assert.equal(result.primary,'Lyon');assert.deepEqual(result.nearby,['Villeurbanne']);}finally{globalThis.fetch=original;}
});

test('la publication utilise des imports cohérents même si une ancienne version est en cache',()=>{
  const python=process.env.MONEYSCOUT_TEST_PYTHON||'python3';
  execFileSync(python,['scripts/build_pages.py'],{cwd:fileURLToPath(new URL('../',import.meta.url))});
  const root=new URL('../.pages-dist/',import.meta.url),release=JSON.parse(readFileSync(new URL('release.json',root),'utf8'));
  const html=readFileSync(new URL('index.html',root),'utf8');
  assert(html.includes('app.mjs?v='+release.version));
  const app=readFileSync(new URL('assets/app.mjs',root),'utf8');
  assert(app.includes("from './discovery.mjs?v="+release.version+"'"));
  for(const match of app.matchAll(/from '(\.\/[^']+)'/g)){const ref=new URL(match[1],new URL('assets/app.mjs',root));assert.equal(ref.searchParams.get('v'),release.version);ref.search='';assert(existsSync(fileURLToPath(ref)));}
  const sourceHTML=readFileSync(new URL('../pages/index.html',import.meta.url),'utf8');
  const offers=sourceHTML.slice(sourceHTML.indexOf('<section id="view-offers"'),sourceHTML.indexOf('<section id="view-cvs"'));
  assert(!offers.includes('board-links'));
  assert(!offers.includes('Élargir la recherche'));
  assert(offers.indexOf('offer-list')<offers.indexOf('source-summary'));
});
