// Mises à jour en direct : Supabase Realtime signale chaque changement des tables du foyer, et l'écran se relit aussitôt.
// Le protocole Phoenix (version 1.0.0, en JSON) tient en quatre messages : rejoindre, battre le cœur, renouveler le jeton, quitter.
// La sécurité par ligne filtre les insertions et modifications reçues ; les suppressions, elles, arrivent à tous (identifiant seul) : à l'appelant de trier.
// onChange(null) signale un abonnement (re)pris : des changements ont pu passer avant ou pendant la coupure, il faut tout relire.
export function live({url,key,token,tables,onChange,onState}){
 // Nom de canal propre à cet écran : un canal public partagé recevrait les diffusions de n'importe qui.
 const topic='realtime:foyer-'+crypto.randomUUID();
 let ws,beat,renew,timer,retry=0,ref=0,joined=null,subscribed=false,stopped=false;
 const push=(event,payload,t=topic)=>{if(ws?.readyState===1)ws.send(JSON.stringify({topic:t,event,payload,ref:String(++ref),join_ref:t===topic?joined:null}))};
 const state=v=>{if(v!==subscribed){subscribed=v;onState?.(v)}};
 function connect(){
  if(stopped||ws)return;clearTimeout(timer);
  const s=ws=new WebSocket(url.replace(/^http/,'ws')+'/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0');
  s.onopen=async()=>{let access;try{access=await token()}catch{return s.close()}if(ws!==s)return;joined=String(++ref);
   s.send(JSON.stringify({topic,event:'phx_join',ref:joined,join_ref:joined,payload:{config:{broadcast:{self:false},presence:{enabled:false},postgres_changes:tables.map(table=>({event:'*',schema:'public',table})),private:false},access_token:access}}));
   beat=setInterval(()=>push('heartbeat',{},'phoenix'),25000);
   // Le jeton de session vit une heure : il est renouvelé bien avant, sans quoi le serveur ferme le canal.
   renew=setInterval(async()=>{try{push('access_token',{access_token:await token()})}catch{}},300000)};
  s.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.topic!==topic||ws!==s)return;const p=m.payload||{};
   if(m.event==='phx_reply'&&m.ref===joined&&p.status!=='ok')s.close();
   else if(m.event==='system'&&p.extension==='postgres_changes'){if(p.status==='ok'){retry=0;state(true);onChange(null)}
    // Table absente de la publication supabase_realtime : database/realtime.sql n'a pas été exécuté. Le rafraîchissement périodique prend le relais.
    else{console.warn('Mises à jour en direct indisponibles : '+(p.message||'refus du serveur')+'. Exécuter database/realtime.sql dans Supabase.');retry=Math.max(retry,4);s.close()}}
   else if(m.event==='postgres_changes'&&p.data)onChange(p.data);
   else if(m.event==='phx_error'||m.event==='phx_close')s.close()};
  s.onclose=()=>{if(ws!==s)return;clearInterval(beat);clearInterval(renew);ws=null;state(false);
   if(!stopped)timer=setTimeout(connect,[1000,2000,5000,10000,60000][Math.min(retry++,4)])};
 }
 connect();
 return {
  // Retour au premier plan : un téléphone coupe souvent la connexion d'une page en arrière-plan, on la rétablit sans attendre.
  wake(){if(!ws&&!stopped){retry=0;connect()}},
  stop(){stopped=true;clearTimeout(timer);if(ws){push('phx_leave',{});const s=ws;ws=null;clearInterval(beat);clearInterval(renew);s.close()}state(false)},
  get on(){return subscribed}
 };
}
