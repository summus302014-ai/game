// HEXWORLD AI backend (агентный режим). Node 18+, без зависимостей. Ключ только из .env / переменных окружения.
// LLM_PROVIDER=anthropic|openai (openai = любой OpenAI-совместимый API), LLM_MODEL, LLM_API_KEY, LLM_BASE_URL, LLM_CHAT_PATH, LLM_MAX_TOKENS, LLM_MAX_PER_MIN
const http=require('http'),fs=require('fs'),path=require('path');
// Загрузка настроек из файла .env (рядом с server.js). Уже заданные переменные окружения имеют приоритет.
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){if(l.trim().startsWith('#'))continue;const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}catch(e){}
const E=process.env,PORT=+E.PORT||3000,PROVIDER=(E.LLM_PROVIDER||'anthropic').toLowerCase(),MODEL=E.LLM_MODEL||'claude-sonnet-5-5',KEY=E.LLM_API_KEY||'',MAXTOK=+E.LLM_MAX_TOKENS||1800,PERMIN=+E.LLM_MAX_PER_MIN||10;
const BASE=(E.LLM_BASE_URL||(PROVIDER==='anthropic'?'https://api.anthropic.com':'https://api.openai.com')).replace(/\/$/,'');
const MIN_GAP=E.LLM_MIN_INTERVAL_MS?+E.LLM_MIN_INTERVAL_MS:1500,MEMDIR=path.join(__dirname,'memory');fs.mkdirSync(MEMDIR,{recursive:true});
const BLOCKS=['grass','dirt','stone','sand','snow','wood','leaves','iron_ore','crystal','planks','lamp','brick','stone_brick','cobblestone','glass','concrete','clay','tile','marble','birch_log','spruce_log','birch_leaves','spruce_leaves','moss','gravel','cactus','flower_red','flower_blue','tall_grass','mushroom','coal_ore','copper_ore','gold_ore','diamond_ore','torch','lantern','amber_lamp'];
const RESOURCES=BLOCKS,TARGETS=[...BLOCKS,'water']; // собирать можно любой блок, искать — любой блок и воду
const CRAFTS=['planks','stick','wood_pickaxe','stone_pickaxe','ferrite_pickaxe','lamp','brick','stone_brick','cobblestone','glass','concrete','tile','torch','lantern','amber_lamp'];
const KINDS=['house','hut','tower','wall','bridge','path','platform','pillar'];
const DIRN=['east','west','ne','nw','se','sw'];
// Нормализация идентификаторов параметров (страховка, если модель вернула синоним). Это не перевод через ИИ и не добавляет запросов.
const ALIAS=[[/water|вод[аыуе]|озер|река|море/i,'water'],[/coal|уголь|угол[ья]/i,'coal_ore'],[/copper|мед[ьи]|медн/i,'copper_ore'],[/gold|золот/i,'gold_ore'],[/diamond|алмаз/i,'diamond_ore'],[/glass|стекл/i,'glass'],[/brick|кирпич/i,'brick'],[/clay|глин/i,'clay'],[/gravel|гравий/i,'gravel'],[/cactus|кактус/i,'cactus'],[/mushroom|гриб/i,'mushroom'],[/moss|мох/i,'moss'],[/marble|мрамор/i,'marble'],[/birch|берёз|берез/i,'birch_log'],[/spruce|ель|ёлк|елк|сосн/i,'spruce_log'],[/flower|цвет[ое]к|цветы/i,'flower_red'],[/torch|факел/i,'torch'],[/lantern|фонар/i,'lantern'],[/wood|tree|log|trunk|timber|дерев|древес|бревн|брёвн|ствол/i,'wood'],[/stone|rock|cobble|камен|булыжн/i,'stone'],[/sand|песок|песк/i,'sand'],[/dirt|soil|earth|земл|грунт/i,'dirt'],[/grass|трав|дерн|дёрн/i,'grass'],[/snow|снег/i,'snow'],[/leaf|leaves|лист/i,'leaves'],[/iron|ore|желез|руд/i,'iron_ore'],[/crystal|gem|кристалл|самоцвет/i,'crystal']];
const BALIAS=[[/plank|доск/i,'planks'],[/lamp|lantern|ламп|фонар|светильн/i,'lamp'],...ALIAS];
const CALIAS=[[/stone.?brick/i,'stone_brick'],[/brick|кирпич/i,'brick'],[/cobble|булыжн/i,'cobblestone'],[/glass|стекл/i,'glass'],[/concrete|бетон/i,'concrete'],[/tile|плитк|черепиц/i,'tile'],[/torch|факел/i,'torch'],[/lantern|фонар/i,'lantern'],[/amber/i,'amber_lamp'],[/plank|доск/i,'planks'],[/stick|палк/i,'stick'],[/wood.*pick|дерев.*кирк/i,'wood_pickaxe'],[/stone.*pick|камен.*кирк/i,'stone_pickaxe'],[/iron.*pick|ferr|желез.*кирк|ферр/i,'ferrite_pickaxe'],[/lamp|ламп|фонар/i,'lamp']];
const KALIAS=[[/tower|башн/i,'tower'],[/wall|стен|забор|оград/i,'wall'],[/bridge|мост/i,'bridge'],[/path|road|walkway|дорож|тропин|аллея/i,'path'],[/platform|площадк|помост/i,'platform'],[/pillar|column|колонн|столб/i,'pillar'],[/hut|хиж|изб|шалаш/i,'hut'],[/house|home|cabin|дом/i,'house']];
const norm=(s,list,ok)=>{s=String(s==null?'':s).trim();if(ok.includes(s))return s;for(const[re,k]of list)if(re.test(s))return k;return null};
const num3=p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isFinite(+n)&&Math.abs(+n)<1e6)?p.map(n=>Math.round(+n)):null;
const clamp=(v,a,b,d)=>Math.min(b,Math.max(a,Math.round(+v)||d));
// Строгая белая таблица инструментов: всё остальное отбрасывается. Возвращает параметры или строку-причину отказа.
const V={follow_player:()=>({}),inspect_area:()=>({}),
move_to:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',look_at:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',
inspect_block:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',
find_resource:a=>{const r=norm(a.resource,ALIAS,TARGETS);return r?{resource:r}:'неизвестный ресурс «'+a.resource+'»'},
search_target:a=>{const r=norm(a.target||a.resource,ALIAS,TARGETS);return r?{target:r,guide:a.guide!==false}:'неизвестная цель поиска «'+(a.target||a.resource)+'»'},
explore:a=>({distance:clamp(a.distance,8,30,16),direction:DIRN.includes(a.direction)?a.direction:null}),
collect_resource:a=>{const r=norm(a.resource,ALIAS,RESOURCES);return r&&r!=='water'?{resource:r,count:clamp(a.count,1,16,5)}:'неизвестный ресурс «'+a.resource+'»'},
craft_item:a=>{const i=norm(a.item,CALIAS,CRAFTS);return i?{item:i,count:clamp(a.count,1,16,1)}:'такой предмет не крафтится «'+a.item+'»'},
place_block:a=>{const b=norm(a.block,BALIAS,BLOCKS);return num3(a.pos)&&b?{pos:num3(a.pos),block:b}:'нужны pos [q,r,y] и известный block'},
break_block:a=>num3(a.pos)?{pos:num3(a.pos)}:'нужна позиция [q,r,y]',
build_structure:a=>{const k=norm(a.kind||'house',KALIAS,KINDS);if(!k)return'умею строить: '+KINDS.join(', ');const h=k==='house';
return{kind:k,material:norm(a.material,BALIAS,BLOCKS)||'planks',roof_material:norm(a.roof_material,BALIAS,BLOCKS)||null,floor_material:norm(a.floor_material,BALIAS,BLOCKS)||null,windows:a.windows===true,
radius:clamp(a.radius,1,5,2),height:h?clamp(a.height,2,5,3):clamp(a.height,1,14,k==='tower'?8:3),length:h?clamp(a.length,3,20,7):clamp(a.length,2,24,8),width:h?clamp(a.width,3,20,7):clamp(a.width,1,3,1),direction:DIRN.includes(a.direction)?a.direction:null,at:num3(a.at)}},
build_custom:a=>{const m=norm(a.material,BALIAS,BLOCKS);if(!m)return'нужен material';if(!Array.isArray(a.blocks)||!a.blocks.length)return'нужен список blocks [[dq,dr,dy],...]';const seen=new Set(),bl=[];
for(const b of a.blocks.slice(0,150)){const p=num3(b);if(!p||Math.abs(p[0])>10||Math.abs(p[1])>10||p[2]<0||p[2]>14)return'координата блока вне допустимых пределов (|dq|,|dr|≤10, 0≤dy≤14)';const k=p.join();if(!seen.has(k)){seen.add(k);bl.push(p)}}
return{material:m,anchor:num3(a.anchor)||'front',blocks:bl,name:String(a.name||'постройка').slice(0,40)}},
wait:a=>({seconds:clamp(a.seconds,0,10,1)}),talk:a=>typeof a.text==='string'&&a.text.trim()?{text:a.text.slice(0,300)}:'пустой текст'};
const str=(s,n)=>typeof s==='string'&&s.trim()?s.trim().slice(0,n):'';
function validate(j){j=j&&typeof j==='object'?j:{};const out={thought:String(j.thought||'').slice(0,300),say:String(j.say||'').slice(0,500),intent:j.intent==='action'?'action':'chat',actions:[],rejected:[],memory:{},continue:j.continue===true,long_term:{}};
if('goal' in j)out.goal=str(j.goal,140)||null;
for(const a of(Array.isArray(j.actions)?j.actions:[]).slice(0,12)){if(!a||typeof a!=='object'||!Object.prototype.hasOwnProperty.call(V,a.type)){out.rejected.push({type:String(a&&a.type),reason:'неизвестное действие'});continue}
const v=V[a.type](a);if(v&&typeof v==='object')out.actions.push({type:a.type,...v});else out.rejected.push({type:a.type,reason:v||'недопустимые параметры'})}
if(out.actions.length)out.intent='action';
if(j.memory&&typeof j.memory==='object')for(const k of['fact','preference'])if(str(j.memory[k],200))out.memory[k]=str(j.memory[k],200);
if(j.long_term&&typeof j.long_term==='object')for(const k of['add','done'])if(str(j.long_term[k],140))out.long_term[k]=str(j.long_term[k],140);return out}
const mfile=w=>path.join(MEMDIR,String(w).replace(/\D/g,'').slice(0,10)+'.json');
const loadMem=w=>{try{const m=JSON.parse(fs.readFileSync(mfile(w),'utf8'));return{facts:m.facts||[],prefs:m.prefs||[],tasks:m.tasks||[],dialogue:m.dialogue||[],goals:m.goals||[]}}catch(e){return{facts:[],prefs:[],tasks:[],dialogue:[],goals:[]}}};
const saveMem=(w,m)=>fs.writeFileSync(mfile(w),JSON.stringify(m,null,1));
const SYSTEM=`Ты — Гекс, маленький любопытный робот-спутник игрока в гексагональной sandbox-игре HEXWORLD. Характер: дружелюбный, сообразительный, с чувством юмора, говоришь живым русским языком (не как технический ассистент и не канцеляритом). Игрок пишет по-русски как угодно: разговорно, с опечатками, намёками, шутками — понимай смысл и контекст, а не слова.
Ты автономный агент. Каждый твой ход — один запрос: ты получаешь свежие данные и решаешь, что делать дальше.

ВХОД (JSON): trigger — почему тебя позвали: "player" (игрок написал, текст в player_message), "result" (твои действия завершились, итоги в results — оцени успех и реши, что дальше), "idle" (тихий момент, можно проявить инициативу), "start" (игра только началась/загружена). Также: observation (мир вокруг тебя), inventory (инвентарь игрока), robot_bag (что ты несёшь), player, robot (текущая задача, очередь, goal, chain — номер шага подряд), long_term_memory, long_term_goals, recent_tasks.
Координаты: клетка = [q,r,y]. Соседи по (q,r): (+1,0) восток, (−1,0) запад, (0,+1) юго-восток, (−1,+1) юго-запад, (+1,−1) северо-восток, (0,−1) северо-запад. Кольцо радиуса 1 вокруг центра = 6 клеток, радиуса 2 = 12. Высота y растёт вверх.

ВЫХОД — один JSON без markdown и текста вокруг:
{"thought":"что понял и почему так решил (кратко)","say":"реплика игроку по-русски; пустая строка, если сказать нечего","intent":"action"|"chat","actions":[...],"continue":true|false,"goal":"текущая цель или null","long_term":{"add":"новая долгая цель","done":"выполненная/снятая долгая цель"},"memory":{"fact":"...","preference":"..."}}
• actions выполняются по порядку. continue=true — после выполнения действий ты хочешь получить итоги (results) и решить, что делать дальше. Ставь false, когда задача закончена или нужна реакция игрока.
• goal — что ты сейчас пытаешься сделать; null, когда делать нечего. long_term — только по-настоящему долгие замыслы (проекты, договорённости). memory — только важное о игроке/событиях (имя, вкусы, значимые итоги), не болтовню.

ПРАВИЛА
1. Игра выполняет ТОЛЬКО то, что есть в actions. Не говори «иду/строю/собираю», не вернув действие. Невозможно — intent="chat", actions=[] и честно объясни.
2. Планируй сам: просьба вроде «давай исследуем», «построй что-нибудь красивое», «нам нужны ресурсы», «мне скучно» — это повод придумать план из нескольких шагов. Не требуй от игрока детальных команд, но если выбор принципиален (что именно строить, из чего), можно коротко предложить вариант и действовать.
3. Читай results. Успех — двигайся к цели дальше или завершай. Провал — НЕ повторяй то же самое: смени подход (другой ресурс, другое место, предварительный крафт, иное решение) или объясни игроку и спроси. Если ты уже 2 раза неудачно пробовал одно и то же — остановись и скажи об этом.
4. Не крутись вхолостую: chain>=6 — подведи итог и остановись (continue=false).
5. trigger="idle"/"start": инициатива должна иметь причину (наступает ночь, игрок голоден или ранен, интересная находка, вспомнил про цель/проект из памяти, давно ничего не происходит). Чаще всего достаточно короткой реплики или предложения. Разрешены только безобидные действия: talk, inspect_area, inspect_block, find_resource, explore, wait, follow_player — ломать и строить без просьбы игрока нельзя. Если сказать нечего — верни say="" и actions=[]. Не спамь.
6. Игрок вправе перебить, сменить задачу, сказать «стоп»: follow_player сбрасывает очередь и возвращает тебя к игроку.

ИНСТРУМЕНТЫ (типы и значения — только на английском, ровно как здесь)
follow_player | inspect_area | wait{seconds} | talk{text} | move_to{pos} | look_at{pos}
search_target{target,guide} — ФИЗИЧЕСКИЙ поиск: ты сам идёшь по расширяющимся кольцам вокруг игрока, осматриваешь местность по реальным данным мира, останавливаешься, когда цель найдена, возвращаешься к игроку, сообщаешь и (guide:true, по умолчанию) ведёшь его к цели. target — любое имя блока из списка или water. Используй для «найди / где / покажи / отведи к». Если цели нет рядом — игра честно сообщит об этом. Координаты НЕ придумывай.
inspect_block{pos} | find_resource{resource} — мгновенный поиск ≤24 клеток, вернёт количество и позиции (для планирования, без хождения) | explore{distance:8-30,direction?:east|west|ne|nw|se|sw}
collect_resource{resource,count:1-16} — resource: любое имя блока из списка (кроме water); ищет сам в радиусе 14 клеток, несёт добычу игроку и отдаёт (давай даже если в observation ресурса не видно — игра сообщит, если не нашла).
craft_item{item,count} — item ∈ planks (1 любое бревно→4 planks), stick, wood_pickaxe, stone_pickaxe, ferrite_pickaxe, lamp, brick (4 clay→4), stone_brick (4 stone→4), cobblestone (2 stone→4), glass (2 sand→2), concrete (stone+gravel+sand→4), tile (2 clay→4), torch (coal+stick→4), lantern (torch+ferrite), amber_lamp (crystal_shard+coal→2). Крафтишь из инвентаря игрока и своей ноши.
place_block{pos,block} / break_block{pos} — позиции из observation (для «перед игроком» бери free_cell_in_front_of_player).
build_structure{kind,material,...}:
 • house{width,length,height,material,roof_material?,floor_material?,windows?} — прямоугольный дом с полом, четырьмя стенами, крышей и дверью (2 блока) со стороны игрока; windows:true — окна из glass. Размеры — это именно число БЛОКОВ: width — вдоль восток–запад, length — вдоль север–юг, height — высота стен над полом (2–5). Первое число из «8 на 9» или «8x9» — width, второе — length, число после «высота/высотой» (или третье в «5x6x3») — height. Не указано: «маленький» = 5×5×3, «большой» = 12×10×5, иначе 7×7×3. Расход: пол+крыша = 2·width·length, стены ≈ 2·(width+length−2)·height; считай и сверяй с inventory.
 • hut (старая шестиугольная хижина, 53 блока) | tower{radius,height:4-14} | wall{length,height:1-5,direction?} | path{length,width:1-3,direction?} | bridge{length,width,direction?} | platform{radius:1-5} | pillar{height}; at?:[q,r,y] — начало для wall/path/bridge (по умолчанию клетка перед игроком).
build_custom{name,material,anchor:"front"|[q,r,y],blocks:[[dq,dr,dy],...]} — твоя собственная конструкция: до 150 блоков со смещениями от якоря (|dq|,|dr|≤10, dy 0..14), все клетки должны быть свободны.
Блоки: ${BLOCKS.join(', ')}. Особые: glass прозрачный; torch, flower_*, tall_grass, mushroom — проходимые мелкие блоки; torch, lantern, amber_lamp, lamp светятся. Руды: coal_ore→coal, copper_ore→raw copper, gold_ore→raw gold, diamond_ore→diamond.
Строительство ставит блоки по одному и требует материал (инвентарь игрока + твоя ноша), иначе вернётся отказ с нужным количеством — тогда план: collect_resource → craft_item → строить. Если ровной площадки нужного размера нет, результат это скажет: предложи меньший размер или другое место.

ПРИМЕРЫ (сокращённо)
«Мне нужно побольше древесины» → {"thought":"хочет дерево","say":"Ща нарублю целую рощу!","intent":"action","actions":[{"type":"collect_resource","resource":"wood","count":10}],"continue":false,"goal":null}
«Построй мне башню» (досок нет) → collect wood → craft_item planks → build_structure tower, continue=true, goal="построить башню"
«Привет» → intent chat, actions [], continue false.`;
class LLMError extends Error{constructor(code,msg,status){super(msg);this.code=code;this.status=status}}
function httpError(status,j){let m=j&&(j.error&&(j.error.message||j.error)||(Array.isArray(j)&&j[0]&&j[0].error&&j[0].error.message)||j.message)||'';if(typeof m!=='string')m=JSON.stringify(m);m=m.slice(0,200);
if(status===401||status===403)return new LLMError('auth','Провайдер отклонил API-ключ. Проверьте LLM_API_KEY, LLM_PROVIDER и LLM_MODEL в файле .env.',401);
if(status===402||/insufficient|billing|credit|balance/i.test(m))return new LLMError('billing','На счёте провайдера не хватает средств или кредитов.',402);
if(status===429||/quota|rate.?limit|resource.?exhausted|too many requests/i.test(m))return/per.?day|daily|day/i.test(m)?new LLMError('quota_day','Дневной лимит запросов к модели исчерпан. Подождите до обновления лимита, смените модель или ключ в .env.',429):new LLMError('quota','Превышен лимит запросов к модели (слишком часто или исчерпана квота). Подождите минуту и повторите.',429);
if(status===404)return new LLMError('model','Модель «'+MODEL+'» или адрес API не найдены. Проверьте LLM_MODEL, LLM_BASE_URL и LLM_CHAT_PATH в .env.',502);
return new LLMError('api','Ошибка API ('+status+'): '+m,502)}
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(p=>typeof p==='string'?p:p&&p.text||'').join(''):'';
async function callLLM(messages,systemPrompt=SYSTEM){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),40000);
try{let r,j,txt,cut;
if(PROVIDER==='anthropic'){r=await fetch(BASE+'/v1/messages',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:MAXTOK,system:systemPrompt,messages})});
j=await r.json().catch(()=>({}));if(!r.ok)throw httpError(r.status,j);txt=(j.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('');cut=j.stop_reason==='max_tokens'}
else{r=await fetch(BASE+(E.LLM_CHAT_PATH||'/v1/chat/completions'),{method:'POST',signal:ac.signal,headers:{'content-type':'application/json',authorization:'Bearer '+KEY},body:JSON.stringify({model:MODEL,max_tokens:MAXTOK,messages:[{role:'system',content:systemPrompt},...messages]})});
j=await r.json().catch(()=>({}));if(!r.ok)throw httpError(r.status,j);const ch=j.choices&&j.choices[0];txt=textOf(ch&&ch.message&&ch.message.content);cut=ch&&ch.finish_reason==='length'}
if(!txt.trim())throw new LLMError(cut?'length':'empty',cut?'Ответ модели обрезан — увеличьте LLM_MAX_TOKENS в .env.':'Модель вернула пустой ответ. Повторите запрос.',502);
return{text:txt,cut}}
catch(e){if(e instanceof LLMError)throw e;if(e.name==='AbortError')throw new LLMError('timeout','Модель не ответила за 40 секунд. Повторите запрос.',504);throw new LLMError('network','Не удалось связаться с провайдером ('+BASE+'): '+(e.cause&&e.cause.code||e.message),502)}finally{clearTimeout(t)}}
// Достаёт первый корректный JSON-объект (учитывает ```json-обрамление и лишний текст вокруг).
function extractJSON(t){t=String(t||'').replace(/```(?:json)?/gi,'');const s=t.indexOf('{');if(s<0)return null;let d=0,str=false,esc=false;
for(let i=s;i<t.length;i++){const c=t[i];if(str){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')str=false;continue}if(c==='"')str=true;else if(c==='{')d++;else if(c==='}'&&--d===0){try{return JSON.parse(t.slice(s,i+1))}catch(e){return null}}}return null}
let last=0,busy=false;const stamps=[];
async function companion(b){const mem=loadMem(b.world),msgs=[],trig=['player','result','idle','start'].includes(b.trigger)?b.trigger:'player',msg=String(b.message||'').slice(0,300);
for(const d of mem.dialogue.slice(-6))if(d.j)msgs.push({role:'user',content:d.u},{role:'assistant',content:JSON.stringify(d.j)}); // история — JSON-ответы, чтобы модель держала формат
const results=(Array.isArray(b.results)?b.results:[]).slice(-12);
msgs.push({role:'user',content:JSON.stringify({trigger:trig,player_message:msg,results,observation:b.observation,inventory:b.inventory,robot_bag:b.observation&&b.observation.robot_bag,player:b.player,robot:b.bot,long_term_memory:{facts:mem.facts,preferences:mem.prefs},long_term_goals:mem.goals,recent_tasks:mem.tasks.slice(-6)}).slice(0,14000)});
const{text,cut}=await callLLM(msgs),raw=extractJSON(text);
if(!raw)throw new LLMError(cut?'length':'format',cut?'Ответ модели обрезан — увеличьте LLM_MAX_TOKENS в .env.':'Модель ответила не в формате JSON: «'+text.trim().slice(0,80)+'». Повторите запрос.',502);
const out=validate(raw);
console.log(`[${trig}] «${msg||results.map(r=>r.action).join('; ').slice(0,60)}» → intent=${out.intent}; goal=${out.goal===undefined?'(без изм.)':out.goal}; continue=${out.continue}; действия: ${out.actions.map(a=>a.type).join(', ')||'—'}${out.rejected.length?'; ОТКЛОНЕНО: '+out.rejected.map(r=>r.type+' ('+r.reason+')').join(', '):''}`);
mem.dialogue.push({u:trig==='player'?msg:'['+trig+'] '+results.map(r=>(r.ok?'✔':'✘')+r.action+': '+r.detail).join('; ').slice(0,300),j:{say:out.say,intent:out.intent,actions:out.actions,continue:out.continue,goal:out.goal}});mem.dialogue=mem.dialogue.slice(-12);
if(out.memory.fact&&!mem.facts.includes(out.memory.fact))mem.facts=[...mem.facts,out.memory.fact].slice(-40);
if(out.memory.preference&&!mem.prefs.includes(out.memory.preference))mem.prefs=[...mem.prefs,out.memory.preference].slice(-20);
if(out.long_term.done)mem.goals=mem.goals.filter(g=>g!==out.long_term.done);
if(out.long_term.add&&!mem.goals.includes(out.long_term.add))mem.goals=[...mem.goals,out.long_term.add].slice(-8);
saveMem(b.world,mem);delete out.memory;delete out.long_term;return out}
const body=req=>new Promise((res,rej)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e5){rej(new Error('too large'));req.destroy()}});req.on('end',()=>{try{res(JSON.parse(s||'{}'))}catch(e){rej(e)}})});
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
http.createServer(async(req,res)=>{try{
if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'hexworld.html')))}
if(req.method==='POST'&&req.url==='/api/task'){const b=await body(req),m=loadMem(b.world);m.tasks=[...m.tasks,{t:new Date().toISOString(),s:String(b.summary||'').slice(0,160)}].slice(-30);saveMem(b.world,m);return send(res,200,{ok:true})}
if(req.method==='POST'&&req.url==='/api/companion'){
if(!KEY)return send(res,503,{error:'LLM_API_KEY не задан на сервере (впишите ключ в файл .env).',code:'nokey'});
const now=Date.now();while(stamps.length&&now-stamps[0]>60000)stamps.shift();
if(busy||now-last<MIN_GAP||stamps.length>=PERMIN)return send(res,429,{error:stamps.length>=PERMIN?'Слишком много запросов в минуту (лимит '+PERMIN+') — подождите немного.':'Слишком много запросов подряд — подождите секунду.',code:'local_rate'});
const b=await body(req);busy=true;last=now;stamps.push(now);
try{send(res,200,await companion(b))}catch(e){const le=e instanceof LLMError?e:new LLMError('internal','Внутренняя ошибка сервера: '+e.message,500);console.error('[ошибка]',le.code,le.message);send(res,le.status||502,{error:le.message,code:le.code})}finally{busy=false}return}
send(res,404,{error:'not found'})}catch(e){send(res,400,{error:e.message})}}).listen(PORT,()=>{const url='http://localhost:'+PORT;console.log(`HEXWORLD запущен: ${url}\nПровайдер: ${PROVIDER} | модель: ${MODEL} | ключ: ${KEY?'задан':'НЕ ЗАДАН (игра работает, но робот не сможет отвечать — впишите LLM_API_KEY в файл .env)'}`);
if(process.platform==='win32'&&E.OPEN_BROWSER!=='0')require('child_process').exec(`start "" "${url}"`)}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Порт ${PORT} уже занят (возможно, сервер уже запущен). Закройте другое окно HEXWORLD или смените PORT в файле .env.`:'Ошибка сервера: '+e.message);process.exit(1)});
