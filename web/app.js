'use strict';
const APP_BUILD='8.0.0';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const token = $('meta[name="jobbot-token"]').content;
const labels = {nouvelle:'À étudier',preparee:'Brouillon prêt',envoyee:'Envoyée',reponse:'Réponse reçue',entretien:'Entretien',refus:'Refus',archivee:'Archivée',envoi_incertain:'Envoi à vérifier'};
const names = {bienvenue:'Démarrage',accueil:'Tableau de bord',offres:'Trouver des offres',yahoo:'Messagerie',suivi:'Mes candidatures',contacts:'Contacts LinkedIn',cv:'Mes CV et mon profil',connexions:'Mes comptes',carte:'Carte des offres',relances:'Relances',guide:'Premiers pas'};
const keywords = ['employé polyvalent','préparateur de commandes','employé libre-service','agent logistique','manutentionnaire','technicien informatique','support informatique','alternance systèmes réseaux'];
let state = {jobs:[],profiles:{},config:{},events:[],profile:{},feed:{offers:[]},contacts:[]};
let currentJob = null;
let currentContact = null;
let bridgeReady=false,bridgeSearchId='',autoStarted=false,polling=false;
let bridgeSequence=0;
const bridgePending=new Map();
const sites={indeed:'Indeed France',francetravail:'France Travail',hellowork:'HelloWork',linkedin:'LinkedIn',meteojob:'Météojob',adecco:'Adecco',manpower:'Manpower',randstad:'Randstad'};
const mailProvider=()=>state.config.email_provider||'yahoo';
const mailLabel=()=>mailProvider()==='yahoo'?'Yahoo':'Gmail';
const mailConnected=()=>state.config.mail_mode==='direct'&&Boolean(state.config[mailProvider()+'_password_configured']);
const mailAddress=()=>state.config[mailProvider()+'_address']||'';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let toastTimer;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = s => s ? new Date(s).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}) : '—';
const due = j => j.status === 'envoyee' && j.next_followup && j.next_followup <= new Date().toISOString();
const badge = j => `<span class="badge ${j.status==='envoyee'?'sent':['reponse','entretien'].includes(j.status)?'reply':j.status==='envoi_incertain'?'warn':''}">${esc(labels[j.status] || j.status)}</span>`;

