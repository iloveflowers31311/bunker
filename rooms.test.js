'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bunker-test-'));
process.env.DATA_FILE=path.join(dir,'state.json');
const {server,rooms,DECK}=require('../server');
let url='';
after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
async function open(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;}
async function api(p,body,method='POST'){
  const r=await fetch(url+p,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const d=await r.json();return {status:r.status,...d};
}
async function state(code,token){return api(`/api/rooms/${code}${token?'?token='+encodeURIComponent(token):''}`,undefined,'GET');}
async function action(code,token,type,other={}){return api(`/api/rooms/${code}/action`,{type,token,...other});}
function distinct(items){return new Set(items).size===items.length;}

test('176 original cards; rooms, authentication, privacy, live events, rounds, teams, draws',async()=>{
  await open();
  assert.equal(DECK.reduce((a,c)=>a+c.cards.length,0),176);
  const created=await api('/api/rooms',{teamNames:['Економісти','Маркетологи'],cardCount:8});
  assert.equal(created.status,201);assert.match(created.code,/^[A-Z2-9]{6}$/);
  const code=created.code,h=created.token;
  const before=await state(code);
  assert.equal(before.role,'guest');assert.equal(before.phase,'lobby');assert.equal(before.teams.length,2);
  const a=await api(`/api/rooms/${code}/join`,{name:'Аліна',teamId:before.teams[0].id});
  const b=await api(`/api/rooms/${code}/join`,{name:'Богдан',teamId:before.teams[1].id});
  assert.equal(a.status,201);assert.equal(b.status,201);
  assert.equal((await action(code,a.token,'startGame')).status,403);
  assert.equal((await action(code,'wrongtoken','startGame')).status,401);
  assert.equal((await action(code,h,'startGame')).status,200);
  const ha=await state(code,h), guest=await state(code),pa=await state(code,a.token),pb=await state(code,b.token);
  assert.equal(ha.role,'host');assert.equal(ha.myHand,undefined);
  assert.equal(guest.myHand,undefined);assert.equal(ha.players[0].opened.length,0);
  assert.equal(pa.myHand.length,8);assert.equal(pb.myHand.length,8);
  assert.equal(pa.myHand[0].number,1);
  assert.equal(pa.myHand.map(x=>x.title).filter(t=>pb.myHand.map(y=>y.title).includes(t)).length,0);
  assert.equal((await action(code,a.token,'reveal',{categoryId:'profession'})).status,200);
  const g2=await state(code),p2=await state(code,b.token);
  assert.equal(g2.players.find(p=>p.name==='Аліна').opened.length,1);
  assert.equal(p2.players.find(p=>p.name==='Аліна').opened[0].categoryId,'profession');
  assert.equal(g2.players.find(p=>p.name==='Богдан').opened.length,0);
  assert.equal((await action(code,h,'nextRound')).status,200);
  assert.equal((await state(code)).round,2);
  assert.equal((await action(code,h,'toggleEliminate',{playerId:a.playerId})).status,200);
  assert.equal((await state(code)).players.find(p=>p.id===a.playerId).eliminated,true);
  assert.equal((await action(code,a.token,'reveal',{categoryId:'health'})).status,400);
  assert.equal((await action(code,h,'newDeal')).status,200);
  const after=await state(code,a.token);
  assert.equal(after.round,1);assert.equal(after.players.find(p=>p.id===a.playerId).eliminated,false);
  assert.equal(after.players.find(p=>p.id===a.playerId).opened.length,0);
  // with two players and category sizes >= 20 no immediate repeats by same person
  assert.equal(after.myHand.filter(c=>pa.myHand.some(pr=>pr.categoryId===c.categoryId&&pr.title===c.title)).length,0);
  assert.equal((await action(code,h,'backToLobby')).status,200);
  assert.equal((await state(code)).phase,'lobby');
  assert.equal((await action(code,h,'addTeam',{name:'Логісти'})).status,200);
  const lobby=await state(code);
  assert.equal(lobby.teams.length,3);
  assert.equal((await action(code,h,'movePlayer',{playerId:a.playerId,teamId:lobby.teams[2].id})).status,200);
  assert.equal((await state(code)).players.find(p=>p.id===a.playerId).teamId,lobby.teams[2].id);
  const contents=fs.readFileSync(process.env.DATA_FILE,'utf8');
  assert.equal(contents.includes(a.token),false);
  assert.equal(contents.includes(h),false);
  assert.equal(rooms.has(code),true);
});

test('20 players get unique card of every category, 21st blocked, special status private',async()=>{
  const created=await api('/api/rooms',{teamNames:['1'],cardCount:8});
  const code=created.code,host=created.token,team=(await state(code)).teams[0].id;
  const keys=[];
  for(let i=0;i<20;i++){
    const r=await api(`/api/rooms/${code}/join`,{name:'Гравець '+String(i+1).padStart(2,'0'),teamId:team});
    assert.equal(r.status,201);keys.push(r.token);
  }
  assert.equal((await api(`/api/rooms/${code}/join`,{name:'Двадцять перший',teamId:team})).status,400);
  await action(code,host,'startGame');
  const hands=await Promise.all(keys.map(k=>state(code,k)));
  assert(hands.every(d=>d.myHand.length===8));
  assert(hands.every(d=>distinct(d.myHand.map(card=>card.title))), 'Duplicate texts inside a single hand');
  for(const category of DECK){
    const values=hands.map(h=>h.myHand.find(c=>c.categoryId===category.id).title);
    assert(distinct(values),`Doubled value in ${category.id}`);
  }
  assert.equal((await action(code,keys[0],'useSpecial')).status,200);
  assert.equal((await state(code,keys[0])).myHand.find(c=>c.categoryId==='special').used,true);
  assert.equal((await state(code,keys[1])).players[0].opened.length,0);
  const redraw=await action(code,host,'adminRedraw',{playerId:hands[0].myPlayerId,categoryId:'hobby'});
  assert.equal(redraw.status,400); // with 20 players no unused cards of that category
  await action(code,host,'finishGame');
  assert.equal((await state(code)).phase,'finished');
});

test('SSE delivers private-by-role and broadcasts reveals',async()=>{
  const created=await api('/api/rooms',{teamNames:['1'],cardCount:8});const code=created.code,host=created.token,team=(await state(code)).teams[0].id;
  const a=await api(`/api/rooms/${code}/join`,{name:'Олена',teamId:team});
  await action(code,host,'startGame');
  const events=[];
  const ac=new AbortController();
  const response=await fetch(`${url}/api/rooms/${code}/events?token=${encodeURIComponent(a.token)}`,{signal:ac.signal});
  assert.equal(response.headers.get('content-type').startsWith('text/event-stream'),true);
  const reader=response.body.getReader();
  let full='';
  const readUntil=async predicate=>{
    const deadline=Date.now()+2500;
    while(Date.now()<deadline){
      const {value,done}=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timed out reading SSE')),2000))]);
      if(done)break;
      full+=new TextDecoder().decode(value);
      const packets=full.split('\n\n');full=packets.pop();
      for(const part of packets){const line=part.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;const p=JSON.parse(line.slice(6));events.push(p);if(predicate(p))return p;}
    }
    throw new Error('No matching SSE packet');
  };
  const start=await readUntil(s=>s.role==='player' && s.myHand?.length===8);
  assert.equal(start.myHand.length,8);
  await action(code,a.token,'reveal',{categoryId:'health'});
  const changed=await readUntil(s=>s.players[0].opened.some(c=>c.categoryId==='health'));
  assert.equal(changed.players[0].opened[0].categoryId,'health');
  ac.abort();try{reader.releaseLock();}catch{}
});
