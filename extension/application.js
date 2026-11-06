/* Formulaires de candidature visibles : identité enregistrée, pièces jointes et clic unitaire. */
(() => {
  'use strict';
  let task=null,form=null,preparing=false,clicked=false,filled=[],fileInputs=[];
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const text=e=>e?.innerText||e?.textContent||'';
  const visible=e=>!!e&&!!e.getClientRects().length;
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible);
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const report=(status,message,verified=false)=>chrome.runtime.sendMessage({kind:'DELIVERY_REPORT',id:task.id,nonce:task.nonce,status,message,verified});
  const label=e=>norm([e.name,e.id,e.autocomplete,e.placeholder,e.getAttribute('aria-label'),...[...(e.labels||[])].map(text)].filter(Boolean).join(' '));
  function issue(){
    if(all('input[type=password]').length)return 'Connecte-toi à ton compte sur ce site, puis reprends la candidature dans MoneyScout.';
    if(/captcha|checkpoint|authwall|\/login|\/connexion/.test(location.pathname)||all('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]').length)return 'Le site demande une connexion ou une vérification. Termine cette étape puis reprends depuis MoneyScout.';
    return '';
  }
  function identity(){
    const title=norm(task.recipient);
    const headings=all('h1,h2,[class*="job-title"],[class*="jobTitle"]');
    return headings.some(e=>norm(text(e)).includes(title))||norm(text(form)).includes(title);
  }
  function assign(e,value){
    if(!value)return;
    if(e.value&&norm(e.value)!==norm(value))throw new Error('Le champ « '+label(e).slice(0,60)+' » contient déjà une autre valeur. Vérifie-le dans le site.');
    const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    filled.push([e,value]);
  }
  function selectForm(){
    const candidates=all('form,[role="dialog"]');
    const withFile=candidates.filter(f=>f.querySelector('input[type=file]')&&f.querySelector('input[type=email],input[name*=mail],input[autocomplete=email]'));
    // Préfère le formulaire interne au dialogue plutôt que deux conteneurs du même formulaire.
    const leaf=withFile.filter(f=>!withFile.some(other=>other!==f&&f.contains(other)));
    return leaf.length===1?leaf[0]:null;
  }
  function sendButton(){
    return all('button,input[type=submit]',form).filter(e=>/^(envoyer(?: ma| la| votre)? candidature|soumettre(?: ma| la)? candidature|postuler|je postule|submit application|send application|candidater)(?:\s*[!→])?$/.test(norm(text(e)||e.value)));
  }
  function remaining(){
    return all('input,textarea,select',form).filter(e=>!e.disabled&&((e.required||e.getAttribute('aria-required')==='true')&&(!e.checkValidity()||(e.type==='checkbox'&&!e.checked)||(e.type==='file'&&!e.files.length))));
  }
  async function attach(){
    const inputs=[...form.querySelectorAll('input[type=file]')].filter(e=>!e.disabled);
    if(!inputs.length)throw new Error('Le site n’affiche aucun emplacement pour le CV.');
    fileInputs=[];
    const assigned=new Map();
    for(let i=0;i<task.attachments.length;i++){
      const a=task.attachments[i],letter=i>0;
      const input=inputs.find(e=>letter?/lettre|motivation|cover/.test(label(e)):/\bcv\b|resume|curriculum/.test(label(e)))||inputs.find(e=>e.multiple)||(letter?null:inputs.length===1?inputs[0]:null);
      if(!input)throw new Error('Ce site ne propose pas de pièce jointe séparée pour la lettre. Le CV est préparé ; joins la lettre PDF ou copie son texte sur le site.');
      if(input.files.length&&![...input.files].every(f=>task.files.includes(f.name)))throw new Error('Une autre pièce jointe est déjà sélectionnée. MoneyScout conserve ce fichier : vérifie-le sur le site.');
      const items=assigned.get(input)||[];items.push(a);assigned.set(input,items);fileInputs.push(input);
    }
    for(const [input,items] of assigned){
      if(input.files.length===items.length&&items.every(a=>[...input.files].some(f=>f.name===a.name)))continue;
      const dt=new DataTransfer();
      for(const a of items){const raw=atob(a.content);dt.items.add(new File([Uint8Array.from(raw,c=>c.charCodeAt(0))],a.name,{type:'application/pdf'}));}
      input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    // Certains sites remplacent le champ après upload ; le nom doit alors être visible.
    await wait(1200);
  }
  function verified(){
    const attached=task.files.every(name=>fileInputs.some(i=>i.isConnected&&[...i.files].some(f=>f.name===name))||text(form).includes(name));
    return form?.isConnected&&identity()&&!issue()&&!remaining().length&&filled.every(([e,v])=>e.isConnected&&norm(e.value)===norm(v))&&attached;
  }
  async function prepare(){
    if(preparing||clicked)return;preparing=true;
    try{
      const problem=issue();if(problem)throw new Error(problem);
      form=selectForm();
      if(!form){
        const heading=all('h1,h2').find(e=>norm(text(e)).includes(norm(task.recipient)));
        if(!heading)throw new Error('Le poste de cette page ne peut pas être vérifié. Ouvre la bonne annonce et reprends la préparation.');
        const buttons=all('button,a[role=button],a',document.querySelector('main')||document.body).filter(e=>/^(postuler|je postule|candidater|candidature simplifiee|postuler maintenant|apply now|easy apply)$/.test(norm(text(e))));
        if(buttons.length!==1)throw new Error('Le formulaire n’est pas reconnu. Ouvre le bouton de candidature dans cet onglet, puis clique sur Reprendre dans MoneyScout.');
        const b=buttons[0];
        if(b.tagName==='A'&&b.href&&new URL(b.href).origin!==location.origin)throw new Error('Le site impose un formulaire externe. Termine-le dans son onglet ; ton CV et ta lettre restent téléchargeables dans MoneyScout.');
        b.click();
        for(let i=0;i<30&&!form;i++){await wait(200);form=selectForm();}
      }
      if(!form||!identity())throw new Error('Impossible de vérifier l’offre associée à ce formulaire. Aucun dossier envoyé.');
      filled=[];
      const f=task.fields;
      for(const e of all('input:not([type=file]),textarea',form)){
        if(e.disabled||e.readOnly||['checkbox','radio','hidden','submit','button','password'].includes(e.type))continue;
        const s=label(e);let value='';
        if(/prenom|first.?name|given-name/.test(s))value=f.first_name;
        else if(/nom de famille|last.?name|family-name|surname|^nom\b/.test(s))value=f.last_name;
        else if(e.type==='email'||/e.?mail/.test(s))value=f.contact_email;
        else if(e.type==='tel'||/telephone|phone|tel-national/.test(s))value=f.phone;
        else if(/postal|zip/.test(s))value=f.postcode;
        else if(/adresse|street-address/.test(s)&&!/linkedin|url|site/.test(s))value=f.address;
        else if(/ville|city|address-level2/.test(s))value=f.city;
        else if(/disponibilite|availability/.test(s))value=f.availability;
        else if(/motivation|cover.?letter|message de candidature/.test(s)&&e.tagName==='TEXTAREA')value=task.body;
        if(value)assign(e,value);
      }
      await attach();
      const pending=remaining();
      if(pending.length)throw new Error('À compléter sur le site : '+pending.map(e=>label(e).slice(0,65)||e.type).join(', ')+'. Tes coordonnées et PDF reconnus sont déjà préparés.');
      if(!verified()||sendButton().length!==1)throw new Error('Le dossier ou le bouton final ne peut pas être vérifié. Les formulaires en plusieurs étapes restent à terminer sur le site.');
      await report('ready','Offre, coordonnées et PDF vérifiés dans le formulaire. Le bouton final de candidature est disponible.',true);
    }catch(e){await report('needs_user',e.message).catch(()=>{});}finally{preparing=false;}
  }
  function receipt(){return all('[role=status],[role=alert],h1,h2,.confirmation,[class*=success]').some(e=>/candidature (?:a (?:bien )?ete |bien )?(?:envoyee|transmise|enregistree|recue)|avons (?:bien )?recu votre candidature|application (?:was )?(?:submitted|sent|received)/.test(norm(text(e))));}
  async function observeReceipt(){
    for(let i=0;i<100;i++){if(receipt()){await report('sent','Le site a confirmé la réception de ta candidature.');return;}await wait(250);}
    await report('uncertain','Le site n’a pas confirmé la candidature. Vérifie ton espace candidat avant toute nouvelle tentative.');
  }
  async function commit(){
    if(clicked)return;
    const buttons=sendButton();
    if(!verified()||buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true'||receipt()){await report('not_clicked','Le formulaire a changé ou le bouton est indisponible. Aucun clic final effectué.');return;}
    clicked=true;buttons[0].click();await observeReceipt();
  }
  chrome.runtime.onMessage.addListener((m,s,respond)=>{
    if(!task)return;
    if(m.kind==='DELIVERY_RETRY'&&!clicked){prepare();respond({ok:true});}
    if(m.kind==='DELIVERY_COMMIT'&&m.id===task.id&&m.nonce===task.nonce){commit().catch(()=>report('uncertain','Résultat du formulaire à vérifier sur le site.'));respond({ok:true});}
  });
  async function initialize(){
    const a=await chrome.runtime.sendMessage({kind:'DELIVERY_READY'}).catch(()=>null);
    if(a?.task?.kind!=='application')return;
    task=a.task;
    if(a.awaiting){clicked=true;await observeReceipt();}else await prepare();
  }
  initialize();
})();
