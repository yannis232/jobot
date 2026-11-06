/* Fonctions réservées à l'édition personnelle : CV adaptés, carte, express et relances. */
(() => {
  'use strict';
  let map=null,markers=null,mapResult=null,mapRevision='',mapBusy=false;
  const autoSending=new Set();
  $('#view-guide').insertAdjacentHTML('beforebegin',`
    <section id="view-carte" class="view" hidden><div class="page-heading"><div><p class="eyebrow">EXPLORER UN LIEU</p><h1>Les offres sur la carte.</h1><p class="muted">Cherche une commune française, puis retrouve les offres dans le rayon choisi.</p></div></div>
    <form id="map-search" class="panel"><div class="form-grid"><label>Commune ou code postal<input name="city" required placeholder="Lyon, Lille, 97600…"></label><label>Métier<input name="query" required placeholder="Technicien informatique…"></label><label>Rayon<select name="radius"><option value="10">10 km</option><option value="25" selected>25 km</option><option value="50">50 km</option><option value="100">100 km</option></select></label></div><div class="actions"><button class="primary">Chercher les offres de ce lieu</button><button type="button" class="secondary" id="map-refresh">Actualiser la carte des résultats</button></div><div id="map-choices" class="actions"></div><p id="map-status" role="status" class="small muted">Les offres apparaissent après lecture des sites. Aucun emplacement n’est inventé.</p></form>
    <div class="map-layout"><div><div id="offers-map" aria-label="Carte interactive des offres"></div><p class="small muted">Positions au centre des communes, distances à vol d’oiseau. Les lieux inconnus restent dans Trouver des offres.</p></div><div id="map-offers" aria-live="polite"></div></div></section>
    <section id="view-relances" class="view" hidden><div class="page-heading"><div><p class="eyebrow">GARDER LE CONTACT</p><h1>Mes relances.</h1><p class="muted">Retrouve les candidatures envoyées sans réponse et prépare un message adapté.</p></div></div><form id="followup-settings" class="panel"><label>Délai par défaut après un envoi (jours)<input name="days" type="number" min="1" max="60" required></label><button class="secondary">Enregistrer le délai</button><p class="small muted">Les rappels apparaissent dans JobBot à partir de cette date. Aucun envoi automatique de relance. En mode navigateur, indique toi-même les réponses reçues pour arrêter les rappels.</p></form><div id="followup-list"></div></section>`);
  $('#view-cv').insertAdjacentHTML('beforeend',`<form id="express-profile" class="panel"><p class="eyebrow">UNE SEULE FOIS POUR LES CANDIDATURES</p><h2>Candidature express</h2><p>Ces informations remplissent les champs reconnus des formulaires, avec ton CV et ta lettre. Connecte-toi aux sites dans Démarrage > Tes sites d’emploi.</p><div class="form-grid"><label>Prénom<input name="first_name" required autocomplete="given-name"></label><label>Nom de famille<input name="last_name" required autocomplete="family-name"></label><label>Email de candidature<input name="contact_email" type="email" required></label><label>Téléphone<input name="phone" autocomplete="tel"></label><label>Adresse<input name="address" autocomplete="street-address"></label><label>Code postal<input name="postcode" autocomplete="postal-code"></label><label>Ville de résidence<input name="city" autocomplete="address-level2"></label><label>Disponibilité réelle<input name="availability" placeholder="À partir du…"></label></div><label class="checkbox"><input name="express" type="checkbox"> Activer l’envoi express : chaque clic sur « Postuler » autorise l’envoi du dossier affiché pour cette offre, après vérification.</label><p class="small muted">Avec cette option, le CV choisi (ou sa variante adaptée validée), la lettre et tes coordonnées sont envoyés lorsque le site le permet. Les questions spécifiques, consentements et vérifications demandent ton intervention. Sans cette option, un aperçu attend ta confirmation.</p><button class="primary">Enregistrer mes informations et mon choix</button><p id="express-status" role="status"></p></form>`);
  $('.letter-editor').insertAdjacentHTML('beforebegin','<section id="ats-panel" class="panel"></section>');
  const originalOpen=openJob;
  openJob=function(job=null){originalOpen(job);renderATS(job);};
  const originalRefresh=refresh;
  refresh=async function(){const result=await originalRefresh();render();return result;};
  const originalGo=go;
  go=function(view){originalGo(view);if(view==='carte'){setupMap();setTimeout(()=>map?.invalidateSize(),100);if(mapResult&&mapRevision!==revision())loadMap().catch(e=>toast(e.message,true));}if(view==='relances')renderRelances();};
  const revision=()=>`${state.feed?.search_id||''}:${state.feed?.revision||0}`;
  function renderATS(job){
    const p=$('#ats-panel');p.hidden=!job?.id;
    if(!job?.id)return;
    const a=job.ats_analysis;
    p.innerHTML=`<div class="editor-heading"><div><p class="eyebrow">UN CV POUR CETTE OFFRE</p><h3>Adapter mon CV et ses mots-clés</h3></div><button type="button" class="secondary" id="adapt-cv" ${job.sent_at?'disabled':''}>✦ Améliorer mon CV pour cette offre</button></div><p class="small muted">Adaptation locale incluse : mots de l’annonce justifiés par ton CV, niveaux conservés, parcours complet et PDF à une colonne. Ton original est conservé. Le passage d’un ATS ne peut pas être garanti.</p>${job.ats_stale?'<p class="match-caution">L’offre ou le CV source a changé : actualise cette adaptation avant de l’utiliser.</p>':''}${a?`<p><strong>Mots repris :</strong> ${a.keywords.map(k=>esc(k.word)+(k.level==='basic'?' (notions)':'')).join(', ')||'Aucun mot-clé supplémentaire justifié.'}</p>${a.missing.length?`<p class="match-caution">Non établi, donc non ajouté : ${a.missing.map(esc).join(', ')}.</p>`:''}${a.provisional?'<p class="match-caution">Adaptation provisoire sur un aperçu : charge la description complète puis actualise.</p>':''}<details><summary>Voir les preuves dans mon CV</summary>${a.keywords.map(k=>`<p><strong>${esc(k.word)}</strong> : ${esc(k.proof)}</p>`).join('')}</details><label>CV adapté · texte modifiable<textarea name="ats_text" rows="15" maxlength="45000" ${job.sent_at?'readonly':''}>${esc(job.ats_text)}</textarea></label><label class="checkbox"><input type="checkbox" name="use_ats" ${job.use_ats?'checked':''} ${job.sent_at?'disabled':''}> Utiliser ce CV adapté pour cette candidature</label><button class="secondary" type="button" id="download-ats">Télécharger le CV adapté PDF</button><p class="small muted">Enregistre ton choix après relecture. Une modification du CV source ou de l’annonce impose une nouvelle adaptation.</p>`:'<p class="muted">Crée la variante, relis-la puis coche son utilisation pour cette candidature.</p>'}`;
  }
  async function startTask(t){
    if(!bridgeReady)throw new Error('Installe le module de navigateur de ton JobBot Cloud puis recharge cette page.');
    await JobBotDelivery.show(t);
    if(['queued','preparing','needs_user'].includes(t.status))await bridgeCall('DELIVERY_PREPARE',{task:await api('/api/outbox/task?id='+encodeURIComponent(t.id))},15000);
    if(t.express&&t.status==='ready')await autoConfirm(t);
  }
  async function apply(job){
    if(job.sent_at){openJob(job);toast('Cette candidature est déjà envoyée.');return;}
    await startTask(await api('/api/apply/prepare',{id:job.id,express:state.config.express_apply===true}));
  }
  async function autoConfirm(t){
    if(!t.express||t.status!=='ready'||autoSending.has(t.id)||JobBotDelivery.current?.id!==t.id)return;
    autoSending.add(t.id);
    try{await JobBotDelivery.confirm();}catch(e){toast(e.message,true);}
  }
  // Remplace le parcours ancien qui ouvrait uniquement un formulaire vide.
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-apply-offer]');if(!b)return;
    event.preventDefault();event.stopImmediatePropagation();
    run(b,async()=>{if(!bridgeReady&&!window.JobBotCloud)throw new Error('Utilise la fenêtre Opera JobBot.');const j=await api('/api/offer/prepare',{offer_id:b.dataset.applyOffer});await refresh();openJob(j);if(!bridgeReady&&window.JobBotCloud){toast('Dossier préparé : relis ta lettre, télécharge tes PDF puis ouvre l’annonce ou ta messagerie pour envoyer.');return;}await apply(j);});
  },true);
  window.addEventListener('message',event=>{
    if(event.source===window&&event.origin===location.origin&&event.data?.channel==='jobbot-bridge'&&event.data.kind==='delivery'){
      const t=event.data.delivery;
      if(t.kind==='application'&&t.status==='sent')refresh().then(()=>{const j=state.jobs.find(j=>j.id===t.target_id);if(currentJob?.id===j?.id&&$('#job-dialog').open)openJob(j);}).catch(()=>{});
      if(t.express&&t.status==='ready')autoConfirm(t);
    }
  });
  function renderRelances(){
    const jobs=state.jobs.filter(j=>j.sent_at&&j.status==='envoyee').sort((a,b)=>(a.next_followup||'9999').localeCompare(b.next_followup||'9999'));
    $('#followup-count').textContent=jobs.filter(due).length;
    if(document.activeElement?.form!==$('#followup-settings'))$('#followup-settings').elements.days.value=state.config.reminder_days||7;
    $('#followup-list').innerHTML=jobs.map(j=>`<article class="panel"><p class="eyebrow">${due(j)?'À RELANCER':'EN ATTENTE'} · ${esc(j.company)}</p><h3>${esc(j.title)}</h3><p>Envoyée le ${esc(date(j.sent_at))} · ${j.followup_count||0} relance(s)${j.last_followup_at?' · dernière le '+esc(date(j.last_followup_at)):''}</p><label>Date de la prochaine relance<input type="date" data-followup-date="${esc(j.id)}" value="${esc((j.next_followup||'').slice(0,10))}"></label><div class="actions"><button class="primary" data-followup-send="${esc(j.id)}" ${!due(j)?'disabled':''}>Préparer ma relance</button><button class="secondary" data-followup-response="${esc(j.id)}">J’ai reçu une réponse</button><button class="secondary" data-edit="${esc(j.id)}">Ouvrir le dossier</button></div><p class="small muted">${j.email?'Envoi par ta messagerie connectée, après relecture.':'Aucun email de recrutement enregistré : utilise le contact LinkedIn ou l’espace candidat dans la fiche.'}</p></article>`).join('')||empty('Aucune candidature à relancer.','Les candidatures envoyées sans réponse apparaîtront ici.');
  }
  function render(){
    const f=$('#express-profile');
    if(document.activeElement?.form!==f){for(const el of [...f.elements])if(el.name&&el.name!=='express')el.value=state.profile[el.name]||'';f.elements.express.checked=state.config.express_apply===true;}
    const m=$('#map-search');if(!m.elements.city.value)m.elements.city.value=state.profile.city||'Lyon';if(!m.elements.query.value)m.elements.query.value=state.profile.query||'employé polyvalent';
    $('#send-browser').textContent=state.config.express_apply?'Postuler en un clic':'Préparer ma candidature';
    renderRelances();
    if(mapResult&&mapRevision!==revision()&&!$('#view-carte').hidden&&!mapBusy)loadMap().catch(e=>toast(e.message,true));
  }
  function setupMap(){
    if(map||!window.L)return;
    map=L.map('offers-map').setView([46.6,2.3],5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    markers=L.layerGroup().addTo(map);
    // Un clic change le centre de vue ; les recherches utilisent la commune explicitement saisie.
  }
  async function loadMap(code=''){
    if(mapBusy)return;mapBusy=true;
    try{
      const f=$('#map-search');$('#map-status').textContent='Localisation des communes des offres…';
      const data=await api('/api/map',{city:f.elements.city.value,radius:f.elements.radius.value,code:code||mapResult?.center?.code||''});
      if(data.choose){$('#map-choices').innerHTML=data.choose.map(t=>`<button type="button" class="secondary" data-town-code="${esc(t.code)}" data-town-name="${esc(t.name)}">${esc(t.name)} · ${esc(t.department)}</button>`).join('');$('#map-status').textContent=data.message;return;}
      mapResult=data;mapRevision=revision();$('#map-choices').innerHTML='';setupMap();markers.clearLayers();
      const groups=new Map();for(const o of data.offers){const k=o.geo.code;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o);}
      for(const group of groups.values()){
        const t=group[0].geo;
        L.circleMarker([t.lat,t.lon],{radius:Math.min(20,8+group.length),color:'#4524b2',fillColor:'#7459e9',fillOpacity:.85}).addTo(markers).bindTooltip(`${t.name} · ${group.length} offre(s)`).on('click',()=>renderMapOffers(group));
      }
      L.circle([data.center.lat,data.center.lon],{radius:data.radius*1000,color:'#6b4bdd',weight:1,fillOpacity:.04}).addTo(markers);
      map.fitBounds(L.latLng(data.center.lat,data.center.lon).toBounds(data.radius*2200));
      $('#map-status').textContent=`${data.offers.length} offre(s) dans ${data.radius} km · ${data.unlocated} offre(s) sans commune reconnue. ${data.message}`;
      renderMapOffers(data.offers);
    }finally{mapBusy=false;}
  }
  function renderMapOffers(offers){
    $('#map-offers').innerHTML=offers.length?offers.map(o=>`<article class="panel map-offer"><p>${esc(o.provider)} · ${esc(o.geo.name)} · ${o.geo.distance} km</p><h3>${esc(o.title)}</h3><p>${esc(o.company)} · indice ${o.matching?.score??'—'}/100</p><div class="actions"><button class="primary" data-apply-offer="${esc(o.offer_id)}">Postuler</button><button class="secondary" data-prepare-offer="${esc(o.offer_id)}">CV et analyse</button></div></article>`).join(''):empty('Aucune offre localisée ici.','La recherche continue dans les sites. Actualise la carte quand les annonces sont arrivées.');
  }
  $('#express-profile').addEventListener('submit',event=>{event.preventDefault();const f=event.currentTarget;run(f.querySelector('button'),async()=>{const values=Object.fromEntries(new FormData(f));delete values.express;await api('/api/profile',values);await api('/api/config',{express_apply:f.elements.express.checked});await refresh();$('#express-status').textContent='Informations enregistrées. '+(state.config.express_apply?'Ton clic sur Postuler autorisera l’envoi vérifié.':'Un aperçu attendra ta confirmation.');});});
  $('#followup-settings').addEventListener('submit',event=>{event.preventDefault();run(event.currentTarget.querySelector('button'),async()=>{await api('/api/config',{reminder_days:Number($('#followup-settings').elements.days.value)});await refresh();toast('Délai enregistré pour les prochains envois. Les dates existantes restent modifiables ci-dessous.');});});
  $('#map-search').addEventListener('submit',event=>{event.preventDefault();run(event.currentTarget.querySelector('button'),async()=>{const f=$('#map-search');if(window.JobBotCloud){$('#search-query').value=f.elements.query.value;$('#feed-city').value=f.elements.city.value;await refreshFeed();await loadMap();return;}if(!bridgeReady)throw new Error('Utilise la fenêtre Opera JobBot pour chercher sur les sites.');const feed=await api('/api/search/start',{query:f.elements.query.value,city:f.elements.city.value});state.feed=feed;bridgeSearchId=feed.search_id;await bridgeCall('START',{search_id:feed.search_id,sites:Object.entries(feed.sources).filter(([,s])=>s.url).map(([id,s])=>({id,url:s.url}))},20000);await loadMap();});});
  $('#map-refresh').addEventListener('click',()=>run($('#map-refresh'),()=>loadMap()));
  document.addEventListener('change',event=>{const id=event.target.dataset.followupDate;if(id)run(null,async()=>{if(!event.target.value)return;await api('/api/job',{id,next_followup:new Date(event.target.value+'T09:00:00').toISOString()});await refresh();toast('Date de relance mise à jour.');});});
  document.addEventListener('click',event=>{
    const a=event.target.closest('#adapt-cv');if(a)run(a,async()=>{const j=await saveForm();const changed=await api('/api/cv/adapt',{id:j.id});await refresh();openJob(changed);$('#ats-panel').scrollIntoView({block:'start'});});
    const d=event.target.closest('#download-ats');if(d)run(d,async()=>{const j=await saveForm();const r=await fetch('/api/cv/adapted?id='+encodeURIComponent(j.id),{headers:{'X-JobBot-Token':token}});if(!r.ok)throw new Error((await r.json()).error);const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='CV_adapte_'+j.id+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);});
    const b=event.target.closest('[data-followup-send]');if(b)run(b,async()=>{if(!bridgeReady)throw new Error('Utilise la fenêtre Opera JobBot.');await startTask(await api('/api/followup/prepare',{id:b.dataset.followupSend}));await refresh();});
    const r=event.target.closest('[data-followup-response]');if(r)run(r,async()=>{await api('/api/job',{id:r.dataset.followupResponse,status:'reponse'});await refresh();toast('Réponse enregistrée : les relances sont arrêtées pour cette candidature.');});
    const t=event.target.closest('[data-town-code]');if(t)run(t,()=>{ $('#map-search').elements.city.value=t.dataset.townName;return loadMap(t.dataset.townCode);});
  });
  window.JobBotPersonal={apply,render,renderATS};
  window.addEventListener('jobbot-ready',render);
  render();
})();
