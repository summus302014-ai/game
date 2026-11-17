// HEXWORLD AI backend. Node 18+, без зависимостей. Ключ только из переменных окружения.
// LLM_PROVIDER=anthropic|openai (openai = любой OpenAI-совместимый API), LLM_MODEL, LLM_API_KEY, LLM_BASE_URL, LLM_CHAT_PATH (для не-OpenAI путей, напр. Gemini)
const http=require('http'),fs=require('fs'),path=require('path');
// Загрузка настроек из файла .env (рядом с server.js). Уже заданные переменные окружения имеют приоритет.
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){if(l.trim().startsWith('#'))continue;const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}catch(e){}
const E=process.env,PORT=+E.PORT||3000,PROVIDER=(E.LLM_PROVIDER||'anthropic').toLowerCase(),MODEL=E.LLM_MODEL||'claude-sonnet-5-5',KEY=E.LLM_API_KEY||'';
const BASE=(E.LLM_BASE_URL||(PROVIDER==='anthropic'?'https://api.anthropic.com':'https://api.openai.com')).replace(/\/$/,'');
const MIN_GAP=+E.LLM_MIN_INTERVAL_MS||1500,MEMDIR=path.join(__dirname,'memory');fs.mkdirSync(MEMDIR,{recursive:true});
const BLOCKS=['grass','dirt','stone','sand','snow','wood','leaves','iron_ore','crystal','planks','lamp'];
const RESOURCES=['wood','stone','sand','dirt','grass','snow','leaves','iron_ore','ore','crystal'];
const isPos=p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isInteger(n)&&Math.abs(n)<1e6);
// Строгая белая таблица действий: всё остальное отбрасывается.
const V={follow_player:()=>({}),inspect_area:()=>({}),
move_to:a=>isPos(a.pos)&&{pos:a.pos},look_at:a=>isPos(a.pos)&&{pos:a.pos},
collect_resource:a=>RESOURCES.includes(a.resource)&&{resource:a.resource,count:Math.min(16,Math.max(1,(a.count|0)||1))},
place_block:a=>isPos(a.pos)&&BLOCKS.includes(a.block)&&{pos:a.pos,block:a.block},
break_block:a=>isPos(a.pos)&&{pos:a.pos},
build_structure:a=>a.kind==='house'&&{kind:'house',material:BLOCKS.includes(a.material)?a.material:'planks'},
wait:a=>({seconds:Math.min(10,Math.max(0,+a.seconds||1))}),talk:a=>typeof a.text==='string'&&{text:a.text.slice(0,300)}};
function validate(j){const out={thought:String(j.thought||'').slice(0,300),say:String(j.say||'').slice(0,400),actions:[],memory:{}};
if(Array.isArray(j.actions))for(const a of j.actions.slice(0,12)){if(!a||!V[a.type])continue;const v=V[a.type](a);if(v)out.actions.push({type:a.type,...v})}
if(j.memory&&typeof j.memory==='object'){for(const k of['fact','preference'])if(typeof j.memory[k]==='string'&&j.memory[k].trim())out.memory[k]=j.memory[k].trim().slice(0,200)}return out}
const mfile=w=>path.join(MEMDIR,String(w).replace(/\D/g,'').slice(0,10)+'.json');
const loadMem=w=>{try{return JSON.parse(fs.readFileSync(mfile(w),'utf8'))}catch(e){return{facts:[],prefs:[],tasks:[],dialogue:[]}}};
const saveMem=(w,m)=>fs.writeFileSync(mfile(w),JSON.stringify(m,null,1));
const SYSTEM=`Ты — Гекс, дружелюбный маленький робот-спутник игрока в гексагональной sandbox-игре HEXWORLD. Отвечай по-русски, тепло, можешь шутить, но коротко.
Мир: гексагональная сетка, координаты клетки [q, r, y] (оси q,r + высота y). Тебе дают компактное наблюдение (observation), инвентарь, состояние игрока и твою память.
Верни ТОЛЬКО JSON без markdown: {"thought":"краткое рассуждение","say":"что сказать игроку","actions":[...],"memory":{"fact":"необязательно, важный факт","preference":"необязательно, предпочтение игрока"}}.
Допустимые действия: follow_player; move_to{pos:[q,r,y]}; look_at{pos}; inspect_area; collect_resource{resource:wood|stone|sand|dirt|grass|snow|leaves|iron_ore|crystal,count:1-16}; place_block{pos,block}; break_block{pos}; build_structure{kind:"house",material:blockName}; wait{seconds}; talk{text}.
Блоки: ${BLOCKS.join(', ')}. Домик строится только из блоков материала (по умолчанию planks, нужно 53 шт.); если материалов не хватает — НЕ вызывай build_structure, объясни и предложи collect_resource wood (игрок крафтит доски из wood: 1 дерево = 4 досок).
Используй только позиции из observation. Не придумывай данные. Если просьба невыполнима — честно скажи. Память сохраняй только для действительно важного.`;
async function callLLM(messages){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),30000);
try{let r,j;if(PROVIDER==='anthropic'){r=await fetch(BASE+'/v1/messages',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:900,system:SYSTEM,messages})});j=await r.json();if(!r.ok)throw new Error(j.error&&j.error.message||r.status);return j.content.map(c=>c.text||'').join('')}
r=await fetch(BASE+(E.LLM_CHAT_PATH||'/v1/chat/completions'),{method:'POST',signal:ac.signal,headers:{'content-type':'application/json',authorization:'Bearer '+KEY},body:JSON.stringify({model:MODEL,max_tokens:900,messages:[{role:'system',content:SYSTEM},...messages]})});j=await r.json();if(!r.ok)throw new Error(j.error&&j.error.message||r.status);return j.choices[0].message.content}finally{clearTimeout(t)}}
let last=0,busy=false;
async function companion(b){const mem=loadMem(b.world),msgs=[];
for(const d of mem.dialogue.slice(-8)){msgs.push({role:'user',content:d.u},{role:'assistant',content:d.a||'…'})}
msgs.push({role:'user',content:JSON.stringify({player_message:String(b.message||'').slice(0,300),observation:b.observation,inventory:b.inventory,player:b.player,robot:b.bot,long_term_memory:{facts:mem.facts,preferences:mem.prefs},recent_tasks:mem.tasks.slice(-5)}).slice(0,12000)});
const raw=await callLLM(msgs),m=raw.match(/\{[\s\S]*\}/);if(!m)throw new Error('модель вернула не JSON');
const out=validate(JSON.parse(m[0]));
mem.dialogue.push({u:String(b.message||'').slice(0,300),a:out.say});mem.dialogue=mem.dialogue.slice(-10);
if(out.memory.fact&&!mem.facts.includes(out.memory.fact))mem.facts=[...mem.facts,out.memory.fact].slice(-40);
if(out.memory.preference&&!mem.prefs.includes(out.memory.preference))mem.prefs=[...mem.prefs,out.memory.preference].slice(-20);
saveMem(b.world,mem);return out}
const body=req=>new Promise((res,rej)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e5){rej(new Error('too large'));req.destroy()}});req.on('end',()=>{try{res(JSON.parse(s||'{}'))}catch(e){rej(e)}})});
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
http.createServer(async(req,res)=>{try{
if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'hexworld.html')))}
if(req.method==='POST'&&req.url==='/api/task'){const b=await body(req),m=loadMem(b.world);m.tasks=[...m.tasks,{t:new Date().toISOString(),s:String(b.summary||'').slice(0,160)}].slice(-30);saveMem(b.world,m);return send(res,200,{ok:true})}
if(req.method==='POST'&&req.url==='/api/companion'){
if(!KEY)return send(res,503,{error:'LLM_API_KEY не задан на сервере'});
if(busy||Date.now()-last<MIN_GAP)return send(res,429,{error:'слишком часто, подождите секунду'});
const b=await body(req);busy=true;last=Date.now();
try{send(res,200,await companion(b))}catch(e){send(res,502,{error:'ошибка модели: '+e.message})}finally{busy=false}return}
send(res,404,{error:'not found'})}catch(e){send(res,400,{error:e.message})}}).listen(PORT,()=>{const url='http://localhost:'+PORT;console.log(`HEXWORLD запущен: ${url}\nПровайдер: ${PROVIDER} | модель: ${MODEL} | ключ: ${KEY?'задан':'НЕ ЗАДАН (игра работает, но робот не сможет отвечать — впишите LLM_API_KEY в файл .env)'}`);
if(process.platform==='win32'&&E.OPEN_BROWSER!=='0')require('child_process').exec(`start "" "${url}"`)}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Порт ${PORT} уже занят (возможно, сервер уже запущен). Закройте другое окно HEXWORLD или смените PORT в файле .env.`:'Ошибка сервера: '+e.message);process.exit(1)});
