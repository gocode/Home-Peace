// Petites célébrations, partagées par l'application et la page du lien personnel : confettis, vibration, flamme de série.
// Avec « réduire les animations » activé sur l'appareil, seule la vibration reste.
const calm=matchMedia('(prefers-reduced-motion: reduce)');
const palette=['#ff5d5d','#ffb703','#3ccf91','#4169e1','#ae368a','#ff8fab','#7bdff2'];

// Petite gerbe depuis le rond coché ; grande pluie quand la journée est bouclée.
export function confetti(from,big=false){
 try{navigator.vibrate?.(big?[30,60,30,60,90]:30)}catch{}
 if(calm.matches)return;
 const W=innerWidth,H=innerHeight,dpr=Math.min(devicePixelRatio||1,2),c=document.createElement('canvas');
 c.className='confetti';c.setAttribute('aria-hidden','true');c.width=W*dpr;c.height=H*dpr;
 // Une modale ouverte est dans la couche supérieure : les confettis la rejoignent pour passer devant.
 (document.querySelector('dialog[open]')||document.body).append(c);
 const g=c.getContext('2d');if(!g)return c.remove();g.scale(dpr,dpr);
 const x0=from?from.left+from.width/2:W/2,y0=from?from.top+from.height/2:H/3,n=big?160:40,life=big?2600:1500;
 const bits=Array.from({length:n},()=>{const a=-Math.PI/2+(Math.random()-.5)*(big?Math.PI*1.6:Math.PI*.9),v=(big?9:6)+Math.random()*(big?9:5);
  return {x:big?Math.random()*W:x0,y:big?H*.25+Math.random()*-H*.3:y0,vx:Math.cos(a)*v*(big?.5:1),vy:big?Math.random()*-6:Math.sin(a)*v,r:Math.random()*6.3,vr:(Math.random()-.5)*.4,w:5+Math.random()*5,h:3+Math.random()*4,color:palette[Math.random()*palette.length|0],round:Math.random()<.3}});
 const t0=performance.now();
 (function frame(t){const k=(t-t0)/life;g.clearRect(0,0,W,H);
  if(k>=1)return c.remove();
  g.globalAlpha=k<.7?1:1-(k-.7)/.3;
  for(const b of bits){b.vy+=.28;b.vx*=.985;b.vy*=.985;b.x+=b.vx;b.y+=b.vy;b.r+=b.vr;
   g.save();g.translate(b.x,b.y);g.rotate(b.r);g.fillStyle=b.color;
   if(b.round){g.beginPath();g.arc(0,0,b.w/2.4,0,7);g.fill()}else g.fillRect(-b.w/2,-b.h/2,b.w,b.h*Math.abs(Math.cos(b.r*2))+1);
   g.restore()}
  requestAnimationFrame(frame)})(t0);
}

// Rebond d'un élément qui vient d'apparaître ou de changer, retrouvé après le nouveau rendu.
export function bounce(sel){const el=document.querySelector(sel);if(!el)return;el.classList.add('pop');el.addEventListener('animationend',()=>el.classList.remove('pop'),{once:true})}
export const pop=(task,day)=>bounce(`.check[data-task="${CSS.escape(task)}"][data-day="${CSS.escape(day)}"]`);

// Flamme de série : affichée à partir d'un jour, avec le détail en info-bulle.
export const flame=(n,cls='')=>n>0?`<span class="flame ${cls}" title="${n} jour${n>1?'s':''} d'affilée avec toutes les tâches faites" aria-label="Série de ${n} jour${n>1?'s':''}">🔥 ${n}</span>`:'';
// Message affiché quand la série progresse.
export const cheer=n=>n>=2?`🔥 ${n} jours d'affilée, continue comme ça !`:'🔥 Première journée bouclée, la série commence !';

// Récompenses de groupe. Médaille : toute la famille a fait ses tâches ce jour-là. Coupe : toute la semaine.
export const medal=day=>`<span class="medal" data-medal="${day}" title="Médaille du jour : toute la famille a fait ses tâches" role="img" aria-label="Médaille de la famille">🏅</span>`;
export const smallMedal='<em class="smedal" aria-hidden="true">🏅</em>';
export const trophy=()=>`<div class="trophy" role="status"><span class="cup" aria-hidden="true">🏆</span><div><strong>Coupe de la semaine !</strong><span>Toute la famille a fait toutes ses tâches. Bravo à tous !</span></div></div>`;
// Vitrine : ce que la famille a gagné depuis le début. Rien tant qu'elle est vide.
export const showcase=a=>a&&(a.medals||a.trophies)?`<p class="awards" title="La vitrine de la famille">${a.trophies?`<span>🏆 ${a.trophies} coupe${a.trophies>1?'s':''}</span>`:''}${a.medals?`<span>🏅 ${a.medals} médaille${a.medals>1?'s':''}</span>`:''}</p>`:'';
export const teamCheer=week=>week?'🏆 Coupe de la semaine ! Toute la famille a tout fait.':'🏅 Médaille du jour pour toute la famille !';
