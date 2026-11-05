/* Lecture du DOM des cartes d'offres, sans endpoint caché ni donnée de compte. */
(() => {
  'use strict';
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const pick=(root,selector)=>text(root?.querySelector(selector));
  function relativeDate(label,today=new Date()){
    const m=String(label||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const iso=m.match(/\b(20\d\d-\d\d-\d\d)\b/);if(iso)return iso[1];
    if(/plus de|\d\s*\+|plus d'un/.test(m))return '';
    let days;
    if(/aujourd.hui|today|instant|\bheures?\b|\bhours?\b|\bminutes?\b/.test(m))days=0;
    else if(/\bhier\b|yesterday/.test(m))days=1;
    else {const n=m.match(/(?:il y a\s+)?(\d+)\s*(jour|day|semaine|week)/);if(n)days=Number(n[1])*(/semaine|week/.test(n[2])?7:1);}
    if(days===undefined||days>366)return '';
    const d=new Date(today);d.setDate(d.getDate()-days);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  }
  function dateLabel(card){
    const exact=card.querySelector('time[datetime]');
    if(exact)return {posted:exact.getAttribute('datetime').slice(0,10),posted_label:text(exact)};
    const label=pick(card,'.date, .job-search-card__listdate, .job-search-card__listdate--new')||
      text(card).match(/(?:Publié(?:e)?\s+)?(?:aujourd.hui|hier|il y a\s+(?:\d+|un|une)\s+(?:jour|heure|minute|semaine)s?|\d+\s+(?:day|week|hour)s?\s+ago)/i)?.[0]||'';
    return {posted:relativeDate(label),posted_label:label};
  }
  function indeed(doc){
    return [...doc.querySelectorAll('a[data-jk], a.jcs-JobTitle')].map(a=>{
      const card=a.closest('li')||a.closest('.result')||a.parentElement;
      const id=a.getAttribute('data-jk')||new URL(a.href,doc.location?.href||'https://fr.indeed.com').searchParams.get('jk');
      if(!id)return null;
      return {url:'https://fr.indeed.com/viewjob?jk='+encodeURIComponent(id),title:pick(a,'span[title]')||text(a),
        company:pick(card,'[data-testid="company-name"], .companyName'),location:pick(card,'[data-testid="text-location"], .companyLocation'),
        summary:pick(card,'[data-testid="belowJobSnippet"], .job-snippet'),contract:pick(card,'.metadataContainer'),...dateLabel(card)};
    }).filter(Boolean);
  }
  function franceTravail(doc){
    return [...doc.querySelectorAll('li.result[data-id-offre], li[data-id-offre]')].map(card=>{
      const a=card.querySelector('a[href*="/offres/recherche/detail/"]');if(!a)return null;
      const sub=card.querySelector('.subtext');
      const location=pick(sub,'span');
      const company=sub?[...sub.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').replace(/[\s\u00a0-]+$/g,'').trim():'';
      return {url:new URL(a.getAttribute('href'),'https://candidat.francetravail.fr').href,title:pick(card,'h2'),company,location,
        summary:pick(card,'.description'),contract:pick(card,'.contrat'),...dateLabel(card)};
    }).filter(Boolean);
  }
  function helloWork(doc){
    return [...doc.querySelectorAll('a[href*="/fr-fr/emplois/"]')].filter(a=>/\/fr-fr\/emplois\/\d+\.html/.test(a.getAttribute('href'))).map(a=>{
      const card=a.closest('li')||a.closest('[data-cy="serpCard"]')||a.parentElement;
      const spans=a.querySelectorAll('h3>span');
      const aria=a.getAttribute('aria-label')||'';
      const title=spans[0]?text(spans[0]):(aria.match(/^Voir offre de (.+?) à /)?.[1]||text(a));
      const company=spans.length>1?text(spans[spans.length-1]):(aria.match(/, chez (.*?), pour un /)?.[1]||'');
      return {url:new URL(a.getAttribute('href'),'https://www.hellowork.com').href,title,company,
        location:pick(card,'[data-cy="localisationCard"]'),contract:pick(card,'[data-cy="contractCard"]'),
        summary:pick(card,'[data-cy="salaryCard"]'),...dateLabel(card)};
    });
  }
  function linkedIn(doc){
    return [...doc.querySelectorAll('a[href*="/jobs/view/"]')].map(a=>{
      const card=a.closest('li')||a.closest('.base-card')||a.closest('[data-job-id]')||a.parentElement;
      const title=pick(card,'.base-search-card__title, .job-card-list__title, .job-card-list__title--link, .job-card-container__link strong')||pick(a,'strong')||text(a).split('\n')[0];
      const href=new URL(a.getAttribute('href'),'https://www.linkedin.com').href;
      return {url:href,title,company:pick(card,'.base-search-card__subtitle, .artdeco-entity-lockup__subtitle, .job-card-container__primary-description'),
        location:pick(card,'.job-search-card__location, .job-card-container__metadata-item, .artdeco-entity-lockup__caption'),
        summary:'',contract:'',...dateLabel(card)};
    });
  }
  function extra(doc,source){
    const spec={
      meteojob:{base:'https://www.meteojob.com',path:/^\/jobs\/\d{5,20}\/?$/,card:'.cc-job-offer-list-item, article, li',company:'p.d-inline-block, [class*="company"], [class*="recruiter"], [itemprop="hiringOrganization"]',location:'[class*="location"], [class*="localisation"], [itemprop="jobLocation"]'},
      adecco:{base:'https://www.adecco.com',path:/^\/fr-fr\/offres-emploi\/[^/]+\/[^/]+\/?$/,card:'article, li, [class*="job-card"], [class*="jobCard"]',company:'[class*="company"]',location:'[class*="location"], [class*="Location"]'},
      manpower:{base:'https://www.manpower.fr',path:/^\/offers\/details\/\d{5,20}\/?$/,card:'article, li, [class*="offer-card"], [class*="job-card"], [class*="offre"]',company:'[class*="company"]',location:'[class*="location"], [class*="localisation"], [class*="lieu"]'},
      randstad:{base:'https://www.randstad.fr',path:/^\/emploi\/[^/]+_[^/]+_[^/]+\/?$/,card:'.cards__item,article,li,[class*="job-card"]',company:'[class*="company"]',location:'.cards__meta-item, [class*="location"], [itemprop="jobLocation"]'}
    }[source];
    const rows=[];
    // Les données structurées publiques complètent les cartes lorsque le site les expose.
    function visit(v){
      if(!v||typeof v!=='object')return;
      if((Array.isArray(v['@type'])?v['@type']:[v['@type']]).includes('JobPosting')){
        try{const u=new URL(v.url||v['@id'],spec.base);if(spec.path.test(u.pathname)){
          const loc=Array.isArray(v.jobLocation)?v.jobLocation[0]:v.jobLocation;
          const div=doc.createElement('div');div.innerHTML=String(v.description||'');
          rows.push({url:u.href,title:v.title,company:v.hiringOrganization?.name||spec.base.split('.')[1],location:loc?.address?.addressLocality||'',summary:text(div).slice(0,2500),contract:String(v.employmentType||''),posted:String(v.datePosted||'').slice(0,10)});
        }}catch{}
      }
      for(const child of Object.values(v))if(child&&typeof child==='object')Array.isArray(child)?child.forEach(visit):visit(child);
    }
    for(const s of doc.querySelectorAll('script[type="application/ld+json"]'))try{visit(JSON.parse(s.textContent));}catch{}
    for(const a of doc.querySelectorAll('a[href]')){
      let u;try{u=new URL(a.getAttribute('href'),spec.base);}catch{continue;}
      if(u.origin!==spec.base||!spec.path.test(u.pathname))continue;
      const card=a.closest(spec.card)||a.parentElement;
      const title=pick(card,'h2 a,h3 a,h2,h3,h4')||a.getAttribute('title')||text(a);
      if(!title||/^(?:je postule|postuler|voir|détails|details|en savoir)/i.test(title))continue;
      const place=[...card.querySelectorAll('mat-icon')].find(e=>text(e)==='place');
      const location=pick(card,spec.location)||(place?text(place.parentElement).replace(/^place\s*/,''):'')||text(card).match(/\b\d{5}\s+[\p{L}][\p{L}\s-]{2,45}/u)?.[0]||'';
      rows.push({url:u.href,title,company:pick(card,spec.company)||({adecco:'Adecco',manpower:'Manpower',randstad:'Randstad'}[source]||''),location,
        summary:pick(card,'[class*="description"],[class*="snippet"]'),contract:text(card).match(/\b(?:CDI|CDD|Intérim|Alternance)\b/i)?.[0]||'',...dateLabel(card)});
    }
    return rows;
  }
  function extract(doc,source){
    const readers={indeed,francetravail:franceTravail,hellowork:helloWork,linkedin:linkedIn};
    const unique=new Map();
    for(const offer of (readers[source]?readers[source](doc):extra(doc,source))){
      if(offer.title?.length>=3&&!unique.has(offer.url))unique.set(offer.url,offer);
    }
    return [...unique.values()].slice(0,30);
  }
  async function adeccoCards(doc){
    const visible=e=>e.getClientRects().length>0;
    const cards=[...doc.querySelectorAll('.job-cards article')].filter(visible).slice(0,30),rows=[];
    const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    for(const card of cards){
      if(!card.isConnected||location.pathname!=='/fr-fr/offres-emploi')break;
      const title=pick(card,'.card-header p'),locationLabel=pick(card,'.card-body p.subtitle');
      const button=card.querySelector('[role=button]');if(!title||!button)continue;
      const before=doc.querySelector('a.static_jobdetailpage_url')?.href;
      const selected=button.classList.contains('selected');
      button.click();
      const end=Date.now()+3500;let url='';
      while(Date.now()<end){
        const a=doc.querySelector('a.static_jobdetailpage_url');
        if(a&&norm(doc.title).includes(norm(title))&&(!locationLabel||norm(doc.title).includes(norm(locationLabel)))&&(selected||a.href!==before)){
          url=a.href;break;
        }
        await new Promise(r=>setTimeout(r,120));
      }
      if(url)rows.push({url,title,company:'Adecco',location:locationLabel,summary:'',contract:pick(card,'.card-body .flex .subtitle'),...dateLabel(card)});
    }
    return rows;
  }
  function obstacle(doc,url,source){
    const path=new URL(url).pathname;
    if(/authwall|checkpoint|\/login|\/uas\//.test(path))return 'Connecte-toi dans cet onglet, puis reviens cliquer sur Reprendre ce site.';
    const body=text(doc.body).slice(0,20000);
    if(/requête bloquée|request blocked|vous avez été bloqué|you have been blocked/i.test(body))return 'Le site bloque l’accès à cette recherche. Ouvre l’onglet pour consulter sa demande. Les autres recherches continuent ; JobBot ne peut pas lire ce site tant que l’accès est refusé.';
    if(/verify (?:that )?you are human|vérifi(?:ez|cation).{0,60}(?:humain|sécurité)|unusual activity|activité inhabituelle|access denied|accès refusé|just a moment|captcha/i.test(body))return 'Le site demande une vérification. Termine-la toi-même dans cet onglet puis reprends la lecture.';
    if(doc.querySelector('input[type="password"]')&&!doc.querySelector('a[href*="/jobs/view/"]')&&source==='linkedin')return 'LinkedIn demande une connexion. Connecte-toi dans cet onglet puis reprends la lecture.';
    return '';
  }
  function explicitlyEmpty(doc){
    const headings=[...doc.querySelectorAll('h1,h2,[data-testid="no-results"],.jobsearch-NoResult-messageContainer')].map(text).join(' ');
    return /(?:\b0\s+(?:offre|emploi|résultat|job)s?\b|aucun(?:e)?\s+(?:offre|emploi|résultat)|no (?:matching )?(?:jobs|results) found)/i.test(headings);
  }
  const api={extract,adeccoCards,relativeDate,obstacle,explicitlyEmpty};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else globalThis.JobBotExtract=api;
})();
