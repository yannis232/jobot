(() => {
  'use strict';
  const content=$('.content');
  content.insertAdjacentHTML('afterbegin',`<div class="cloud-bar"><p><strong>JobBot Cloud · Espace privé</strong><br><span id="cloud-connection">CV, suivi, lettres et carte accessibles depuis ce lien.</span></p><div class="actions"><button class="secondary" id="cloud-help-toggle">Connecter mon navigateur</button><button class="secondary" id="cloud-logout">Me déconnecter</button></div></div><section class="cloud-help" id="cloud-help" hidden><h2>Une seule installation pour les sites connectés.</h2><p>Ton JobBot fonctionne sur son hébergement, sans lancer de programme sur ton PC. Pour lire les huit sites et préparer les envois dans tes comptes, ce module relie le site à ton navigateur. Sur téléphone, tu peux consulter ton suivi, importer une annonce, comparer tes CV et préparer tes PDF ; le pilotage des sites nécessite un navigateur de bureau compatible.</p><ol><li><button class="secondary" id="cloud-download">Télécharger le module de MON site JobBot</button> puis extrais le ZIP.</li><li>Dans Opera, ouvre <code>opera://extensions</code> (ou <code>chrome://extensions</code> dans Chrome).</li><li>Active le mode développeur, clique sur Charger l’extension non empaquetée, puis sélectionne le dossier <strong>JobBot_Cloud_Extension</strong>.</li><li>Recharge cette page. Connecte-toi aux sites depuis Démarrage ou Messagerie. Dans Opera, autorise l’accès du module aux résultats de recherche si cette option est demandée.</li></ol><p>Le module est configuré pour l’adresse exacte de ton site. Les cookies et mots de passe des sites restent dans ton navigateur.</p></section>`);
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
    const detail=document.createElement('small');
    detail.className='cloud-account';
    detail.textContent=(account.used_bytes/1048576).toFixed(1)+' Mo utilisés / '+account.quota_mb+' Mo'+(account.is_owner?' · '+account.account_count+'/'+account.max_accounts+' comptes':'');
    $('.cloud-bar p').append(document.createElement('br'),detail);
  }).catch(()=>{});
  const originalRefresh=refreshFeed;
  refreshFeed=async function(){
    if(bridgeReady)return originalRefresh();
    $('#cloud-help').hidden=false;$('#cloud-help').scrollIntoView({block:'start'});
    toast('Installe une seule fois le module pour lancer la recherche sur les huit sites. Tu peux déjà importer une annonce par son lien et utiliser tes CV.',true);
  };
  function cloudSetup(){
    $('#setup-profile-form .badge').textContent='ENREGISTRÉ DANS TON ESPACE PRIVÉ';
    $('#open-jobbot-browser').hidden=true;
    $('#browser-status').textContent=bridgeReady?'Ton navigateur est connecté à ce JobBot Cloud.':'Active le module ci-dessus pour la recherche et les envois dans tes sites connectés.';
    $('#cloud-connection').textContent=bridgeReady?'Navigateur connecté · tes sessions restent sur les sites.':'CV, suivi, lettres et carte accessibles depuis ce lien.';
    for(const el of $$('input[name="mail_mode"][value="direct"]')){el.disabled=true;el.closest('label').hidden=true;}
    for(const name of ['gmail_password','yahoo_password','openai_key','telegram_token','telegram_chat','watch_mail'])for(const el of $$('[name="'+name+'"]')){el.disabled=true;const label=el.closest('label');if(label)label.hidden=true;}
    for(const id of ['test-email','test-gmail','test-telegram','check-mail','setup-mail-verify','send-email','yahoo-connect','gmail-connect']){const el=$('#'+id);if(el)el.hidden=true;}
    $('#setup-password-fields').hidden=true;
  }
  const all=renderAll;renderAll=function(){all();cloudSetup();};
  window.addEventListener('jobbot-ready',cloudSetup);
  window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.channel==='jobbot-bridge')cloudSetup();});
  cloudSetup();
})();
