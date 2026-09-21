const $=s=>document.querySelector(s), app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(d);
const date=s=>new Date(s+'T12:00:00');
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const color=c=>/^#[0-9a-f]{6}$/i.test(c)?c:'#4169e1';
const label={fait:'✓ Terminé',attente:'À confirmer',retard:'En retard',prevu:'À faire'};
const token=new URLSearchParams(location.search).get('token')||'';
function fail(title,detail,hint){app.innerHTML=`<section class="auth panel"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p class="muted">${esc(hint)}</p></section>`}
async function load(week){app.innerHTML='<p>Chargement du planning…</p>';
 try{const r=await fetch('/api/planning?token='+encodeURIComponent(token)+(week?'&week='+week:''));const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Planning indisponible.');render(d)}
 catch(e){fail('Planning indisponible',e.message,'Ce lien a pu être renouvelé ou désactivé par la famille. Demande-leur le lien à jour.')}}
function person(name,c){return `<span class="person" style="--person:${color(c)}"><span class="avatar">${esc((name||'?').slice(0,1))}</span>${esc(name||'Membre absent')}</span>`}
function dayHtml(x,today){return `<article class="day ${x.day===today?'today':''}"><div class="dayhead">${date(x.day).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'})}</div>${x.tasks.map(t=>`<div class="task ${t.state==='fait'?'done':''}" style="--person:${color(t.color)}">${person(t.who,t.color)}<h3>${esc(t.title)}</h3><div class="status ${t.state==='retard'?'late':''}">${label[t.state]||'À faire'}${t.rotating?' · À tour de rôle':''}</div></div>`).join('')||'<div class="empty">Rien de prévu.</div>'}</article>`}
function render(d){const all=d.days.flatMap(x=>x.tasks),fait=all.filter(t=>t.state==='fait').length;
 app.innerHTML=`<div class="top"><div><p class="muted">${esc(d.home)}</p><h1>Le planning de la semaine</h1></div></div><div class="notice">Vue en lecture seule partagée par la famille : rien n'est modifiable ici, et aucun compte n'est nécessaire.</div><div class="summary"><strong>${fait} / ${all.length}</strong><div>Tâches terminées cette semaine<div class="progress"><div style="width:${all.length?fait/all.length*100:0}%"></div></div></div></div><div class="toolbar"><div class="row"><button id="prev" aria-label="Semaine précédente">‹</button><strong>Semaine du ${date(d.start).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</strong><button id="next" aria-label="Semaine suivante">›</button><button id="today">Cette semaine</button></div></div><div class="people">${d.people.map(p=>`<div class="legend">${person(p.name,p.color)}</div>`).join('')}</div><br><section class="week">${d.days.map(x=>dayHtml(x,d.today)).join('')}</section><p class="foot">Pour cocher une tâche, il faut son propre compte dans l'application.</p>`;
 $('#prev').onclick=()=>load(add(d.start,-7));$('#next').onclick=()=>load(add(d.start,7));$('#today').onclick=()=>load();
}
if(!token)fail('Lien incomplet','Ce lien ne contient pas de jeton de partage.','Ouvre le lien exact transmis par la famille.');else load();
