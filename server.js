// HEXWORLD AI backend. Node 18+, без зависимостей. Ключ только из .env / переменных окружения.
// LLM_PROVIDER=anthropic|openai (openai = любой OpenAI-совместимый API), LLM_MODEL, LLM_API_KEY, LLM_BASE_URL, LLM_CHAT_PATH, LLM_MAX_TOKENS
const http=require('http'),fs=require('fs'),path=require('path');
// Загрузка настроек из файла .env (рядом с server.js). Уже заданные переменные окружения имеют приоритет.
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){if(l.trim().startsWith('#'))continue;const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}catch(e){}
const E=process.env,PORT=+E.PORT||3000,PROVIDER=(E.LLM_PROVIDER||'anthropic').toLowerCase(),MODEL=E.LLM_MODEL||'claude-sonnet-5-5',KEY=E.LLM_API_KEY||'',MAXTOK=+E.LLM_MAX_TOKENS||1600;
const BASE=(E.LLM_BASE_URL||(PROVIDER==='anthropic'?'https://api.anthropic.com':'https://api.openai.com')).replace(/\/$/,'');
const MIN_GAP=+E.LLM_MIN_INTERVAL_MS||1500,MEMDIR=path.join(__dirname,'memory');fs.mkdirSync(MEMDIR,{recursive:true});
const BLOCKS=['grass','dirt','stone','sand','snow','wood','leaves','iron_ore','crystal','planks','lamp'];
const RESOURCES=['wood','stone','sand','dirt','grass','snow','leaves','iron_ore','crystal'];
// Нормализация названий (рус/англ синонимы → канонические идентификаторы). Это НЕ перевод через ИИ, запросов не добавляет.
const ALIAS=[[/wood|tree|log|trunk|timber|дерев|древес|бревн|брёвн|ствол/i,'wood'],[/stone|rock|cobble|камен|булыжн/i,'stone'],[/sand|песок|песк/i,'sand'],[/dirt|soil|earth|земл|грунт/i,'dirt'],[/grass|трав|дерн|дёрн/i,'grass'],[/snow|снег/i,'snow'],[/leaf|leaves|лист/i,'leaves'],[/iron|ore|желез|руд/i,'iron_ore'],[/crystal|gem|кристалл|самоцвет/i,'crystal']];
const BALIAS=[[/plank|доск/i,'planks'],[/lamp|lantern|ламп|фонар|светильн/i,'lamp'],...ALIAS];
const norm=(s,list,ok)=>{s=String(s==null?'':s).trim();if(ok.includes(s))return s;for(const[re,k]of list)if(re.test(s))return k;return null};
const num3=p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isFinite(+n)&&Math.abs(+n)<1e6)?p.map(n=>Math.round(+n)):null;
// Строгая белая таблица действий: всё остальное отбрасывается. Возвращает параметры или строку-причину отказа.
const V={follow_player:()=>({}),inspect_area:()=>({}),
move_to:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',look_at:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',
collect_resource:a=>{const r=norm(a.resource,ALIAS,RESOURCES);return r?{resource:r,count:Math.min(16,Math.max(1,Math.round(+a.count)||5))}:'неизвестный ресурс «'+a.resource+'»'},
place_block:a=>{const b=norm(a.block,BALIAS,BLOCKS);return num3(a.pos)&&b?{pos:num3(a.pos),block:b}:'нужны pos [q,r,y] и известный block'},
break_block:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',
build_structure:a=>/house|home|hut|cabin|дом|хиж|изб/i.test(String(a.kind||'house'))?{kind:'house',material:norm(a.material,BALIAS,BLOCKS)||'planks'}:'умею строить только дом',
wait:a=>({seconds:Math.min(10,Math.max(0,+a.seconds||1))}),talk:a=>typeof a.text==='string'&&a.text.trim()?{text:a.text.slice(0,300)}:'пустой текст'};
function validate(j){j=j&&typeof j==='object'?j:{};const out={thought:String(j.thought||'').slice(0,300),say:String(j.say||'').slice(0,400),intent:j.intent==='action'?'action':'chat',actions:[],rejected:[],memory:{}};
for(const a of(Array.isArray(j.actions)?j.actions:[]).slice(0,12)){if(!a||typeof a!=='object'||!Object.prototype.hasOwnProperty.call(V,a.type)){out.rejected.push({type:String(a&&a.type),reason:'неизвестное действие'});continue}
const v=V[a.type](a);if(v&&typeof v==='object')out.actions.push({type:a.type,...v});else out.rejected.push({type:a.type,reason:v||'недопустимые параметры'})}
if(out.actions.length)out.intent='action';
if(j.memory&&typeof j.memory==='object'){for(const k of['fact','preference'])if(typeof j.memory[k]==='string'&&j.memory[k].trim())out.memory[k]=j.memory[k].trim().slice(0,200)}return out}
const mfile=w=>path.join(MEMDIR,String(w).replace(/\D/g,'').slice(0,10)+'.json');
const loadMem=w=>{try{const m=JSON.parse(fs.readFileSync(mfile(w),'utf8'));return{facts:m.facts||[],prefs:m.prefs||[],tasks:m.tasks||[],dialogue:m.dialogue||[]}}catch(e){return{facts:[],prefs:[],tasks:[],dialogue:[]}}};
const saveMem=(w,m)=>fs.writeFileSync(mfile(w),JSON.stringify(m,null,1));
const SYSTEM=`Ты — Гекс, дружелюбный маленький робот-спутник игрока в гексагональной sandbox-игре HEXWORLD. Игрок пишет по-русски (иногда с опечатками, сленгом, в любых падежах) — понимай намерение, а не точную формулировку. Отвечай игроку по-русски, тепло и коротко, можешь шутить.
Мир: гексагональная сетка, клетка = [q, r, y]. Тебе приходят: player_message, observation (свежие данные об окружении), inventory, player, robot, память. Observation актуальнее истории диалога.

ФОРМАТ ОТВЕТА — только один JSON-объект, без markdown и текста вокруг:
{"thought":"кратко, что понял и решил","say":"ответ игроку по-русски","intent":"action"|"chat","actions":[...],"memory":{"fact":"...","preference":"..."}}
memory — необязательно, только действительно важное (имя игрока, постоянные предпочтения).

ГЛАВНОЕ ПРАВИЛО: игра выполняет ТОЛЬКО то, что есть в actions. Если игрок просит что-то сделать — intent="action" и обязательно верни подходящие actions. Никогда не пиши «Собираю/Иду/Строю», не вернув действие. Если сделать нельзя — intent="chat", actions=[] и честно объясни причину.

ДЕЙСТВИЯ (типы и значения — только на английском, ровно как ниже, даже если игрок пишет по-русски):
follow_player | inspect_area | wait{seconds} | talk{text} | move_to{pos:[q,r,y]} | look_at{pos:[q,r,y]}
collect_resource{resource,count} — resource ∈ wood, stone, sand, dirt, grass, snow, leaves, iron_ore, crystal; count 1–16 (не указано = 5, «пару» = 2, «немного» = 5, «побольше/много» = 10).
place_block{pos:[q,r,y],block} и break_block{pos:[q,r,y]} — позиции только из observation. Блок — из: ${BLOCKS.join(', ')}.
build_structure{kind:"house",material} — домик из 53 блоков material (по умолчанию planks).
Соответствие слов: дерево/древесина/брёвна/«наруби» → wood; камень/булыжник → stone; песок → sand; земля/грунт → dirt; трава → grass; снег → snow; листва → leaves; железо/руда → iron_ore; кристаллы → crystal; доски → planks; лампа/фонарь → lamp. «Деревянный блок» = planks, если они есть в inventory, иначе wood.
Собранное попадает в инвентарь игрока. Крафт доски из wood делает сам игрок (меню E). Другие действия ты не умеешь.

ВАЖНО: collect_resource давай всегда, даже если ресурса нет в nearby_objects — игра сама ищет в радиусе 14 клеток и сообщит, если не нашла. Для «положи блок передо мной/здесь» бери pos из free_cell_in_front_of_player; блок должен быть в inventory (в creative — любой). Дом: если материала меньше 53 (и режим не creative) — не вызывай build_structure, объясни и предложи собрать дерево. Несколько просьб подряд — несколько actions в порядке выполнения (до 12).

ПРИМЕРЫ:
«Мне нужно побольше древесины» → {"thought":"Хочет дерево","say":"Понял, нарублю брёвен!","intent":"action","actions":[{"type":"collect_resource","resource":"wood","count":10}]}
«Привет, Гекс» → {"thought":"Приветствие","say":"Привет! Чем займёмся?","intent":"chat","actions":[]}
«Найди камень и добудь его, потом принеси песок» → actions: collect_resource stone 5, collect_resource sand 5
«Пойди за мной» → follow_player; «Осмотрись вокруг» → inspect_area; «Построй небольшой домик» → build_structure house planks
«Поставь здесь блок дерева» → {"type":"place_block","pos":<free_cell_in_front_of_player>,"block":"planks"}`;
class LLMError extends Error{constructor(code,msg,status){super(msg);this.code=code;this.status=status}}
function httpError(status,j){let m=j&&(j.error&&(j.error.message||j.error)||(Array.isArray(j)&&j[0]&&j[0].error&&j[0].error.message)||j.message)||'';if(typeof m!=='string')m=JSON.stringify(m);m=m.slice(0,200);
if(status===401||status===403)return new LLMError('auth','Провайдер отклонил API-ключ. Проверьте LLM_API_KEY, LLM_PROVIDER и LLM_MODEL в файле .env.',401);
if(status===402||/insufficient|billing|credit|balance/i.test(m))return new LLMError('billing','На счёте провайдера не хватает средств или кредитов.',402);
if(status===429||/quota|rate.?limit|resource.?exhausted|too many requests/i.test(m))return/per.?day|daily|day/i.test(m)?new LLMError('quota_day','Дневной лимит запросов к модели исчерпан. Подождите до обновления лимита, смените модель или ключ в .env.',429):new LLMError('quota','Превышен лимит запросов к модели (слишком часто или исчерпана квота). Подождите минуту и повторите.',429);
if(status===404)return new LLMError('model','Модель «'+MODEL+'» или адрес API не найдены. Проверьте LLM_MODEL, LLM_BASE_URL и LLM_CHAT_PATH в .env.',502);
return new LLMError('api','Ошибка API ('+status+'): '+m,502)}
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(p=>typeof p==='string'?p:p&&p.text||'').join(''):'';
async function callLLM(messages,systemPrompt=SYSTEM){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),30000);
try{let r,j,txt,cut;
if(PROVIDER==='anthropic'){r=await fetch(BASE+'/v1/messages',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:MAXTOK,system:systemPrompt,messages})});
j=await r.json().catch(()=>({}));if(!r.ok)throw httpError(r.status,j);txt=(j.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('');cut=j.stop_reason==='max_tokens'}
else{r=await fetch(BASE+(E.LLM_CHAT_PATH||'/v1/chat/completions'),{method:'POST',signal:ac.signal,headers:{'content-type':'application/json',authorization:'Bearer '+KEY},body:JSON.stringify({model:MODEL,max_tokens:MAXTOK,messages:[{role:'system',content:systemPrompt},...messages]})});
j=await r.json().catch(()=>({}));if(!r.ok)throw httpError(r.status,j);const ch=j.choices&&j.choices[0];txt=textOf(ch&&ch.message&&ch.message.content);cut=ch&&ch.finish_reason==='length'}
if(!txt.trim())throw new LLMError(cut?'length':'empty',cut?'Ответ модели обрезан — увеличьте LLM_MAX_TOKENS в .env.':'Модель вернула пустой ответ. Повторите запрос.',502);
return{text:txt,cut}}
catch(e){if(e instanceof LLMError)throw e;if(e.name==='AbortError')throw new LLMError('timeout','Модель не ответила за 30 секунд. Повторите запрос.',504);throw new LLMError('network','Не удалось связаться с провайдером ('+BASE+'): '+(e.cause&&e.cause.code||e.message),502)}finally{clearTimeout(t)}}
// Достаёт первый корректный JSON-объект (учитывает ```json-обрамление и лишний текст вокруг).
function extractJSON(t){t=String(t||'').replace(/```(?:json)?/gi,'');const s=t.indexOf('{');if(s<0)return null;let d=0,str=false,esc=false;
for(let i=s;i<t.length;i++){const c=t[i];if(str){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')str=false;continue}if(c==='"')str=true;else if(c==='{')d++;else if(c==='}'&&--d===0){try{return JSON.parse(t.slice(s,i+1))}catch(e){return null}}}return null}
let last=0,busy=false;
async function companion(b){const mem=loadMem(b.world),msgs=[],msg=String(b.message||'').slice(0,300);
for(const d of mem.dialogue.slice(-8))if(d.j)msgs.push({role:'user',content:d.u},{role:'assistant',content:JSON.stringify(d.j)}); // в истории — JSON-ответы, чтобы модель не переходила на обычный текст
msgs.push({role:'user',content:JSON.stringify({player_message:msg,observation:b.observation,inventory:b.inventory,player:b.player,robot:b.bot,long_term_memory:{facts:mem.facts,preferences:mem.prefs},recent_tasks:mem.tasks.slice(-5)}).slice(0,12000)});
const{text,cut}=await callLLM(msgs),raw=extractJSON(text);
if(!raw)throw new LLMError(cut?'length':'format',cut?'Ответ модели обрезан — увеличьте LLM_MAX_TOKENS в .env.':'Модель ответила не в формате JSON: «'+text.trim().slice(0,80)+'». Повторите запрос.',502);
const out=validate(raw);
console.log(`[запрос] «${msg}» → intent=${out.intent}; действия: ${out.actions.map(a=>a.type).join(', ')||'—'}${out.rejected.length?'; ОТКЛОНЕНО: '+out.rejected.map(r=>r.type+' ('+r.reason+')').join(', '):''}`);
mem.dialogue.push({u:msg,j:{say:out.say,intent:out.intent,actions:out.actions}});mem.dialogue=mem.dialogue.slice(-10);
if(out.memory.fact&&!mem.facts.includes(out.memory.fact))mem.facts=[...mem.facts,out.memory.fact].slice(-40);
if(out.memory.preference&&!mem.prefs.includes(out.memory.preference))mem.prefs=[...mem.prefs,out.memory.preference].slice(-20);
saveMem(b.world,mem);delete out.memory;return out}
const body=req=>new Promise((res,rej)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e5){rej(new Error('too large'));req.destroy()}});req.on('end',()=>{try{res(JSON.parse(s||'{}'))}catch(e){rej(e)}})});
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
http.createServer(async(req,res)=>{try{
if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'hexworld.html')))}
if(req.method==='POST'&&req.url==='/api/task'){const b=await body(req),m=loadMem(b.world);m.tasks=[...m.tasks,{t:new Date().toISOString(),s:String(b.summary||'').slice(0,160)}].slice(-30);saveMem(b.world,m);return send(res,200,{ok:true})}
if(req.method==='POST'&&req.url==='/api/companion'){
if(!KEY)return send(res,503,{error:'LLM_API_KEY не задан на сервере (впишите ключ в файл .env).',code:'nokey'});
if(busy||Date.now()-last<MIN_GAP)return send(res,429,{error:'Слишком много запросов подряд — подождите секунду.',code:'local_rate'});
const b=await body(req);busy=true;last=Date.now();
try{send(res,200,await companion(b))}catch(e){const le=e instanceof LLMError?e:new LLMError('internal','Внутренняя ошибка сервера: '+e.message,500);console.error('[ошибка]',le.code,le.message);send(res,le.status||502,{error:le.message,code:le.code})}finally{busy=false}return}
send(res,404,{error:'not found'})}catch(e){send(res,400,{error:e.message})}}).listen(PORT,()=>{const url='http://localhost:'+PORT;console.log(`HEXWORLD запущен: ${url}\nПровайдер: ${PROVIDER} | модель: ${MODEL} | ключ: ${KEY?'задан':'НЕ ЗАДАН (игра работает, но робот не сможет отвечать — впишите LLM_API_KEY в файл .env)'}`);
if(process.platform==='win32'&&E.OPEN_BROWSER!=='0')require('child_process').exec(`start "" "${url}"`)}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Порт ${PORT} уже занят (возможно, сервер уже запущен). Закройте другое окно HEXWORLD или смените PORT в файле .env.`:'Ошибка сервера: '+e.message);process.exit(1)});
