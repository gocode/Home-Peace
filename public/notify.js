// État des notifications sur cet appareil, partagé par l'application et la page du lien personnel.
// request(action,body) envoie à /api/push avec l'identité de la page : session du compte ou jeton du lien.
const ios=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
const key=vapid=>{const base=vapid.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),c=>c.charCodeAt(0))};
// Si le service worker ne s'enregistre pas, ready ne se résout jamais : on n'attend pas indéfiniment.
const worker=()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,no)=>setTimeout(()=>no(Error('Service worker indisponible.')),10000))]);
// Un abonnement créé avec d'anciennes clés VAPID ne reçoit plus rien : il faut le refaire.
const stale=(sub,vapid)=>{const k=sub.options?.applicationServerKey;if(!k)return false;const a=new Uint8Array(k),b=key(vapid);return a.length!==b.length||a.some((x,i)=>x!==b[i])};

export async function deviceState(vapid,request){
 // Sans clé serveur, on peut déjà obtenir l'autorisation : l'abonnement suivra dès que la clé sera là.
 if(!vapid)return supported()&&Notification.permission==='granted'?'attente':'config';
 if(!supported())return ios()&&!standalone()?'ios':'unsupported';
 if(Notification.permission==='denied')return 'denied';
 if(Notification.permission!=='granted')return 'off';
 let sub;
 try{const reg=await worker();sub=await reg.pushManager.getSubscription();
  if(sub&&stale(sub,vapid)){await sub.unsubscribe();sub=null}
  // Autorisation déjà accordée mais abonnement perdu : on le rétablit sans rien demander.
  if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(vapid)});await request('subscribe',sub.toJSON());return 'ok'}
 }catch{return 'off'}
 try{const {state}=await request('status',{endpoint:sub.endpoint});
  if(state==='absent'){await request('subscribe',sub.toJSON());return 'ok'}
  return state==='autre'?'autre':'ok';
 }catch{return 'inconnu'}
}

// À appeler directement depuis un clic : Safari n'accorde la demande d'autorisation qu'à un geste de l'utilisateur.
// Rend 'ok' une fois abonné, ou 'attente' quand l'autorisation est accordée mais que le serveur n'a pas encore sa clé.
export async function enableDevice(vapid,request){
 if(!supported())throw Error(ios()&&!standalone()?"Sur iPhone, ajoute d'abord l'application à l'écran d'accueil, puis ouvre-la depuis l'icône.":"Ce navigateur ne gère pas les notifications. Essaie avec Chrome, Edge, Firefox ou Safari récent.");
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw Error(permission==='denied'?'Les notifications sont bloquées : rouvre-les dans les réglages du navigateur ou du téléphone.':'Autorise les notifications pour être prévenu.');
 if(!vapid)return 'attente';
 const reg=await worker();let sub=await reg.pushManager.getSubscription();
 if(sub&&stale(sub,vapid)){await sub.unsubscribe();sub=null}
 sub=sub||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(vapid)});
 await request('subscribe',sub.toJSON());
 return 'ok';
}

const texts={
 off:['Les notifications sont désactivées sur cet appareil',"Tu ne seras pas prévenu quand une tâche t'attend, ni quand une validation est demandée. Active-les, cela prend deux secondes.",'Activer les notifications'],
 autre:["Cet appareil reçoit les rappels d'un autre profil","Les tâches qui t'attendent ne te sont pas signalées ici.",'Recevoir mes rappels ici'],
 denied:['Les notifications sont bloquées sur cet appareil',"Tu les as refusées pour ce site, l'application ne peut plus les redemander. Sur Android : touche l'icône à gauche de l'adresse, puis Autorisations → Notifications. Sur iPhone : Réglages → Notifications → À chacun son tour. Recharge ensuite cette page."],
 ios:['Installe l’application pour recevoir les rappels',"Sur iPhone, les notifications ne fonctionnent que depuis l'écran d'accueil (iOS 16.4 minimum) : touche Partager → Sur l'écran d'accueil, puis ouvre l'application depuis sa nouvelle icône."],
 unsupported:['Ce navigateur ne peut pas recevoir de notifications',"Ouvre le planning avec Chrome, Edge, Firefox ou un Safari récent pour être prévenu des tâches qui t'attendent."],
 config:['Les notifications ne sont pas encore en service',"Le serveur n'a pas encore ses clés de notification. Autorise dès maintenant cet appareil : il s'abonnera tout seul dès que le service sera prêt.",'Autoriser les notifications'],
 attente:['Notifications autorisées, en attente du serveur',"Cet appareil est prêt et s'abonnera tout seul dès que le serveur aura ses clés de notification. Préviens la personne qui gère l'application."]};

// Bannière d'alerte, vide quand tout va bien ou quand l'état n'a pas pu être établi. Le bouton porte l'identifiant enablepush.
export function alertHtml(state){const t=texts[state];if(!t)return '';
 return `<div class="alert" role="alert"><strong>⚠ ${t[0]}</strong><p>${t[1]}</p>${t[2]?`<button class="primary" id="enablepush">${t[2]}</button>`:''}</div>`}
