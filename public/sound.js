// Sons de célébration, synthétisés à la volée (Web Audio) : aucun fichier à charger.
// Coupables par appareil depuis le bouton haut-parleur de l'en-tête ; le choix reste dans ce navigateur.
import {icon} from '/icons.js';
let ctx,out,noise;
export const muted=()=>{try{return localStorage.getItem('sons')==='off'}catch{return false}};

// Les navigateurs (iPhone surtout) n'autorisent le son qu'à partir d'un geste : à appeler dans le clic, avant toute attente.
export function unlock(){
 if(muted())return;
 try{
  if(!ctx){const A=window.AudioContext||window.webkitAudioContext;if(!A)return;ctx=new A();
   // Le compresseur évite la saturation quand fanfare et crépitements se superposent.
   const comp=ctx.createDynamicsCompressor(),vol=ctx.createGain();vol.gain.value=.8;vol.connect(comp).connect(ctx.destination);out=vol;
   noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const n=noise.getChannelData(0);for(let i=0;i<n.length;i++)n[i]=Math.random()*2-1}
  if(ctx.state==='suspended')ctx.resume();
 }catch{ctx=null}
}
const ready=()=>!muted()&&ctx&&ctx.state!=='closed';

// Note de clochette : fondamentale en triangle, octave légère en sinus pour la brillance.
function bell(f,t,d=.5,gain=.16){
 for(const [mult,type,g] of [[1,'triangle',gain],[2,'sine',gain*.3]]){
  const o=ctx.createOscillator(),v=ctx.createGain();o.type=type;o.frequency.value=f*mult;
  v.gain.setValueAtTime(0,t);v.gain.linearRampToValueAtTime(g,t+.012);v.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(v).connect(out);o.start(t);o.stop(t+d+.05)}
}
// Cuivre de fanfare : dent de scie adoucie par un filtre.
function brass(f,t,d=.3,gain=.09){
 const o=ctx.createOscillator(),lp=ctx.createBiquadFilter(),v=ctx.createGain();o.type='sawtooth';o.frequency.value=f;lp.type='lowpass';lp.frequency.value=2200;
 v.gain.setValueAtTime(0,t);v.gain.linearRampToValueAtTime(gain,t+.03);v.gain.setValueAtTime(gain,t+d*.7);v.gain.exponentialRampToValueAtTime(.0001,t+d);
 o.connect(lp).connect(v).connect(out);o.start(t);o.stop(t+d+.05)
}
// Bruit filtré très court : le « pop » du canon à confettis et les crépitements des paillettes.
function burst(t,{freq=1800,q=1,d=.08,gain=.35}={}){
 const s=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),v=ctx.createGain();s.buffer=noise;bp.type='bandpass';bp.frequency.value=freq;bp.Q.value=q;
 v.gain.setValueAtTime(gain,t);v.gain.exponentialRampToValueAtTime(.0001,t+d);
 s.connect(bp).connect(v).connect(out);s.start(t,Math.random()*.5);s.stop(t+d+.02)
}
function thump(t){const o=ctx.createOscillator(),v=ctx.createGain();o.frequency.setValueAtTime(320,t);o.frequency.exponentialRampToValueAtTime(70,t+.12);
 v.gain.setValueAtTime(.4,t);v.gain.exponentialRampToValueAtTime(.0001,t+.15);o.connect(v).connect(out);o.start(t);o.stop(t+.2)}

// Effet sonore des confettis : un pop, puis des paillettes qui crépitent en retombant.
export function popSound(big=false){
 if(!ready())return;const t=ctx.currentTime+.01;
 thump(t);burst(t,{freq:big?1200:1800,q:.8,d:big?.18:.09,gain:big?.5:.35});
 const n=big?38:10,span=big?1.6:.6;
 for(let i=0;i<n;i++)burst(t+.05+Math.random()*span*Math.random(),{freq:3500+Math.random()*4000,q:6,d:.02+Math.random()*.03,gain:.06+Math.random()*.08});
}

// Musique de succès, de la plus discrète à la plus solennelle.
const C5=523.25,D5=587.33,E5=659.25,G5=783.99,C6=1046.5,E6=1318.5,G6=1568,G4=392;
export function success(kind='task'){
 if(!ready())return;const t=ctx.currentTime+.03;
 if(kind==='task'){bell(C6,t,.3);bell(G6,t+.09,.5)}
 else if(kind==='day'){[C5,E5,G5,C6].forEach((f,i)=>bell(f,t+i*.1,i===3?.9:.35));bell(E6,t+.4,.9,.08)}
 else if(kind==='medal'){[G4,C5,E5].forEach((f,i)=>bell(f,t+i*.11,.3));[C5,E5,G5,C6].forEach(f=>bell(f,t+.36,1.2,.11));bell(G6,t+.5,1,.06)}
 else if(kind==='trophy'){
  // Ta-ta-ta-taaa, réponse, puis accord final tenu.
  [[C5,0,.12],[C5,.14,.12],[C5,.28,.12],[G5,.42,.42],[E5,.9,.14],[G5,1.06,.9]].forEach(([f,at,d])=>{brass(f,t+at,d);bell(f*2,t+at,d,.05)});
  [C5,E5,G5,C6].forEach(f=>bell(f,t+1.06,1.6,.1));bell(E6,t+1.2,1.4,.05);
 }
}

// Bouton haut-parleur de l'en-tête : bascule les sons de cet appareil.
export function soundToggle(btn){
 const paint=()=>{const off=muted();btn.innerHTML=icon(off?'mute':'volume');btn.setAttribute('aria-pressed',String(!off));const l=off?'Activer les sons de célébration':'Couper les sons de célébration';btn.setAttribute('aria-label',l);btn.title=l};
 btn.hidden=false;paint();
 btn.onclick=()=>{const off=!muted();try{localStorage.setItem('sons',off?'off':'on')}catch{}paint();if(!off){unlock();success('task')}};
}
