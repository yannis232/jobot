(() => {
  'use strict';
  let job=null,observer=null,debounce=null,deadline=null,last='',generation=0,adeccoRows=null,adeccoReading=false;
  const send=data=>chrome.runtime.sendMessage({kind:'COLLECT',search_id:job.search_id,...data}).catch(()=>{});
  function scan(final=false){
    if(!job)return;
    const expected=new URL(job.target_url),current=new URL(location.href);
    const keys={meteojob:['what','where'],adecco:['jobTitle','jobLocation'],manpower:[],randstad:[],indeed:['q','l'],francetravail:['motsCles','lieux'],hellowork:['k','l'],linkedin:['keywords','location']}[job.source];
    if(keys.some(key=>current.searchParams.has(key)&&current.searchParams.get(key).toLowerCase()!==expected.searchParams.get(key)?.toLowerCase())){
      const signature='criteria-changed';
      if(last!==signature){last=signature;send({status:'unavailable',offers:[],message:'Les critères ont été changés dans cet onglet. Relance une recherche depuis JobBot pour les garder identiques sur les huit sites.'});}
      return;
    }
    if(job.source==='adecco'&&adeccoRows===null&&document.querySelector('.job-cards article')){
      if(!adeccoReading){
        adeccoReading=true;const gen=generation;
        send({status:'reading',offers:[],message:'Lecture des cartes Adecco et de leurs liens publics…'});
        JobBotExtract.adeccoCards(document).then(rows=>{if(gen!==generation)return;adeccoRows=rows;adeccoReading=false;scan(true);}).catch(()=>{adeccoReading=false;send({status:'unavailable',offers:[],message:'Lecture Adecco interrompue. Ouvre le site puis reprends.'});});
      }
      return;
    }
    const offers=adeccoRows===null?JobBotExtract.extract(document,job.source):adeccoRows;
    const obstacle=offers.length?'':JobBotExtract.obstacle(document,location.href,job.source);
    const empty=!offers.length&&!obstacle&&JobBotExtract.explicitlyEmpty(document);
    const status=offers.length?'results':obstacle?'needs_user':empty?'empty':final?'unavailable':'reading';
    const message=offers.length?offers.length+' carte(s) importée(s) depuis la page affichée.':obstacle||
      (empty?'Le site indique zéro résultat pour cette recherche.':final?'Aucune carte reconnue. Ouvre le site, puis reprends la lecture.':'Chargement des résultats du site…');
    const result={offers,status,message,partial:offers.length>0};
    const signature=JSON.stringify(result);
    if(signature!==last){last=signature;send(result);}
  }
  async function begin(){
    const current=++generation;
    const response=await chrome.runtime.sendMessage({kind:'COLLECTOR_READY'}).catch(()=>null);
    if(current!==generation||!response?.search_id)return;
    job=response;last='';adeccoRows=null;adeccoReading=false;
    if(observer)observer.disconnect();
    clearTimeout(deadline);clearTimeout(debounce);
    scan();
    observer=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(()=>scan(),900);});
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    // Pas de pagination ni de défilement caché. Reprendre relit la page que
    // l'utilisateur choisit d'afficher, y compris une page suivante.
    deadline=setTimeout(()=>{observer.disconnect();scan(true);},45000);
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.kind==='RESUME'){begin();respond({ok:true});}
  });
  begin();
  setTimeout(()=>{if(!job)begin();},1000);
})();
