self.addEventListener('push',event=>{let data={title:'À chacun son tour',body:'Consulte ton planning du jour.'};try{data={...data,...event.data.json()}}catch{}
 // Seule une adresse de ce site est acceptée comme destination du clic.
 let url='/';try{const u=new URL(data.url||'/',self.location.origin);if(u.origin===self.location.origin)url=u.pathname+u.search}catch{}
 event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:data.tag||'planning',data:{url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/';
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{for(const client of list){const u=new URL(client.url);if(u.origin===self.location.origin&&u.pathname+u.search===url)return client.focus();}return clients.openWindow(url);}));});
