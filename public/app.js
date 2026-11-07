'use strict';
/* Доступ до закритих карток надходить лише від сервера власнику; у клієнті немає колоди. */
const $ = id => document.getElementById(id);
const app = $('app'), modalRoot = $('modal-root');
const CATEGORY_SIGNS = {profession:'▣',biology:'◷',health:'✚',hobby:'✳',baggage:'▤',fact1:'✦',fact2:'◈',special:'✧'};
let roomCode=null, token='', state=null, es=null, screen='home', currentTeam=null, currentPlayer=null, playerView='hand', toastTimeout=null, temporaryModal=null;
function escapeHTML(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const e = escapeHTML;
function key(code){return `bunker_online_session_${code}`;}
function storedToken(code){try{return JSON.parse(localStorage.getItem(key(code)))?.token||''}catch{return ''}}
function saveToken(code,t){localStorage.setItem(key(code),JSON.stringify({token:t}));}
function forgetToken(code){localStorage.removeItem(key(code));}
function roomLink(){return `${location.origin}/?room=${encodeURIComponent(roomCode)}`;}
function setConnection(value){const node=$('connection');node.className=`connection ${value==='offline'?'offline':''}`;node.innerHTML=`<span class="signal-dot"></span> ${e(value==='online'?'НА ЗВ’ЯЗКУ':value==='offline'?'НЕМАЄ ЗВ’ЯЗКУ':'З’ЄДНАННЯ…')}`;}
function notify(message,isError=false){const node=$('toast');node.textContent=message;node.classList.toggle('error',isError);node.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>node.hidden=true,4200);}
function loading(){app.innerHTML='<div class="loading">З’єднуємося з сервером…</div>';}
async function request(url,options={}){
  let response;
  try{response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});}catch{throw new Error('Немає зв’язку із сервером. Перевірте інтернет.');}
  let data;try{data=await response.json();}catch{data={error:'Некоректна відповідь сервера.'};}
  if(!response.ok){const err=new Error(data.error||'Помилка запиту.');err.status=response.status;throw err;}
  return data;
}
async function enterRoom(code){
  const raw=String(code||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(raw)){notify('Введіть шестизначний код кімнати.',true);return;}
  if(es){es.close();es=null;}
  roomCode=raw;state=null;token=storedToken(raw);screen='room';loading();setConnection('connecting');
  const qs=token?'?token='+encodeURIComponent(token):'';
  try{state=await request(`/api/rooms/${raw}${qs}`);}catch(err){
    if(err.status===401 && token){forgetToken(raw);token='';try{state=await request(`/api/rooms/${raw}`);}catch(e2){notify(e2.message,true);return goHome();}}
    else {notify(err.message,true);return goHome();}
  }
  history.replaceState({},'',`/?room=${raw}`);
  render();connectStream();
}
function connectStream(){
  if(es){es.close();es=null;}
  if(!roomCode)return;
  es=new EventSource(`/api/rooms/${roomCode}/events${token?'?token='+encodeURIComponent(token):''}`);
  es.addEventListener('state',ev=>{
    try{state=JSON.parse(ev.data);setConnection('online');render();}catch{ /* ignore invalid packet */ }
  });
  es.onopen=()=>setConnection('online');
  es.onerror=()=>setConnection('offline');
}
function goHome(){if(es){es.close();es=null;}roomCode=null;state=null;screen='home';history.replaceState({},'','/');setConnection('connecting');render();}
async function sendCommand(type,payload={}){
  if(!roomCode||!token)throw new Error('Ви не приєднались до кімнати.');
  return request(`/api/rooms/${roomCode}/action`,{method:'POST',body:JSON.stringify({type,token,...payload})});
}
async function runCommand(type,payload={},success=''){
  try{await sendCommand(type,payload);if(success)notify(success);}catch(err){notify(err.message,true);if(err.status===401){forgetToken(roomCode);token='';await enterRoom(roomCode);}}
}
async function copyText(value){
  try{await navigator.clipboard.writeText(value);notify('Скопійовано!');}
  catch{
    const el=document.createElement('textarea');el.value=value;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();
    try{document.execCommand('copy');notify('Скопійовано!');}catch{notify('Скопіюйте посилання вручну.',true);}el.remove();
  }
}
function home(){return `
  <div class="eyebrow">ЕКОНОМІЧНА ГРА · У ПРЯМОМУ ЕФІРІ</div>
  <div class="hero"><div><h1>БУНКЕР:<br><em>ЕКОНОМІКА</em><span style="font-size:.26em;vertical-align:top;letter-spacing:-.06em;margin-left:9px;color:#b1ccac">ONLINE</span></h1>
  <p>Світ змінився. Ресурсів обмаль. Кого візьмуть у бункер? Створюй кімнату, запрошуй команду й відкривай свої секрети тоді, коли це вигідно.</p></div><div class="hero-insignia"><span>₴</span></div></div>
  <div class="hero-metrics"><div class="metric"><strong>176</strong><span>КАРТОК У ГРІ</span></div><div class="metric"><strong>08</strong><span>КАТЕГОРІЙ</span></div><div class="metric"><strong>20</strong><span>ГРАВЦІВ У КІМНАТІ</span></div><div class="metric"><strong>LIVE</strong><span>СИНХРОНІЗАЦІЯ</span></div></div>
  <div class="grid two">
    <div class="setup-card"><div class="eyebrow">01 / ДЛЯ ВЕДУЧОГО</div><h2>Створити кімнату</h2><p>Налаштуй гру та поділись посиланням. Учасники приєднаються кожен зі свого телефона.</p>
      <form data-form="create"><label class="label" for="teams-input">НАЗВИ КОМАНД · ЧЕРЕЗ КОМУ</label><input class="form-field" id="teams-input" name="teams" maxlength="250" placeholder="Команда 1, Команда 2" value="Команда 1, Команда 2"><label class="label" for="card-count">КАРТОК НА ГРАВЦЯ</label><select id="card-count" class="form-field" name="cardCount">${Array.from({length:8},(_,i)=>`<option value="${i+1}" ${i===7?'selected':''}>${i+1} ${i===0?'картка':i<4?'картки':'карток'}</option>`).join('')}</select>
      <p class="helper">Можна створити до 8 команд. В одній кімнаті — до 20 гравців.</p><button class="btn primary full large" style="margin-top:18px" type="submit">СТВОРИТИ КІМНАТУ ↗</button></form></div>
    <div class="setup-card secondary"><div class="eyebrow">02 / ДЛЯ УЧАСНИКА</div><h2>Приєднатися</h2><p>Отримай код від ведучого або просто відкрий посилання-запрошення.</p>
      <form data-form="enter"><label class="label" for="join-code">КОД КІМНАТИ</label><input name="code" id="join-code" class="form-field" maxlength="6" autocomplete="off" spellcheck="false" placeholder="НАПР. BX7K2P" style="text-transform:uppercase;font:850 23px ui-monospace,monospace;letter-spacing:.22em"><button class="btn ghost full large" type="submit" style="margin-top:17px">ЗНАЙТИ КІМНАТУ →</button></form>
      <hr class="split-line"><p class="mini-note"><b>Твої картки приватні.</b> Ведучий та інші учасники бачать їх лише після того, як ти відкриєш відповідну карту.</p></div>
  </div>`;}
