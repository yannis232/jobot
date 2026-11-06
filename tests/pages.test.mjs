import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SOURCES,contractKind,searchPhrase,newData,rankCV,compare,adaptCV,draftLetter,makeZIP,makeEML,validEmail,safeURL,composeURL,boardLinks,toBase64,crc32,due,nextDate} from '../pages/assets/core.mjs';
import {createRecord,unlock,seal,validateEnvelope,createSaveQueue,prepareBackup} from '../pages/assets/vault.mjs';
import {readOffer,searchPublic,alternanceWidgetURL} from '../pages/assets/sources.mjs';

const cv={id:'cv-one',name:'CV.pdf',label:'Informatique',text:'Alex Exemple\nTechnicien support informatique. Assistance utilisateurs Windows. Active Directory (notions). Installation de postes et diagnostic informatique. Travail en équipe. Baccalauréat obtenu.'};
const offer={title:'Technicien support informatique Windows',company:'Exemple',description:'Assistance utilisateurs Windows, installation et maintenance. Active Directory. Python expert requis.',descriptionKind:'full'};

test('la recherche lit les descriptions publiques sans confondre une panne avec zéro résultat',async()=>{
  const original=globalThis.fetch;let details=0;
  globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.includes('EVERIENCE'))return new Response('{}',{status:503});if(/\/postings\//.test(u.pathname)){details++;return Response.json({id:'123456',name:'Technicien Windows',location:{country:'fr',city:'Lyon'},jobAd:{sections:{jobDescription:{text:'Assistance utilisateurs Windows et résolution des incidents. '.repeat(4)}}}});}return Response.json({content:[{id:'123456',name:'Technicien Windows',location:{country:'fr',city:'Lyon'}}],totalFound:1});};
  try{const result=await searchPublic('Windows','Lyon');assert.equal(result.items.length,Object.keys(SOURCES).length-1);assert.equal(details,Object.keys(SOURCES).length-1);assert(result.items.every(o=>o.descriptionKind==='full'&&o.description.includes('Windows')));assert.equal(result.sources.find(s=>s.id==='EVERIENCE').ok,false);assert(result.sources.find(s=>s.id==='EVERIENCE').message.includes('ne signifie pas'));}finally{globalThis.fetch=original;}
});

test('les mots établis classent le bon CV, sans score pour un document illisible',()=>{
  const other={id:'cv-two',label:'Restauration',text:'Service en salle. Accueil des clients, prise de commandes, préparation de la salle et service à table. Formation en restauration.'};
  assert.equal(compare(offer,[other,cv])[0].cvId,cv.id);
  assert.equal(rankCV(offer,{id:'scan',text:''}).score,null);
  assert.equal(rankCV({...offer,descriptionKind:'excerpt'},cv).provisional,true);
});

test('les contrats distinguent un stage, une alternance et les horaires à temps plein',()=>{
  assert.equal(contractKind('Alternance – BTS métiers de l’eau','Full-time'),'alternance');
  assert.equal(contractKind('Stage consultant','Intern'),'stage');
  assert.equal(contractKind('Assistant administratif','Apprenticeship'),'alternance');
  assert.equal(contractKind('Assistant administratif','Full-time'),'');
  assert.equal(contractKind('Technicien intérim'),'interim');
  assert.equal(contractKind('Ingénieur commercial (avec un 1er stage ou alternance)','Permanent'),'cdi');
  assert.equal(contractKind('Ingénieur commercial (avec un 1er stage ou alternance)','Full-time'),'');
  assert.equal(searchPhrase('comptable','alternance'),'comptable alternance');
  assert.equal(searchPhrase('électricien','all'),'électricien');
  const u=new URL(alternanceWidgetURL({latitude:45.76,longitude:4.84}));
  assert.equal(u.hostname,'labonnealternance.apprentissage.beta.gouv.fr');
  assert.equal(u.searchParams.get('lat'),'45.76');
  assert(!u.searchParams.has('cv'));
});

test('les mots propres aux métiers manuels sont repris avec une preuve, sans compétence niée ou souhaitée',()=>{
  const source={id:'electricien',text:'Électricien bâtiment.\nInstallation et câblage des tableaux électriques.\nNotions de domotique.\nSans expérience en Python.\nJe souhaite apprendre la soudure.'};
  const job={title:'Électricien bâtiment',description:'Câblage des tableaux électriques, domotique. Python et soudure.',descriptionKind:'full'};
  const result=adaptCV(job,{},source);
  assert(result.proof.some(p=>p.word==='Câblage'));
  assert(result.proof.some(p=>p.word==='domotique'&&p.level==='notions'));
  assert(!result.proof.some(p=>p.word.toLowerCase()==='python'||p.word==='soudure'));
  assert(!rankCV(job,source).hits.includes('python'));
  assert(result.text.includes(source.text));
});

