import {deviceState,enableDevice,alertHtml} from '/notify.js';
import {icon} from '/icons.js';
import {confetti,pop,bounce,flame,cheer,medal,smallMedal,trophy,showcase,teamCheer} from '/fun.js';
const $=s=>document.querySelector(s), app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(d);
const date=s=>new Date(s+'T12:00:00');
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const color=c=>/^#[0-9a-f]{6}$/i.test(c)?c:'#4169e1';
// Initiale lisible sur toute couleur choisie : sombre sur les teintes claires, blanche sinon.
const ink=c=>{const n=parseInt(color(c).slice(1),16);return (.299*(n>>16)+.587*(n>>8&255)+.114*(n&255))/255>.62?'#192640':'#fff'};
const label={attente:'À confirmer',retard:'En retard'};
const fmt=(d,o)=>date(d).toLocaleDateString('fr-FR',o);
const long=d=>fmt(d,{weekday:'long',day:'numeric',month:'long'});
const ib=(name,text,attrs='')=>`<button type="button" class="icon" aria-label="${esc(text)}" title="${esc(text)}" ${attrs}>${icon(name)}</button>`;
// Sur téléphone : bandeau des sept jours et une seule journée affichée, celle qu'on touche.
const narrow=matchMedia('(max-width:650px)');
const token=new URLSearchParams(location.search).get('token')||'';
let vue=null, timer, alerte='inconnu', vapid, jour;
narrow.addEventListener('change',()=>{if(vue)render(vue)});
// Notifications d'un lien personnel : le jeton du lien tient lieu de compte. Un lien de foyer, lui, n'appartient à personne.
async function request(action,body){const r=await fetch('/api/push?action='+action+'&token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Envoi impossible.');return d}
async function checkPush(){if(!vue?.who)return;
 if(vapid===undefined){try{vapid=(await fetch('/api/config').then(r=>r.json())).vapid||''}catch{return}}
 const state=await deviceState(vapid,request);if(state!==alerte){alerte=state;render(vue)}}
