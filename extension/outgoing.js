(() => {
  'use strict';
  let task=null,scope=null,editor=null,clicked=false,preparing=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const visible=e=>!!e&&!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
  const first=(selectors,root=document)=>selectors.map(s=>all(s,root)[0]).find(Boolean);
  const report=(status,message,verified=false)=>chrome.runtime.sendMessage({kind:'DELIVERY_REPORT',id:task.id,nonce:task.nonce,status,message,verified});
  async function until(read,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const v=read();if(v)return v;await sleep(200);}return null;}
  function fill(input,value){
    if(input.isContentEditable){input.focus();input.textContent=value;input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));}
    else{const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  const text=e=>e?.isContentEditable?e.innerText:e?.value||'';
  function subjectField(){return first(['input[name="subject"]','input[name="subjectbox"]','input[data-test-id="compose-subject"]','input[placeholder="Subject"]','input[placeholder="Objet"]']);}
  function emailEditor(){return first(['[data-test-id="rte"] [contenteditable="true"]','[data-test-id="rte"][contenteditable="true"]','[role="textbox"][aria-label="Message Body"]','[role="textbox"][aria-label="Corps du message"]','[contenteditable="true"][role="textbox"]','[contenteditable="true"][aria-label*="Message"]']);}
  function recipientEmails(){
    const root=scope||document;
    return [...root.querySelectorAll('[email],[data-email],[data-test-id="email-pill"],input[name="to"],input[data-test-id="compose-to"]')].flatMap(e=>([e.getAttribute('email'),e.getAttribute('data-email'),e.value,e.textContent,e.getAttribute('title')].filter(Boolean).join(' ').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi)||[])).map(x=>x.toLowerCase());
  }
  async function verifySender(){
    const selected=()=>[...document.querySelectorAll('[data-test-id="compose-from"],[data-test-id="compose-send-as"],[data-test-id="from-address"],[data-test-id="profile-button"],input[name="from"],a[href*="SignOutOptions"],button[aria-label*="Compte Google"],a[aria-label*="Google Account"]')].filter(visible).some(e=>norm([e.textContent,e.value,e.getAttribute('title'),e.getAttribute('aria-label')].join(' ')).includes(task.sender.toLowerCase()));
    if(selected())return true;
    const account=first(['[data-test-id="profile-button"]','[data-test-id="account-switcher"]','button[aria-label*="Account"]','button[aria-label*="compte"]']);
    if(account){account.click();const ok=await until(selected,2000);account.click();return !!ok;}
    return false;
  }
  function attachmentText(){return [...document.querySelectorAll('[data-test-id*="attachment"],.aQH,.aQy,[aria-label*="Attachment"],[aria-label*="jointe"]')].map(e=>[e.textContent,e.getAttribute('title'),e.getAttribute('aria-label')].join(' ')).join(' ');}
  async function attach(){
    const missing=task.attachments.filter(a=>!attachmentText().includes(a.name));
    if(!missing.length)return;
    const inputs=[...document.querySelectorAll('input[type="file"]')].filter(e=>!e.accept||/pdf|\*|document/i.test(e.accept));
    if(!inputs.length)throw new Error('Le champ des pièces jointes n’est pas disponible. Ouvre cet onglet et les options de pièces jointes, puis clique sur Reprendre dans JobBot.');
    const input=inputs.find(e=>e.multiple)||inputs[0];
    const transfer=new DataTransfer();
    for(const a of missing){const raw=atob(a.content),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);transfer.items.add(new File([bytes],a.name,{type:a.type}));}
    if(missing.length>1&&!input.multiple)throw new Error('Ce formulaire exige une pièce jointe à la fois. Ajoute les PDF dans cet onglet ou utilise l’envoi direct configuré.');
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    if(!await until(()=>task.files.every(name=>attachmentText().includes(name)),30000))throw new Error('Le chargement des PDF n’est pas confirmé. Vérifie les pièces jointes dans l’onglet de messagerie.');
  }
  async function prepareEmail(){
    const subject=await until(subjectField,25000);editor=await until(emailEditor,10000);
    if(!subject||!editor)throw new Error('Connecte-toi à ta messagerie dans cet onglet, puis clique sur Reprendre dans JobBot.');
    if(all('input[name="subject"],input[name="subjectbox"],input[data-test-id="compose-subject"]').length!==1)throw new Error('Plusieurs messages sont ouverts dans cet onglet. Conserve seulement le brouillon de cette candidature avant de reprendre.');
    scope=subject.closest('[data-test-id="compose"],form,[role="dialog"],.M9')||document;
    const recipients=[...new Set(recipientEmails())];
    if(recipients.some(r=>r!==task.recipient.toLowerCase()))throw new Error('Un autre destinataire est présent. JobBot ne modifie pas ce brouillon.');
    if(!recipients.includes(task.recipient.toLowerCase())){
      const to=first(['input[data-test-id="compose-to"]','input[name="to"]','input[aria-label="To"]','input[aria-label="À"]'],scope);
      if(!to)throw new Error('Le destinataire ne peut pas être vérifié dans cette page.');
      fill(to,task.recipient);to.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));to.blur();
    }
    if(subject.value.trim()&&subject.value!==task.subject)throw new Error('L’objet de ce brouillon est différent. Aucun contenu existant n’a été remplacé.');
    if(text(editor).trim()&&norm(text(editor))!==norm(task.body))throw new Error('Un texte différent est déjà dans ce brouillon. Vérifie-le dans ta messagerie.');
    fill(subject,task.subject);fill(editor,task.body);await attach();
    if(!await verifyEmail())throw new Error('Le compte expéditeur ou le dossier ne peut pas être vérifié. Dans la messagerie, affiche le compte expéditeur, puis clique sur Reprendre.');
  }
  async function verifyEmail(){
    const recipients=[...new Set(recipientEmails())];
    return recipients.length===1&&recipients[0]===task.recipient.toLowerCase()&&subjectField()?.value===task.subject&&norm(text(editor))===norm(task.body)&&task.files.every(f=>attachmentText().includes(f))&&await verifySender();
  }
  function profilePath(url){try{return new URL(url).pathname.replace(/\/$/,'');}catch{return '';}}
  function linkedScope(){
    const windows=all('.msg-overlay-conversation-bubble');
    return windows.filter(w=>[...w.querySelectorAll('a[href*="/in/"]')].some(a=>profilePath(a.href)===profilePath(task.url)))[0];
  }
  async function prepareLinkedIn(){
    const heading=await until(()=>first(['main h1']),20000);
    if(!heading||profilePath(location.href)!==profilePath(task.url)||norm(heading.textContent)!==norm(task.recipient))throw new Error('Connecte-toi et vérifie le nom sur le profil LinkedIn exact avant de reprendre.');
    scope=linkedScope();
    if(!scope){
      const card=heading.closest('section')||heading.parentElement.parentElement;
      const buttons=all('button,a[role="button"]',card).filter(b=>/^(message|envoyer un message)$/.test(norm(b.textContent)));
      if(buttons.length!==1)throw new Error('Le bouton Message gratuit n’est pas disponible pour ce profil. LinkedIn peut exiger une connexion acceptée ou un accès particulier. JobBot n’achète pas d’InMail.');
      buttons[0].click();scope=await until(linkedScope,10000);
    }
    if(!scope)throw new Error('Le destinataire de la conversation ne peut pas être vérifié. Ouvre la conversation depuis le profil.');
    editor=first(['.msg-form__contenteditable[contenteditable="true"]','[contenteditable="true"][role="textbox"]'],scope);
    if(!editor)throw new Error('Aucun champ de message utilisable n’est disponible pour cette personne.');
    if(text(editor).trim()&&norm(text(editor))!==norm(task.body))throw new Error('Un autre brouillon est déjà saisi dans LinkedIn. JobBot le conserve.');
    fill(editor,task.body);
    if(!verifyLinkedIn())throw new Error('Le message ou le profil LinkedIn a changé.');
  }
  function verifyLinkedIn(){return scope&&scope===linkedScope()&&editor?.isConnected&&norm(text(editor))===norm(task.body);}
  function sendButton(){
    if(task.kind==='linkedin')return first(['.msg-form__send-button','button[type="submit"]'],scope);
    return first(['[data-test-id="compose-send-button"]','[data-test-id="send-button"]','[role="button"][data-tooltip^="Send"]','[role="button"][data-tooltip^="Envoyer"]','.aoO[role="button"]'],scope);
  }
  async function prepare(){
    if(preparing||clicked)return;preparing=true;
    try{await (task.kind==='linkedin'?prepareLinkedIn():prepareEmail());await report('ready','Destinataire, texte'+(task.kind==='email'?', compte expéditeur et PDF':' du message LinkedIn')+' vérifiés. Relis l’aperçu dans JobBot puis confirme l’envoi.',true);}
    catch(error){await report('needs_user',error.message).catch(()=>{});}finally{preparing=false;}
  }
  async function commit(){
    if(clicked)return;
    const valid=task.kind==='linkedin'?verifyLinkedIn():await verifyEmail();
    const button=sendButton();
    if(!valid||!button||button.disabled||button.getAttribute('aria-disabled')==='true'){await report('not_clicked','Le dossier a changé ou le bouton Envoyer est indisponible. Aucun clic d’envoi effectué.');return;}
    const oldEvents=new Set(task.kind==='linkedin'?all('.msg-s-event-listitem',scope):[]);
    const oldAlerts=new Map(all('[role="alert"],[role="status"]').map(e=>[e,norm(e.textContent)]));
    clicked=true;button.click();
    const success=await until(()=>{
      if(task.kind==='linkedin')return !norm(text(editor))&&all('.msg-s-event-listitem',scope).some(e=>!oldEvents.has(e)&&norm(e.textContent).includes(norm(task.body)));
      return all('[role="alert"],[role="status"]').some(e=>oldAlerts.get(e)!==norm(e.textContent)&&/message (?:sent|envoye)|email (?:sent|envoye)|e.mail envoye|votre message a ete envoye/.test(norm(e.textContent)));
    },25000);
    await report(success?'sent':'uncertain',success?'Le site a confirmé l’envoi.':'Le site n’a pas confirmé le résultat. Vérifie les messages envoyés avant toute autre tentative.');
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.kind==='DELIVERY_RETRY'&&task&&!clicked){prepare();respond({ok:true});}
    if(message.kind==='DELIVERY_COMMIT'&&task&&message.id===task.id&&message.nonce===task.nonce){commit().catch(()=>report('uncertain','Résultat de l’envoi non confirmé.'));respond({ok:true});}
  });
  async function initialize(){
    const answer=await chrome.runtime.sendMessage({kind:'DELIVERY_READY'}).catch(()=>null);
    if(!answer?.task||!['email','linkedin'].includes(answer.task.kind))return;task=answer.task;await prepare();
  }
  initialize();
})();