test('les pages suivantes ajoutent des annonces distinctes et respectent le plafond de 500',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{const u=new URL(url),id=u.pathname.split('/').at(-1);if(/\/postings\//.test(u.pathname))return Response.json({id,name:'Assistant comptable',location:{country:'fr'},jobAd:{sections:{jobDescription:{text:'Tenue de comptabilité et facturation. '.repeat(5)}}}});const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit'));return Response.json({totalFound:1000,content:Array.from({length:limit},(_,i)=>({id:String(100000+offset+i),name:'Assistant comptable',location:{country:'fr'}}))});};
  try{const first=await searchPublic('comptable','');assert.equal(first.items.length,320);assert(first.hasMore);const next=await searchPublic('comptable','',{previous:first});assert.equal(next.items.length,500);assert.equal(new Set(next.items.map(o=>o.url)).size,500);assert.equal(next.hasMore,false);await assert.rejects(searchPublic('autre','',{previous:first}),/Relance/);}finally{globalThis.fetch=original;}
});

test('une mention alternance dans le corps d’un stage ne passe pas le filtre de contrat',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{const u=new URL(url),id=u.pathname.split('/').at(-1);if(/\/postings\//.test(u.pathname))return Response.json({id,name:'Assistant en apprentissage',location:{country:'fr'},jobAd:{sections:{jobDescription:{text:'Offre en apprentissage, avec missions en comptabilité. '.repeat(4)}}}});assert(u.searchParams.get('q').includes('alternance'));return Response.json({totalFound:2,content:[{id:'100001',name:'Stage comptabilité',location:{country:'fr'},typeOfEmployment:{label:'Intern'}},{id:'100002',name:'Assistant comptabilité',location:{country:'fr'},customField:[{fieldLabel:'Nature of Contract',valueLabel:'Apprenticeship'}]}]});};
  try{const result=await searchPublic('comptabilité','',{kind:'alternance'});assert.equal(result.items.length,Object.keys(SOURCES).length);assert(result.items.every(o=>o.contractKind==='alternance'));}finally{globalThis.fetch=original;}
});

test('adaptation et lettre gardent les faits et le niveau, sans ajouter Python expert',()=>{
  const adapted=adaptCV(offer,{name:'Alex Exemple'},cv);
  assert(adapted.text.includes(cv.text));
  assert(adapted.text.includes('Active Directory — notions'));
  assert(adapted.missing.includes('Python'));
  assert(!adapted.proof.some(p=>p.word==='Python'));
  assert(!adapted.text.includes('Python'));
  const grouped=adaptCV({...offer,description:'Active Directory et Microsoft 365.'},{}, {...cv,text:'CV support informatique.\nNotions Active Directory, réseaux TCP/IP et Microsoft 365.'});
  assert(grouped.text.includes('Microsoft 365 — notions'));
  const letter=draftLetter(offer,{name:'Alex Exemple',mobility:'Mobilité sur Lyon.'},cv);
  assert(letter.includes('Exemple'));
  assert(letter.includes('notions'));
  assert(!letter.includes('expert'));
  assert(!letter.includes('diplômé'));
});

test('le coffre et les CV survivent à un export/rechargement, sans texte privé en clair',async()=>{
  const one=await createRecord('alice','six123');
  one.data.cvs.push({...cv,bytes:toBase64(new TextEncoder().encode('%PDF-FAUX-FICHIER-DE-TEST')),size:30});
  one.data.profile.email='alice@example.test';
  const saved=await seal(one.record,one.data,one.key);
  const json=JSON.stringify(saved);
  assert(!json.includes('alice@example.test'));
  assert(!json.includes('Active Directory'));
  assert(!json.includes('six123'));
  const reopened=await unlock(JSON.parse(json),'six123');
  assert.equal(reopened.data.cvs[0].text,cv.text);
  await assert.rejects(unlock(saved,'mauvais'),/incorrect/);
  await assert.rejects(unlock({...saved,username:'bob'},'six123'),/incorrect/);
  assert.throws(()=>validateEnvelope({...saved,iterations:999999999}),/incorrecte/);
});

test('deux espaces et leurs clés sont distincts, une restauration peut être renommée sans écraser',async()=>{
  const alice=await createRecord('alice','six123'),bob=await createRecord('bob','six123');
  alice.data.profile.name='Alice Exemple';
  const saved=await seal(alice.record,alice.data,alice.key);
  await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(saved.iv),c=>c.charCodeAt(0))},bob.key,Uint8Array.from(atob(saved.ciphertext),c=>c.charCodeAt(0))));
  const opened=await unlock(saved,'six123');
  const restored=await seal({...saved,id:crypto.randomUUID(),username:'alice-2'},opened.data,opened.key);
  assert.equal((await unlock(restored,'six123')).data.profile.name,'Alice Exemple');
  assert.equal((await unlock(bob.record,'six123')).data.profile.name,'');
  assert.equal(saved.username,'alice');
});

