import {deviceState,enableDevice,alertHtml} from '/notify.js';
const $=s=>document.querySelector(s), app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(d);
const date=s=>new Date(s+'T12:00:00');
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const color=c=>/^#[0-9a-f]{6}$/i.test(c)?c:'#4169e1';
const label={fait:'✓ Terminé',attente:'À confirmer',retard:'En retard',prevu:'À faire'};
const token=new URLSearchParams(location.search).get('token')||'';
let vue=null, timer, alerte='inconnu', vapid;
// Notifications d'un lien personnel : le jeton du lien tient lieu de compte. Un lien de foyer, lui, n'appartient à personne.
async function request(action,body){const r=await fetch('/api/push?action='+action+'&token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Envoi impossible.');return d}
async function checkPush(){if(!vue?.who)return;
 if(vapid===undefined){try{vapid=(await fetch('/api/config').then(r=>r.json())).vapid||''}catch{return}}
 const state=await deviceState(vapid,request);if(state!==alerte){alerte=state;render(vue)}}
async function enablePush(){try{await enableDevice(vapid,request);alerte='ok';render(vue);toast('Notifications activées : tu seras prévenu des tâches qui t’attendent.')}catch(e){toast(e.message);checkPush()}}
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',5000)}
function fail(title,detail,hint){app.innerHTML=`<section class="auth panel"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p class="muted">${esc(hint)}</p></section>`}
async function load(week){
 try{const r=await fetch('/api/planning?token='+encodeURIComponent(token)+(week?'&week='+week:''));const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Planning indisponible.');const first=!vue;vue=d;render(d);if(first)checkPush()}
 catch(e){fail('Planning indisponible',e.message,'Ce lien a pu être renouvelé ou désactivé par la famille. Demande-leur le lien à jour.')}}
async function mark(b){b.disabled=true;
 try{const r=await fetch('/api/planning?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:b.dataset.task,day:b.dataset.day,action:b.dataset.do})});
  const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Action impossible.');await load(vue.start)}
 catch(e){toast(e.message);b.disabled=false}}
function person(name,c){return `<span class="person" style="--person:${color(c)}"><span class="avatar">${esc((name||'?').slice(0,1))}</span>${esc(name||'Membre absent')}</span>`}
function dayHtml(x,today){return `<article class="day ${x.day===today?'today':''}"><div class="dayhead">${date(x.day).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'})}</div>${x.tasks.map(t=>`<div class="task ${t.state==='fait'?'done':''}" style="--person:${color(t.color)}">${person(t.who,t.color)}<h3>${esc(t.title)}</h3><div class="status ${t.state==='retard'?'late':''}">${label[t.state]||'À faire'}${t.rotating?' · À tour de rôle':''}</div>${t.mine&&t.id?`<button data-do="${t.state==='prevu'||t.state==='retard'?'done':'undo'}" data-task="${esc(t.id)}" data-day="${x.day}">${t.state==='prevu'||t.state==='retard'?"C'est fait":'Annuler'}</button>`:''}</div>`).join('')||'<div class="empty">Rien de prévu.</div>'}</article>`}
function render(d){const all=d.days.flatMap(x=>x.tasks),fait=all.filter(t=>t.state==='fait').length,mien=!!d.who;
 app.innerHTML=`${mien?alertHtml(alerte):''}<div class="top"><div><p class="muted">${esc(d.home)}</p><h1>${mien?'Les tâches de '+esc(d.who):'Le planning de la semaine'}</h1></div></div><div class="notice">${mien?'Ton planning personnel. Tu peux déclarer une tâche faite ; le reste des réglages appartient aux parents.':"Vue en lecture seule partagée par la famille : rien n'est modifiable ici, et aucun compte n'est nécessaire."}</div><div class="summary"><strong>${fait} / ${all.length}</strong><div>Tâches terminées cette semaine<div class="progress"><div style="width:${all.length?fait/all.length*100:0}%"></div></div></div></div><div class="toolbar"><div class="row"><button id="prev" aria-label="Semaine précédente">‹</button><strong>Semaine du ${date(d.start).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</strong><button id="next" aria-label="Semaine suivante">›</button><button id="today">Cette semaine</button></div></div><div class="people">${d.people.map(p=>`<div class="legend">${person(p.name,p.color)}</div>`).join('')}</div><br><section class="week">${d.days.map(x=>dayHtml(x,d.today)).join('')}</section><p class="foot">${mien?'Une tâche à confirmer attend le passage d’un parent.':"Pour cocher une tâche, il faut son propre compte dans l'application."}</p>`;
 $('#prev').onclick=()=>load(add(d.start,-7));$('#next').onclick=()=>load(add(d.start,7));$('#today').onclick=()=>load();
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