function roomTop(){
  const phase=state.phase==='lobby'?'ОЧІКУВАННЯ':state.phase==='finished'?'ЗАВЕРШЕНО':`РАУНД ${state.round}`;
  const active=state.players.filter(p=>!p.eliminated).length;
  const online=state.players.filter(p=>p.online).length;
  return `<div class="room-header"><div><div class="eyebrow">${state.role==='host'?'ПАНЕЛЬ ВЕДУЧОГО':state.role==='player'?'ОСОБИСТИЙ КАБІНЕТ УЧАСНИКА':'СПОСТЕРІГАЧ'} · БУНКЕР ONLINE</div><h1>БУНКЕР <em>ЕКОНОМІКА.</em></h1><div class="info-row"><span class="room-status ${state.phase==='playing'?'live':''}">${e(phase)}</span><span class="mini-note">${state.teams.length} команд · ${state.settings.cardCount} карт / гравець</span></div></div><div class="room-details"><div class="room-code"><small>КОД КІМНАТИ</small>${e(state.code)}</div><button class="btn ghost" data-action="copy-link">↗ Запросити</button></div></div>
    <div class="stat-strip"><div class="stat"><b>${state.players.length}</b><span>ГРАВЦІВ</span></div><div class="stat"><b>${online}</b><span>У МЕРЕЖІ</span></div><div class="stat"><b>${active}</b><span>У ГРІ</span></div><div class="stat"><b>${state.teams.length}</b><span>КОМАНД</span></div></div>`;
}
function invitePanel(){return `<div class="section"><div class="eyebrow">ЗАПРОШЕННЯ</div><h2>Надішли посилання</h2><p>Кожен гравець відкриває його на своєму телефоні, обирає команду та вводить нікнейм.</p><div class="copyline"><input class="form-field" readonly value="${e(roomLink())}" aria-label="Посилання на кімнату" id="invite-link"><button class="btn primary" data-action="copy-link">КОПІЮВАТИ</button></div><div class="button-row" style="margin-top:12px"><button class="btn small ghost" data-action="copy-code">Копіювати код ${e(roomCode)}</button><button class="btn small ghost" data-action="share-link">Поділитись ↗</button></div><p class="helper">Не надсилай особисту сторінку ведучого з відкритими інструментами — користуйся лише кнопкою «Запросити».</p></div>`;}
function memberHTML(p,canEdit){
  return `<div class="member"><div class="member-name"><div class="avatar">${e(p.name.slice(0,1).toUpperCase())}</div><div><strong>${e(p.name)}</strong><small><span class="online-dot ${p.online?'':'away'}"></span>${p.online?'На зв’язку':'Не в мережі'}${p.eliminated?' · ВИБУВ':''}</small></div></div>${canEdit?`<div class="member-tools"><select aria-label="Змінити команду ${e(p.name)}" data-move-for="${e(p.id)}">${state.teams.map(t=>`<option value="${e(t.id)}" ${t.id===p.teamId?'selected':''}>${e(t.name)}</option>`).join('')}</select><button class="btn small ghost" data-action="move-player" data-id="${e(p.id)}" title="Перемістити">→</button><button class="btn small danger" data-action="kick-player" data-id="${e(p.id)}" title="Видалити">×</button></div>`:''}</div>`;
}
function teamsHTML(editable=false){
  return `<div class="team-list">${state.teams.map((t,i)=>{
    const players=state.players.filter(p=>p.teamId===t.id);
    return `<div class="team-editor"><div class="team-head"><h3><span class="my-team-label">${String(i+1).padStart(2,'0')} / </span>${e(t.name)}</h3><span class="count-pill">${players.length} / ${state.settings.maxPlayers}</span></div>${editable?`<div class="team-actions"><button class="btn ghost small" data-action="rename-team" data-id="${e(t.id)}">✎ Назва</button><button class="btn ghost small" data-action="copy-link">↗</button><button class="btn danger small" data-action="remove-team" data-id="${e(t.id)}">×</button></div>`:''}<div style="margin-top:13px">${players.length?players.map(p=>memberHTML(p,editable)).join(''):'<div class="empty-members">Поки немає учасників</div>'}</div></div>`;
  }).join('')}</div>`;
}
function activityPanel(){return `<div class="section"><div class="eyebrow">ХРОНІКА</div><h2>Події кімнати</h2><div class="activity">${state.events.slice().reverse().map(x=>`<div class="activity-item"><time>${new Date(x.time).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}</time>${e(x.text)}</div>`).join('')||'<p>Поки немає подій.</p>'}</div></div>`;}
function lobby(){
  const isHost=state.role==='host';
  if(isHost) return `<div class="leader-layout"><div class="leader-main"><div class="section"><div class="eyebrow">ЛОБІ · ПІДГОТОВКА</div><div class="public-card-header" style="margin-top:9px"><div><h2>Склад команд</h2><p>Гравці самі приєднуються за посиланням.</p></div><button class="btn ghost" data-action="add-team" ${state.teams.length>=8?'disabled':''}>＋ ДОДАТИ КОМАНДУ</button></div>${teamsHTML(true)}</div></div><aside class="grid side-panel"><div class="section"><div class="eyebrow">НАЛАШТУВАННЯ ГРИ</div><label class="label" for="lobby-count">КАРТОК НА ГРАВЦЯ</label><select class="form-field" id="lobby-count" data-setting="cardCount">${Array.from({length:8},(_,i)=>`<option value="${i+1}" ${i+1===state.settings.cardCount?'selected':''}>${i+1}</option>`).join('')}</select><p class="helper">Видаються випадкові категорії з 1–8, без повторів карт у межах партії, поки це можливо.</p><button class="btn primary full large" data-action="start-game" ${state.players.length===0?'disabled':''} style="margin-top:14px">РОЗДАТИ КАРТКИ →</button></div>${invitePanel()}${activityPanel()}</aside></div>`;
  if(state.role==='player'){
    const my=state.players.find(p=>p.id===state.myPlayerId),team=state.teams.find(t=>t.id===my?.teamId);
    return `<div class="grid two"><div class="waiting"><span class="waiting-icon">⌛</span><div class="eyebrow" style="justify-content:center">УЧАСНИК ЗАРЕЄСТРОВАНИЙ</div><h2>${e(my?.name||'Учасник')}, ти в команді!</h2><p>Команда: <strong style="color:var(--lime)">${e(team?.name||'—')}</strong>. Дочекайся, поки ведучий роздасть картки. Партія почнеться автоматично.</p><p class="mini-note">Після перезавантаження ти повернешся у свою кімнату на цьому пристрої.</p><button class="btn ghost" data-action="leave-room" style="margin-top:16px">Вийти з команди</button></div><div class="grid">${invitePanel()}<div class="section"><div class="eyebrow">УЧАСНИКИ</div><h2>Хто вже тут</h2>${teamsHTML(false)}</div></div></div>`;
  }
  return `<div class="grid two"><div class="setup-card"><div class="eyebrow">ТИ ЗАПРОШЕНИЙ / ${e(roomCode)}</div><h2>Приєднатися до гри</h2><p>Обери команду та ім’я. Секретні картки з’являться на цьому телефоні після початку партії.</p>
  <form data-form="join"><label class="label" for="nick">ТВІЙ НІКНЕЙМ</label><input class="form-field" id="nick" name="name" maxlength="32" minlength="2" autocomplete="nickname" required placeholder="Як до тебе звертатися?"><label class="label">ОБЕРИ КОМАНДУ</label><div class="join-teams">${state.teams.map((t,i)=>`<label class="choice"><input name="teamId" type="radio" value="${e(t.id)}" ${i===0?'checked':''}><span><span class="team-index">${String(i+1).padStart(2,'0')}</span><span class="choice-name">${e(t.name)}</span><span class="choice-count">${state.players.filter(p=>p.teamId===t.id).length} грав.</span></span></label>`).join('')}</div><button type="submit" class="btn primary full large" ${state.players.length>=20?'disabled':''}>ПРИЄДНАТИСЯ ДО КОМАНДИ →</button></form></div>
  <div class="grid"><div class="section"><div class="eyebrow">СКЛАД ЛОБІ</div><h2>Учасники</h2>${teamsHTML(false)}</div><div class="section"><div class="eyebrow">ЯК ЦЕ ПРАЦЮЄ</div><ol class="invite-steps"><li>Обери команду.</li><li>Ведучий запускає роздачу.</li><li>Ти бачиш <strong>лише власні картки</strong>.</li><li>Відкривай їх по одній і переконуй інших.</li></ol></div></div></div>`;
}
function cardHTML(card,opts={}){
  const hidden=!!opts.hidden;
  if(hidden){return `<article class="game-card locked"><div class="card-head"><span class="card-number">??</span><span class="card-category">ЗАКРИТО</span></div><div class="locked-message"><span class="lock-symbol">⌑</span>КАРТКУ НЕ ВІДКРИТО</div><div class="card-bottom"><span class="mark">ОЧІКУЄ РОЗКРИТТЯ</span></div></article>`;}
  const revealed=!!opts.revealed;
  return `<article class="game-card" data-cat="${e(card.categoryId)}"><div class="card-head"><span class="card-number">${String(card.number).padStart(2,'0')} <span style="font-size:14px">${e(CATEGORY_SIGNS[card.categoryId]||'')}</span></span><span class="card-category">${e(card.category)}</span></div><div><h3>${e(card.title)}</h3>${card.description?`<p style="margin-top:8px">${e(card.description)}</p>`:''}</div><div class="card-bottom">${opts.own? (revealed?`<span class="mark">✓ ВІДКРИТО ВСІМ</span>`:`<button class="btn small primary" data-action="reveal-card" data-cat="${e(card.categoryId)}">◎ ВІДКРИТИ ВСІМ</button>`):'<span class="mark">◉ ПУБЛІЧНО</span>'}${opts.own && card.categoryId==='special'?`<button class="btn small ${card.used?'ghost':'danger'}" data-action="use-special" ${card.used?'disabled':''}>${card.used?'✓ Використано':'⚡ Використати'}</button>`:card.used?'<span class="mark used">ВИКОРИСТАНО</span>':''}</div></article>`;
}
function publicCards(p){
  if(!p)return '<div class="state-empty">Оберіть гравця.</div>';
  const unrevealed=p.totalCards-p.revealedCount;
  const placeholders=Array.from({length:Math.min(unrevealed,4)},()=>cardHTML(null,{hidden:true})).join('');
  return `<div class="cards-grid">${p.opened.map(c=>cardHTML(c)).join('')}${placeholders}</div>${unrevealed>4?`<p class="hint">І ще ${unrevealed-4} прихованих карток…</p>`:''}${!p.totalCards?'<div class="state-empty">Немає карток.</div>':''}`;
}
function publicBoard(canManage=false){
  if(!state.players.length)return '<div class="state-empty">Поки немає гравців.</div>';
  const team=state.teams.find(t=>t.id===currentTeam)||state.teams[0];currentTeam=team.id;
  const roster=state.players.filter(p=>p.teamId===team.id);
  const chosen=roster.find(p=>p.id===currentPlayer)||roster[0];currentPlayer=chosen?.id||null;
  const selected=chosen;
  return `<div class="tabs">${state.teams.map(t=>{const ps=state.players.filter(p=>p.teamId===t.id);return `<button class="tab ${currentTeam===t.id?'active':''}" data-action="select-team" data-id="${e(t.id)}"><b>${e(t.name)}</b><span>${ps.filter(p=>!p.eliminated).length}/${ps.length} у грі</span></button>`;}).join('')}</div>
    <div class="game-layout"><div class="section players-list">${roster.length?roster.map((p,i)=>`<button class="player-choice ${p.id===selected?.id?'active':''} ${p.eliminated?'eliminated':''}" data-action="select-player" data-id="${e(p.id)}"><span class="avatar">${String(i+1).padStart(2,'0')}</span><span class="name"><b>${e(p.name)}</b><small>${p.eliminated?'ВИБУВ':p.online?'У МЕРЕЖІ':'НЕ В МЕРЕЖІ'}</small></span><span class="mini-count">${p.revealedCount}/${p.totalCards}</span></button>`).join(''):'<div class="state-empty">Поки порожньо</div>'}</div>
    <div class="section public-card-wrap">${selected?`<div class="public-card-header"><div><div class="eyebrow">ПУБЛІЧНІ КАРТКИ</div><h2>${e(selected.name)} ${selected.eliminated?'<span style="color:var(--red);font-size:13px">· ВИБУВ</span>':''}</h2><p>Відкрито ${selected.revealedCount} з ${selected.totalCards}</p></div>${canManage?`<div class="button-row"><button class="btn small ${selected.eliminated?'ghost':'danger'}" data-action="toggle-eliminate" data-id="${e(selected.id)}">${selected.eliminated?'↺ Повернути':'× Виключити'}</button><button class="btn small ghost" data-action="manage-player" data-id="${e(selected.id)}">⚙ Картки</button></div>`:''}</div>${publicCards(selected)}`:'<div class="state-empty">У цій команді поки нікого немає.</div>'}</div></div>`;
}
function hostGame(){return `<div class="game-toolbar"><div><div class="eyebrow">КЕРУВАННЯ ПАРТІЄЮ</div><h2>Раунд ${state.round}</h2></div><div class="button-row"><button class="btn ghost" data-action="next-round">↗ Наступний раунд</button><button class="btn ghost" data-action="new-deal">⟳ Нова роздача</button><button class="btn danger" data-action="finish-game">Завершити</button></div></div><div class="leader-layout"><div class="leader-main">${publicBoard(true)}</div><aside class="grid side-panel">${invitePanel()}<div class="section"><div class="eyebrow">УПРАВЛІННЯ</div><h2>Панель ведучого</h2><p>Ведучий бачить лише відкриті картки. Додаткові дії (обміни, заміна, примусове відкриття) виконуються тут вручну.</p><button class="btn ghost full" data-action="back-lobby">← Повернутися в лобі</button></div>${activityPanel()}</aside></div>`;}
function playerGame(){
  const me=state.players.find(p=>p.id===state.myPlayerId),team=state.teams.find(t=>t.id===me?.teamId);
  if(!me)return '<div class="state-empty">Твій акаунт не знайдено. Зайди до кімнати знову.</div>';
  if(state.phase==='finished')return finished();
  return `<div class="hand-hero"><div><div class="eyebrow">ТВОЯ ОСОБИСТА РУКА · ТІЛЬКИ ДЛЯ ТЕБЕ</div><h2>${e(me.name)}</h2><p>Команда: ${e(team?.name||'—')}. Інші не бачать цих карток, поки ти сам їх не відкриєш. Розкриту карту побачать усі в кімнаті.</p></div><div class="hand-symbol">◇</div></div>
  <div class="button-row" style="margin-bottom:19px"><button class="btn ${playerView==='hand'?'primary':'ghost'}" data-action="player-view" data-id="hand">▣ Мої секретні картки</button><button class="btn ${playerView==='board'?'primary':'ghost'}" data-action="player-view" data-id="board">◎ Публічне поле</button></div>
  ${me.eliminated?'<div class="warning">Ти вибув(ла) з гри. Розкривати нові картки не можна, доки ведучий не поверне тебе.</div>':''}
  ${playerView==='hand'?`<div class="info-row" style="justify-content:space-between;margin:7px 0 18px"><div><span class="eyebrow">КАРТКИ ГРАВЦЯ</span><h2 style="margin:8px 0;font-size:25px;letter-spacing:-.05em">Мої ${state.myHand.length} карток</h2></div><span class="priv-badge">⌑ ПРИВАТНИЙ ПЕРЕГЛЯД</span></div><div class="cards-grid hand">${state.myHand.map(c=>cardHTML(c,{own:true,revealed:me.opened.some(o=>o.categoryId===c.categoryId)})).join('')}</div><p class="hint">Після натискання «Відкрити всім» карту неможливо знову приховати самостійно. Особливі випадки виконуються за домовленістю з ведучим.</p>`:`${publicBoard(false)}`}
  <div style="margin-top:21px">${activityPanel()}</div>`;
}
function guestGame(){return `<div class="warning">Партія вже почалася. Доєднатися як новий учасник можна лише після повернення ведучого в лобі. Публічні картки доступні для перегляду.</div>${publicBoard(false)}<div style="margin-top:20px">${activityPanel()}</div>`;}
function finished(){
  const survivors=state.players.filter(p=>!p.eliminated);
  return `<div class="waiting"><span class="waiting-icon">✧</span><div class="eyebrow" style="justify-content:center">ПАРТІЮ ЗАВЕРШЕНО</div><h2>Хто потрапив у бункер?</h2><p>Залишилось у грі: <strong style="color:var(--lime)">${survivors.length} із ${state.players.length}</strong></p></div><div class="grid two" style="margin-top:20px">${state.teams.map(t=>{const ps=survivors.filter(p=>p.teamId===t.id);return `<div class="section"><div class="eyebrow">КОМАНДА</div><h2>${e(t.name)}</h2><p>${ps.length?ps.map(p=>e(p.name)).join(' · '):'Ніхто не залишився'}</p></div>`;}).join('')}</div>${state.role==='host'?`<div class="button-row" style="margin-top:18px"><button class="btn primary" data-action="new-deal">↻ Нова партія</button><button class="btn ghost" data-action="back-lobby">← Повернутися в лобі</button></div>`:''}<div style="margin-top:24px">${publicBoard(false)}</div>`;
}
function render(){
  if(screen!=='room'||!state){app.innerHTML=home();return;}
  let body;
  if(state.phase==='lobby')body=lobby();
  else if(state.phase==='finished')body=finished();
  else body=state.role==='host'?hostGame():state.role==='player'?playerGame():guestGame();
  app.innerHTML=roomTop()+body;
}
function closeModal(){temporaryModal=null;modalRoot.innerHTML='';}
function openModal(title,html){temporaryModal=title;modalRoot.innerHTML=`<div class="modal-screen" data-close-backdrop="true"><div class="modal" role="dialog" aria-modal="true" aria-label="${e(title)}"><div class="eyebrow">БУНКЕР / КЕРУВАННЯ</div><h2>${e(title)}</h2>${html}<div class="modal-actions"><button class="btn ghost" data-action="close-modal">Закрити</button></div></div></div>`;}
function manageModal(playerId){
  const player=state.players.find(p=>p.id===playerId);
  if(!player)return;
  const possible=state.categories;
  openModal(`Картки: ${player.name}`,`<p>Ведучий може відкрити або приховати картку, видати нову, або помінятися картками однакової категорії. Приховані значення йому недоступні.</p><label class="label" for="admin-cat">КАТЕГОРІЯ</label><select class="form-field" id="admin-cat">${possible.map(c=>`<option value="${e(c.id)}">${c.number}. ${e(c.title)}</option>`).join('')}</select><label class="label" for="other-player">ОБМІН З ГРАВЦЕМ</label><select class="form-field" id="other-player">${state.players.filter(p=>p.id!==playerId).map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('')||'<option value="">Інших учасників немає</option>'}</select><div class="button-row" style="margin-top:15px"><button class="btn small ghost" data-action="admin-reveal" data-id="${e(playerId)}">◎ Відкрити</button><button class="btn small ghost" data-action="admin-conceal" data-id="${e(playerId)}">⌑ Приховати</button><button class="btn small ghost" data-action="admin-redraw" data-id="${e(playerId)}">⟳ Замінити</button><button class="btn small primary" data-action="admin-swap" data-id="${e(playerId)}">⇄ Обміняти</button></div><p class="helper">Після заміни або обміну нові значення приховуються від публіки. Операції видно в хроніці.</p>`);
}
function confirmAction(message){return window.confirm(message);}
document.addEventListener('submit',async ev=>{
  const form=ev.target.closest('[data-form]');if(!form)return;
  ev.preventDefault();const kind=form.dataset.form,btn=form.querySelector('[type=submit]');if(btn)btn.disabled=true;
  try{
    const fields=new FormData(form);
    if(kind==='create'){
      const teamNames=String(fields.get('teams')||'').split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
      const result=await request('/api/rooms',{method:'POST',body:JSON.stringify({cardCount:Number(fields.get('cardCount')),teamNames})});
      saveToken(result.code,result.token);await enterRoom(result.code);notify('Кімнату створено! Надішліть посилання учасникам.');
    }else if(kind==='enter'){await enterRoom(fields.get('code'));}
    else if(kind==='join'){
      const result=await request(`/api/rooms/${roomCode}/join`,{method:'POST',body:JSON.stringify({name:fields.get('name'),teamId:fields.get('teamId')})});
      saveToken(roomCode,result.token);await enterRoom(roomCode);notify('Ти в грі! Очікуй на роздачу.');
    }else if(kind==='add-team'){
      await runCommand('addTeam',{name:fields.get('name')},'Команду додано.');closeModal();
    }
  }catch(err){notify(err.message,true);}finally{if(btn?.isConnected)btn.disabled=false;}
});
document.addEventListener('change',async ev=>{
  if(ev.target?.dataset.setting==='cardCount')await runCommand('setCardCount',{cardCount:Number(ev.target.value)},'Кількість карт змінено.');
});
document.addEventListener('click',async ev=>{
  const target=ev.target.closest('[data-action]');
  if(!target){if(ev.target.matches('[data-close-backdrop]'))closeModal();return;}
  if(target.disabled)return;
  const action=target.dataset.action,id=target.dataset.id;
  switch(action){
    case 'close-modal':closeModal();break;
    case 'copy-link':await copyText(roomLink());break;
    case 'copy-code':await copyText(roomCode);break;
    case 'share-link':
      if(navigator.share){try{await navigator.share({title:'БУНКЕР: ЕКОНОМІКА',text:'Приєднуйся до гри!',url:roomLink()});}catch{}}
      else await copyText(roomLink());break;
    case 'add-team':openModal('Нова команда',`<form data-form="add-team"><label class="label" for="new-team">НАЗВА КОМАНДИ</label><input name="name" id="new-team" class="form-field" required maxlength="32" placeholder="Наприклад, Аналітики"><button class="btn primary full" style="margin-top:14px" type="submit">＋ ДОДАТИ КОМАНДУ</button></form>`);break;
    case 'rename-team':{
      const team=state.teams.find(t=>t.id===id),name=window.prompt('Нова назва команди',team?.name||'');
      if(name?.trim())await runCommand('renameTeam',{teamId:id,name:name.trim()},'Назву команди змінено.');break;}
    case 'remove-team':if(confirmAction('Видалити цю команду?'))await runCommand('removeTeam',{teamId:id});break;
    case 'move-player':{
      const select=document.querySelector(`select[data-move-for="${CSS.escape(id)}"]`);
      if(select?.value)await runCommand('movePlayer',{playerId:id,teamId:select.value});break;}
    case 'kick-player':if(confirmAction('Видалити учасника з кімнати?'))await runCommand('kickPlayer',{playerId:id});break;
    case 'leave-room':if(confirmAction('Вийти з команди?')){await runCommand('leaveRoom');forgetToken(roomCode);await enterRoom(roomCode);}break;
    case 'start-game':if(confirmAction('Роздати картки усім учасникам і почати гру?'))await runCommand('startGame');break;
    case 'next-round':await runCommand('nextRound');break;
    case 'new-deal':if(confirmAction('ПЕРЕРОЗДАТИ всі секретні картки? Попередні картки і розкриття буде скинуто.')){await runCommand('newDeal',{},'Нові картки роздано.');playerView='hand';}break;
    case 'finish-game':if(confirmAction('Завершити поточну партію?'))await runCommand('finishGame');break;
    case 'back-lobby':if(confirmAction('Повернутися в лобі? Поточні картки буде скинуто.'))await runCommand('backToLobby');break;
    case 'select-team':currentTeam=id;currentPlayer=null;render();break;
    case 'select-player':currentPlayer=id;render();break;
    case 'player-view':playerView=id;render();break;
    case 'reveal-card':if(confirmAction('Показати цю картку ВСІМ учасникам кімнати?'))await runCommand('reveal',{categoryId:target.dataset.cat});break;
    case 'use-special':if(confirmAction('Позначити особливу картку використаною? Її ефект виконується за домовленістю з ведучим.'))await runCommand('useSpecial',{},'Особливу картку позначено використаною.');break;
    case 'toggle-eliminate':await runCommand('toggleEliminate',{playerId:id});break;
    case 'manage-player':manageModal(id);break;
    case 'admin-reveal':case 'admin-conceal':case 'admin-redraw':case 'admin-swap':{
      const categoryId=$('admin-cat')?.value;
      const type={'admin-reveal':'adminReveal','admin-conceal':'adminConceal','admin-redraw':'adminRedraw','admin-swap':'swapCards'}[action];
      const otherPlayerId=$('other-player')?.value;
      if(action==='admin-swap'&&!otherPlayerId){notify('Виберіть другого гравця.',true);break;}
      if(action==='admin-redraw' && !confirmAction('Замінити картку новою і приховати її від інших?'))break;
      if(action==='admin-swap' && !confirmAction('Обміняти картки цієї категорії між гравцями?'))break;
      try{await sendCommand(type,{playerId:id,categoryId,otherPlayerId});closeModal();notify('Операцію виконано.');}catch(err){notify(err.message,true);}break;
    }
  }
});
window.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeModal();});
window.addEventListener('popstate',()=>{const c=new URLSearchParams(location.search).get('room');if(c)enterRoom(c);else goHome();});
const onloadRoom=new URLSearchParams(location.search).get('room');
if(onloadRoom)enterRoom(onloadRoom);else{screen='home';render();setConnection('online');}

// Під час активної гри підтримуємо зв’язок із безкоштовними хостингами, які засинають без вхідних запитів.
setInterval(()=>{if(roomCode && document.visibilityState==='visible')fetch('/api/health',{cache:'no-store'}).catch(()=>{});},4*60*1000);
