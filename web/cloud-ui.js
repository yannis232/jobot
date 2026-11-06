(() => {
  'use strict';
  window.JobBotCloud=true;
  document.body.classList.add('jobbot-cloud');
  let searching=false;
  const content=$('.content');
  content.insertAdjacentHTML('afterbegin',`<div class="cloud-bar"><p><strong>JobBot Cloud · Espace privé</strong><br><span id="cloud-connection">Recherche publique, CV et candidatures depuis ce lien.</span></p><div class="actions"><button class="secondary" id="cloud-help-toggle">Options avancées</button><button class="secondary" id="cloud-logout">Me déconnecter</button></div></div><section class="cloud-help" id="cloud-help" hidden><h2>Choisis ton mode de recherche.</h2><label>Mode<select id="cloud-search-mode"><option value="public">Simple · sans module et sans connexion aux sites</option><option value="browser">Navigateur connecté · module facultatif</option></select></label><p>Le mode simple lit les annonces accessibles publiquement depuis l’hébergement. Certains sites le limitent : leur état est indiqué, et leurs résultats ne sont pas garantis. La première page est lue, avec 30 annonces maximum par source. Pour envoyer un dossier sans module, télécharge tes PDF puis termine sur le site ou dans ta messagerie.</p><details><summary>Activer le pilotage des sites et des envois (facultatif)</summary><p>Le module reste disponible pour lire les pages de ton navigateur et préparer les envois dans tes comptes connectés. Il n’est plus nécessaire pour démarrer.</p><ol><li><button class="secondary" id="cloud-download">Télécharger le module facultatif</button> et extraire le ZIP.</li><li>Ouvrir <code>opera://extensions</code> ou <code>chrome://extensions</code>.</li><li>Activer le mode développeur, choisir Charger l’extension non empaquetée et le dossier <strong>JobBot_Cloud_Extension</strong>.</li><li>Recharger JobBot et choisir le mode Navigateur connecté ci-dessus. Les connexions se font directement sur les sites lorsqu’ils les demandent.</li></ol><p>Les cookies et mots de passe des plateformes restent dans ton navigateur.</p></details></section>`);
  $('#cloud-help-toggle').addEventListener('click',()=>{$('#cloud-help').hidden=!$('#cloud-help').hidden;});
  $('#cloud-download').addEventListener('click',()=>run($('#cloud-download'),async()=>{
    const response=await fetch('/api/extension.zip',{headers:{'X-JobBot-Token':token}});
    if(!response.ok)throw new Error('Reconnecte-toi à ton JobBot pour télécharger le module.');
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='JobBot_Cloud_Extension.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }));
  $('#cloud-logout').addEventListener('click',()=>run($('#cloud-logout'),async()=>{window.postMessage({channel:'jobbot-request',id:'logout-'+Date.now(),command:'ACCOUNT_LOGOUT',payload:{}},location.origin);await api('/logout',{});location.assign('/login');}));
  fetch('/api/account',{headers:{'X-JobBot-Token':token}}).then(async response=>{
    if(!response.ok)return;
    const account=await response.json();
    $('.cloud-bar strong').textContent='JobBot Cloud · '+account.username;
    const detail=document.createElement('small');detail.className='cloud-account';
    detail.textContent=(account.used_bytes/1048576).toFixed(1)+' Mo utilisés / '+account.quota_mb+' Mo'+(account.is_owner?' · '+account.account_count+'/'+account.max_accounts+' comptes':'');
    $('.cloud-bar p').append(document.createElement('br'),detail);
  }).catch(()=>{});

  // Deux champs suffisent pour commencer. Les faits du profil restent disponibles
  // dans une section facultative, sans effacer un profil déjà renseigné.
  $('#view-bienvenue .welcome-hero h1').innerHTML='Ton prochain poste.<br>On commence ?';
  $('#view-bienvenue .welcome-hero > p:not(.eyebrow)').textContent='Un métier, une ville. Ajoute ton CV quand tu veux pour classer les offres.';
  const form=$('#setup-profile-form');
  const details=document.createElement('details');details.className='cloud-profile-details';
  details.innerHTML='<summary>Mon profil pour les candidatures (facultatif pour chercher)</summary>';
  const primary=document.createElement('div');primary.className='form-grid';
  for(const name of ['query','city']){const input=form.elements[name];input.required=true;primary.append(input.closest('label'));}
  const fields=[...form.children].filter(el=>!el.classList.contains('panel-title')&&el.tagName!=='BUTTON');
  for(const el of fields)details.append(el);
  for(const el of details.querySelectorAll('[required]'))el.required=false;
  form.querySelector('h2').textContent='Qu’est-ce que tu recherches ?';
  form.querySelector('button').textContent='Enregistrer et trouver des offres →';
  form.insertBefore(primary,form.querySelector('button'));form.insertBefore(details,form.querySelector('button'));
  $('#setup-upload-form h2').textContent='Ton CV · facultatif pour commencer';
  $('#setup-upload-form > p').textContent='Un PDF suffit pour comparer les offres. Les autres versions de ton CV pourront être ajoutées plus tard.';
  $('#setup-upload-form').insertAdjacentHTML('beforeend','<p class="small muted">Tu peux aussi commencer sans CV. La correspondance avec ton parcours apparaîtra après son ajout.</p>');

  const originalRefresh=refreshFeed;
  refreshFeed=async function(){
    if($('#cloud-search-mode').value==='browser'){
      if(!bridgeReady)throw new Error('Le mode Navigateur connecté utilise le module facultatif. Choisis le mode Simple pour chercher sans installation.');
      return originalRefresh();
    }
    if(searching)return;
    const query=$('#search-query').value.trim(),city=$('#feed-city').value.trim();
    if(!query||!city)throw new Error('Indique un métier et une ville.');
    searching=true;autoStarted=true;
    try{
      const feed=await api('/api/public/search/start',{query,city});
      state.feed=feed;resetFeedFilters();renderHome();renderFeed();
      // Requêtes séparées : l’unique worker gratuit reste disponible entre deux sites.
      for(const source_id of Object.keys(sites)){
        const next=await api('/api/public/search/site',{search_id:feed.search_id,source_id});
        if(next.search_id!==feed.search_id)break;
        adoptFeed(next);
      }
      const n=state.feed.offers.length;
      toast(n?n+' offre(s) publique(s) trouvée(s). Consulte l’état des sources.':'Les sources ne fournissent pas d’annonces lisibles pour cette recherche. Tu peux les consulter avec les liens indiqués.',!n);
    }finally{searching=false;renderFeed();}
  };
  const originalProgress=renderSiteProgress;
  renderSiteProgress=function(){
    if(state.feed.access_mode!=='public')return originalProgress();
    $('#site-progress').innerHTML=Object.entries(sites).map(([id,label])=>{
      const s=state.feed.sources?.[id]||{};
      const status=s.status==='opening'?'En attente…':s.status==='results'?'Lecture publique':'Lecture limitée';
      return `<article class="site-state ${esc(s.status)}"><div><strong>${esc(label)}</strong><span class="badge">${status}</span></div><p>${s.count?'<b>'+s.count+' offre(s)</b> · ':''}${esc(s.status==='opening'?'La recherche continue, sans connexion.':s.message||'Source non accessible.')}</p>${s.url?`<a class="text-button" href="${esc(s.url)}" target="_blank" rel="noreferrer">Consulter ce site ↗</a>`:''}</article>`;
    }).join('');
  };
  const originalFeed=renderFeed;
  renderFeed=function(){originalFeed();cloudSetup();
    if(state.feed.access_mode==='public'){
      const completed=Object.values(state.feed.sources||{}).filter(s=>s.status!=='opening').length;
      $('#feed-status').textContent=completed+'/8 sources vérifiées'+(searching?' · en cours…':'');
      if(!state.feed.offers.length&&!state.feed.running)$('#opportunity-list').innerHTML=empty('Aucune annonce publique lisible.','Les accès peuvent être limités par les sites ou l’hébergement gratuit. Consulte l’état des sources ci-dessus ; ce résultat ne prouve pas l’absence de postes.',false);
    }
  };
  const oldHint=JobBotWorkspace.offerHint;
  JobBotWorkspace.offerHint=o=>state.feed.access_mode==='public'&&!bridgeReady?'<div class="research-hint">Annonce publique · vérifie la description et la disponibilité dans la source. Le classement utilise le texte disponible.</div>':oldHint(o);

  function cloudSetup(){
    $('#setup-profile-form .badge').textContent='DANS TON ESPACE PRIVÉ';
    $('#open-jobbot-browser').hidden=true;
    $('#browser-status').textContent=$('#cloud-search-mode').value==='public'?'Mode simple · aucune installation ni connexion aux plateformes pour lancer la recherche.':bridgeReady?'Navigateur connecté.':'Module facultatif à activer pour ce mode.';
    $('#cloud-connection').textContent='Recherche publique, CV et suivi depuis ce lien.';
    $('#search-all').textContent='Trouver des offres';$('#refresh-feed').textContent='↻ Actualiser les offres';
    $('#view-offres .search-scope').textContent='Lecture des annonces publiques accessibles. Certaines sources bloquent l’accès de l’hébergement gratuit : consulte leur état ci-dessous. Le site peut élargir le lieu demandé.';
    $('#site-progress').setAttribute('aria-label','État des huit sources');
    for(const option of $$('#feed-employer option'))if(!option.value)option.textContent='Tous les sites';
    for(const el of $$('input[name="mail_mode"][value="direct"]')){el.disabled=true;el.closest('label').hidden=true;}
    for(const name of ['gmail_password','yahoo_password','openai_key','telegram_token','telegram_chat','watch_mail'])for(const el of $$('[name="'+name+'"]')){el.disabled=true;const label=el.closest('label');if(label)label.hidden=true;}
    for(const id of ['test-email','test-gmail','test-telegram','check-mail','setup-mail-verify','send-email','yahoo-connect','gmail-connect']){const el=$('#'+id);if(el)el.hidden=true;}
    $('#setup-password-fields').hidden=true;
    $('#express-profile').hidden=!bridgeReady;
    if(!bridgeReady){
      $('#send-browser').hidden=true;$('#send-linkedin').hidden=true;$('#express-profile').hidden=true;
      $('#enrichment-status').textContent='Tes CV sont comparés au texte disponible. Sans module, les contacts LinkedIn et les envois se terminent sur les sites concernés.';
      $('#toggle-enrichment').hidden=true;
      for(const p of $$('#opportunity-list .board-offer > div > p.small.muted'))if(p.textContent.includes('en préparation'))p.textContent='Aperçu public · analyse limitée au texte disponible.';
      for(const b of $$('[data-priority-research]'))b.hidden=true;
    }
  }
  $('#view-yahoo > section.panel:first-child h2').textContent='Ta messagerie habituelle.';
  $('#view-yahoo > section.panel:first-child > p').textContent='JobBot prépare le message, le CV et la lettre PDF. Ouvre Yahoo ou Gmail, ajoute les documents et termine l’envoi. Le mode simple ne nécessite aucune connexion à la messagerie pour chercher des offres.';
  $('#view-yahoo > section.panel:first-child > p.small').textContent='Avec le module facultatif, le mode avancé peut aussi préparer les pièces jointes dans les formulaires compatibles.';
  $('#cloud-search-mode').addEventListener('change',cloudSetup);
  const all=renderAll;renderAll=function(){all();cloudSetup();};
  const oldOpen=openJob;openJob=function(job){oldOpen(job);cloudSetup();};
  const oldContact=openContact;openContact=async function(person){await oldContact(person);cloudSetup();};
  window.addEventListener('jobbot-ready',cloudSetup);
  window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.channel==='jobbot-bridge')cloudSetup();});
  cloudSetup();
})();