test('les sauvegardes concurrentes conservent le dernier état et un échec ne bloque pas la suite',async()=>{
  const one=await createRecord('alice','six123'),writes=[];
  let fail=true;
  const save=createSaveQueue(async r=>{if(fail){fail=false;throw new Error('quota');}writes.push(r);});
  const first=newData('alice');first.profile.name='Ancien';
  const a=save(one.record,first,one.key);
  const second=newData('alice');second.profile.name='Dernier';
  const b=save(one.record,second,one.key);
  await assert.rejects(a,/quota/);await b;
  second.profile.name='Modification après sauvegarde';
  assert.equal((await unlock(writes.at(-1),'six123')).data.profile.name,'Dernier');
});

test('les liens refusent les schémas actifs et les adresses injectées',()=>{
  assert.equal(safeURL('javascript:alert(1)'),'');
  assert.equal(safeURL('https://user:pass@example.test/'),'');
  assert.equal(validEmail('a@example.test\r\nBcc:other@example.test'),false);
  assert.throws(()=>composeURL('yahoo','invalide','objet','texte'));
  assert(composeURL('yahoo','rh@example.test','Candidature','Bonjour').startsWith('https://compose.mail.yahoo.com/'));
  assert.equal(boardLinks('support','Lyon').length,15);
});

test('les relances dépendent des envois déclarés et de la date',()=>{
  assert.equal(due({status:'ready',nextFollowup:'2000-01-01'}),false);
  assert.equal(due({status:'sent',nextFollowup:'2000-01-01'}),true);
  assert.equal(due({status:'reply',nextFollowup:'2000-01-01'}),false);
  assert.equal(nextDate(7,0),'1970-01-08T00:00:00.000Z');
});

test('ZIP et email sont lisibles par les outils standards, avec de vraies pièces jointes',()=>{
  const bytes=new TextEncoder().encode('%PDF-TEST-ÉTÉ');
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const zip=makeZIP([{name:'CV été.pdf',bytes},{name:'Lettre.pdf',bytes}]);
  const mail=makeEML({to:'rh@example.test',from:'alex@example.test',subject:'Candidature é\r\nBcc: injection',body:'Bonjour été',files:[{name:'CV.pdf',bytes}]});
  const python=process.env.MONEYSCOUT_TEST_PYTHON||'python3';
  const script="import sys,io,zipfile,json,base64,email.policy;from email.parser import BytesParser;d=json.load(sys.stdin);z=zipfile.ZipFile(io.BytesIO(base64.b64decode(d['zip'])));assert z.testzip() is None;assert 'CV été.pdf' in z.namelist();m=BytesParser(policy=email.policy.default).parsebytes(base64.b64decode(d['mail']));assert m.get('Bcc') is None;a=list(m.iter_attachments());assert len(a)==1;assert a[0].get_payload(decode=True)==z.read('Lettre.pdf');assert 'été' in m.get_body(preferencelist=('plain',)).get_content();print('OK')";
  assert.equal(execFileSync(python,['-c',script],{input:JSON.stringify({zip:toBase64(zip),mail:toBase64(mail)}),encoding:'utf8'}).trim(),'OK');
});

test('les ressources de la page et du cache sont locales et présentes',()=>{
  const page=readFileSync(new URL('../pages/index.html',import.meta.url),'utf8');
  for(const match of page.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)){
    assert(existsSync(fileURLToPath(new URL('../pages/'+match[1],import.meta.url))),match[1]);
  }
  assert(!page.includes('__JOBBOT_'));
  assert(!page.includes('http://localhost'));
  assert(page.includes('form-action \'none\''));
});

test('une source inconnue ne déclenche aucun accès réseau',async()=>{
  let called=false;const previous=globalThis.fetch;
  globalThis.fetch=()=>{called=true;throw new Error('pas de réseau');};
  try{const fake={source:'__proto__',postingId:'12345678'};assert.equal(await readOffer(fake),fake);assert.equal(called,false);}
  finally{globalThis.fetch=previous;}
});

test('une sauvegarde reste exportable si le navigateur refuse un nouvel enregistrement',async()=>{
 const space=await createRecord('secours','six123');space.data.profile.name='Dernières modifications';
 const backup=await prepareBackup(space.record,space.data,space.key,async()=>{throw new Error('quota dépassé');});
 assert.equal(backup.stored,false);
 assert.equal((await unlock(backup.envelope,'six123')).data.profile.name,'Dernières modifications');
});