async function enablePush(){try{alerte=await enableDevice(vapid,request);render(vue);toast(alerte==='ok'?'Notifications activées : tu seras prévenu des tâches qui t’attendent.':'Autorisation enregistrée : les rappels arriveront dès que le serveur sera prêt.')}catch(e){toast(e.message);checkPush()}}
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',5000)}
function fail(title,detail,hint){app.innerHTML=`<section class="auth panel"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p class="muted">${esc(hint)}</p></section>`}
async function load(week){
 try{const r=await fetch('/api/planning?token='+encodeURIComponent(token)+(week?'&week='+week:''));const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Planning indisponible.');const first=!vue;vue=d;render(d);if(first)checkPush()}
 catch(e){fail('Planning indisponible',e.message,'Ce lien a pu être renouvelé ou désactivé par la famille. Demande-leur le lien à jour.')}}
// Cocher se fête : petite gerbe, ou grande pluie quand c'était la dernière tâche du jour.
async function mark(b){b.disabled=true;const {task,day}=b.dataset,act=b.dataset.do,from=b.getBoundingClientRect(),before=vue.streak||0,hadMedal=!!vue.days.find(x=>x.day===day)?.medal,hadCup=!!vue.trophy;
 const last=act==='done'&&vue.days.find(x=>x.day===day)?.tasks.every(t=>t.id===task||t.state==='fait'||t.state==='attente');
 try{const r=await fetch('/api/planning?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:b.dataset.task,day:b.dataset.day,action:b.dataset.do})});
  const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Action impossible.');await load(vue.start);
  // Médaille et coupe se lisent sur toute la famille, côté serveur : on compare avant et après.
  const won=act==='done'&&!hadMedal&&!!vue.days.find(x=>x.day===day)?.medal,cup=won&&!hadCup&&!!vue.trophy;
  if(won){pop(task,day);confetti(null,true);bounce(cup?'.trophy':`[data-medal="${day}"]`);if(cup)setTimeout(()=>confetti(null,true),700);toast(teamCheer(cup))}
  else if(act==='done'){pop(task,day);confetti(last?null:from,last);if((vue.streak||0)>before)toast(cheer(vue.streak));else if(last)toast('Journée bouclée, bravo ! 🎉')}}
 catch(e){toast(e.message);b.disabled=false}}
function person(name,c){return `<span class="person" style="--person:${color(c)};--on:${ink(c)}"><span class="avatar">${esc((name||'?').slice(0,1))}</span>${esc(name||'Membre absent')}</span>`}
function dayHtml(x,today,single){return `<article class="day ${x.day===today?'today':''}"><div class="dayhead">${single?`<h2>${long(x.day)}</h2>`:`<span class="dlink">${fmt(x.day,{weekday:'short',day:'numeric'})}</span>`}${x.medal?medal(x.day):''}</div>${x.tasks.map(t=>taskHtml(t,x.day)).join('')||'<div class="empty">Rien de prévu.</div>'}</article>`}
function taskHtml(t,day){const state={fait:'done',attente:'pending',retard:'late'}[t.state]||'',open=t.state==='prevu'||t.state==='retard',glyph=icon(t.state==='attente'?'clock':'check');
 const check=t.mine&&t.id?`<button type="button" class="check" data-do="${open?'done':'undo'}" data-task="${esc(t.id)}" data-day="${day}" aria-pressed="${!open}" aria-label="${esc(t.title)} : ${open?"c'est fait":'annuler'}" title="${open?"C'est fait":'Annuler'}">${glyph}</button>`:`<span class="check" role="img" aria-label="${t.state==='fait'?'Terminé':t.state==='attente'?'À confirmer':'À faire'}">${state==='done'||state==='pending'?glyph:''}</span>`;
 return `<div class="task ${state}" style="--person:${color(t.color)}">${check}<div class="info"><h3>${esc(t.title)}</h3><div class="meta">${person(t.who,t.color)}${label[t.state]?`<span class="status">${label[t.state]}</span>`:''}${t.rotating?`<span class="rot" title="À tour de rôle" role="img" aria-label="À tour de rôle">${icon('repeat')}</span>`:''}</div></div></div>`}
function render(d){const all=d.days.flatMap(x=>x.tasks),fait=all.filter(t=>t.state==='fait').length,mien=!!d.who,strip=narrow.matches,end=d.days[d.days.length-1].day;
 if(!d.days.some(x=>x.day===jour))jour=d.days.some(x=>x.day===d.today)?d.today:d.start;
 const period=strip?fmt(d.start,{day:'numeric',month:'short'})+' – '+fmt(end,{day:'numeric',month:'short'}):'Semaine du '+fmt(d.start,{day:'numeric',month:'long',year:'numeric'});
 app.innerHTML=`${mien?alertHtml(alerte):''}<div class="top"><div><p class="eyebrow">${esc(d.home)}</p><h1>${mien?'Les tâches de '+esc(d.who)+' '+flame(d.streak,'big'):'Le planning de la semaine'}</h1>${showcase(d.awards)}</div><div class="score" title="${fait} sur ${all.length} terminée(s) cette semaine"><strong>${fait}/${all.length}</strong><span>terminées cette semaine</span><div class="progress"><div style="width:${all.length?fait/all.length*100:0}%"></div></div></div></div>${d.trophy?trophy():''}<div class="notice">${mien?'Ton planning personnel : touche le rond d’une tâche pour la déclarer faite. Le reste des réglages appartient aux parents.':"Vue en lecture seule partagée par la famille : rien n'est modifiable ici, et aucun compte n'est nécessaire."}</div><div class="toolbar"><div class="nav">${ib('left','Semaine précédente','id="prev"')}<strong class="period">${period}</strong>${ib('right','Semaine suivante','id="next"')}${ib('today','Revenir à cette semaine','id="today" '+(d.days.some(x=>x.day===d.today)?'disabled':''))}</div></div>${mien?'':`<div class="people">${d.people.map(p=>`<span class="legend">${person(p.name,p.color)}${flame(p.streak)}</span>`).join('')}</div>`}${strip?`<div class="strip">${d.days.map(x=>{const ok=x.tasks.filter(t=>t.state==='fait').length,late=x.tasks.some(t=>t.state==='retard');return `<button type="button" class="sday ${x.day===d.today?'today':''} ${x.day===jour?'sel':''} ${x.tasks.length&&ok===x.tasks.length?'full':late?'late':''}" data-strip="${x.day}" aria-pressed="${x.day===jour}" aria-label="${esc(long(x.day))} : ${ok} sur ${x.tasks.length} terminée(s)"><span>${fmt(x.day,{weekday:'short'}).replace('.','')}</span><b>${fmt(x.day,{day:'numeric'})}</b><i>${x.tasks.length?ok+'/'+x.tasks.length:'·'}</i>${x.medal?smallMedal:''}</button>`}).join('')}</div>`:''}<section class="week ${strip?'single':''}">${(strip?d.days.filter(x=>x.day===jour):d.days).map(x=>dayHtml(x,d.today,strip)).join('')}</section><p class="foot">${mien?'Une tâche à confirmer attend le passage d’un parent.':"Pour cocher une tâche, il faut son propre compte dans l'application."}</p>`;
 $('#prev').onclick=()=>load(add(d.start,-7));$('#next').onclick=()=>load(add(d.start,7));$('#today').onclick=()=>{jour=d.today;load()};
 document.querySelectorAll('[data-strip]').forEach(b=>b.onclick=()=>{jour=b.dataset.strip;render(d)});
 document.querySelectorAll('[data-do]').forEach(b=>b.onclick=()=>mark(b));$('#enablepush')?.addEventListener('click',enablePush);
}
if(!token)fail('Lien incomplet','Ce lien ne contient pas de jeton de partage.','Ouvre le lien exact transmis par la famille.');
else{
 // Le manifeste propre au lien fait rouvrir ce planning depuis l'écran d'accueil.
 const m=document.createElement('link');m.rel='manifest';m.href='/api/manifest?token='+encodeURIComponent(token);document.head.append(m);
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 load();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&vue)checkPush()});
}
