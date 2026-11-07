'use strict';
/**
 * БУНКЕР: ЕКОНОМІКА — онлайн-кімнати без сторонніх npm-залежностей.
 * Node.js 20+; realtime: Server-Sent Events, actions: JSON POST.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DECK = require('./deck');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STORE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const MAX_PLAYERS = 20; // мінімальна категорія містить рівно 20 карт
const MAX_TEAMS = 8;
const MAX_ROOMS = 300;
const BASE = path.join(__dirname, 'public');
const CATEGORIES = DECK.map(({id, number, title}) => ({id, number, title}));
const byCategory = Object.fromEntries(DECK.map(c => [c.id, c]));
const rooms = new Map();
const deckUsage = Object.fromEntries(DECK.map(c => [c.id, Array.from({length: c.cards.length}, () => ({used: 0, last: 0}))]));
let drawClock = 0;
const limits = new Map();

function secureToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function randId() { return crypto.randomBytes(8).toString('hex'); }
function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cleanText(value, length=40) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0,length);
}
function checkedNum(value, lo, hi) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < lo || n > hi) fail('Некоректне число.', 400);
  return n;
}
function fail(message, code=400) { const error = new Error(message); error.status=code; throw error; }
function requireRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) fail('Кімнату не знайдено або її термін дії завершився.', 404);
  return room;
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:6}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function getIdentity(room, token) {
  if (!token) return {role: 'guest'};
  if (typeof token !== 'string' || token.length > 100) fail('Невірний ключ доступу.', 401);
  const hash = tokenHash(token);
  if (hash === room.hostTokenHash) return {role:'host'};
  const player = room.players.find(p => p.tokenHash === hash);
  if (player) return {role:'player',player};
  fail('Доступ не підтверджено. Оновіть посилання або приєднайтесь знову.', 401);
}
function materialize(card) {
  const category = byCategory[card.categoryId];
  if (!category) return null;
  const raw = category.cards[card.cardId];
  if (raw === undefined) return null;
  return {categoryId: category.id, number: category.number, category: category.title,
    title: Array.isArray(raw) ? raw[0] : raw,
    description: Array.isArray(raw) ? raw[1] : '',
    used: !!card.used};
}
function publicPlayer(room, player) {
  const opened = player.cards.filter(c=>player.revealed.includes(c.categoryId)).map(materialize).filter(Boolean);
  const connections = [...room.clients].filter(c=>c.role==='player' && c.playerId===player.id).length;
  return {id:player.id, name:player.name, teamId:player.teamId, eliminated:!!player.eliminated,
    online:connections>0, opened, revealedCount:opened.length, totalCards:player.cards.length};
}
function snapshot(room, identity={role:'guest'}) {
  const payload = {code:room.code, role:identity.role, phase:room.phase, round:room.round,
    settings:{cardCount:room.cardCount, maxPlayers:MAX_PLAYERS, maxTeams:MAX_TEAMS},
    teams:room.teams.map(t=>({id:t.id,name:t.name})),
    players:room.players.map(p=>publicPlayer(room,p)),
    categories:CATEGORIES, events:room.events.slice(-10),
    createdAt:room.createdAt, lastActiveAt:room.lastActiveAt};
  if(identity.role==='player') {
    const p = identity.player;
    payload.myPlayerId=p.id;
    payload.myHand=p.cards.map(materialize).filter(Boolean);
  }
  return payload;
}
function logEvent(room, text) {
  room.events.push({time:Date.now(),text});
  if(room.events.length>30) room.events.splice(0,room.events.length-30);
  room.lastActiveAt=Date.now();
}
function serialize() {
  return {version:1,drawClock,deckUsage,
    rooms:[...rooms.values()].map(({clients, ...rest})=>rest)};
}
function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE),{recursive:true});
    const temp=STORE+'.'+process.pid+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(serialize()),{mode:0o600});
    fs.renameSync(temp,STORE);
  } catch(e) { console.error('Помилка збереження:',e.message); }
}
function restore() {
  try {
    if(!fs.existsSync(STORE)) return;
    const raw=JSON.parse(fs.readFileSync(STORE,'utf8'));
    if(raw.version!==1) return;
    if(Number.isInteger(raw.drawClock)) drawClock=raw.drawClock;
    for(const cat of DECK) {
      const source=raw.deckUsage?.[cat.id];
      if(Array.isArray(source) && source.length===cat.cards.length) {
        deckUsage[cat.id]=source.map(e=>({used:Math.max(0,Number(e.used)||0),last:Math.max(0,Number(e.last)||0)}));
      }
    }
    for(const record of raw.rooms || []) {
      if(/^[A-Z2-9]{6}$/.test(record.code) && record.hostTokenHash && Array.isArray(record.players) && Array.isArray(record.teams))
        rooms.set(record.code,{...record,clients:new Set()});
    }
    console.log(`Відновлено кімнат: ${rooms.size}`);
  } catch(e) {console.error('Не вдалося завантажити збереження:',e.message);}
}
function registerUsage(categoryId,cardId) {
  drawClock++;
  const usage=deckUsage[categoryId][cardId];
  usage.used++;
  usage.last=drawClock;
}
function bestAssignment(players, ids, categoryId) {
  // Шукаємо перестановку з мінімумом повторів ТІЄЇ САМОЇ картки для ТІЄЇ САМОЇ людини.
  let best=shuffle(ids), bestScore=Infinity;
  for(let attempt=0; attempt<250; attempt++) {
    const candidate=attempt===0 ? best.slice() : shuffle(ids);
    const score=candidate.reduce((sum,id,i)=>{
      const raw=byCategory[categoryId].cards[id];
      const title=Array.isArray(raw)?raw[0]:raw;
      const alreadyHasSameText=players[i].cards.some(card=>{
        const existing=byCategory[card.categoryId].cards[card.cardId];
        return (Array.isArray(existing)?existing[0]:existing)===title;
      });
      return sum+(players[i].previous?.[categoryId]===id?1:0)+(alreadyHasSameText?20:0);
    },0);
    if(score < bestScore){bestScore=score;best=candidate;}
    if(bestScore===0) break;
  }
  return best;
}
function freshCardsFor(room) {
  const players=shuffle(room.players);
  const perCategory=Object.fromEntries(DECK.map(c=>[c.id, []]));
  for(const player of players) {
    const selected=shuffle(DECK).slice(0,room.cardCount);
    for(const cat of selected) perCategory[cat.id].push(player);
    player.cards=[];player.revealed=[];player.eliminated=false;
  }
  for(const cat of DECK) {
    const participants=shuffle(perCategory[cat.id]);
    if (!participants.length) continue;
    const ranked=shuffle(cat.cards.map((_,i)=>i)).sort((a,b)=>{
      const x=deckUsage[cat.id][a],y=deckUsage[cat.id][b];
      return x.used-y.used || x.last-y.last;
    });
    const chosen=ranked.slice(0,participants.length);
    const assigned=bestAssignment(participants,chosen,cat.id);
    participants.forEach((p,i)=> {
      const id=assigned[i];
      p.cards.push({categoryId:cat.id,cardId:id,used:false});
      p.previous=p.previous||{};
      p.previous[cat.id]=id;
      registerUsage(cat.id,id);
    });
  }
  for(const p of room.players) p.cards.sort((a,b)=>byCategory[a.categoryId].number-byCategory[b.categoryId].number);
}
function notify(room) {
  for(const client of [...room.clients]) {
    try {
      const identity=client.role==='host'?{role:'host'}:
        client.role==='player'?{role:'player',player:room.players.find(p=>p.id===client.playerId)}:{role:'guest'};
      if(identity.role==='player' && !identity.player) {client.res.end();room.clients.delete(client);continue;}
      client.res.write('event: state\ndata: '+JSON.stringify(snapshot(room,identity))+'\n\n');
    } catch(_) {room.clients.delete(client);try{client.res.end()}catch{}}
  }
}
function commit(room) {room.lastActiveAt=Date.now();persist();notify(room);}
function checkRate(ip, key, limit, windowMs) {
  const now=Date.now(), id=ip+':'+key;
  let row=limits.get(id);
  if(!row || now-row.start>windowMs) row={start:now,count:0};
  row.count++;limits.set(id,row);
  if(row.count>limit) fail('Забагато спроб. Спробуйте трохи пізніше.', 429);
}
function json(res,code,value) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
function readJSON(req) {
  return new Promise((resolve,reject)=>{
    let data='',finished=false;
    req.on('data',chunk=>{
      if(finished) return;
      data+=chunk.toString('utf8');
      if(data.length>12_000){finished=true;reject(Object.assign(new Error('Завеликий запит.'),{status:413}));req.destroy();}
    });
    req.on('end',()=>{if(finished)return;try{resolve(JSON.parse(data||'{}'));}catch{reject(Object.assign(new Error('Некоректний JSON.'),{status:400}));}});
    req.on('error',reject);
  });
}
function requireHost(identity) {if(identity.role!=='host')fail('Лише ведучий може виконати цю дію.',403);}
function requirePlayer(identity) {if(identity.role!=='player')fail('Ця дія доступна лише учаснику.',403);}
function requireLobby(room) {if(room.phase!=='lobby')fail('Цю дію можна виконати лише до початку партії.',409);}
function getPlayer(room, id) {const p=room.players.find(p=>p.id===id);if(!p)fail('Гравця не знайдено.',404);return p;}
function getTeam(room,id) {const t=room.teams.find(t=>t.id===id);if(!t)fail('Команду не знайдено.',404);return t;}
function command(room,identity,data) {
  const type=cleanText(data.type,40);
  const hostActions=['addTeam','renameTeam','removeTeam','movePlayer','kickPlayer','setCardCount',
    'startGame','newDeal','nextRound','toggleEliminate','backToLobby','adminReveal','adminConceal','adminRedraw','swapCards','finishGame'];
  const playerActions=['reveal','useSpecial','leaveRoom'];
  if(hostActions.includes(type)) requireHost(identity);
  else if(playerActions.includes(type)) requirePlayer(identity);
  else fail('Невідома дія.');
  switch(type) {
    case 'addTeam': {
      requireLobby(room);
      if(room.teams.length>=MAX_TEAMS)fail('Максимум 8 команд.');
      const name=cleanText(data.name,32)||`Команда ${room.teams.length+1}`;
      if(room.teams.some(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('Така команда вже є.');
      room.teams.push({id:randId(),name});logEvent(room,`Додано команду «${name}».`);break;
    }
    case 'renameTeam': {
      requireLobby(room);
      const t=getTeam(room,data.teamId),name=cleanText(data.name,32);
      if(!name)fail('Введіть назву команди.');
      if(room.teams.some(x=>x.id!==t.id && x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('Така команда вже є.');
      t.name=name;break;
    }
    case 'removeTeam': {
      requireLobby(room);
      if(room.teams.length<=1)fail('Повинна залишитися хоча б одна команда.');
      const t=getTeam(room,data.teamId);
      if(room.players.some(p=>p.teamId===t.id))fail('Спочатку перемістіть гравців до іншої команди.');
      room.teams=room.teams.filter(x=>x.id!==t.id);break;
    }
    case 'movePlayer': {
      requireLobby(room);
      const p=getPlayer(room,data.playerId),t=getTeam(room,data.teamId);
      p.teamId=t.id;logEvent(room,`${p.name} перейшов(ла) до команди «${t.name}».`);break;
    }
    case 'kickPlayer': {
      const p=getPlayer(room,data.playerId);
      room.players=room.players.filter(x=>x.id!==p.id);
      logEvent(room,`${p.name} більше не бере участі.`);break;
    }
    case 'setCardCount': {
      requireLobby(room);room.cardCount=checkedNum(data.cardCount,1,8);break;
    }
    case 'startGame':
    case 'newDeal': {
      if(type==='startGame') requireLobby(room);
      if(type==='newDeal' && room.phase==='lobby')fail('Спочатку почніть гру.');
      if(!room.players.length)fail('Спочатку додайте хоча б одного гравця.');
      freshCardsFor(room);room.round=1;room.phase='playing';
      logEvent(room,type==='startGame'?'Гру розпочато! Картки роздано приватно.':'Нову партію роздано. Картки оновились.');break;
    }
    case 'nextRound': {
      if(room.phase!=='playing')fail('Гра ще не почалась.');
      room.round++;logEvent(room,`Розпочався раунд ${room.round}.`);break;
    }
    case 'toggleEliminate': {
      if(room.phase!=='playing')fail('Гра ще не почалась.');
      const p=getPlayer(room,data.playerId);p.eliminated=!p.eliminated;
      logEvent(room,p.eliminated?`${p.name} вибув(ла) з гри.`:`${p.name} повернувся(лась) до гри.`);break;
    }
    case 'backToLobby': {
      room.phase='lobby';room.round=0;
      for(const p of room.players){p.cards=[];p.revealed=[];p.eliminated=false;}
      logEvent(room,'Ведучий повернув усіх до лобі.');break;
    }
    case 'finishGame': {
      if(room.phase!=='playing')fail('Гра ще не почалась.');
      room.phase='finished';logEvent(room,'Партію завершено.');break;
    }
    case 'adminReveal':
    case 'adminConceal': {
      if(room.phase==='lobby')fail('Гра ще не почалась.');
      const p=getPlayer(room,data.playerId);
      const cat=cleanText(data.categoryId,25);
      if(!p.cards.some(c=>c.categoryId===cat))fail('Такої картки у гравця немає.');
      if(type==='adminReveal' && !p.revealed.includes(cat))p.revealed.push(cat);
      if(type==='adminConceal')p.revealed=p.revealed.filter(x=>x!==cat);
      logEvent(room,`${p.name}: ведучий ${type==='adminReveal'?'відкрив':'приховав'} карту «${byCategory[cat].title}».`);break;
    }
    case 'adminRedraw': {
      if(room.phase!=='playing')fail('Гра ще не почалась.');
      const p=getPlayer(room,data.playerId),catId=cleanText(data.categoryId,25),cat=byCategory[catId];
      if(!cat)fail('Невідома категорія.');
      const card=p.cards.find(c=>c.categoryId===catId);
      if(!card)fail('У гравця немає картки цієї категорії.');
      const occupied=new Set(room.players.flatMap(person=>person.cards.filter(c=>c.categoryId===catId).map(c=>c.cardId)));
      const candidates=shuffle(cat.cards.map((_,i)=>i)).filter(i=>!occupied.has(i) && i!==card.cardId)
        .sort((a,b)=>deckUsage[catId][a].used-deckUsage[catId][b].used || deckUsage[catId][a].last-deckUsage[catId][b].last);
      if(!candidates.length) fail('Усі картки цієї категорії вже використані гравцями.');
      card.cardId=candidates[0];card.used=false;p.revealed=p.revealed.filter(x=>x!==catId);
      p.previous[catId]=card.cardId;registerUsage(catId,card.cardId);
      logEvent(room,`${p.name} отримав(ла) нову приховану карту «${cat.title}».`);break;
    }
    case 'swapCards': {
      if(room.phase!=='playing')fail('Гра ще не почалась.');
      const p1=getPlayer(room,data.playerId),p2=getPlayer(room,data.otherPlayerId);
      if(p1.id===p2.id)fail('Оберіть двох різних гравців.');
      const cat=cleanText(data.categoryId,25);
      const a=p1.cards.find(c=>c.categoryId===cat), b=p2.cards.find(c=>c.categoryId===cat);
      if(!a||!b)fail('Обидва гравці повинні мати цю категорію.');
      [a.cardId,b.cardId]=[b.cardId,a.cardId];[a.used,b.used]=[b.used,a.used];
      p1.previous[cat]=a.cardId;p2.previous[cat]=b.cardId;
      p1.revealed=p1.revealed.filter(c=>c!==cat);p2.revealed=p2.revealed.filter(c=>c!==cat);
      logEvent(room,`${p1.name} і ${p2.name} обмінялися картками «${byCategory[cat].title}» (обидві приховано).`);break;
    }
    case 'reveal': {
      if(room.phase!=='playing')fail('Гра зараз не активна.');
      const p=identity.player,cat=cleanText(data.categoryId,25);
      if(p.eliminated)fail('Виключений гравець не може відкривати картки.');
      if(!p.cards.some(c=>c.categoryId===cat))fail('Такої картки у вас немає.');
      if(p.revealed.includes(cat))fail('Ця картка вже відкрита.');
      p.revealed.push(cat);logEvent(room,`${p.name} відкрив(ла) карту «${byCategory[cat].title}».`);break;
    }
    case 'useSpecial': {
      if(room.phase!=='playing')fail('Гра зараз не активна.');
      const card=identity.player.cards.find(c=>c.categoryId==='special');
      if(!card)fail('У вас немає особливої картки.');
      if(card.used)fail('Цю картку вже використано.');
      card.used=true;logEvent(room,`${identity.player.name} використав(ла) особливу картку (дію виконує ведучий).`);break;
    }
    case 'leaveRoom': {
      requireLobby(room);
      room.players=room.players.filter(p=>p.id!==identity.player.id);
      logEvent(room,`${identity.player.name} залишив(ла) кімнату.`);break;
    }
  }
  commit(room);
  return {ok:true};
}
function serveStatic(req,res,url) {
  const pathname=url.pathname==='/'?'/index.html':url.pathname;
  const safe=path.posix.normalize(pathname);
  if(!/^\/(index\.html|app\.js|styles\.css|favicon\.svg|manifest\.webmanifest)$/.test(safe))fail('Сторінку не знайдено.',404);
  const file=path.join(BASE,safe);
  const mime=safe.endsWith('.js')?'text/javascript; charset=utf-8':safe.endsWith('.css')?'text/css; charset=utf-8':safe.endsWith('.svg')?'image/svg+xml':safe.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':safe==='/index.html'?'no-store':'public, max-age=3600'});
  fs.createReadStream(file).pipe(res);
}
function apiHandler(req,res,url) {
  const method=req.method;
  if(url.pathname==='/api/health' && method==='GET') return json(res,200,{ok:true,rooms:rooms.size});
  if(url.pathname==='/api/config' && method==='GET') return json(res,200,{categories:CATEGORIES,maxPlayers:MAX_PLAYERS,maxTeams:MAX_TEAMS});
  if(url.pathname==='/api/rooms' && method==='POST') return readJSON(req).then(data=>{
    const ip=req.socket.remoteAddress||'unknown';checkRate(ip,'create',15,600000);
    if(rooms.size>=MAX_ROOMS)fail('Зараз забагато відкритих кімнат.',503);
    const hostToken=secureToken(),code=makeCode(),cardCount=data.cardCount==null?8:checkedNum(data.cardCount,1,8);
    const supplied=Array.isArray(data.teamNames)?data.teamNames:[];
    const names=supplied.slice(0,MAX_TEAMS).map(n=>cleanText(n,32)).filter(Boolean);
    const teamNames=names.length?names:['Команда 1'];
    if(new Set(teamNames.map(n=>n.toLocaleLowerCase())).size!==teamNames.length)fail('Назви команд повинні бути різними.');
    const room={code,hostTokenHash:tokenHash(hostToken),phase:'lobby',round:0,cardCount,
      teams:teamNames.map(n=>({id:randId(),name:n})),players:[],events:[],
      createdAt:Date.now(),lastActiveAt:Date.now(),clients:new Set()};
    logEvent(room,'Кімнату створено. Надішліть посилання учасникам.');
    rooms.set(code,room);persist();
    json(res,201,{code,token:hostToken});
  });
  const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|action|events))?$/i);
  if(!match)fail('Невідома адреса API.',404);
  const room=requireRoom(match[1]);const sub=match[2]||'';
  if(!sub && method==='GET') {
    const identity=getIdentity(room,url.searchParams.get('token'));
    return json(res,200,snapshot(room,identity));
  }
  if(sub==='events' && method==='GET') {
    const identity=getIdentity(room,url.searchParams.get('token'));
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(': connected\n\n');
    const client={res,role:identity.role,playerId:identity.player?.id};room.clients.add(client);
    res.on('close',()=>{room.clients.delete(client);notify(room);});
    notify(room);return;
  }
  if(sub==='join' && method==='POST') return readJSON(req).then(data=>{
    checkRate(req.socket.remoteAddress||'unknown','join',70,600000);
    requireLobby(room);
    if(room.players.length>=MAX_PLAYERS)fail(`До однієї кімнати можна додати максимум ${MAX_PLAYERS} учасників.`);
    const name=cleanText(data.name,32),team=getTeam(room,data.teamId);
    if(name.length<2)fail('Ім’я повинно мати щонайменше 2 символи.');
    if(room.players.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('Такий нікнейм уже зайнятий.');
    const token=secureToken();
    const player={id:randId(),tokenHash:tokenHash(token),name,teamId:team.id,cards:[],revealed:[],
      eliminated:false,previous:{},joinedAt:Date.now()};
    room.players.push(player);logEvent(room,`${name} приєднався(лась) до команди «${team.name}».`);
    commit(room);return json(res,201,{token,playerId:player.id,code:room.code});
  });
  if(sub==='action' && method==='POST') return readJSON(req).then(data=>{
    const identity=getIdentity(room,data.token);
    const result=command(room,identity,data);
    return json(res,200,result);
  });
  fail('Метод не підтримується.',405);
}
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const origin=req.headers.origin;
  if(origin && ['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    try {
      const o=new URL(origin),host=req.headers.host;
      if(o.host!==host) return json(res,403,{error:'Заборонений зовнішній запит.'});
    }catch{return json(res,403,{error:'Недійсне джерело запиту.'});}
  }
  let url;
  try {url=new URL(req.url,'http://localhost');}catch{return json(res,400,{error:'Неправильна адреса.'});}
  try {
    const result=url.pathname.startsWith('/api/')?apiHandler(req,res,url):serveStatic(req,res,url);
    if(result?.catch)result.catch(err=>handleError(res,err));
  } catch(err){handleError(res,err);}
});
function handleError(res,err) {
  if(res.headersSent){try{res.end()}catch{};return;}
  if(!err.status)console.error(err);
  json(res,err.status||500,{error:err.status?err.message:'Помилка сервера.'});
}
restore();
const pulse=setInterval(()=>{
  for(const room of rooms.values()) for(const client of room.clients) {
    try {client.res.write(': ping\n\n');} catch {room.clients.delete(client);}
  }
},20000);
pulse.unref();
const gc=setInterval(()=>{
  const now=Date.now();let changed=false;
  for(const [code,room] of rooms){if(room.clients.size===0 && now-room.lastActiveAt>14*24*3600*1000){rooms.delete(code);changed=true;}}
  if(changed)persist();
  for(const [key,value] of limits)if(now-value.start>600000)limits.delete(key);
},3600000);
gc.unref();
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`БУНКЕР ONLINE → http://localhost:${PORT}`));
module.exports={server,rooms,DECK,deckUsage,snapshot};
