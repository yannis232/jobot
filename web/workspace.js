(() => {
  'use strict';
  let step=0,pumping=false,uploading=false,profileDirty=false;
  const opened=new Set();
  function showStep(next){
    step=Math.max(0,Math.min(3,Number(next)));
    $$('[data-setup-page]').forEach(el=>el.hidden=Number(el.dataset.setupPage)!==step);
    $$('[data-setup-step]').forEach(el=>el.classList.toggle('active',Number(el.dataset.setupStep)===step));
    if(step===3)renderSummary();
    go('bienvenue');
  }
  function renderSummary(){
    const p=state.profile||{},cfg=state.config||{};
    const cvs=Object.values(state.profiles).filter(p=>p.available).length;
    $('#setup-summary').innerHTML=`<p><strong>${esc(p.name||'Ton nom reste à renseigner')}</strong><br>${esc(p.contact_email||'Ton email reste à renseigner')} · ${esc(p.city||'Ville à renseigner')}</p><p>${cvs} CV disponible(s) · ${esc(cfg.email_provider==='gmail'?'Google / Gmail':'Yahoo')} · ${cfg.mail_mode==='direct'?'Envoi direct configuré, connexion à vérifier si nécessaire':'Préparation et ouverture de la messagerie'}</p><p class="small muted">${opened.size} site(s) ouvert(s) pendant cette configuration. Vérifie toi-même que la connexion a été terminée dans chaque onglet.</p>`;
  }
  function renderSetup(){
    const p=state.profile||{};
    const f=$('#setup-profile-form');
    if(!profileDirty&&document.activeElement?.form!==f)for(const [key,value] of Object.entries(p)){
      const input=f.elements[key];if(input)input.value=Array.isArray(value)?value.join('\n'):value??'';
    }
    const m=$('#setup-mail-form');
    if(document.activeElement?.form!==m){
      m.elements.email_provider.value=state.config.email_provider||'yahoo';
      m.elements.address.value=mailAddress()||p.contact_email||'';
      m.elements.mail_mode.value=state.config.mail_mode||'browser';
      m.elements.password.value='';
    }
    updateMailFields();
    const options=Object.entries(state.profiles).map(([id,p])=>`<option value="${id}">${esc(p.label)}</option>`).join('');
    $$('.upload-profile').forEach(select=>{const current=select.value;select.innerHTML=options;if(current)select.value=current;});
    $('#setup-sites').innerHTML=Object.entries(sites).map(([id,label])=>`<article class="account-tile"><h3>${esc(label)}</h3><p id="setup-site-${id}">${opened.has(id)?'Onglet ouvert · connexion à terminer sur le site.':'Prépare ta connexion, ou utilise la recherche publique si elle est disponible.'}</p><button class="secondary" type="button" data-connect-site="${id}">Ouvrir et se connecter ↗</button></article>`).join('');
    $('#setup-auto-enrich').checked=state.config.auto_enrich!==false;
    $('#sidebar-name').textContent=p.name||'Mon espace';
    $('#sidebar-target').textContent=p.target||p.city||'Mon projet professionnel';
    $('#hero-target').textContent=p.target||'TON PROCHAIN CHAPITRE';
    $('#home-mobility').textContent=p.mobility||'Ton projet et tes contraintes restent visibles pour chaque candidature.';
    $('.avatar').textContent=(p.name||'Mon espace').split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase();
    if(!state.feed.search_id){$('#feed-city').value=p.city||'Lyon';$('#search-query').value=p.query||'employé polyvalent';}
    renderSummary();renderResearchSummary();
  }
  function updateMailFields(){
    const f=$('#setup-mail-form');
    $('#setup-password-fields').hidden=f.elements.mail_mode.value!=='direct';
    const provider=f.elements.email_provider.value;
    const verified=state.config[provider+'_verified_at']&&state.config[provider+'_verified_address']===f.elements.address.value;
    $('#setup-mail-status').textContent=f.elements.mail_mode.value==='browser'?'Mode navigateur : connecte ton compte dans Opera. Postuler depuis MoneyScout prépare les PDF puis demande ta confirmation avant le clic d’envoi. Le mode manuel reste disponible.':verified?'Connexion directe vérifiée. Le test n’a envoyé aucun email.':'Connexion directe à vérifier avec un mot de passe d’application autorisé.';
  }
  function mailValues(){
    const f=$('#setup-mail-form'),provider=f.elements.email_provider.value;
    return {email_provider:provider,mail_mode:f.elements.mail_mode.value,[provider+'_address']:f.elements.address.value.trim(),[provider+'_password']:f.elements.password.value};
  }
  async function openSite(site){
    if(!bridgeReady)throw new Error('Installe le module du navigateur depuis le bandeau MoneyScout Cloud puis recharge la page.');
    await bridgeCall('CONNECT_SITE',{site});
    if(sites[site])opened.add(site);
    const label=$('#setup-site-'+site);if(label)label.textContent='Onglet ouvert · termine la connexion sur le site puis reviens ici.';
  }
  async function upload(form,target){
    if(uploading)return;
    const file=form.elements.file.files[0];
    if(!file||file.size>8000000)throw new Error('Choisis un CV PDF de moins de 8 Mo.');
    uploading=true;
    try{
      const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Le PDF ne peut pas être lu.'));reader.readAsDataURL(file);});
      const result=await api('/api/cv/upload',{profile:form.elements.profile.value,content});
      await refresh();$(target).textContent=result.message;
      toast('CV ajouté. Ton fichier sera disponible comme pièce jointe.');
    }finally{uploading=false;}
  }
  function offerHint(o){
    const r=o.research||{};
    const person=(r.people||[])[0];
    const message=o.form_mandatory?'Formulaire obligatoire indiqué dans le texte':o.email?'Adresse de recrutement publiée disponible':r.status==='unavailable'?'Recherche de coordonnées interrompue ou non lisible':r.status==='none'?'Aucune coordonnée vérifiable trouvée pour le moment':'Analyse et recherche de contacts en cours…';
    return `<div class="research-hint">${esc(message)}${person?' · '+esc(person.name)+' (profil à vérifier)':''}</div>`;
  }
  function renderResearchSummary(){
    const e=state.feed.enrichment||{counts:{},total:0},c=e.counts||{};
    $('#enrichment-status').textContent=e.total?`${c.done||0}/${e.total} lectures terminées · ${e.people||0} profil(s) public(s) · ${e.emails||0} adresse(s) publiée(s). ${c.needs_user||c.unavailable?'Certains sites demandent une intervention ou ne sont pas lisibles. ':''}${state.config.auto_enrich===false?'La recherche automatique est en pause.':'Les tâches avancent progressivement.'}`:'Les descriptions et coordonnées seront recherchées après l’arrivée des offres.';
    if(e.messages?.length)$('#enrichment-status').textContent+=' '+e.messages[0];
    $('#toggle-enrichment').textContent=state.config.auto_enrich===false?'Reprendre la recherche auto':'Mettre en pause la recherche auto';
  }
  async function pump(){
    if(pumping||!window.JobBotReady||!bridgeReady||!state.config.onboarding_done||state.config.auto_enrich===false)return;
    pumping=true;
    try{const r=await api('/api/enrich/tasks');if(r.tasks.length)await bridgeCall('ENRICH',{tasks:r.tasks});}catch{}finally{pumping=false;}
  }
  async function prioritize(offerId){
    if(window.JobBotCloud&&!bridgeReady)return;
    const r=await api('/api/enrich/start',{offer_id:offerId});
    adoptFeed(r.feed);
    if(bridgeReady&&r.tasks.length)await bridgeCall('ENRICH',{tasks:r.tasks,manual:true});
    else if(!bridgeReady)toast('Ouvre Opera MoneyScout pour lire la description et rechercher les contacts.',true);
  }
  function renderJob(job){
    if(!job?.id)return;
    const offer=state.feed.offers.find(o=>o.offer_id===job.offer_id)||job;
    const a=offer.analysis||job.analysis||{},r=offer.research||job.research||{};
    const people=r.people||[],emails=r.emails||[];
    $('#job-research').innerHTML=`<div class="editor-heading"><div><p class="eyebrow">COMPRENDRE L’OFFRE ET TROUVER LE CONTACT</p><h3>${esc(a.coverage||'Analyse en préparation')}</h3></div>${job.offer_id?`<button class="secondary" type="button" data-priority-research="${esc(job.offer_id)}">Analyser et chercher maintenant</button>`:''}</div><div class="analysis-grid">${(a.requirements||[]).map(item=>`<div class="analysis-item"><strong>${esc(item.label)}</strong><p>${esc(item.text)}</p></div>`).join('')}</div>${a.matching_skills?.length?`<p class="small">Compétences déclarées en lien avec le texte : ${esc(a.matching_skills.join(', '))}.</p>`:''}<p class="small muted">${(a.cautions||[]).map(esc).join(' ')}</p><div class="contact-match"><h3>Personne à contacter</h3>${people.length?people.map(p=>`<p><a href="${esc(p.profile_url)}" target="_blank" rel="noreferrer"><strong>${esc(p.name)}</strong> · LinkedIn ↗</a><br>${esc(p.role)}<br><span class="muted">${esc(p.context)}</span><br><a href="${esc(p.source_url)}" target="_blank" rel="noreferrer">Voir la source ↗</a></p>`).join(''):'<p class="muted">Aucune personne identifiée pour le moment. Une recherche en cours ou inaccessible n’est pas une absence de recruteur.</p>'}</div><div class="contact-match"><h3>Adresse de candidature</h3>${emails.length?emails.map(e=>`<p><strong>${esc(e.email)}</strong><br>${esc(e.association)}<br><a href="${esc(e.source_url)}" target="_blank" rel="noreferrer">Page publiant l’adresse ↗</a><br><span class="muted">${esc(e.context)}</span>${e.scope==='company'?`<br><button class="secondary" type="button" data-use-email="${esc(e.email)}" data-email-source="${esc(e.source_url)}">Utiliser pour cette offre après vérification</button>`:''}</p>`).join(''):'<p class="muted">Aucune adresse publiée et vérifiable pour l’instant. MoneyScout ne déduit pas une adresse depuis le nom d’une personne.</p>'}<p class="small muted">Une adresse de recrutement d’entreprise n’est pas automatiquement l’adresse personnelle du profil LinkedIn affiché.</p>${offer.form_mandatory?'<p><strong>Le texte demande un formulaire obligatoire. Termine cette candidature sur le site.</strong></p>':''}</div>`;
    const f=$('#job-form');
    if(offer.email&&!f.elements.email.value&&!f.elements.email.dataset.userEdited){f.elements.email.value=offer.email;f.elements.email_source.value=offer.email_source;}
    if(offer.form_mandatory)$('#send-email').hidden=true;
  }
  async function downloadLetter(){
    const job=await saveForm();
    const response=await fetch('/api/letter?id='+encodeURIComponent(job.id),{headers:{'X-JobBot-Token':token}});
    if(!response.ok){const err=await response.json();throw new Error(err.error||'Le PDF ne peut pas être créé.');}
    const url=URL.createObjectURL(await response.blob());
    const a=document.createElement('a');a.href=url;a.download='Lettre de motivation - '+job.company.replace(/[<>:"/\\|?*]/g,'')+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
    toast('Lettre PDF téléchargée. Joins-la à ta candidature si tu utilises le site ou ta messagerie.');
  }
  document.addEventListener('click',event=>{
    const next=event.target.closest('[data-setup-step]');if(next)showStep(next.dataset.setupStep);
    const connect=event.target.closest('[data-connect-site]');if(connect)run(connect,()=>openSite(connect.dataset.connectSite));
    const useEmail=event.target.closest('[data-use-email]');
    if(useEmail){const f=$('#job-form');f.elements.email.value=useEmail.dataset.useEmail;f.elements.email_source.value=useEmail.dataset.emailSource;f.elements.email.dataset.userEdited='1';toast('Adresse ajoutée à cette candidature. Vérifie le destinataire avant l’envoi.');}
    const research=event.target.closest('[data-priority-research]');if(research)run(research,()=>prioritize(research.dataset.priorityResearch));
  });
  $('#setup-profile-form').addEventListener('input',()=>{profileDirty=true;});
  $('#setup-profile-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await api('/api/profile',Object.fromEntries(new FormData(event.target)));profileDirty=false;await refresh();if(window.JobBotCloud){acceptState(await api('/api/setup/finish',{}));renderAll();go('offres');$('#feed-city').value=state.profile.city;$('#search-query').value=state.profile.query;await refreshFeed();return;}showStep(1);});});
  for(const [id,target] of [['setup-upload-form','#setup-cv-result'],['cv-upload-form','#cv-upload-result']])$('#'+id).addEventListener('submit',event=>{event.preventDefault();run(event.submitter,()=>upload(event.target,target));});
  $('#setup-mail-form').addEventListener('change',event=>{
    if(event.target.name==='email_provider'){
      const f=event.currentTarget;f.elements.address.value=state.config[f.elements.email_provider.value+'_address']||state.profile.contact_email||'';f.elements.password.value='';
    }
    updateMailFields();
  });
  $('#setup-mail-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await api('/api/config',mailValues());await refresh();showStep(2);});});
  $('#setup-mail-verify').addEventListener('click',()=>run($('#setup-mail-verify'),async()=>{
    const values=mailValues();const result=await api(values.email_provider==='gmail'?'/api/gmail/connect':'/api/yahoo/connect',values);
    await refresh();$('#setup-mail-status').textContent=result.message;toast(result.message);
  }));
  $('#setup-open-mail').addEventListener('click',()=>run($('#setup-open-mail'),()=>openSite($('#setup-mail-form').elements.email_provider.value)));
  $('#setup-finish').addEventListener('click',()=>run($('#setup-finish'),async()=>{
    await api('/api/config',{auto_enrich:$('#setup-auto-enrich').checked});
    acceptState(await api('/api/setup/finish',{}));renderAll();go('offres');
    if(bridgeReady)await bridgeCall('PAUSE_ENRICH',{paused:state.config.auto_enrich===false});
    $('#feed-city').value=state.profile.city||'Lyon';$('#search-query').value=state.profile.query||'employé polyvalent';
    await refreshFeed();
  }));
  $('#toggle-enrichment').addEventListener('click',()=>run($('#toggle-enrichment'),async()=>{
    await api('/api/config',{auto_enrich:state.config.auto_enrich===false});await refresh();
    if(bridgeReady)await bridgeCall('PAUSE_ENRICH',{paused:state.config.auto_enrich===false});
    toast(state.config.auto_enrich?'Recherche automatique reprise.':'Les nouvelles tâches sont en pause. Les lectures déjà commencées peuvent se terminer.');pump();
  }));
  $('#generate-letter').addEventListener('click',()=>run($('#generate-letter'),async()=>{
    const previous=$('#job-form').elements.letter_text.value;
    if(previous.trim()&&!confirm('Remplacer le texte actuel par une nouvelle lettre rédigée à partir de l’offre et de ton profil ?'))return;
    const job=await saveForm(),result=await api('/api/letter/draft',{id:job.id});
    $('#job-form').elements.letter_text.value=result.letter_text;toast('Lettre rédigée. Relis-la avant de la joindre.');
  }));
  $('#download-letter').addEventListener('click',()=>run($('#download-letter'),downloadLetter));
  $('#job-form').elements.email.addEventListener('input',event=>event.target.dataset.userEdited='1');
  $('#verify-current-mail').addEventListener('click',()=>run($('#verify-current-mail'),async()=>{
    const f=$('#config-form'),provider=f.elements.email_provider.value;
    const result=await api(provider==='gmail'?'/api/gmail/connect':'/api/yahoo/connect',{[provider+'_address']:f.elements[provider+'_address'].value,[provider+'_password']:f.elements[provider+'_password'].value});await refresh();toast(result.message);
  }));
  window.JobBotWorkspace={renderSetup,renderJob,renderResearchSummary,offerHint,pump,prioritize};
  function initialize(){renderSetup();renderFeed();if(!state.config.onboarding_done){showStep(0);}pump();}
  if(window.JobBotReady)initialize();else window.addEventListener('jobbot-ready',initialize,{once:true});
  setInterval(pump,3000);
})();
