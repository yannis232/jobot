/* Comparaisons de CV et parcours d'envoi avec le navigateur connecté. */
(() => {
  'use strict';
  let activeDelivery=null;
  $('#view-offres h1').innerHTML='Les offres<br>qui te correspondent.';
  $('#view-offres .page-heading .muted').textContent='Comparées à tes CV et classées par correspondance, avec leur lettre et leurs contacts.';
  const filter=$('#feed-filter').closest('.filter-bar');
  filter.insertAdjacentHTML('afterbegin','<select id="feed-cv" aria-label="CV utilisé pour classer"><option value="">Comparer tous mes CV</option></select><select id="feed-order" aria-label="Ordre des offres"><option value="match">Meilleure correspondance CV</option><option value="date">Plus récentes</option></select><select id="feed-match" aria-label="Correspondance minimum"><option value="0">Tous les niveaux</option><option value="50">Indice de 50 ou plus</option><option value="70">Indice de 70 ou plus</option></select>');
  $('#feed-update').insertAdjacentHTML('beforebegin','<p id="matching-explanation" class="small muted"></p>');
  $('#job-assessment').insertAdjacentHTML('beforebegin','<section id="cv-comparison" class="panel cv-comparison" hidden></section>');
  $('#open-gmail').insertAdjacentHTML('beforebegin','<button type="button" class="primary" id="send-browser">Postuler depuis MoneyScout</button>');
  $('#open-gmail').classList.replace('primary','secondary');
  $('#open-linkedin-message').insertAdjacentHTML('beforebegin','<button type="button" class="primary" id="send-linkedin">Préparer l’envoi depuis MoneyScout</button>');
  $('#open-linkedin-message').classList.replace('primary','secondary');
  $('#view-yahoo').insertAdjacentHTML('afterbegin','<section class="panel"><p class="eyebrow">SANS MOT DE PASSE D’APPLICATION</p><h2>Ton compte ouvert dans Opera.</h2><p>Connecte-toi toi-même à Yahoo ou Gmail dans la fenêtre MoneyScout. Dans une offre, <strong>Postuler depuis MoneyScout</strong> prépare le texte, le CV recommandé et la lettre PDF. Le programme vérifie le destinataire et le dossier, puis attend ton clic de confirmation.</p><div class="actions"><button class="primary" type="button" data-connect-webmail="yahoo">Ouvrir Yahoo pour me connecter</button><button class="secondary" type="button" data-connect-webmail="gmail">Ouvrir Gmail pour me connecter</button></div><p class="small muted">Si le site ne permet pas de vérifier le dossier ou demande une intervention, MoneyScout garde le brouillon et te laisse reprendre dans son onglet. Les réglages ci-dessous concernent l’autre mode, l’envoi SMTP avec mot de passe d’application.</p></section>');
  $('#contact-form .actions').insertAdjacentHTML('afterend','<p class="small muted">L’envoi depuis MoneyScout utilise la conversation du profil exact dans Opera. Tu relis le texte ici et confirmes chaque envoi. Si LinkedIn ne propose pas Message avec ton compte, le programme le signale.</p>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="delivery-dialog"><div class="dialog-header"><h2>Ton envoi depuis MoneyScout</h2><button class="icon-button" type="button" id="delivery-close" aria-label="Fermer">×</button></div><div id="delivery-content"></div><p class="connection-result" role="status" id="delivery-status"></p><div class="actions"><button class="secondary" id="delivery-open" type="button">Voir l’onglet de préparation</button><button class="secondary" id="delivery-retry" type="button">Reprendre la préparation</button><button class="secondary" id="delivery-cancel" type="button">Annuler la préparation</button></div><div class="dialog-footer"><button class="primary" id="delivery-confirm" type="button" disabled>Confirmer cet envoi</button></div></dialog>');
  function row(offer){const key=$('#feed-cv').value;return key?offer.matching?.profiles?.find(p=>p.profile===key):offer.matching?.profiles?.[0];}
  function sort(a,b){
    if($('#feed-order').value==='date')return String(b.posted||'').localeCompare(String(a.posted||''));
    return (row(b)?.score??-1)-(row(a)?.score??-1)||(row(b)?.order_score??-1)-(row(a)?.order_score??-1)||String(b.posted||'').localeCompare(String(a.posted||''));
  }
  function card(offer){
    const r=row(offer);if(!r)return '';
    const score=r.score==null?'CV à analyser':`${r.score}/100`;
    return `<div class="match-summary"><strong class="match-badge ${r.score>=70?'match-high':''}">${esc(score)}</strong><div><strong>${esc(r.label)}</strong><p class="small">${r.matched?.length?'En commun : '+esc(r.matched.slice(0,4).join(', ')):'Peu de compétences communes explicites.'}</p>${r.missing?.length?`<p class="small muted">Non établi dans ce CV : ${esc(r.missing.slice(0,3).join(', '))}.</p>`:''}${r.cautions?.length?`<p class="small match-caution">${esc(r.cautions.slice(0,2).join(' '))}</p>`:''}</div></div>`;
  }
  function controls(){
    const selected=$('#feed-cv').value;
    $('#feed-cv').innerHTML='<option value="">Comparer tous mes CV</option>'+Object.entries(state.profiles).map(([id,p])=>`<option value="${esc(id)}">${esc(p.label)}</option>`).join('');
    $('#feed-cv').value=selected;
    const count=Object.values(state.profiles).filter(p=>p.analysis?.status==='read').length;
    $('#matching-explanation').textContent=count?`${count} CV analysé(s). Par défaut, les offres les plus proches de leur contenu arrivent en premier. L’indice est indicatif ; une carte incomplète reste provisoire.`:'Ajoute un CV PDF contenant du texte pour comparer les offres. Aucun score de correspondance n’est inventé pour un CV illisible.';
    for(const [id,p] of Object.entries(state.profiles)){
      const link=$(`#cv-grid a[href="/cv/${encodeURIComponent(p.cv)}"]`),parent=link?.closest('article');
      if(parent&&!parent.querySelector('.cv-read-status'))parent.insertAdjacentHTML('beforeend',`<p class="small cv-read-status">${p.analysis?.status==='read'?`${p.analysis.word_count} mots lus pour les comparaisons.`:esc(p.analysis?.warning||'CV à ajouter.')}</p>`);
    }
  }
  function renderJob(job){
    const panel=$('#cv-comparison');panel.hidden=!job?.matching;
    $('#send-browser').hidden=!job?.id||!!job.sent_at||job.status==='envoi_incertain';
    if(!job?.matching)return;
    window.JobBotPersonal?.renderATS(job);
    panel.innerHTML=`<h3>Cette offre face à chacun de tes CV</h3><p class="small muted">Le CV recommandé est ${esc(job.matching.label)}. Tu peux choisir un autre PDF.</p><div class="cv-compare-list">${job.matching.profiles.map(r=>`<div><span><strong>${esc(r.label)}</strong><small>${r.score==null?'Texte à analyser':r.score+'/100'}${job.profile===r.profile?' · CV sélectionné':''}</small></span><button type="button" class="secondary" data-choose-cv="${esc(r.profile)}" ${r.status!=='read'?'disabled':''}>Choisir ce CV</button></div>`).join('')}</div>${job.letter_stale?'<p class="match-caution">Le CV a changé : actualise ou adapte la lettre avant de la joindre.</p>':''}`;
  }
  async function showDelivery(t){
    activeDelivery=t;
    $('#delivery-content').innerHTML=`<p><strong>${t.kind==='email'?'À':t.kind==='application'?'Poste':'Profil'} :</strong> ${esc(t.recipient)} · ${esc(t.company)}</p>${t.kind==='application'?`<p><strong>Site :</strong> ${esc(t.provider)}<br><strong>Pièces jointes :</strong> ${t.files.map(esc).join(' · ')}</p><p>${Object.entries(t.fields||{}).filter(([,v])=>v).map(([,v])=>esc(v)).join(' · ')}</p><p><a href="${esc(t.url)}" target="_blank" rel="noreferrer">Vérifier le formulaire ↗</a></p>`:t.kind==='email'?`<p><strong>Compte expéditeur :</strong> ${esc(t.sender)}<br><strong>Objet :</strong> ${esc(t.subject)}<br><strong>Pièces jointes :</strong> ${t.files.map(esc).join(' · ')}</p>`:`<p><a href="${esc(t.url)}" target="_blank" rel="noreferrer">Vérifier le profil LinkedIn ↗</a></p>`}<pre>${esc(t.body)}</pre>`;
    updateDelivery(t);
    if(!$('#delivery-dialog').open)$('#delivery-dialog').showModal();
  }
  function updateDelivery(t){
    activeDelivery=t;$('#delivery-status').textContent=t.message||t.status;
    $('#delivery-confirm').disabled=t.status!=='ready';
    $('#delivery-cancel').disabled=['sending','uncertain','sent'].includes(t.status);
    $('#delivery-retry').hidden=!['queued','preparing','needs_user'].includes(t.status);
    $('#delivery-confirm').textContent=t.status==='sent'?'Envoi confirmé par le site':t.status==='uncertain'?'Résultat à vérifier dans le site':t.status==='sending'?'Attente de confirmation…':'Confirmer cet envoi';
  }
  async function prepareDelivery(kind,id,jobId=''){
    if(!bridgeReady)throw new Error('Active le module du navigateur de ton MoneyScout Cloud avant de préparer un envoi.');
    const t=await api('/api/outbox/prepare',{kind,id,job_id:jobId});await showDelivery(t);
    if(['queued','preparing','needs_user'].includes(t.status))await bridgeCall('DELIVERY_PREPARE',{task:await api('/api/outbox/task?id='+encodeURIComponent(t.id))},15000);
  }
  $('#send-browser').addEventListener('click',()=>run($('#send-browser'),async()=>{const job=await saveForm();if(window.JobBotPersonal)await window.JobBotPersonal.apply(job);else await prepareDelivery('email',job.id);}));
  $('#send-linkedin').addEventListener('click',()=>run($('#send-linkedin'),async()=>{const person=await saveContact();await prepareDelivery('linkedin',person.id,$('#contact-job').value||'');}));
  $('#delivery-close').addEventListener('click',()=>$('#delivery-dialog').close());
  $('#delivery-open').addEventListener('click',()=>run($('#delivery-open'),()=>bridgeCall('DELIVERY_FOCUS',{id:activeDelivery.id})));
  $('#delivery-retry').addEventListener('click',()=>run($('#delivery-retry'),async()=>{const task=await api('/api/outbox/task?id='+encodeURIComponent(activeDelivery.id));await bridgeCall('DELIVERY_PREPARE',{task},15000);}));
  $('#delivery-cancel').addEventListener('click',()=>run($('#delivery-cancel'),async()=>{updateDelivery(await api('/api/outbox/cancel',{id:activeDelivery.id}));await refresh();}));
  async function confirmDelivery(){
    const command=await api('/api/outbox/confirm',{id:activeDelivery.id,confirm:true});
    updateDelivery({...activeDelivery,status:'sending',message:'Envoi demandé une seule fois. Attente du résultat…'});
    const answer=await bridgeCall('DELIVERY_SEND',command,15000);
    if(answer?.not_clicked){await api('/api/outbox/results',{...command,status:'not_clicked',message:answer.message});await refresh();const latest=state.deliveries.find(t=>t.id===activeDelivery.id);if(latest)updateDelivery(latest);}
    else if(answer?.uncertain)$('#delivery-status').textContent=answer.message;
  }
  $('#delivery-confirm').addEventListener('click',()=>run($('#delivery-confirm'),confirmDelivery));
  window.JobBotDelivery={show:showDelivery,update:updateDelivery,confirm:confirmDelivery,get current(){return activeDelivery;}};
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='jobbot-bridge'||event.data.kind!=='delivery')return;
    const t=event.data.delivery;
    if(activeDelivery?.id===t.id)updateDelivery(t);
    refresh().then(()=>{if(t.status==='sent'&&t.kind==='email'&&currentJob?.id===t.target_id&&$('#job-dialog').open){const saved=state.jobs.find(j=>j.id===t.target_id);if(saved)openJob(saved);}if(t.status==='sent'&&t.kind==='linkedin'&&currentContact?.id===t.target_id){currentContact.status='sent';$('#mark-contact-sent').hidden=true;}}).catch(()=>{});
    if(t.status==='sent')toast('Le site a confirmé l’envoi. Ton suivi est à jour.');
  });
  document.addEventListener('click',event=>{
    const connect=event.target.closest('[data-connect-webmail]');if(connect)run(connect,async()=>{if(!bridgeReady&&window.JobBotCloud){window.open(connect.dataset.connectWebmail==='gmail'?'https://mail.google.com/':'https://mail.yahoo.com/','_blank','noopener');toast('Ajoute ton CV et ta lettre PDF dans ta messagerie, puis termine l’envoi.');return;}if(!bridgeReady)throw new Error('Ouvre MoneyScout avec son lanceur Opera.');await bridgeCall('CONNECT_SITE',{site:connect.dataset.connectWebmail});toast('Termine la connexion dans cet onglet puis reviens à MoneyScout.');});
    const choose=event.target.closest('[data-choose-cv]');if(choose)run(choose,async()=>{const f=$('#job-form');f.elements.profile.value=choose.dataset.chooseCv;f.elements.profile.dispatchEvent(new Event('change'));const job=await saveForm();renderJob(job);toast('CV sélectionné. Actualise la lettre si son contenu doit changer.');});
    const letter=event.target.closest('[data-letter-offer]');if(letter)run(letter,async()=>{const job=await api('/api/offer/prepare',{offer_id:letter.dataset.letterOffer});await refresh();openJob(job);$('.letter-editor').scrollIntoView({block:'start'});});
  });
  for(const id of ['feed-cv','feed-order','feed-match'])$('#'+id).addEventListener('change',renderFeed);
  window.JobBotMatching={row,sort,card,controls,renderJob,allow:o=>(row(o)?.score??0)>=Number($('#feed-match').value)};
  if(window.JobBotReady){controls();renderFeed();}
})();