function toast(message,error=false){
  clearTimeout(toastTimer);
  $('#toast').textContent=message;
  $('#toast').className=error?'error':'';
  $('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,error?14000:8000);
}

async function api(path,payload){
  const controller=new AbortController();
  const timer=path==='/api/state'?setTimeout(()=>controller.abort(),15000):null;
  try{
    const response=await fetch(path,{method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-JobBot-Token':token},body:payload===undefined?undefined:JSON.stringify(payload),signal:controller.signal});
    if(!(response.headers.get('content-type')||'').includes('application/json')) throw new Error('Cette fenêtre ne communique pas avec la version actuelle de MoneyScout. Relance ton lien MoneyScout du nouveau dossier.');
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'L’action a échoué.');
    return data;
  }finally{if(timer)clearTimeout(timer);}
}

async function run(button,action){
  if(button?.disabled) return;
  if(button) button.disabled=true;
  try {return await action();}
  catch(error){toast(error.message||'Connexion à MoneyScout interrompue. Vérifie sa fenêtre de lancement.',true);}
  finally {if(button) button.disabled=false;}
}

function go(view){
  if(!names[view]) view='offres';
  $$('.view').forEach(el=>el.hidden=el.id!=='view-'+view);
  $$('nav [data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('#breadcrumb').textContent='MON ESPACE / '+names[view].toLocaleUpperCase('fr');
  location.hash=view;
  window.scrollTo(0,0);
}

function empty(title,message,button=true){
  return `<div class="empty"><div class="empty-icon">↗</div><h3>${esc(title)}</h3><p>${esc(message)}</p>${button?'<button class="secondary" data-go="offres">Trouver une offre</button>':''}</div>`;
}

function jobRow(j){
  return `<div class="job-row"><span class="company-icon">${esc(j.company.slice(0,2).toUpperCase())}</span><div class="job-title"><strong>${esc(j.title)}</strong><small>${esc(j.company)} · ${esc(j.location||'Lieu à préciser')}</small></div>${badge(j)}<button class="text-button" data-edit="${esc(j.id)}">Ouvrir ↗</button></div>`;
}

function renderHome(){
  const jobs=state.jobs;
  const stats=[['Offres à étudier',jobs.filter(j=>['nouvelle','preparee'].includes(j.status)).length,'Pour ton prochain envoi','⌕'],['Candidatures envoyées',jobs.filter(j=>j.sent_at).length,'Toutes tes démarches enregistrées','↗'],['Réponses reçues',jobs.filter(j=>['reponse','entretien'].includes(j.status)).length,'À consulter et à qualifier','↩'],['Relances à préparer',jobs.filter(due).length,'Pour garder le contact','◷']];
  $('#stats').innerHTML=stats.map(([label,note,sub,icon])=>`<div class="stat"><div class="label">${esc(label)}<span>${icon}</span></div><strong>${note}</strong><small>${esc(sub)}</small></div>`).join('');
  let tasks=[];
  const uncertain=jobs.find(j=>j.status==='envoi_incertain');
  if(uncertain) tasks.push(['Vérifier un envoi email',uncertain.company+' : consulte le dossier Envoyés avant toute nouvelle action.',`data-edit="${esc(uncertain.id)}"`,'Ouvrir la fiche']);
  const followup=jobs.find(due);
  if(followup) tasks.push(['Reprendre contact avec '+followup.company,'La date de relance est arrivée. Prépare et relis ton message.',`data-edit="${esc(followup.id)}"`,'Préparer la suite']);
  if(!mailConnected()&&!window.JobBotCloud) tasks.push(['Connecter '+mailLabel(),'Pour envoyer directement les candidatures qui proposent une adresse de recrutement.','data-go="connexions"','Configurer la messagerie']);
  const draft=jobs.find(j=>['nouvelle','preparee'].includes(j.status));
  if(draft) tasks.push(['Préparer ta candidature',draft.title+' · '+draft.company,`data-edit="${esc(draft.id)}"`,'Ouvrir le brouillon']);
  tasks.push(['Chercher sur les huit sites','Indeed France, France Travail, HelloWork et LinkedIn dans une seule liste.','data-go="offres"','Voir les offres']);
  if(tasks.length<3) tasks.push(['Vérifier tes CV','Choisis le profil qui correspond à chaque candidature.','data-go="cv"','Voir mes CV']);
  $('#todo').innerHTML=tasks.slice(0,3).map(([title,message,attr,cta],i)=>`<div class="task"><span class="task-number">0${i+1}</span><div><strong>${esc(title)}</strong><p>${esc(message)}</p><button ${attr}>${esc(cta)} ↗</button></div></div>`).join('');
  $('#latest').innerHTML=jobs.length?jobs.slice(0,4).map(jobRow).join(''):(state.feed.offers||[]).slice(0,4).map(o=>`<div class="job-row"><span class="company-icon">${esc(o.company.slice(0,2).toUpperCase())}</span><div class="job-title"><strong>${esc(o.title)}</strong><small>${esc(o.location)} · ${esc(date(o.posted))}</small></div><button class="secondary" data-prepare-offer="${esc(o.offer_id)}">Voir et préparer ↗</button></div>`).join('')||empty('Aucune offre en cache.','Ouvre la recherche puis actualise les offres des employeurs.');
}

function renderJobs(){
  const query=$('#filter-text').value.toLowerCase();
  const status=$('#filter-status').value;
  const profile=$('#filter-profile').value;
  const jobs=state.jobs.filter(j=>(!query||(j.title+' '+j.company+' '+j.location).toLowerCase().includes(query))&&(!status||j.status===status)&&(!profile||j.profile===profile));
  $('#count').textContent=state.jobs.length;
  $('#job-list').innerHTML=jobs.length?jobs.map(j=>`<article class="job-card"><div><p>${esc(j.company)} · ${esc(j.location||'Adresse à préciser')}</p><h3>${esc(j.title)}</h3><div class="pills"><span>${esc(state.profiles[j.profile]?.label)}</span>${j.posted?`<span>Publiée le ${esc(date(j.posted))}</span>`:''}${due(j)?'<span>Relance à faire</span>':''}</div></div><div class="score"><strong>${j.score}</strong><small>INDICE / 100</small></div><footer><div>${badge(j)} <small>${j.sent_at?'Envoi le '+esc(date(j.sent_at)):'CV proposé à vérifier'}${j.sent_at&&j.next_followup?' · Relance '+esc(date(j.next_followup)):''}</small></div><button class="secondary" data-edit="${esc(j.id)}">Ouvrir la fiche ↗</button></footer></article>`).join(''):empty(state.jobs.length?'Aucune offre avec ces filtres.':'Ton suivi est prêt.','Les annonces que tu ajoutes apparaîtront ici, avec leur CV et leur statut.',!state.jobs.length);
  $('#events').innerHTML=state.events.length?state.events.map(v=>`<div class="event"><time>${esc(date(v.at))} · ${new Date(v.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</time><span>${esc(v.message)}</span></div>`).join(''):'<p class="small muted">Tes envois et réponses apparaîtront ici.</p>';
}

function renderCV(){
  $('#cv-grid').innerHTML=Object.entries(state.profiles).map(([id,p],i)=>`<article class="cv-card"><span class="optional">PROFIL 0${i+1}</span><div class="cv-symbol">▧</div><h2>${esc(p.label)}</h2><p>${p.available?'Ton PDF est disponible pour les candidatures de ce profil.':'Ajoute un CV PDF pour utiliser ce profil dans tes candidatures.'}</p><div class="actions">${p.available?`<a class="secondary button" href="/cv/${encodeURIComponent(p.cv)}" target="_blank" rel="noreferrer">Voir le CV ↗</a><a href="/cv/${encodeURIComponent(p.cv)}" download="${esc(p.cv)}">Télécharger</a>`:'<span class="badge">CV à ajouter</span>'}</div></article>`).join('');
  $('#mobility-preview').textContent=state.profile.mobility;
  for(const [key,value] of Object.entries(state.profile)) if($('#profile-form').elements[key]) $('#profile-form').elements[key].value=value;
}

function renderConfig(){
  const form=$('#config-form');
  for(const [key,value] of Object.entries(state.config)){
    const el=form.elements[key];
    if(!el) continue;
    if(el.type==='checkbox') el.checked=Boolean(value);
    else el.value=value;
  }
  for(const key of ['gmail_password','yahoo_password','openai_key','telegram_token']){
    form.elements[key].placeholder=state.config[key+'_configured']?'Déjà enregistré · laisser vide pour conserver':'À renseigner une première fois';
  }
  $('#gmail-state').textContent=mailConnected()?mailLabel()+' · prêt à tester':mailLabel()+' · à connecter';
  $('#check-mail').hidden=!mailConnected();
  $('#yahoo-fields').hidden=mailProvider()!=='yahoo';
  $('#gmail-fields').hidden=mailProvider()!=='gmail';
  $('#openai-state').textContent=state.config.openai_key_configured?'Clé enregistrée':'Rédaction locale incluse';
  $('#telegram-state').textContent=state.config.telegram_token_configured?'Prêt à tester':'À connecter';
}

function renderYahoo(){
  const form=$('#yahoo-form');
  if(document.activeElement?.form!==form){
    form.elements.yahoo_address.value=state.config.yahoo_address||'';
    form.elements.yahoo_password.value='';
  }
  const configured=Boolean(state.config.yahoo_password_configured);
  const verified=Boolean(state.config.yahoo_verified_at&&state.config.yahoo_verified_address===state.config.yahoo_address);
  form.elements.yahoo_password.placeholder=configured?'Déjà enregistré · laisse vide pour conserver':'Mot de passe créé pour MoneyScout';
  $('#yahoo-connection-state').textContent=verified?'Connexion vérifiée':configured?'Enregistrée · à vérifier':'À configurer';
  $('#yahoo-connection-state').classList.toggle('reply',verified);
  $('#yahoo-connect-result').textContent=verified?'Connexion vérifiée le '+new Date(state.config.yahoo_verified_at).toLocaleString('fr-FR')+'. Aucun email n’est envoyé par ce test.':configured?'Un mot de passe est enregistré. Clique sur Connecter Yahoo et vérifier.':'Renseigne ton adresse et le mot de passe d’application Yahoo pour connecter les envois.';
}

function acceptState(next){
  if(next.build!==APP_BUILD) throw new Error('Une ancienne version de MoneyScout répond à cette fenêtre. Ferme-la puis relance ton lien MoneyScout dans le dossier MoneyScout Cloud.');
  state={...state,...next,feed:next.feed||{offers:[],city:'Lyon',sources:{},errors:[]},contacts:next.contacts||[]};
}

function renderAll(){
  const warnings=[...(state.warnings||[])];
  for(const [name,render] of [['les offres',renderFeed],['Yahoo',renderYahoo],['le tableau de bord',renderHome],['le suivi',renderJobs],['les CV',renderCV],['les connexions',renderConfig],['les contacts',renderContacts]]){
    try{render();}catch(error){console.error('Affichage MoneyScout : '+name,error);warnings.push('L’écran '+name+' n’a pas pu être affiché. Les autres rubriques restent accessibles.');}
  }
  window.JobBotWorkspace?.renderSetup();
  window.JobBotMatching?.controls();
  window.JobBotPersonal?.render();
  $('#state-warnings').hidden=!warnings.length;
  $('#state-warnings').textContent=warnings.join(' ');
}

async function refresh(){
  acceptState(await api('/api/state'));
  renderAll();
}

function openJob(job=null){
  currentJob=job;
  const form=$('#job-form');form.reset();
  $('#dialog-title').textContent=job?.id?'Ta candidature':'Ajouter une offre';
  for(const [key,value] of Object.entries(job||{})) if(form.elements[key]){if(form.elements[key].type==='checkbox')form.elements[key].checked=Boolean(value);else form.elements[key].value=value??'';}
  delete form.elements.email.dataset.userEdited;
  form.elements.status.value=job?.status||'nouvelle';
  $('#editor').hidden=!job?.id;
  $('#job-assessment').innerHTML=job?.checks?`<div class="assessment"><strong>Points à vérifier · indice indicatif ${job.score}/100</strong><ul>${job.checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:'';
  if(job?.id){
    const p=state.profiles[job.profile];
    $('#attachment').innerHTML=`▧ ${esc(p.label)} · <a href="/cv/${encodeURIComponent(p.cv)}" download="${esc(p.cv)}">Télécharger le CV à joindre</a> · <a href="/cv/${encodeURIComponent(p.cv)}" target="_blank" rel="noreferrer">Voir ↗</a>`;
    $('#apply-link').href=job.source_url||'#';
    $('#apply-link').hidden=!job.source_url;
    $('#draft-followup').hidden=!job.sent_at||job.status!=='envoyee';
    $('#draft-followup').disabled=!due(job);
    const relance=job.draft_kind==='followup'&&job.status==='envoyee';
    const canPrepare=['nouvelle','preparee'].includes(job.status)||relance;
    $('#send-email').hidden=!canPrepare||!mailConnected();
    $('#open-gmail').hidden=!canPrepare;
    $('#send-email').textContent=relance?'Relire et envoyer la relance':'Relire et envoyer par '+mailLabel();
    $('#open-gmail').textContent='Ouvrir '+mailLabel()+' dans le navigateur';
    $('#draft-standard').hidden=Boolean(job.sent_at);
    $('#draft-ai').hidden=Boolean(job.sent_at)||!state.config.openai_key_configured;
    $('#mark-sent').hidden=Boolean(job.sent_at)&&job.status!=='envoi_incertain'&&!relance;
    $('#mark-sent').textContent=job.status==='envoi_incertain'?'J’ai vérifié ma messagerie : email envoyé':relance?'J’ai envoyé la relance':'J’ai envoyé ma candidature';
  }
  if(!$('#job-dialog').open) $('#job-dialog').showModal();
  window.JobBotWorkspace?.renderJob(job);
  window.JobBotMatching?.renderJob(job);
  if(job?.offer_id)window.JobBotWorkspace?.prioritize(job.offer_id).catch(()=>{});
}

function jobPayload(){const ats=$('#job-form').elements.use_ats;return {...Object.fromEntries(new FormData($('#job-form'))),use_ats:ats&&!ats.disabled?ats.checked:!!currentJob?.use_ats,include_letter:$('#job-form').elements.include_letter.checked,email_user_edited:Boolean($('#job-form').elements.email.dataset.userEdited)};}
async function saveForm(){
  if(!$('#job-form').reportValidity()) throw new Error('Complète les champs obligatoires de la fiche.');
  const job=await api('/api/job',jobPayload());
  currentJob=job;await refresh();return job;
}

function fillSelects(){
  const profileOptions=Object.entries(state.profiles).map(([id,p])=>`<option value="${id}">${esc(p.label)}</option>`).join('');
  const statusOptions=Object.entries(labels).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
  $('#job-form').elements.profile.innerHTML='<option value="">Choisir automatiquement</option>'+profileOptions;
  $('#job-form').elements.status.innerHTML=statusOptions;
  $('#filter-profile').innerHTML='<option value="">Tous les profils</option>'+profileOptions;
  $('#filter-status').innerHTML='<option value="">Tous les statuts</option>'+statusOptions;
}

async function sources(){
  const q=$('#search-query').value;
  $$('#keywords button').forEach(b=>b.classList.toggle('selected',b.textContent===q));
}

document.addEventListener('click',event=>{
  const goButton=event.target.closest('[data-go],[data-view]');
  if(goButton) go(goButton.dataset.go||goButton.dataset.view);
  const add=event.target.closest('[data-action="add"]');if(add) openJob();
  const edit=event.target.closest('[data-edit]');if(edit) openJob(state.jobs.find(j=>j.id===edit.dataset.edit));
  if(event.target.closest('.close-dialog')) $('#job-dialog').close();
});

$('#job-form').addEventListener('submit',e=>{e.preventDefault();run($('#save-job'),async()=>{const j=await saveForm();openJob(j);toast('Offre enregistrée. Tu peux maintenant préparer ton message.');});});
for(const [id,options] of [['draft-standard',{}],['draft-ai',{ai:true}],['draft-followup',{followup:true}]]){
  $('#'+id).addEventListener('click',()=>run($('#'+id),async()=>{
    const j=await saveForm();
    const result=await api('/api/draft',{id:j.id,...options});
    await refresh();openJob(result);toast('Brouillon prêt. Relis le texte et vérifie le CV.');
  }));
}
$('#job-form').elements.profile.addEventListener('change',()=>{
  const p=state.profiles[$('#job-form').elements.profile.value];
  if(p) $('#attachment').innerHTML=`▧ ${esc(p.label)} · <a href="/cv/${encodeURIComponent(p.cv)}" download="${esc(p.cv)}">Télécharger le CV à joindre</a> · <a href="/cv/${encodeURIComponent(p.cv)}" target="_blank" rel="noreferrer">Voir ↗</a>`;
});

$('#open-gmail').addEventListener('click',()=>{
  // La fenetre est ouverte pendant le clic pour eviter le blocage des popups.
  const tab=window.open('about:blank','_blank');
  if(tab) tab.opener=null;
  run($('#open-gmail'),async()=>{
    try{
      const job=await saveForm();
      const result=await api('/api/gmail-link',{id:job.id});
      if(!tab) throw new Error('Autorise l’ouverture d’un nouvel onglet pour MoneyScout, puis recommence.');
      tab.location.href=result.url;
      toast(mailLabel()+' ouvert. Vérifie le compte expéditeur, joins le CV téléchargé, puis envoie depuis ta messagerie.');
    }catch(error){if(tab) tab.close();throw error;}
  });
});
for(const [id,field] of [['copy-body','body'],['copy-subject','subject']]){
  $('#'+id).addEventListener('click',()=>run($('#'+id),async()=>{
    const element=$('#job-form').elements[field];
    if(!element.value.trim()) throw new Error('Prépare d’abord un brouillon.');
    if(!navigator.clipboard){element.focus();element.select();toast('Texte sélectionné. Appuie sur Ctrl+C pour le copier.');return;}
    await navigator.clipboard.writeText(element.value);
    toast(field==='body'?'Texte copié. Tu peux le coller dans ta messagerie.':'Objet copié.');
  }));
}

$('#send-email').addEventListener('click',()=>run($('#send-email'),async()=>{
  const job=await saveForm();
  if(!job.email||!job.email_source) throw new Error('Renseigne l’email du recruteur et le lien de la page qui le publie.');
  if(!job.subject||!job.body) throw new Error('Prépare un brouillon avant l’envoi.');
  $('#send-preview').innerHTML=`<p><strong>De :</strong> ${esc(mailAddress())}<br><strong>À :</strong> ${esc(job.email)}<br><strong>Source de l’adresse :</strong> <a href="${esc(job.email_source)}" target="_blank" rel="noreferrer">Vérifier la page ↗</a><br><strong>Objet :</strong> ${esc(job.subject)}<br><strong>Pièces jointes :</strong> ${job.draft_kind==='followup'?'Aucune (relance)':esc(state.profiles[job.profile].cv)+(job.include_letter?' + Lettre de motivation PDF':'')}</p>${job.email_association?`<p class="small muted">${esc(job.email_association)}. Vérifie le destinataire avant l’envoi.</p>`:''}<pre>${esc(job.body)}</pre>${job.include_letter?'<h3>Lettre jointe en PDF</h3><pre>'+esc(job.letter_text)+'</pre>':''}`;
  $('#confirm-dialog').showModal();
}));
for(const id of ['cancel-send','back-send']) $('#'+id).addEventListener('click',()=>$('#confirm-dialog').close());
$('#confirm-send').addEventListener('click',()=>run($('#confirm-send'),async()=>{
  const result=await api('/api/send',{id:currentJob.id,confirm:true,followup:currentJob.draft_kind==='followup'});
  $('#confirm-dialog').close();await refresh();openJob(result);toast('Email envoyé avec succès. Le suivi est à jour.');
}));
$('#mark-sent').addEventListener('click',()=>run($('#mark-sent'),async()=>{
  const j=await saveForm();
  if(!confirm('As-tu bien terminé l’envoi de cette candidature sur le site, ou vérifié sa présence dans les messages envoyés de ta messagerie ?')) return;
  const result=await api('/api/mark-sent',{id:j.id,followup:j.draft_kind==='followup'});
  await refresh();openJob(result);toast('Candidature enregistrée comme envoyée.');
}));

$('#search-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{
  await refreshFeed();
  await sources();
});});
$('#keywords').innerHTML=keywords.map(k=>`<button type="button">${esc(k)}</button>`).join('');
$('#keywords').addEventListener('click',e=>{if(e.target.tagName==='BUTTON'){$('#search-query').value=e.target.textContent;run(e.target,sources);}});
$('#import-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{
  const result=await api('/api/import',{url:$('#import-url').value});
  openJob(result);toast('Annonce lue. Vérifie les informations puis enregistre-la.');
});});
for(const id of ['filter-text','filter-status','filter-profile']) $('#'+id).addEventListener('input',renderJobs);
$('#config-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{
  const values=Object.fromEntries(new FormData(e.target));values.watch_mail=e.target.elements.watch_mail.checked;values.auto_enrich=e.target.elements.auto_enrich.checked;
  await api('/api/config',values);await refresh();toast('Connexions enregistrées. Tu peux lancer les tests.');
});});
$('#profile-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{
  await api('/api/profile',Object.fromEntries(new FormData(e.target)));await refresh();toast('Profil enregistré pour les prochains brouillons.');
});});
for(const [id,path] of [['test-gmail','/api/test-email'],['test-telegram','/api/test-telegram'],['check-mail','/api/check-mail']]){
  $('#'+id).addEventListener('click',()=>run($('#'+id),async()=>{
    const result=await api(path,{});toast(result.message);await refresh();
  }));
}
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));

function matchesOffer(offer, query){
  query=norm(query.trim());
  const mappings={'employe polyvalent':'polyvalent','employe libre-service':'polyvalent','preparateur de commandes':'commandes','agent logistique':'commandes','manutentionnaire':'commandes','technicien informatique':'informatique','support informatique':'informatique','alternance systemes reseaux':'alternance'};
  if(mappings[query]) return offer.profile===mappings[query];
  return !query||norm(offer.title+' '+offer.company+' '+offer.description).includes(query);
}

function renderFeed(){
  const feed=state.feed||{offers:[]};
  const days=Number($('#feed-days').value);
  const employer=$('#feed-employer').value;
  const query=$('#feed-filter').value;
  const threshold=Date.now()-days*86400000;
  const offers=(feed.offers||[]).filter(o=>matchesOffer(o,query)&&(!employer||o.source_id===employer)&&(!days||!o.posted||new Date(o.posted).getTime()>=threshold)&&(!window.JobBotMatching||window.JobBotMatching.allow(o))).sort((a,b)=>window.JobBotMatching?.sort(a,b)||0);
  $('#feed-count').textContent=offers.length+' offre(s) affichée(s)';
  const completed=Object.values(feed.sources||{}).filter(s=>['results','empty'].includes(s.status)).length;
  $('#feed-status').textContent=feed.search_id?completed+'/4 sites lus'+(feed.running?' · en cours…':''):'Prêt pour les 8 sites';
  $('#feed-update').textContent=(feed.search_id?'Recherche : « '+feed.query+' » · '+feed.city+'. ':'')+(feed.checked_at?'Dernière lecture : '+new Date(feed.checked_at).toLocaleString('fr-FR')+'. ':'')+'Les dates non indiquées restent incluses. Le site peut élargir son rayon autour de la ville.';
  $('#feed-errors').textContent=(feed.errors||[]).join(' ');
  renderSiteProgress();
  window.JobBotWorkspace?.renderResearchSummary();
  $('#opportunity-list').innerHTML=offers.length?offers.map(o=>{
    const existing=state.jobs.find(j=>j.offer_id===o.offer_id||j.source_url===o.source_url);
    const posted=o.posted_label||(o.posted?'Publiée le '+date(o.posted):'Date non indiquée');
    const summary=o.summary||o.description||'Ouvre l’annonce pour lire les missions et les conditions demandées.';
    return `<article class="job-card opportunity board-offer"><div><p><span class="source-tag">${esc(o.provider)}</span> ${esc(o.company)} · ${esc(o.location)}</p><h3>${esc(o.title)}</h3>${window.JobBotMatching?.card(o)||''}<div class="pills"><span>${esc(state.profiles[o.profile]?.label)}</span><span>${esc(posted)}</span>${o.contract?`<span>${esc(o.contract)}</span>`:''}${existing?.sent_at?'<span>Déjà envoyée</span>':''}</div><p class="offer-excerpt">${esc(summary.slice(0,300))}${summary.length>300?'…':''}</p><p class="small muted">${o.description_kind==='full'?'Description de l’offre lue.':'Aperçu · analyse complète en préparation.'}</p>${window.JobBotWorkspace?.offerHint(o)||''}</div><footer><div class="actions"><button class="primary" data-apply-offer="${esc(o.offer_id)}">${existing?.sent_at?'Voir mon envoi':o.email&&!o.form_mandatory?'Postuler par email':'Préparer et postuler'}</button><button class="secondary" data-prepare-offer="${esc(o.offer_id)}">CV et analyse</button><button class="secondary" data-letter-offer="${esc(o.offer_id)}">Lettre de motivation</button><button class="secondary" data-offer-contacts="${esc(o.offer_id)}">Contacts LinkedIn${o.research?.people?.length?' ('+o.research.people.length+')':''}</button></div><a href="${esc(o.source_url)}" target="_blank" rel="noreferrer" class="small">Voir sur ${esc(o.provider)} ↗</a></footer></article>`;
  }).join(''):empty(feed.running?'La recherche est en cours…':(feed.offers||[]).length?'Aucune offre avec ces filtres.':feed.search_id?'Pas encore d’offre importée.':'Lance ta recherche sur les huit sites.',feed.running?'Les offres s’ajoutent ici dès qu’un site les affiche.':feed.search_id?'Consulte l’état de chaque site ci-dessus. Un site qui demande une connexion ou une vérification doit être ouvert puis relu.':'Choisis un métier et une ville, puis clique sur Chercher sur les 8 sites.',false);
  if(!offers.length&&(feed.offers||[]).length){
    $('#opportunity-list').insertAdjacentHTML('beforeend','<div class="actions filter-recovery"><button class="primary" data-reset-feed>Afficher les '+(feed.offers||[]).length+' offres disponibles sans filtre</button></div>');
  }
}

async function refreshFeed(){
  autoStarted=true;
  const query=$('#search-query').value.trim(),city=$('#feed-city').value.trim();
  if(!query||!city)throw new Error('Indique un métier et une ville.');
  if(!bridgeReady){
    try{await connectBridge(false);}catch{}
  }
  if(!bridgeReady){
    const opened=await api('/api/browser/open',{query,city});
    toast(opened.message);return;
  }
  const feed=await api('/api/search/start',{query,city});
  state.feed=feed;bridgeSearchId=feed.search_id;resetFeedFilters();renderHome();
  try{
    await bridgeCall('START',{search_id:feed.search_id,sites:Object.entries(feed.sources).filter(([,s])=>s.url).map(([id,s])=>({id,url:s.url}))},20000);
    toast('Recherche lancée en parallèle sur les huit sites. Les offres arrivent ici.');
  }catch(error){
    await Promise.all(Object.keys(sites).filter(id=>feed.sources[id]?.url).map(source_id=>api('/api/search/results',{search_id:feed.search_id,source_id,status:'unavailable',offers:[],message:'Le navigateur n’a pas démarré la lecture. Rouvre la fenêtre Opera MoneyScout.'})));
    adoptFeed(await api('/api/search/state'));throw error;
  }
}

function fillNewFilters(){
  const previous=$('#feed-employer').value;
  $('#feed-employer').innerHTML='<option value="">Les quatre sites</option>'+Object.entries(sites).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('');
  $('#feed-employer').value=previous;
}

function renderSiteProgress(){
  const feed=state.feed||{};
  const labels={idle:'Prêt',opening:'Ouverture…',reading:'Lecture…',results:'Offres importées',empty:'Zéro résultat',needs_user:'À ouvrir',unavailable:'À reprendre'};
  $('#site-progress').innerHTML=Object.entries(sites).map(([id,label])=>{
    const s=feed.sources?.[id]||{status:'idle',count:0,message:'Prêt pour la recherche.'};
    return `<article class="site-state ${esc(s.status)}" data-site-state="${id}"><div><strong>${esc(label)}</strong><span class="badge">${esc(labels[s.status]||'À vérifier')}</span></div><p>${s.count?`<b>${s.count} offre(s)</b> · `:''}${esc(s.message||'')}</p>${feed.search_id&&s.url?`<div class="actions"><button class="text-button" data-site-open="${id}">Ouvrir l’onglet ↗</button><button class="text-button" data-site-resume="${id}">Relire cette page</button></div>`:''}</article>`;
  }).join('');
}

function bridgeCall(command,payload={},timeout=4000){
  const id=++bridgeSequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{bridgePending.delete(id);reject(new Error('Ouvre MoneyScout avec ton lien MoneyScout ou le bouton Ouvrir la fenêtre Opera MoneyScout.'));},timeout);
    bridgePending.set(id,{resolve,reject,timer});
    window.postMessage({channel:'jobbot-request',id,command,payload},location.origin);
  });
}
function adoptFeed(feed){
  if(feed.search_id===state.feed.search_id&&feed.revision<state.feed.revision)return;
  state.feed=feed;renderFeed();renderHome();
}
async function connectBridge(automatic=true){
  const result=await bridgeCall('HELLO',{search_id:state.feed.search_id,pause_enrichment:state.config.auto_enrich===false||!state.config.onboarding_done});
  if(result.version!==APP_BUILD)throw new Error('Rouvre MoneyScout depuis le dossier VERSION 8.0.0.');
  const accountScope=document.querySelector('meta[name="jobbot-account"]')?.content;
  if(accountScope&&result.account_scope!==accountScope)throw new Error('Mets à jour le module pour utiliser les comptes personnels : Connecter mon navigateur → Télécharger le module, puis remplace l’ancien module dans Opera.');
  bridgeReady=true;bridgeSearchId=result.search_id||'';
  $('#browser-status').textContent='Navigateur MoneyScout connecté · les quatre recherches peuvent démarrer ensemble.';
  $('#open-jobbot-browser').hidden=true;
  const launch=new URLSearchParams(location.search).get('launch')==='1';
  if(automatic&&!autoStarted&&window.JobBotReady&&state.config.onboarding_done&&(launch||(state.auto_search&&(!state.feed.search_id||bridgeSearchId!==state.feed.search_id)))){
    autoStarted=true;run($('#search-all'),refreshFeed);
    if(launch)history.replaceState(null,'','/?v='+APP_BUILD+location.hash);
  }
  return result;
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='jobbot-bridge')return;
  const data=event.data;
  if(data.kind==='response'){
    const pending=bridgePending.get(data.id);if(!pending)return;
    clearTimeout(pending.timer);bridgePending.delete(data.id);
    if(data.result?.error)pending.reject(new Error(data.result.error));else pending.resolve(data.result||{});
  }else if(data.kind==='ready'){
    if(window.JobBotReady)connectBridge().catch(()=>{});
  }else if(data.kind==='feed'){
    if(data.feed.search_id===state.feed.search_id)adoptFeed(data.feed);
  }else if(data.kind==='enrichment'){
    if(data.contacts)state.contacts=data.contacts;
    if(data.feed.search_id===state.feed.search_id)adoptFeed(data.feed);
    if(currentJob&&$('#job-dialog').open)window.JobBotWorkspace?.renderJob(currentJob);
    if(!$('#view-contacts').hidden)renderContacts();
  }else if(data.kind==='error'&&data.search_id===state.feed.search_id)toast(data.message,true);
});
$('#open-jobbot-browser').addEventListener('click',()=>run($('#open-jobbot-browser'),async()=>{
  const result=await api('/api/browser/open',{query:$('#search-query').value.trim(),city:$('#feed-city').value.trim()});toast(result.message);
}));
setInterval(async()=>{
  if(!window.JobBotReady||!state.feed.running||polling)return;
  polling=true;
  try{adoptFeed(await api('/api/search/state'));}catch{}finally{polling=false;}
},3000);

function renderContacts(){
  const selected=$('#contact-company').value;
  const companies=[...new Set([...(state.contacts||[]).map(c=>c.company),...state.jobs.map(j=>j.company)])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr'));
  $('#contact-company').innerHTML='<option value="">Toutes les entreprises</option>'+companies.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#contact-company').value=companies.includes(selected)?selected:'';
  const previousJob=$('#contact-job').value;
  $('#contact-job').innerHTML='<option value="">Mon projet de recherche à Lyon</option>'+state.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.title)} · ${esc(j.company)}</option>`).join('');
  $('#contact-job').value=previousJob;
  const selectedJob=state.jobs.find(j=>j.id===$('#contact-job').value);
  const contacts=(state.contacts||[]).filter(c=>(!selected||norm(c.company)===norm(selected))&&(!c.offer_id||!selectedJob||c.offer_id===selectedJob.offer_id));
  $('#contact-list').innerHTML=contacts.length?contacts.map(c=>`<article class="panel contact-card"><div class="contact-card-top"><span class="company-icon">${esc(c.name.split(/\s+/).map(n=>n[0]).join('').slice(0,2))}</span><span class="badge ${c.confidence==='orientation'?'warn':''}">${c.status==='sent'?'Message déclaré envoyé':c.confidence==='orientation'?'Piste d’orientation':'Source publique'}</span></div><h2>${esc(c.name)}</h2><p class="contact-company">${esc(c.company)}</p><p><strong>${esc(c.role)}</strong></p><p class="small muted">${esc(c.context)}</p><p class="small muted">Recherche effectuée le ${esc(date(c.checked_at))}. Vérifie le poste actuel sur le profil.</p><div class="actions"><button class="primary" data-contact="${esc(c.id)}">Préparer un message</button><a href="${esc(c.source_url||c.profile_url)}" target="_blank" rel="noreferrer" class="small">Voir la source ↗</a></div></article>`).join(''):empty('Aucun contact identifié pour cette entreprise.','Utilise la recherche LinkedIn ci-dessous, puis ajoute uniquement les personnes dont le lien avec le recrutement est vérifiable.',false);
  const company=selected||'Lyon';
  $('#company-searches').innerHTML=`<a class="secondary button" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company+' recrutement')}" target="_blank" rel="noreferrer">Chercher les contacts de ${esc(company)} dans LinkedIn ↗</a>`;
}

async function openContact(id){
  const result=await api('/api/contact/draft',{id,job_id:$('#contact-job').value||null});
  currentContact=result.contact;
  const form=$('#contact-form');form.reset();
  for(const key of ['id','name','company','role','profile_url','source_url']) form.elements[key].value=currentContact[key]||'';
  form.elements.body.value=currentContact.body&&!$('#contact-job').value?currentContact.body:result.body;
  $('#contact-context').textContent=currentContact.context||'';
  $('#contact-dialog-title').textContent='Écrire à '+currentContact.name;
  $('#mark-contact-sent').hidden=currentContact.status==='sent';
  $('#contact-dialog').showModal();
}

async function saveContact(status){
  if(!$('#contact-form').reportValidity()) throw new Error('Vérifie le nom, l’entreprise et les liens du contact.');
  const values=Object.fromEntries(new FormData($('#contact-form')));
  if(status) values.status=status;
  const saved=await api('/api/contact',values);currentContact=saved;await refresh();return saved;
}

document.addEventListener('click',event=>{
  if(event.target.closest('[data-reset-feed]')) resetFeedFilters();
  const siteButton=event.target.closest('[data-site-open],[data-site-resume]');
  if(siteButton)run(siteButton,async()=>{
    if(!bridgeReady)throw new Error('Utilise la fenêtre Opera MoneyScout pour retrouver les onglets de recherche.');
    await bridgeCall(siteButton.dataset.siteResume?'RESUME':'FOCUS',{search_id:state.feed.search_id,source_id:siteButton.dataset.siteResume||siteButton.dataset.siteOpen});
  });
  const prepare=event.target.closest('[data-prepare-offer]');
  if(prepare) run(prepare,async()=>{const job=await api('/api/offer/prepare',{offer_id:prepare.dataset.prepareOffer});await refresh();openJob(job);});
  const contacts=event.target.closest('[data-offer-contacts]');
  if(contacts) run(contacts,async()=>{
    const job=await api('/api/offer/prepare',{offer_id:contacts.dataset.offerContacts});await refresh();
    $('#contact-company').value=job.company||'';$('#contact-job').value=job.id;renderContacts();go('contacts');
  });
  const contact=event.target.closest('[data-contact]');if(contact) run(contact,()=>openContact(contact.dataset.contact));
  const apply=event.target.closest('[data-apply-offer]');
  if(apply){
    const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
    run(apply,async()=>{
      try{
        const result=await api('/api/offer/apply',{offer_id:apply.dataset.applyOffer,confirm:true});
        await refresh();openJob(result.job);
        if(result.kind==='form'){
          if(tab)tab.location.href=result.url;
          else toast('Autorise l’ouverture de l’onglet ou utilise Ouvrir l’annonce dans la fiche.',true);
          toast('Dossier préparé. Termine le formulaire employeur et joins le CV avant de confirmer l’envoi ici.');
        }else{
          if(tab)tab.close();
          toast(result.kind==='existing'?'Cette candidature est déjà dans ton suivi.':'Dossier prêt. Relis le contact et la lettre, puis choisis l’envoi depuis MoneyScout ou ta messagerie.');
        }
      }catch(error){if(tab)tab.close();throw error;}
    });
  }
});
$('#refresh-feed').addEventListener('click',()=>run($('#refresh-feed'),refreshFeed));
function resetFeedFilters(){
  $('#feed-filter').value='';$('#feed-days').value='0';$('#feed-employer').value='';
  renderFeed();go('offres');
}
$('#reset-feed').addEventListener('click',resetFeedFilters);
for(const id of ['feed-days','feed-employer']) $('#'+id).addEventListener('change',renderFeed);
$('#feed-filter').addEventListener('input',renderFeed);
$('#search-query').addEventListener('input',sources);
$('#contact-company').addEventListener('change',renderContacts);
$('#contact-job').addEventListener('change',renderContacts);
$('#email-provider').addEventListener('change',()=>{
  $('#yahoo-fields').hidden=$('#email-provider').value!=='yahoo';$('#gmail-fields').hidden=$('#email-provider').value!=='gmail';
});
$('#yahoo-form').addEventListener('submit',event=>{
  event.preventDefault();
  run($('#connect-yahoo'),async()=>{
    $('#yahoo-connect-result').textContent='Vérification de la connexion Yahoo en cours…';
    try{
      const result=await api('/api/yahoo/connect',Object.fromEntries(new FormData(event.target)));
      event.target.elements.yahoo_password.value='';
      await refresh();
      $('#yahoo-connect-result').textContent=result.message;
      toast(result.message);
    }catch(error){
      $('#yahoo-connection-state').textContent='Connexion non vérifiée';
      $('#yahoo-connection-state').classList.remove('reply');
      $('#yahoo-connect-result').textContent=error.message;
      throw error;
    }
  });
});
$('#close-contact').addEventListener('click',()=>$('#contact-dialog').close());
$('#add-contact').addEventListener('click',()=>{
  currentContact=null;$('#contact-form').reset();$('#contact-dialog-title').textContent='Ajouter un contact vérifié';$('#contact-context').textContent='Ajoute le profil et la source qui établit le lien avec le recrutement.';$('#mark-contact-sent').hidden=true;$('#contact-dialog').showModal();
});
$('#contact-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{await saveContact();toast('Brouillon du contact enregistré.');});});
$('#open-linkedin-message').addEventListener('click',()=>{
  const text=$('#contact-form').elements.body.value;
  const copied=navigator.clipboard&&text.trim()?navigator.clipboard.writeText(text):null;
  const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
  run($('#open-linkedin-message'),async()=>{
    try{
      if(!$('#contact-form').elements.body.value.trim()) throw new Error('Prépare ton message avant d’ouvrir LinkedIn.');
      const saved=await saveContact();
      if(copied) await copied;
      else throw new Error('Utilise Ctrl+C pour copier le texte, puis ouvre le profil LinkedIn.');
      const url=saved.profile_url||('https://www.linkedin.com/search/results/people/?keywords='+encodeURIComponent(saved.name+' '+saved.company));
      if(!tab) throw new Error('Autorise l’ouverture d’un onglet pour MoneyScout, puis recommence.');
      tab.location.href=url;
      toast('Message copié. Dans LinkedIn, clique sur Message ou InMail, colle le texte et termine l’envoi.');
    }catch(error){if(tab)tab.close();throw error;}
  });
});
$('#mark-contact-sent').addEventListener('click',()=>run($('#mark-contact-sent'),async()=>{
  if(!confirm('As-tu bien envoyé ce message dans LinkedIn ?'))return;
  await saveContact('sent');$('#contact-dialog').close();toast('Message déclaré envoyé dans le suivi.');
}));
async function startup(force=false){
  window.JobBotReady=false;
  try{
    let initial;
    const bootstrap=$('#jobbot-bootstrap');
    if(!force&&bootstrap&&bootstrap.textContent.trim()&&!bootstrap.textContent.includes('__JOBBOT_BOOTSTRAP__')) initial=JSON.parse(bootstrap.textContent);
    else initial=await api('/api/state');
    acceptState(initial);
    fillSelects();fillNewFilters();renderAll();
    const params=new URLSearchParams(location.search);
    $('#feed-city').value=params.get('city')||state.feed.city||'Lyon';
    $('#search-query').value=params.get('query')||state.feed.query||'employé polyvalent';
    go(state.config.onboarding_done?(location.hash.slice(1)||'offres'):'bienvenue');
    window.JobBotReady=true;
    window.dispatchEvent(new Event('jobbot-ready'));
    $('#startup-error').hidden=true;
    sources().catch(()=>{});
    connectBridge().catch(()=>{
      if(bridgeReady)return;
      if(window.JobBotCloud){$('#browser-status').textContent='Mode simple · aucune installation ni connexion aux plateformes pour lancer la recherche.';$('#open-jobbot-browser').hidden=true;return;}
      $('#browser-status').textContent='La recherche intégrée utilise la fenêtre Opera MoneyScout. Ouvre-la avec le bouton ci-dessous.';
      $('#open-jobbot-browser').hidden=false;
    });
  }catch(error){
    window.showJobBotError(error.name==='AbortError'?'Le programme ne répond pas. Ferme les anciennes fenêtres et relance ton lien MoneyScout du dossier VERSION 8.0.0.':error.message);
  }
}
$('#retry-startup').addEventListener('click',()=>startup(true));
startup();
