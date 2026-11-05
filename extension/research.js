(() => {
  'use strict';
  let work=null,completed=false,observer=null,timer=null;
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const pick=(e,s)=>text(e.querySelector(s));
  function blocked(){
    const p=location.pathname,t=text(document.body).slice(0,10000);
    if(/authwall|checkpoint|\/login|\/uas\//.test(p))return 'Une connexion est nécessaire pour lire cette page.';
    if(/captcha|requête bloquée|you have been blocked|vérifiez.{0,40}humain|unusual activity|access denied|just a moment/i.test(t))return 'Le site demande une vérification ou refuse la lecture. Ouvre-le toi-même si nécessaire.';
    return '';
  }
  function posting(value){
    if(Array.isArray(value)){for(const v of value){const p=posting(v);if(p)return p;}}
    if(value&&typeof value==='object'){
      const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
      if(types.includes('JobPosting'))return value;
      for(const v of Object.values(value))if(v&&typeof v==='object'){const p=posting(v);if(p)return p;}
    }
    return null;
  }
  function htmlText(html){const doc=new DOMParser().parseFromString(String(html||''),'text/html');return text(doc.body);}
  function detail(){
    let description='',full=false;
    for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
      try{const p=posting(JSON.parse(script.textContent));if(p?.description){description=htmlText(p.description);full=description.length>100;break;}}catch{}
    }
    if(!description){
      const node=document.querySelector('#jobDescriptionText,[itemprop="description"],.show-more-less-html__markup,[data-cy="jobDescription"],.jobs-description__content,.description__text');
      if(node){description=text(node);full=description.length>120;}
    }
    if(!description){description=pick(document,'main, [role="main"], #zoneContenu');}
    const people=[];
    for(const a of document.querySelectorAll('a[href*="linkedin.com/in/"],a[href^="/in/"]')){
      const context=text(a.closest('section,article,[class*="hirer"],[class*="poster"]')||a.parentElement);
      const name=text(a);
      if(name.length>3&&name.length<100&&/recrut|talent|hiring|recruit|ressources humaines/i.test(context))people.push({name,profile_url:a.href,role:'Personne mentionnée dans cette annonce ; fonction à vérifier',context:context.slice(0,500)});
    }
    return {description:description.slice(0,40000),full,people:people.slice(0,5)};
  }
  function actualLink(a){
    try{
      const u=new URL(a.href);
      if(u.hostname.endsWith('bing.com')&&u.searchParams.has('u')){
        let encoded=u.searchParams.get('u');if(encoded.startsWith('a1'))encoded=encoded.slice(2);
        return atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
      }
      return u.href;
    }catch{return '';}
  }
  function search(){
    const results=[];
    for(const card of document.querySelectorAll('#b_results li.b_algo')){
      const a=card.querySelector('h2 a');if(!a)continue;
      const url=actualLink(a);if(!url.startsWith('https://'))continue;
      results.push({title:text(a),url,snippet:pick(card,'.b_caption p')||text(card).slice(0,1000)});
    }
    return results.slice(0,8);
  }
  async function send(data){
    if(completed)return;completed=true;observer?.disconnect();clearTimeout(timer);
    await chrome.runtime.sendMessage({kind:'WORK_RESULT',task_id:work.id,...data}).catch(()=>{});
  }
  function scan(final=false){
    if(!work||completed)return;
    const issue=blocked();if(issue){send({status:'needs_user',message:issue});return;}
    if(work.kind==='detail'){
      const result=detail();
      if(result.full||(final&&result.description.length>100))send({status:'done',...result,message:result.full?'Description de l’offre lue.':'Un aperçu est disponible ; lecture complète non confirmée.'});
      else if(final)send({status:'unavailable',message:'Description non reconnue. Tu peux la copier dans la fiche.'});
    }else{
      const results=search();
      const empty=/aucun résultat|no results found|il n.y a aucun résultat/i.test(text(document.body));
      if(results.length||empty)send({status:'done',results,message:results.length+' résultat(s) public(s) lus.'});
      else if(final)send({status:'unavailable',message:'Le moteur de recherche n’a pas fourni de résultats lisibles.'});
    }
  }
  async function begin(){
    const result=await chrome.runtime.sendMessage({kind:'WORK_READY'}).catch(()=>null);
    if(!result?.work)return;
    work=result.work;
    setTimeout(()=>scan(),1100);
    let debounce;
    observer=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(()=>scan(),800);});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    timer=setTimeout(()=>scan(true),18000);
  }
  begin();setTimeout(()=>{if(!work)begin();},1000);
})();
