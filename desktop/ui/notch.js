
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

/* Colour ramp (upstream palette values) */
let AMPLE='#00FF88', WATCH='#F2FF00', CRIT='#FF3F00';
// The status arc is neutral on purpose: the ring behind it is coloured by how much of the limit
// is gone, and a green arc inside it reads as part of that scale. Waiting borrows the warning yellow.
let TRACK='#303030', INK='#ffffff', DIM='#808080', HOLE='#2a2a2a';
// The arcs and the card's dots are drawn into SVG and inline styles, where `var()` does not reach,
// so the palette is read back out of the page instead of written down twice.
function readPalette(){
  const s=getComputedStyle(document.documentElement);
  const v=(name,fallback)=>s.getPropertyValue(name).trim()||fallback;
  TRACK=v('--track',TRACK); INK=v('--ink',INK); DIM=v('--ink-dim',DIM); HOLE=v('--hole',HOLE);
  AMPLE=v('--ample',AMPLE); WATCH=v('--watch',WATCH); CRIT=v('--crit',CRIT);
}
readPalette();
/* The palette switches on this attribute, and what is drawn into SVG is redrawn by hand, since
   var() does not reach it. `dark` is the default the CSS already holds, so a failed ask changes
   nothing rather than leaving the page half-painted. */
function applyTheme(name){
  document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
  readPalette();
  renderRing();
  if(card&&card.classList.contains('show')) renderCard();
}
invoke('get_theme_resolved').then(applyTheme).catch(()=>{});
listen('theme_resolved',e=>applyTheme(e.payload)).catch(()=>{});
let colorTransition='hard_step';
const stepTone=f=> f>=0.7?CRIT : f>=0.5?WATCH : AMPLE;
// A continuous sRGB ramp across the whole range: the Windows watch cut has always been 50%, so
// this is a named equivalence rather than a magic number. Windows has no watch-limit slider.
const WATCH_AT=0.5;
function hex3(c){ const n=parseInt(c.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function lerpHex(a,b,t){
  const A=hex3(a), B=hex3(b);
  const ch=i=>Math.round(A[i]+(B[i]-A[i])*t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
const rampTone=f=>{
  f=Math.max(0,Math.min(1,f));
  if(f<WATCH_AT) return lerpHex(AMPLE,WATCH,f/WATCH_AT);
  return lerpHex(WATCH,CRIT,(f-WATCH_AT)/(1-WATCH_AT));
};
const tone=f=> colorTransition==='ramp'?rampTone(f):stepTone(f);
// Whole percents, except where rounding would read as nothing used or nothing left, as the Mac's Percent does
function smallPct(v){
  if(v<=0) return '0';
  const t=Math.round(v*10)/10;
  if(t<0.1) return '<0.1';
  if(t>99.9) return '>99.9';
  return t.toFixed(1);
}
function pctText(f){ const v=f*100; return v>0&&v<1?smallPct(v):String(Math.round(v)); }
// Both ends, since vendors disagree on which they print; the left half comes from the rounded used half, as their dashboards do
function usedCopy(w){
  const v=w.used*100;
  let used, left;
  if((v>0&&v<1)||(v>99&&v<100)){ used=smallPct(v); left=100-v>99.9?'>99.9':smallPct(Math.max(0,100-v)); }
  else { const u=Math.round(v); used=String(u); left=String(Math.max(0,100-u)); }
  if(w.derived) used='~'+used;
  return ui().usedLeft(used,left);
}

let usage={status:'',windows:[],fetched_at:0,note:''};
let codexSnap={status:'absent',windows:[],fetched_at:0,note:''};
let cursorSnap={status:'absent',windows:[],fetched_at:0,note:''};
// Grok Build credits, from the Grok CLI's own session; absent until that CLI is signed in
let grokSnap={status:'absent',windows:[],fetched_at:0,note:''};
let glmSnap={status:'absent',windows:[],fetched_at:0,note:''};
// OpenCode Go plan, read with OpenCode's own sign-in; absent until OpenCode is installed
let opencodeSnap={status:'absent',windows:[],fetched_at:0,note:''};
let agSnap={status:'absent',windows:[],fetched_at:0,note:''};
let glyphs={}; // id → {kind:'mark'|'appicon', url}
let activity=[]; // live sessions from the collector's feed: {provider,account,state:'busy'|'waiting',name,detail,since}
/* Which screen edge the notch is pinned to. Rust owns it (it is what placed the window); the page is
   told so it can mirror or rotate itself to match. 'right' is the default and the pre-edge layout. */
let notchEdge='right';
// Show on hover. the logic is beside the move handle below; declared here, since reportHot reads `folded` from the first frame
let folded=false, pointerIn=false, menuOpen=false, foldTimer=null;
/* How much of the window the taskbar covers, in CSS px, from Rust: top, right, bottom, left. The pill
   stays against the screen edge; the card is kept out of these. */
let insets=[0,0,0,0];
function applyInsets(v){
  const next=Array.isArray(v)&&v.length===4?v.map(n=>Math.max(0,Number(n)||0)):[0,0,0,0];
  if(next.every((n,i)=>n===insets[i])) return;
  insets=next;
  if(card&&card.classList.contains('show')){ placeCard(); reportHot(); }
}
// Pushed on every placement, and asked for once in case the placement happened before this page was listening
listen('notch_insets',e=>applyInsets(e.payload)).catch(()=>{});
invoke('get_notch_insets').then(applyInsets).catch(()=>{});
function edgeIsVertical(){ return notchEdge==='left'||notchEdge==='right'; }
function applyEdge(e){
  const next=(e==='left'||e==='top'||e==='bottom')?e:'right';
  if(next===notchEdge) return;
  notchEdge=next;
  document.body.dataset.edge=next;
  // The window changes shape with the edge, and so does the width the zoom correction measures against
  reportDpr();
  // The pill changes shape, so both the hot rectangles and the card's anchor have to be measured again
  if(card&&card.classList.contains('show')) placeCard();
  reportHot();
}
let uiLang='en';
// The tray menu already speaks four languages: i18n.rs resolves the user's locale to zh, ja, ko
// or ru, and main.rs hands the result to this page as `lang_resolved`. The card understood only
// Russian, so a Chinese machine showed a translated menu above an English card. Everything a
// provider or this page can put on the card is keyed by that same language code below:
// TEXT for whole strings, PATTERNS for the ones carrying a number or a plan name, UI for the
// words the card writes itself. A language with no table falls back to English rather than
// showing half a translation, so adding one is only ever data.
const TEXT={
  ko:{
    'Included usage':'포함 사용량',
    'API usage':'API 사용량',
    'On demand':'온디맨드',
    'Usage':'사용량',
    'Current session':'현재 세션',
    'Weekly (all models)':'주간 (모든 모델)',
    'Weekly (Opus)':'주간 (Opus)',
    'Weekly (model-scoped)':'주간 (모델별)',
    'Weekly limit':'주간 제한',
    'Weekly Limit':'주간 제한',
    '5-Hour Limit':'5시간 제한',
    '5-hour Limit':'5시간 제한',
    'Gemini Models':'Gemini 모델',
    'Claude and GPT models':'Claude 및 GPT 모델',
    'Monthly limit':'월간 제한',
    'Monthly Limit':'월간 제한',
    'Longer window':'장기 사용 기간',
    'Requests today · no limit published':'오늘 요청 수 · 한도 미공개',
    'Resetting…':'재설정 중…',
    'Resets at':'재설정 시각',
    'Resets':'재설정',
    'Working':'작업 중',
    'Waiting':'대기 중',
    'Streaming (network)':'스트리밍 중 (네트워크)',
    'Rate limited, retrying in':'요청 제한, 재시도까지',
    'Rate limited. retrying in':'요청 제한. 재시도까지',
    'request today':'오늘 요청',
    'requests today':'오늘 요청',
    'no requests today':'오늘 요청 없음',
    'Waiting for first reading…':'첫 측정값을 기다리는 중…',
    'Sign in to Claude Code to see usage.':'사용량을 확인하려면 Claude Code에 로그인하십시오.',
    'Sign in to Cursor to see usage.':'사용량을 확인하려면 Cursor에 로그인하십시오.',
    'Sign in to Codex to see usage.':'사용량을 확인하려면 Codex에 로그인하십시오.',
    'Sign in to Antigravity to see usage.':'사용량을 확인하려면 Antigravity에 로그인하십시오.',
    'needs your input':'응답을 기다리는 중',
    'Working in':'작업 위치:',
    'Sign in':'로그인',
    'Signing in...':'로그인 중…',
    'Refresh':'새로 고침',
    'Browser sign-in through Claude Code':'Claude Code를 통한 브라우저 로그인',
    'Complete sign-in in the browser or terminal window.':'브라우저나 터미널 창에서 로그인을 완료하십시오.',
    'Sign-in complete. Refreshing usage...':'로그인되었습니다. 사용량을 새로 고치는 중…',
    'Sign-in cancelled, failed or timed out. Try again.':'로그인이 취소되거나 실패했거나 시간이 초과되었습니다. 다시 시도하십시오.',
    'Checking usage...':'사용량 확인 중…',
    'Rate limited. Wait for the retry deadline.':'요청이 제한되었습니다. 재시도 시점까지 기다리십시오.',
    'Claude Code CLI not found. Install the standalone CLI first.':'Claude Code CLI를 찾을 수 없습니다. 먼저 독립 실행형 CLI를 설치하십시오.',
    'Claude sign-in or renewal is already running.':'Claude 로그인 또는 갱신이 이미 진행 중입니다.',
    'Unable to open Claude sign-in window.':'Claude 로그인 창을 열 수 없습니다.',
    'Claude HTTP 403: access denied. Check network or account access; sign-in may still be valid.':'Claude HTTP 403: 접근이 거부되었습니다. 네트워크나 계정의 접근 권한을 확인하십시오. 로그인은 여전히 유효할 수 있습니다.',
    'Run grok login to see usage.':'사용량을 확인하려면 grok login을 실행하십시오.',
  },
  'pt-BR':{
    'Included usage':'Uso incluído',
    'Sign in':'Entrar',
    'Signing in...':'Entrando...',
    'Refresh':'Atualizar',
    'Browser sign-in through Claude Code':'Login pelo navegador via Claude Code',
    'Complete sign-in in the browser or terminal window.':'Conclua o login no navegador ou na janela do terminal.',
    'Sign-in complete. Refreshing usage...':'Login concluído. Atualizando uso...',
    'Sign-in cancelled, failed or timed out. Try again.':'O login foi cancelado, falhou ou expirou. Tente novamente.',
    'Checking usage...':'Verificando uso...',
    'Rate limited. Wait for the retry deadline.':'Limite de requisições atingido. Aguarde o prazo para nova tentativa.',
    'Claude Code CLI not found. Install the standalone CLI first.':'CLI do Claude Code não encontrada. Instale primeiro a CLI independente.',
    'Claude sign-in or renewal is already running.':'O login ou a renovação do Claude já está em andamento.',
    'Unable to open Claude sign-in window.':'Não foi possível abrir a janela de login do Claude.',
    'Claude HTTP 403: access denied. Check network or account access; sign-in may still be valid.':'Claude HTTP 403: acesso negado. Verifique a rede ou o acesso da conta; o login ainda pode ser válido.',
    'API usage':'Uso da API',
    'On demand':'Sob demanda',
    'Usage':'Uso',
    'Current session':'Sessão atual',
    'Weekly (all models)':'Semanal (todos os modelos)',
    'Weekly (Opus)':'Semanal (Opus)',
    'Weekly (model-scoped)':'Semanal (por modelo)',
    'Weekly limit':'Limite semanal',
    'Weekly Limit':'Limite semanal',
    '5-Hour Limit':'Limite de 5 horas',
    '5-hour Limit':'Limite de 5 horas',
    'Gemini Models':'Modelos Gemini',
    'Claude and GPT models':'Modelos Claude e GPT',
    'Monthly limit':'Limite mensal',
    'Monthly Limit':'Limite mensal',
    'Longer window':'Janela mais longa',
    'Requests today · no limit published':'Solicitações hoje · nenhum limite publicado',
    'Updated':'Atualizado',
    'Resetting…':'Renovando…',
    'Resets at':'Redefine às',
    'Resets':'Redefine',
    'Working':'Trabalhando',
    'Waiting':'Aguardando',
    'Streaming (network)':'Transmitindo (rede)',
    'Rate limited, retrying in':'Limite de requisições, nova tentativa em',
    'Rate limited. retrying in':'Limite de requisições. nova tentativa em',
    'request today':'requisição hoje',
    'requests today':'requisições hoje',
    'no requests today':'nenhuma solicitação hoje',
    'Waiting for first reading…':'Aguardando a primeira leitura…',
    'Sign in to Claude Code to see usage.':'Entre no Claude Code para ver o uso.',
    'Sign in to Cursor to see usage.':'Entre no Cursor para ver o uso.',
    'Sign in to Codex to see usage.':'Entre no Codex para ver o uso.',
    'Sign in to Antigravity to see usage.':'Entre no Antigravity para ver o uso.',
    'Run grok login to see usage.':'Execute grok login para ver o uso.',
    'Run opencode auth login to see usage.':'Execute opencode auth login para ver o uso.',
    'No OpenCode Go subscription on this account':'Nenhuma assinatura do OpenCode Go nesta conta',
    'needs your input':'precisa da sua resposta',
    'Working in':'Em execução em'
  },
  uk:{
    'Included usage':'Використання в тарифі',
    'API usage':'Використання API',
    'On demand':'За потребою',
    'Usage':'Використання',
    'Current session':'Поточна сесія',
    'Weekly (all models)':'Тижневий (усі моделі)',
    'Weekly (Opus)':'Тижневий (Opus)',
    'Weekly (model-scoped)':'Тижневий (для вибраної моделі)',
    'Weekly limit':'Тижневий ліміт',
    'Weekly Limit':'Тижневий ліміт',
    '5-Hour Limit':'Ліміт 5 годин',
    '5-hour Limit':'Ліміт 5 годин',
    'Gemini Models':'Моделі Gemini',
    'Claude and GPT models':'Моделі Claude і GPT',
    'Monthly limit':'Місячний ліміт',
    'Monthly Limit':'Місячний ліміт',
    'Longer window':'Довше вікно',
    'Requests today · no limit published':'Запитів сьогодні · ліміт не опубліковано',
    'Resetting…':'Скидання…',
    'Resets at':'Скидання о',
    'Resets':'Скидання',
    'Working':'Працює',
    'Waiting':'Очікує',
    'Streaming (network)':'Потокова передача (мережа)',
    'Rate limited, retrying in':'Ліміт запитів, повтор через',
    'Rate limited. retrying in':'Ліміт запитів. повтор через',
    'request today':'запит сьогодні',
    'requests today':'запитів сьогодні',
    'no requests today':'сьогодні запитів немає',
    'Waiting for first reading…':'Очікування першого показника…',
    'Sign in to Claude Code to see usage.':'Увійдіть у Claude Code, щоб бачити використання.',
    'Sign in to Cursor to see usage.':'Увійдіть у Cursor, щоб бачити використання.',
    'Sign in to Codex to see usage.':'Увійдіть у Codex, щоб бачити використання.',
    'Sign in to Antigravity to see usage.':'Увійдіть в Antigravity, щоб бачити використання.',
    'needs your input':'потрібна ваша відповідь',
    'Working in':'Працює в'
  },
  ru:{
    'Included usage':'Включённое использование',
    'Sign in':'Авторизоваться',
    'Signing in...':'Вход…',
    'Browser sign-in through Claude Code':'Вход через браузер с помощью Claude Code',
    'Complete sign-in in the browser or terminal window.':'Подтвердите вход в браузере или окне терминала.',
    'Sign-in complete. Refreshing usage...':'Вход выполнен. Обновляю лимиты…',
    'Sign-in cancelled, failed or timed out. Try again.':'Вход отменён, завершился ошибкой или истекло время ожидания. Попробуйте ещё раз.',
    'Claude Code CLI not found. Install the standalone CLI first.':'Claude Code CLI не найден. Установите отдельный CLI.',
    'Claude sign-in or renewal is already running.':'Вход или обновление авторизации Claude уже выполняется.',
    'Unable to open Claude sign-in window.':'Не удалось открыть окно входа Claude.',
    'Claude HTTP 403: access denied. Check network or account access; sign-in may still be valid.':'Claude HTTP 403: доступ запрещён. Проверьте сеть и доступ к аккаунту; авторизация может быть действующей.',
    'API usage':'Использование API',
    'On demand':'По запросу',
    'Usage':'Использование',
    'Current session':'Текущий сеанс',
    'Weekly (all models)':'Недельный (все модели)',
    'Weekly (Opus)':'Недельный (Opus)',
    'Weekly (model-scoped)':'Недельный (для выбранной модели)',
    'Weekly limit':'Недельный лимит',
    'Weekly Limit':'Недельный лимит',
    '5-Hour Limit':'Лимит на 5 часов',
    '5-hour Limit':'Лимит на 5 часов',
    'Gemini Models':'Модели Gemini',
    'Claude and GPT models':'Модели Claude и GPT',
    'Monthly limit':'Месячный лимит',
    'Monthly Limit':'Месячный лимит',
    'Longer window':'Более длительный период',
    'Requests today · no limit published':'Запросы сегодня · лимит не опубликован',
    'Resetting…':'Сброс…',
    'Resets at':'Сброс в',
    'Resets':'Сброс',
    'Working':'Работа',
    'Waiting':'Ожидание',
    'Streaming (network)':'Потоковая передача (сеть)',
    'Rate limited, retrying in':'Превышен лимит, повтор через',
    'Rate limited. retrying in':'Превышен лимит. повтор через',
    'request today':'запрос сегодня',
    'requests today':'запросов сегодня',
    'no requests today':'сегодня запросов нет',
    'Waiting for first reading…':'Ожидание первого показания…',
    'Sign in to Claude Code to see usage.':'Войдите в Claude Code, чтобы увидеть использование.',
    'Sign in to Cursor to see usage.':'Войдите в Cursor, чтобы увидеть использование.',
    'Sign in to Codex to see usage.':'Войдите в Codex, чтобы увидеть использование.',
    'Sign in to Antigravity to see usage.':'Войдите в Antigravity, чтобы увидеть использование.',
    'Run grok login to see usage.':'Выполните grok login, чтобы увидеть использование.',
    'needs your input':'требуется ваш ответ',
    'Working in':'Работает в'
  },
  zh:{
    'Included usage':'包含用量',
    'API usage':'API 用量',
    'On demand':'按需用量',
    'Usage':'用量',
    'Current session':'当前会话',
    'Weekly (all models)':'每周（全部模型）',
    'Weekly (Opus)':'每周（Opus）',
    'Weekly (model-scoped)':'每周（指定模型）',
    'Weekly limit':'每周限额',
    'Weekly Limit':'每周限额',
    '5-Hour Limit':'5 小时限额',
    '5-hour Limit':'5 小时限额',
    'Gemini Models':'Gemini 模型',
    'Claude and GPT models':'Claude 与 GPT 模型',
    'Monthly limit':'每月限额',
    'Monthly Limit':'每月限额',
    'Longer window':'更长的周期',
    'Requests today · no limit published':'今日请求数 · 未公布限额',
    'Resetting…':'正在重置…',
    'Resets at':'重置于',
    'Resets':'重置',
    'Working':'工作中',
    'Waiting':'等待中',
    'Streaming (network)':'正在传输（网络）',
    'Rate limited, retrying in':'已限流，稍后重试',
    'Rate limited. retrying in':'已限流. 稍后重试',
    'request today':'次请求（今日）',
    'requests today':'次请求（今日）',
    'no requests today':'今日没有请求',
    'Waiting for first reading…':'正在等待第一次读数…',
    'Sign in to Claude Code to see usage.':'请登录 Claude Code 以查看用量。',
    'Sign in to Cursor to see usage.':'请登录 Cursor 以查看用量。',
    'Sign in to Codex to see usage.':'请登录 Codex 以查看用量。',
    'Sign in to Antigravity to see usage.':'请登录 Antigravity 以查看用量。',
    'Run grok login to see usage.':'请运行 grok login 以查看用量。',
    'needs your input':'等待你的输入',
    'Working in':'工作于',
  },
  'zh-Hant':{
    'Included usage':'包含用量',
    'API usage':'API 用量',
    'On demand':'按需用量',
    'Usage':'用量',
    'Current session':'目前工作階段',
    'Weekly (all models)':'每週（全部模型）',
    'Weekly (Opus)':'每週（Opus）',
    'Weekly (model-scoped)':'每週（指定模型）',
    'Weekly limit':'每週限額',
    'Weekly Limit':'每週限額',
    '5-Hour Limit':'5 小時限額',
    '5-hour Limit':'5 小時限額',
    'Gemini Models':'Gemini 模型',
    'Claude and GPT models':'Claude 與 GPT 模型',
    'Monthly limit':'每月限額',
    'Monthly Limit':'每月限額',
    'Longer window':'更長的週期',
    'Requests today · no limit published':'今日要求數 · 未公布限額',
    'Resetting…':'正在重置…',
    'Resets at':'重置於',
    'Resets':'重置',
    'Working':'工作中',
    'Waiting':'等待中',
    'Streaming (network)':'正在傳輸（網路）',
    'Rate limited, retrying in':'已限流，稍後重試',
    'Rate limited. retrying in':'已限流. 稍後重試',
    'request today':'次要求（今日）',
    'requests today':'次要求（今日）',
    'no requests today':'今日沒有要求',
    'Waiting for first reading…':'正在等待第一次讀數…',
    'Sign in to Claude Code to see usage.':'請登入 Claude Code 以查看用量。',
    'Sign in to Cursor to see usage.':'請登入 Cursor 以查看用量。',
    'Sign in to Codex to see usage.':'請登入 Codex 以查看用量。',
    'Sign in to Antigravity to see usage.':'請登入 Antigravity 以查看用量。',
    'Run grok login to see usage.':'請執行 grok login 以查看用量。',
    'needs your input':'等待你的輸入',
    'Working in':'工作於',
  },
};
// Kept as patterns rather than exact keys: each one carries a number, a plan name or an error
// the provider wrote, so the whole string can never be a dictionary key.
const PATTERNS={
  ko:[
    [/^(\d+)m limit$/,'$1분 제한'],
    [/^(\d+)h limit$/,'$1시간 제한'],
    [/^(\d+)d limit$/,'$1일 제한'],
    [/^Rate limited, retrying in (\d+)s$/,'요청 제한, $1초 후 재시도'],
    [/^Rate limited. retrying in (\d+)s$/,'요청 제한. $1초 후 재시도'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'$1 요금제는 무제한입니다. 측정할 사용량이 없습니다'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'$1 요금제에는 아직 Cursor가 측정할 사용량이 없습니다'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google이 이 계정의 할당량을 공개하지 않습니다'],
    [/^Live read failed \((.+)\)$/,'실시간 조회 실패 ($1)'],
    [/Weekly \(all models\)/g,'주간 (모든 모델)'],
    [/Weekly \(Opus\)/g,'주간 (Opus)'],
    [/Weekly \(model-scoped\)/g,'주간 (모델별)'],
    [/Weekly limit/g,'주간 제한'],
    [/Monthly limit/g,'월간 제한'],
    [/\bWeekly\b/g,'주간'],
    [/\bMonthly\b/g,'월간'],
    [/ · via /g,' · 경유: '],
    [/needs your input/g,'응답을 기다리는 중'],
    [/^Working in /,'작업 위치: '],
    [/via Antigravity CLI/g,'Antigravity CLI 경유'],
    [/via Antigravity/g,'Antigravity 경유'],
    [/via Google/g,'Google 경유'],
    [/No Claude Code credential found/g,'Claude Code 자격 증명을 찾을 수 없습니다'],
    [/Credential expired. run claude once in a terminal to renew it/g,'자격 증명이 만료되었습니다. 터미널에서 claude를 한 번 실행해 갱신하십시오'],
    [/Credential rejected \(switched accounts\?\)/g,'자격 증명이 거부되었습니다 (계정을 전환하셨습니까?)'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'Codex 로그인이 만료되었습니다. Codex를 한 번 열어 갱신하십시오'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'Codex 로그인이 거부되었습니다. Codex에 다시 로그인하십시오'],
    [/Codex reported no usage windows/g,'Codex가 사용량 집계 기간을 보고하지 않았습니다'],
    [/Codex has not recorded a usage snapshot yet/g,'Codex가 아직 사용량 스냅샷을 기록하지 않았습니다'],
    [/from last Codex run/g,'마지막 Codex 실행 기준'],
    [/Waiting for Antigravity CLI quota/g,'Antigravity CLI 할당량을 기다리는 중'],
    [/Open Antigravity to read its quota/g,'할당량을 확인하려면 Antigravity를 여십시오'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'Antigravity의 Google 세션이 거부되었습니다. Antigravity에서 다시 로그인하십시오'],
    [/Antigravity is closed. last reading kept/g,'Antigravity가 닫혀 있습니다. 마지막 측정값 유지'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'사용량을 확인하려면 Cursor 편집기에 로그인하십시오.'],
    [/Cursor session was rejected. sign in again in the editor/g,'Cursor 세션이 거부되었습니다. 편집기에서 다시 로그인하십시오'],
  ],
  'pt-BR':[
    [/^(\d+)m limit$/,'Limite de $1 min'],
    [/^(\d+)h limit$/,'Limite de $1 h'],
    [/^(\d+)d limit$/,'Limite de $1 d'],
    [/^Rate limited, retrying in (\d+)s$/,'Limite de requisições, nova tentativa em $1 s'],
    [/^Rate limited. retrying in (\d+)s$/,'Limite de requisições. nova tentativa em $1 s'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'Ilimitado no plano $1. nada para medir'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'O plano $1 ainda não tem uso para o Cursor medir'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google não publica cota para esta conta'],
    [/^Live read failed \((.+)\)$/,'Falha na leitura em tempo real ($1)'],
    [/Weekly \(all models\)/g,'Semanal (todos os modelos)'],
    [/Weekly \(Opus\)/g,'Semanal (Opus)'],
    [/Weekly \(model-scoped\)/g,'Semanal (por modelo)'],
    [/Weekly limit/g,'Limite semanal'],
    [/Monthly limit/g,'Limite mensal'],
    [/\bWeekly\b/g,'Semanal'],
    [/\bMonthly\b/g,'Mensal'],
    [/ · via /g,' · via '],
    [/needs your input/g,'precisa da sua resposta'],
    [/^Working in /,'Em execução em '],
    [/via Antigravity CLI/g,'via Antigravity CLI'],
    [/via Antigravity/g,'via Antigravity'],
    [/via Google/g,'via Google'],
    [/No Claude Code credential found/g,'Credencial do Claude Code não encontrada'],
    [/Credential expired. run claude once in a terminal to renew it/g,'A credencial expirou. execute claude uma vez no terminal para renová-la'],
    [/Credential rejected \(switched accounts\?\)/g,'Credencial rejeitada (você trocou de conta?)'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'O login do Codex expirou. abra o Codex uma vez para atualizá-lo'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'O Codex rejeitou o login. entre novamente no Codex'],
    [/Codex reported no usage windows/g,'O Codex não informou nenhuma janela de uso'],
    [/Codex has not recorded a usage snapshot yet/g,'O Codex ainda não registrou um retrato de uso'],
    [/from last Codex run/g,'da última execução do Codex'],
    [/Waiting for Antigravity CLI quota/g,'Aguardando a cota da CLI do Antigravity'],
    [/Open Antigravity to read its quota/g,'Abra o Antigravity para ler a cota'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'A sessão Google do Antigravity foi rejeitada. entre novamente no Antigravity'],
    [/Antigravity is closed. last reading kept/g,'O Antigravity está fechado. última leitura mantida'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'Entre no Cursor (o editor) para ver o uso.'],
    [/Cursor session was rejected. sign in again in the editor/g,'A sessão do Cursor foi rejeitada. entre novamente no editor'],
  ],
  uk:[
    [/^(\d+)m limit$/,'Ліміт $1 хв'],
    [/^(\d+)h limit$/,'Ліміт $1 год'],
    [/^(\d+)d limit$/,'Ліміт $1 дн'],
    [/^Rate limited, retrying in (\d+)s$/,'Ліміт запитів, повтор через $1 с'],
    [/^Rate limited. retrying in (\d+)s$/,'Ліміт запитів. повтор через $1 с'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'Безліміт на тарифі $1. нічого вимірювати'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'У тарифі $1 Cursor поки нічого вимірювати'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google не публікує ліміт для цього акаунта'],
    [/^Live read failed \((.+)\)$/,'Не вдалося прочитати наживо ($1)'],
    [/Weekly \(all models\)/g,'Тижневий (усі моделі)'],
    [/Weekly \(Opus\)/g,'Тижневий (Opus)'],
    [/Weekly \(model-scoped\)/g,'Тижневий (для вибраної моделі)'],
    [/Weekly limit/g,'Тижневий ліміт'],
    [/Monthly limit/g,'Місячний ліміт'],
    [/\bWeekly\b/g,'Тижневий'],
    [/\bMonthly\b/g,'Місячний'],
    [/ · via /g,' · через '],
    [/needs your input/g,'потрібна ваша відповідь'],
    [/^Working in /,'Працює в '],
    [/via Antigravity CLI/g,'через Antigravity CLI'],
    [/via Antigravity/g,'через Antigravity'],
    [/via Google/g,'через Google'],
    [/No Claude Code credential found/g,'Не знайдено облікових даних Claude Code'],
    [/Credential expired. run claude once in a terminal to renew it/g,'Термін дії облікових даних минув. запустіть claude один раз у терміналі, щоб поновити їх'],
    [/Credential rejected \(switched accounts\?\)/g,'Облікові дані відхилено (змінили акаунт?)'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'Термін входу в Codex минув. відкрийте Codex один раз, щоб поновити'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'Codex відхилив вхід. увійдіть у Codex ще раз'],
    [/Codex reported no usage windows/g,'Codex не повернув жодного вікна використання'],
    [/Codex has not recorded a usage snapshot yet/g,'Codex ще не записав знімок використання'],
    [/from last Codex run/g,'з останнього запуску Codex'],
    [/Waiting for Antigravity CLI quota/g,'Очікування ліміту Antigravity CLI'],
    [/Open Antigravity to read its quota/g,'Відкрийте Antigravity, щоб прочитати його ліміт'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'Сеанс Google в Antigravity відхилено. увійдіть в Antigravity ще раз'],
    [/Antigravity is closed. last reading kept/g,'Antigravity закрито. збережено останній показник'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'Увійдіть у Cursor (редактор), щоб бачити використання.'],
    [/Cursor session was rejected. sign in again in the editor/g,'Сеанс Cursor відхилено. увійдіть у редакторі ще раз'],
  ],
  ru:[
    [/^(\d+)m limit$/,'Лимит на $1 мин'],
    [/^(\d+)h limit$/,'Лимит на $1 ч'],
    [/^(\d+)d limit$/,'Лимит на $1 дн.'],
    [/^Rate limited, retrying in (\d+)s$/,'Превышен лимит, повтор через $1 с'],
    [/^Rate limited. retrying in (\d+)s$/,'Превышен лимит. повтор через $1 с'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'Безлимитный тариф $1. нечего измерять'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'В тарифе $1 пока нечего измерять Cursor'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google не публикует лимит для этого аккаунта'],
    [/^Live read failed \((.+)\)$/,'Ошибка чтения онлайн-данных ($1)'],
    [/Weekly \(all models\)/g,'Недельный (все модели)'],
    [/Weekly \(Opus\)/g,'Недельный (Opus)'],
    [/Weekly \(model-scoped\)/g,'Недельный (для выбранной модели)'],
    [/Weekly limit/g,'Недельный лимит'],
    [/Monthly limit/g,'Месячный лимит'],
    [/\bWeekly\b/g,'Недельный'],
    [/\bMonthly\b/g,'Месячный'],
    [/ · via /g,' · через '],
    [/needs your input/g,'требуется ваш ответ'],
    [/^Working in /,'Работает в '],
    [/via Antigravity CLI/g,'через CLI Antigravity'],
    [/via Antigravity/g,'через Antigravity'],
    [/via Google/g,'через Google'],
    [/No Claude Code credential found/g,'Учётные данные Claude Code не найдены'],
    [/Credential expired. run claude once in a terminal to renew it/g,'Учётные данные истекли. запустите claude в терминале один раз, чтобы обновить их'],
    [/Credential rejected \(switched accounts\?\)/g,'Учётные данные отклонены (вы сменили аккаунт?)'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'Срок входа в Codex истёк. откройте Codex для обновления'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'Codex отклонил вход. войдите в Codex снова'],
    [/Codex reported no usage windows/g,'Codex не сообщил окна использования'],
    [/Codex has not recorded a usage snapshot yet/g,'Codex ещё не записал снимок использования'],
    [/from last Codex run/g,'из последнего запуска Codex'],
    [/Waiting for Antigravity CLI quota/g,'Ожидание квоты Antigravity CLI'],
    [/Open Antigravity to read its quota/g,'Откройте Antigravity, чтобы получить квоту'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'Сеанс Google в Antigravity отклонён. войдите в Antigravity снова'],
    [/Antigravity is closed. last reading kept/g,'Antigravity закрыт. сохранено последнее показание'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'Войдите в Cursor (редактор), чтобы увидеть использование.'],
    [/Cursor session was rejected. sign in again in the editor/g,'Сеанс Cursor отклонён. снова войдите в редакторе'],
  ],
  zh:[
    [/^(\d+)m limit$/,'$1 分钟限额'],
    [/^(\d+)h limit$/,'$1 小时限额'],
    [/^(\d+)d limit$/,'$1 天限额'],
    [/^Rate limited, retrying in (\d+)s$/,'已限流，$1 秒后重试'],
    [/^Rate limited. retrying in (\d+)s$/,'已限流. $1 秒后重试'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'$1 套餐不限量. 没有可计量的项目'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'$1 套餐暂时没有可供 Cursor 计量的用量'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google 未公布该账号的配额'],
    [/^Live read failed \((.+)\)$/,'实时读取失败（$1）'],
    [/Weekly \(all models\)/g,'每周（全部模型）'],
    [/Weekly \(Opus\)/g,'每周（Opus）'],
    [/Weekly \(model-scoped\)/g,'每周（指定模型）'],
    [/Weekly limit/g,'每周限额'],
    [/Monthly limit/g,'每月限额'],
    [/\bWeekly\b/g,'每周'],
    [/\bMonthly\b/g,'每月'],
    [/ · via /g,' · 来自 '],
    [/needs your input/g,'等待你的输入'],
    [/^Working in /,'工作于 '],
    [/via Antigravity CLI/g,'来自 Antigravity CLI'],
    [/via Antigravity/g,'来自 Antigravity'],
    [/via Google/g,'来自 Google'],
    [/No Claude Code credential found/g,'未找到 Claude Code 凭证'],
    [/Credential expired. run claude once in a terminal to renew it/g,'凭证已过期. 在终端里运行一次 claude 即可续期'],
    [/Credential rejected \(switched accounts\?\)/g,'凭证被拒绝（换过账号？）'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'Codex 登录已过期. 打开一次 Codex 即可刷新'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'Codex 拒绝了它的登录. 请重新登录 Codex'],
    [/Codex reported no usage windows/g,'Codex 没有报告任何用量周期'],
    [/Codex has not recorded a usage snapshot yet/g,'Codex 还没有记录过用量快照'],
    [/from last Codex run/g,'来自上次 Codex 运行'],
    [/Waiting for Antigravity CLI quota/g,'正在等待 Antigravity CLI 的配额'],
    [/Open Antigravity to read its quota/g,'打开 Antigravity 以读取配额'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'Antigravity 的 Google 会话被拒绝. 请在 Antigravity 中重新登录'],
    [/Antigravity is closed. last reading kept/g,'Antigravity 已关闭. 保留上一次读数'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'请登录 Cursor（编辑器）以查看用量。'],
    [/Cursor session was rejected. sign in again in the editor/g,'Cursor 会话被拒绝. 请在编辑器中重新登录'],
  ],
  'zh-Hant':[
    [/^(\d+)m limit$/,'$1 分鐘限額'],
    [/^(\d+)h limit$/,'$1 小時限額'],
    [/^(\d+)d limit$/,'$1 天限額'],
    [/^Rate limited, retrying in (\d+)s$/,'已限流，$1 秒後重試'],
    [/^Rate limited. retrying in (\d+)s$/,'已限流. $1 秒後重試'],
    [/^Unlimited on the (.+) plan. nothing to meter$/,'$1 方案不限量. 沒有可計量的項目'],
    [/^The (.+) plan has nothing for Cursor to meter yet$/,'$1 方案暫時沒有可供 Cursor 計量的用量'],
    [/^(.+) · Google publishes no quota for this account$/,'$1 · Google 未公布該帳號的配額'],
    [/^Live read failed \((.+)\)$/,'即時讀取失敗（$1）'],
    [/Weekly \(all models\)/g,'每週（全部模型）'],
    [/Weekly \(Opus\)/g,'每週（Opus）'],
    [/Weekly \(model-scoped\)/g,'每週（指定模型）'],
    [/Weekly limit/g,'每週限額'],
    [/Monthly limit/g,'每月限額'],
    [/\bWeekly\b/g,'每週'],
    [/\bMonthly\b/g,'每月'],
    [/ · via /g,' · 來自 '],
    [/needs your input/g,'等待你的輸入'],
    [/^Working in /,'工作於 '],
    [/via Antigravity CLI/g,'來自 Antigravity CLI'],
    [/via Antigravity/g,'來自 Antigravity'],
    [/via Google/g,'來自 Google'],
    [/No Claude Code credential found/g,'未找到 Claude Code 憑證'],
    [/Credential expired. run claude once in a terminal to renew it/g,'憑證已過期. 在終端機裡執行一次 claude 即可續期'],
    [/Credential rejected \(switched accounts\?\)/g,'憑證被拒絕（換過帳號？）'],
    [/Codex sign-in expired. open Codex once to refresh it/g,'Codex 登入已過期. 開啟一次 Codex 即可重新整理'],
    [/Codex rejected its sign-in. sign in to Codex again/g,'Codex 拒絕了它的登入. 請重新登入 Codex'],
    [/Codex reported no usage windows/g,'Codex 沒有報告任何用量週期'],
    [/Codex has not recorded a usage snapshot yet/g,'Codex 還沒有記錄過用量快照'],
    [/from last Codex run/g,'來自上次 Codex 執行'],
    [/Waiting for Antigravity CLI quota/g,'正在等待 Antigravity CLI 的配額'],
    [/Open Antigravity to read its quota/g,'開啟 Antigravity 以讀取配額'],
    [/Antigravity's Google session was rejected. sign in again in Antigravity/g,'Antigravity 的 Google 工作階段被拒絕. 請在 Antigravity 中重新登入'],
    [/Antigravity is closed. last reading kept/g,'Antigravity 已關閉. 保留上一次讀數'],
    [/Sign in to Cursor \(the editor\) to see usage\./g,'請登入 Cursor（編輯器）以查看用量。'],
    [/Cursor session was rejected. sign in again in the editor/g,'Cursor 工作階段被拒絕. 請在編輯器中重新登入'],
  ],
};
// Grammar differs enough that a format string would not carry it. Russian puts the verb last,
// Chinese puts it after the time. so each language writes its own short functions.
const UI={
  ko:{locale:'ko-KR',title:n=>n+' 사용량',resetting:'재설정 중…',resetsIn:m=>`${m}분 후 재설정`,
      resetsAt:t=>`${t}에 재설정`,resetsOn:(d,t)=>`${d} ${t}에 재설정`,resetsDate:d=>`${d}에 재설정`,
      ago:m=>m<60?`${m}분 전`:`${Math.round(m/60)}시간 전`,
      usedLeft:(used,left)=>`${used}% 사용 · ${left}% 남음`,andMore:n=>`외 ${n}개`,updated:a=>`${a}에 마지막 업데이트됨`},
  'pt-BR':{locale:'pt-BR',title:n=>'Uso do '+n,resetting:'Renovando…',resetsIn:m=>`Renova em ${m} min`,
      resetsAt:t=>`Renova às ${t}`,resetsOn:(d,t)=>`Renova ${d} às ${t}`,resetsDate:d=>`Renova ${d}`,
      ago:m=>m<60?`há ${m} min`:`há ${Math.round(m/60)} h`,
      usedLeft:(used,left)=>`${used}% usado · ${left}% restante`,andMore:n=>`e mais ${n}`},
  en:{locale:'en-US',title:n=>n+' Usage',resetting:'Resetting…',resetsIn:m=>`Resets in ${m} min`,
      resetsAt:t=>`Resets at ${t}`,resetsOn:(d,t)=>`Resets ${d} ${t}`,resetsDate:d=>`Resets ${d}`,
      ago:m=>m<60?`${m}m ago`:`${Math.round(m/60)}h ago`,
      usedLeft:(used,left)=>`${used}% Used · ${left}% left`,andMore:n=>`and ${n} more`,updated:a=>`Updated ${a}`},
  uk:{locale:'uk-UA',title:n=>'Використання '+n,resetting:'Скидання…',resetsIn:m=>`Скидання через ${m} хв`,
      resetsAt:t=>`Скидання о ${t}`,resetsOn:(d,t)=>`Скидання: ${d} ${t}`,resetsDate:d=>`Скидання: ${d}`,
      ago:m=>m<60?`${m} хв тому`:`${Math.round(m/60)} год тому`,
      usedLeft:(used,left)=>`Використано ${used}% · лишилось ${left}%`,andMore:n=>`і ще ${n}`,updated:a=>`Оновлено ${a}`},
  ru:{locale:'ru-RU',title:n=>'Использование '+n,resetting:'Сброс…',resetsIn:m=>`Сброс через ${m} мин`,
      resetsAt:t=>`Сброс в ${t}`,resetsOn:(d,t)=>`Сброс: ${d} ${t}`,resetsDate:d=>`Сброс: ${d}`,
      ago:m=>m<60?`${m} мин назад`:`${Math.round(m/60)} ч назад`,
      usedLeft:(used,left)=>`Использовано ${used}% · осталось ${left}%`,andMore:n=>`и ещё ${n}`,updated:a=>`Обновлено ${a}`},
  zh:{locale:'zh-CN',title:n=>n+' 用量',resetting:'正在重置…',resetsIn:m=>`${m} 分钟后重置`,
      resetsAt:t=>`${t} 重置`,resetsOn:(d,t)=>`${d} ${t} 重置`,resetsDate:d=>`${d} 重置`,
      ago:m=>m<60?`${m} 分钟前`:`${Math.round(m/60)} 小时前`,
      usedLeft:(used,left)=>`已用 ${used}% · 剩余 ${left}%`,andMore:n=>`另有 ${n} 个`,updated:a=>`更新于 ${a}`},
  'zh-Hant':{locale:'zh-TW',title:n=>n+' 用量',resetting:'正在重置…',resetsIn:m=>`${m} 分鐘後重置`,
      resetsAt:t=>`${t} 重置`,resetsOn:(d,t)=>`${d} ${t} 重置`,resetsDate:d=>`${d} 重置`,
      ago:m=>m<60?`${m} 分鐘前`:`${Math.round(m/60)} 小時前`,
      usedLeft:(used,left)=>`已用 ${used}% · 剩餘 ${left}%`,andMore:n=>`另有 ${n} 個`,updated:a=>`更新於 ${a}`},
};
function ui(){return UI[uiLang]||UI.en;}
function textCopy(value){
  if(!value) return '';
  const table=TEXT[uiLang];
  if(!table) return value;
  if(table[value]) return table[value];
  let out=String(value);
  for(const [re,to] of PATTERNS[uiLang]||[]) out=out.replace(re,to);
  return out;
}
function setUiLanguage(lang){
  const next=TEXT[lang]?lang:'en';
  if(uiLang===next) return;
  uiLang=next;
  renderRing();
  if(card&&card.classList.contains('show')) renderCard();
}
// "Is it working?" per account, from the collector's session feed. Returns running | attention | idle
function workState(p){
  const acts=activity.filter(a=>a.account===p.id);
  if(acts.some(a=>a.state==='waiting')) return 'attention';
  if(acts.some(a=>a.state==='busy')) return 'running';
  return 'idle';
}
function glyphHtml(p,small){
  const g=glyphs[p.base||p.id];
  if(g&&g.kind==='svg'&&g.svg) return `<span class="mark">${g.svg}</span>`;
  if(g&&g.url) return `<img class="${g.kind}" src="${g.url}" alt="${p.name}"${small?' style="width:16px;height:16px;border-radius:4px"':''}>`;
  return small?'':p.glyph; // fallback letter
}
// Provider table (order = top to bottom in the pill). `glyph` is the fallback letter used when no mark is available
// Which providers get a ring: [{provider}]. null or an empty list means every provider.
let notchSlots=null;
function slotFor(id){
  if(!Array.isArray(notchSlots)) return null;
  for(const s of notchSlots){ if(s&&s.provider===id) return s; }
  return null;
}
// One cell per Claude account. Each account's windows arrive carrying its heading in `group` and,
// past the default account, an `@slug` id; the cell gets that account's windows under the ids they
// would have had on their own, so headlineOf and weeklyOf need no rule about accounts. `base` is the
// provider the cell belongs to (glyph, activity, slot choice); `id` is what makes the cell unique.
function claudeCells(){
  const ws=Array.isArray(usage.windows)?usage.windows:[];
  const accounts=[];
  for(const w of ws){
    const g=w.group||'';
    if(!accounts.some(a=>a.g===g)) accounts.push({g:g,slug:(String(w.id).split('@')[1]||'')});
  }
  // One account (or a reading with no headings yet) is the single cell it has always been
  if(accounts.length<2) return [{id:'claude',base:'claude',name:'Claude',glyph:'C',snap:usage}];
  return accounts.map(a=>({
    id:a.slug?'claude@'+a.slug:'claude',
    base:'claude',
    name:a.g||'Claude',
    glyph:'C',
    snap:Object.assign({},usage,{windows:ws.filter(w=>(w.group||'')===a.g)
      .map(w=>Object.assign({},w,{id:String(w.id).split('@')[0]}))})
  }));
}
let agentAccounts=[];
function providers(){
  const list=agentAccounts.length?agentAccounts:[{id:'collector',base:'claude',name:'Agent Usage',glyph:'…',snap:usage}];
  const picked=list.filter(p=>!!slotFor(p.id));
  return picked.length?picked:list;
}
// Antigravity's "Notch reads" and "Model data", as in the Mac app; chosen in settings
let agPrefs={limit:'automatic',model:'gemini'};
// Where the weekly limit's own ring goes, from settings: 'off', 'inside' or 'outside'
let weeklyRing='off';
// The tightest metered window, ties going to the lower id so the choice never flickers
function tightestOf(ws){
  return ws.filter(w=>w.count==null).reduce((a,b)=>!a||b.used>a.used||(b.used===a.used&&b.id<a.id)?b:a,null);
}
function laneFamily(w){ const id=w.id.toLowerCase(); return id.startsWith('gemini')?'gemini':(id.startsWith('3p')||id.startsWith('claude'))?'3p':''; }
function laneIs(w,limit){
  const t=(w.id+' '+w.label).toLowerCase();
  return limit==='weekly'?t.includes('weekly'):['5h','5-hour','five hour','five-hour','hourly','session'].some(k=>t.includes(k));
}
// The window a provider's ring shows: the same rule as ring_window in main.rs, which draws the tray
// BEGIN TESTABLE HEADLINE SELECTOR
function headlineOf(snap,id){
  const ws=snap.windows; if(!ws.length) return null;
  const byId=x=>ws.find(w=>w.id===x)||null;
  if(id==='claude') return byId('session')||ws[0];
  if(id==='codex') return byId('primary')||ws[0];
  if(id==='cursor') return byId('included')||byId('api');
  if(id==='grok') return byId('credits')||ws[0];
  if(id==='glm') return byId('session');
  if(id==='opencode') return byId('rolling');
  const fam=ws.filter(w=>laneFamily(w)===agPrefs.model), lanes=fam.length?fam:ws;
  if(agPrefs.limit!=='automatic'){ const w=tightestOf(lanes.filter(w=>laneIs(w,agPrefs.limit))); if(w) return w; }
  return tightestOf(lanes.filter(w=>w.used<1))||tightestOf(lanes)||lanes[0];
}
// END TESTABLE HEADLINE SELECTOR
// The weekly window each provider reports, or null where there is none: Claude names it seven_day,
// Codex calls its second window secondary, and Antigravity has one per model family. Cursor has none.
// BEGIN TESTABLE WEEKLY SELECTOR
function weeklyOf(snap,id){
  const ws=snap.windows.filter(w=>w.count==null); if(!ws.length) return null;
  const byId=x=>ws.find(w=>w.id===x)||null;
  if(id==='claude') return byId('seven_day')||byId('weekly_all')||byId('weekly');
  if(id==='codex') return byId('secondary');
  if(id==='cursor') return null;
  if(id==='grok') return null; // the credits window is already the weekly one
  if(id==='glm') return byId('weekly');
  if(id==='opencode') return byId('weekly');
  const fam=ws.filter(w=>laneFamily(w)===agPrefs.model), lanes=fam.length?fam:ws;
  return tightestOf(lanes.filter(w=>laneIs(w,'weekly')));
}
// END TESTABLE WEEKLY SELECTOR
// 15 minutes, the Mac's `UsageStore.staleAfter`. At 5 a reading went grey between two polls of a
// provider that is answering perfectly well, which made "stale" mean "recently fetched" rather than
// "old enough not to trust". A provider that knows its own reading is stale still says so in status.
function staleOf(snap){ if(snap.status==='stale') return true; return snap.fetched_at>0 && (Date.now()-snap.fetched_at)>15*60*1000; }
let stateSnap={sessions:[],agg:'idle'};

function svgArc(r,frac,color,width,extra=''){
  // Nothing at all at zero: a zero-length dash still paints a dot once the caps are round, where the
  // Mac's `trim(from: 0, to: 0)` draws nothing. A reading small enough that its two caps meet does
  // draw as a dot, on both platforms. `ProviderRing.sweep` has no floor. Upstream #260 argues that
  // is wrong, for the local model's arc; if it lands, the same floor belongs here.
  if(!(frac>0)) return '';
  const C=2*Math.PI*r;
  return `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
    stroke-dasharray="${(C*frac).toFixed(2)} ${C.toFixed(2)}" stroke-linecap="round"
    transform="rotate(-90 28 28)" ${extra}/>`;
}

// Pin and refresh at the end of the notch; each can be hidden in Settings → Appearance → Controls
let notchButtons={pin:true,refresh:true}, pinnedNow=false;
const PIN_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path class="pin-head" d="M10.2 1.9l3.9 3.9-1.9.7-2.6 2.6.3 2.9-1.1 1.1-5.9-5.9 1.1-1.1 2.9.3 2.6-2.6z"/><path d="M5.3 10.7 2 14"/></svg>';
const REFRESH_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.3 8.4a5.3 5.3 0 1 1-1.6-4.3"/><path d="M12.2 1.6v3h-3"/></svg>';
function controlsHtml(){
  if(!notchButtons.pin&&!notchButtons.refresh) return '';
  return `<div class="ctl">${notchButtons.pin?`<button class="ctl-btn" id="ctl-pin" type="button" aria-label="Pin" aria-pressed="false" title="Pin">${PIN_ICON}</button>`:''}`
    +`${notchButtons.refresh?`<button class="ctl-btn" id="ctl-refresh" type="button" aria-label="Refresh usage" title="Refresh usage">${REFRESH_ICON}</button>`:''}</div>`;
}
function renderRing(){
  const ps=providers();
  // Rebuild the DOM only when the structure changes (never swap the element under the cursor)
  const want=ps.map(p=>p.id+':'+(glyphs[p.base]?glyphs[p.base].kind:'-')).join(',')+`|${notchButtons.pin}${notchButtons.refresh}`;
  if(pill.dataset.cells!==want){
    pill.innerHTML=ps.map((p,i)=>`<div class="cell" data-p="${p.id}" style="--i:${i}">
      <div class="ringwrap"><svg class="ring" viewBox="0 0 56 56"></svg><svg class="reading" viewBox="0 0 56 56"></svg><svg class="activity" viewBox="0 0 56 56"></svg><div class="glyph ${(!glyphs[p.base]&&p.glyph.length>1)?'small':''}">${glyphHtml(p)}</div></div>
      <div class="pct">…</div></div>`).join('')+controlsHtml();
    pill.dataset.cells=want;
  }
  const pinButton=pill.querySelector('#ctl-pin');
  if(pinButton){ pinButton.classList.toggle('on',pinnedNow); pinButton.setAttribute('aria-pressed',String(pinnedNow)); pinButton.title=pinnedNow?'Unpin':'Pin'; }
  for(const p of ps){
    const cell=pill.querySelector(`.cell[data-p="${p.id}"]`); if(!cell) continue;
    const svg=cell.querySelector('svg.ring'), reading=cell.querySelector('svg.reading'), activity=cell.querySelector('svg.activity'), pct=cell.querySelector('.pct'), glyph=cell.querySelector('.glyph'), wrap=cell.querySelector('.ringwrap');
    const h=headlineOf(p.snap,p.base);
    let inner=`<circle cx="28" cy="28" r="22" fill="${HOLE}"/><circle cx="28" cy="28" r="25" fill="none" stroke="${TRACK}" stroke-width="5"/>`;
    wrap.classList.toggle('pressed',!!refreshing[p.id]);
    const used=h&&h.count==null?Math.min(h.used,1):null, prev=reading.dataset.used?Number(reading.dataset.used):null;
    reading.innerHTML=used==null?'':svgArc(25,used,tone(used),5);
    reading.dataset.used=used==null?'':String(used);
    // A new reading while the notch is open: the arc eases from the old value, so what changed is visible
    const arc=reading.querySelector('circle');
    if(arc&&shown&&prev!=null&&Math.abs(used-prev)>=0.005&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const C=2*Math.PI*25, dash=f=>`${(C*f).toFixed(2)} ${C.toFixed(2)}`;
      arc.animate([{strokeDasharray:dash(prev),stroke:tone(prev)},{strokeDasharray:dash(used),stroke:tone(used)}],{duration:700,easing:'cubic-bezier(.32,.72,.24,1)'});
    }
    if(weeklyRing!=='off'){ // the week, thinner and at its own radius, in its own colour: a session at 12% beside a week at 91% is the case this exists for
      const wk=weeklyOf(p.snap,p.base);
      // Inside, it shares the gap with the working indicator, so it stands down while that is showing
      const taken=weeklyRing==='inside'&&workState(p)!=='idle';
      if(wk&&(!h||wk.id!==h.id)&&!taken){
        const r=weeklyRing==='inside'?16:31;
        inner+=`<circle cx="28" cy="28" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.4" opacity="0.7"/>`
          +svgArc(r,Math.min(wk.used,1),tone(wk.used),2.4,'opacity="0.85"');
      }
    }
    svg.innerHTML=inner;
    { // thin inner arc: spinning white = working, yellow pulse = waiting on you (one animation for all four, different sources)
      // Its own layer, so a stale reading can dim around it without dimming it: see `.ringwrap.stale`
      const ws=workState(p);
      if(ws==='running') activity.innerHTML=`<g class="arc-spin">${svgArc(19,0.28,INK,2.5)}</g>`;
      else if(ws==='attention') activity.innerHTML=`<g class="arc-pulse"><circle cx="28" cy="28" r="19" fill="none" stroke="${WATCH}" stroke-width="2.5"/></g>`;
      else activity.innerHTML='';
    }
    if(p.snap.status==='needsAuth'||p.snap.status==='none') pct.textContent='N/A';
    else if(h && h.count!=null) pct.textContent='~'+h.count;
    else if(h) pct.textContent=(h.derived?'~':'')+pctText(h.used)+'%';
    else pct.textContent=p.snap.windows.length?'N/A':'…'; // its declared window is missing: a dash, not a wait
    glyph.classList.toggle('dim', !!(h && h.used>=1));
    wrap.classList.toggle('stale', staleOf(p.snap));
  }
  reportHot(); // a provider appearing or leaving resizes the pill
}

function resetCopy(ms){
  if(!ms) return '';
  const diff=ms-Date.now();
  if(diff<=0) return ui().resetting;
  const min=Math.round(diff/60000); // rounded before the test, so 59m40s never reads "Resets in 60 min"
  if(min<60) return ui().resetsIn(Math.max(1,min));
  const d=new Date(ms), locale=ui().locale;
  // A weekday only names a day in the coming week: a Codex monthly reset 26 days out read as this Monday
  if(daysApart(Date.now(),ms)>=7) return ui().resetsDate(d.toLocaleDateString(locale,{month:'short',day:'numeric'}));
  const t=d.toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit',hourCycle:stateSnap.clock_24h?'h23':'h12'});
  if(diff<24*60*60*1000) return ui().resetsAt(t);
  return ui().resetsOn(d.toLocaleDateString(locale,{weekday:'short'}),t);
}
// Calendar days rather than 24-hour blocks, so a clock change cannot move the answer
function daysApart(from,to){
  const day=ms=>{const d=new Date(ms); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();};
  return Math.round((day(to)-day(from))/86400000);
}

function ago(ms){
  const m=Math.round((Date.now()-ms)/60000);
  return ui().ago(m);
}

// The card is clipped, not scrolled, so rows past this would push its title off the top; the rest are counted, as on the Mac
const SESSION_ROWS=5;
function moreRow(n){ return n>0?`<div class="s-more">${ui().andMore(n)}</div>`:''; }

let hoverId='claude';
let claudeAuth={busy:false,message:''};
let claudeActionMessage='';
// Authentication stays on the collector machine.
function renderCard(){
  const c=document.getElementById('card');
  const p=providers().find(x=>x.id===hoverId)||providers()[0];
  const snap=p.snap;
  const headIcon=glyphHtml(p,true);
  // p.name is no longer a constant: for a second account it is built from the home
  // directory's slug and the subscriptionType read out of .credentials.json.
  let html=`<div class="c-head">${headIcon}<span class="c-title">${esc(ui().title(p.name))}</span></div>`;
  if(staleOf(snap)&&snap.fetched_at) html+=`<div class="c-sub">${ui().updated(ago(snap.fetched_at))}</div>`;
  if(snap.status==='needsAuth'){
    const who={claude:'Sign in to Claude Code to see usage.',cursor:'Sign in to Cursor to see usage.',codex:'Sign in to Codex to see usage.',grok:'Run grok login to see usage.',opencode:'Run opencode auth login to see usage.',gemini:'Sign in to Antigravity to see usage.'}[p.base]||'';
    html+=`<div class="c-note">${textCopy(who)}<br>${esc(textCopy(snap.note||''))}</div>`;
  }else if(!snap.windows.length){
    html+=`<div class="c-note">${esc(textCopy(snap.note||'Waiting for first reading…'))}</div>`;
  }else{
    // Windows that share a group (Antigravity's model families) sit in one box under its name, as on the Mac
    let group=null;
    for(const w of snap.windows){
      if((w.group||null)!==group){
        if(group) html+=`</div>`;
        group=w.group||null;
        if(group) html+=`<div class="g-head">${esc(textCopy(group))}</div><div class="g-box">`;
      }
      if(w.count!=null){
        html+=`<div class="win"><div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span></div>
          <div class="w-used">${w.count>0?`~${w.count} ${textCopy(w.count===1?'request today':'requests today')}`:textCopy('no requests today')}</div></div>`;
        continue;
      }
      html+=`<div class="win">
        <div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span><span class="w-reset">${resetCopy(w.resets_at)}</span></div>
        <div class="w-track"><div class="w-fill" style="width:${(Math.min(w.used,1)*100).toFixed(0)}%;background:${tone(w.used)}"></div></div>
        <div class="w-used">${esc(usedCopy(w))}</div>
      </div>`;
    }
    if(group) html+=`</div>`;
    if(snap.note) html+=`<div class="c-note">${esc(textCopy(snap.note))}</div>`;
  }
  if(snap.details?.length) html+=`<section class="account-extra">
    <button class="extra-toggle" type="button" aria-expanded="false">Account details <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5"/></svg></button>
    <div class="extra-fold"><div class="extra-content">${snap.details.map(detail=>`<div class="extra-row">${esc(detail)}</div>`).join('')}</div></div>
  </section>`;
  { // this account's live sessions: waiting before busy, newest first within each, so what gets cut is what matters least
    const acts=activity.filter(a=>a.account===p.id).sort((a,b)=>(b.state==='waiting')-(a.state==='waiting')||b.since-a.since);
    if(acts.length){
      html+=`<div class="c-sessions">`;
      for(const a of acts.slice(0,SESSION_ROWS)){
        const col=a.state==='waiting'?WATCH:INK;
        html+=`<div class="s-row"><span class="s-dot" style="background:${col}"></span>${esc(a.name)}<span style="color:#808080;margin-left:auto">${esc(textCopy(a.detail))}</span></div>`;
      }
      html+=moreRow(acts.length-SESSION_ROWS)+`</div>`;
    }
  }
  const wasOpen=c.querySelector('.account-extra')?.classList.contains('expanded') && c.dataset.account===p.id;
  const scroll=c.scrollTop;
  c.innerHTML=html;c.dataset.account=p.id;
  const extra=c.querySelector('.account-extra');
  if(extra){
    const button=extra.querySelector('button');let closeTimer;
    const expand=on=>{extra.classList.toggle('expanded',on);button.setAttribute('aria-expanded',String(on));};
    extra.addEventListener('mouseenter',()=>{clearTimeout(closeTimer);expand(true);});
    extra.addEventListener('mouseleave',()=>{closeTimer=setTimeout(()=>expand(false),220);});
    extra.addEventListener('focusin',()=>expand(true));
    button.addEventListener('click',()=>expand(!extra.classList.contains('expanded')));
    if(wasOpen) expand(true);
  }
  c.scrollTop=scroll;
  placeCard();
}
// The card follows the hovered cell: centred on it along the pill (kept inside the window), tail pointing at it.
// On the upright edges that means matching its vertical centre; on the flat ones, its horizontal centre,
// and the card is pushed clear of a pill whose thickness follows the cells it holds.
function placeCard(){
  // Measured on screen, written inside #root, which is offset while it slides
  const o=document.getElementById('root').getBoundingClientRect();
  const r=pill.getBoundingClientRect(), cell=pill.querySelector(`.cell[data-p="${hoverId}"]`)||pill;
  const cr=cell.getBoundingClientRect(), w=card.offsetWidth, h=card.offsetHeight;
  let x=cr.left+cr.width/2-w/2, y=cr.top+cr.height/2-h/2;
  if(notchEdge==='left') x=r.right+28;
  if(notchEdge==='right') x=r.left-w-28;
  if(notchEdge==='top') y=r.bottom+28;
  if(notchEdge==='bottom') y=r.top-h-28;
  x=Math.round(Math.max(8,Math.min(innerWidth-w-8,x)));y=Math.round(Math.max(8,Math.min(innerHeight-h-8,y)));
  card.style.cssText+=`;transform:none;right:auto;bottom:auto;left:${x-o.left}px;top:${y-o.top}px`;
  // The point sits on the ring, not the cell, which includes the label below it; clamped to the card's straight edge
  const rr=(cell.querySelector('.ringwrap')||cell).getBoundingClientRect();
  if(edgeIsVertical()){
    const th=tail.offsetHeight||36, ty=Math.max(y+16+th/2,Math.min(y+h-16-th/2,rr.top+rr.height/2));
    tail.style.left=(notchEdge==='left'?r.right-1:r.left-31)-o.left+'px';tail.style.top=Math.round(ty-th/2)-o.top+'px';
  }else{
    const tw=tail.offsetWidth||36, tx=Math.max(x+16+tw/2,Math.min(x+w-16-tw/2,rr.left+rr.width/2));
    tail.style.left=Math.round(tx-tw/2)-o.left+'px';tail.style.top=(notchEdge==='top'?r.bottom-1:r.top-31)-o.top+'px';
  }
}

function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}

/* Hover: stays expanded while either the pill or the card is under the cursor; collapses after a 250 ms grace period (upstream motion rule) */
const card=document.getElementById('card'), pill=document.getElementById('pill'), tail=document.getElementById('tail');
let hideTimer=null;
function showCard(){clearTimeout(hideTimer);card.classList.add('show');renderCard();armWatchdog();refreshClock();} // show first, then render: placeCard needs offsetHeight
// Nothing is broadcast when the Windows clock format changes, so ask again each time the card opens
function refreshClock(){
  invoke('get_state').then(s=>{
    if(!s||s.clock_24h===stateSnap.clock_24h) return;
    stateSnap.clock_24h=s.clock_24h;
    if(card.classList.contains('show')) renderCard();
  }).catch(()=>{});
}
function hideCard(){if(!card.classList.contains('show'))return;card.classList.remove('show');reportHot();}
function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hideCard,250);}
// ===== Diagnostics + geometry =====
function jslog(m){invoke('log_js',{msg:String(m)}).catch(()=>{});}
function callq(cmd,args){ // invoke with visible failure: any command error is reported on screen (a silent .catch used to swallow them)
  return invoke(cmd,args).catch(e=>{notice(cmd+' failed: '+(e&&e.message||e));throw e;});
}
// Hot rectangles are reported in physical pixels (multiplied by this page's real DPR), so the Rust side does no conversion. WebView2's DPR and the window scale can disagree
function rectOf(el){const r=el.getBoundingClientRect(),k=1;return [r.left*k,r.top*k,r.width*k,r.height*k];}
/* Rust gates click-through on these, so they are reported whenever the pill or card moves, not only
   when the card opens: a stale pill rectangle is a pill that cannot be clicked. */
let hotFrame=0,lastHot='';
function reportHot(){
  if(!hotFrame) hotFrame=requestAnimationFrame(flushHot);
}
function flushHot(){
  hotFrame=0;
  const open=card.classList.contains('show');
  const rects=open?[rectOf(pill),rectOf(tail),rectOf(card)]:[rectOf(pill)];
  const controls={};
  if(placeHandles()){
    controls.settings=rectOf(orb);rects.push(controls.settings);
    if(showMove){controls.move=rectOf(moveHandle);rects.push(controls.move);}
  }
  for(const [name,id] of [['pin','ctl-pin'],['refresh','ctl-refresh']]){ const b=document.getElementById(id); if(b) controls[name]=rectOf(b); }
  const data={rects,controls,expanded:open};const signature=JSON.stringify(data);
  if(signature!==lastHot){lastHot=signature;callq('set_hot',data).catch(()=>{lastHot='';});}
}
// Expansion and scrolling alter the clickable card bounds without a cursor move.
new ResizeObserver(()=>{if(card.classList.contains('show'))placeCard();reportHot();}).observe(card);
/* What wakes the folded notch: the resting pill, as long along the edge as the pill and deepened into
   the screen by the Mac's pillHotZone. Design.px(90), 34 here. because the pill is small and the
   place that opens it should not be (NotchViewModel.wakeLength and wakeDepth). */
const WAKE_BAND=34;
function wakeRect(){
  const r=document.getElementById('rest').getBoundingClientRect(), k=1;
  const b=WAKE_BAND*(parseFloat(document.documentElement.style.zoom)||1); // rects come back zoomed
  let x=r.left,y=r.top,w=r.width,h=r.height;
  if(notchEdge==='left') w+=b; else if(notchEdge==='top') h+=b; else if(notchEdge==='bottom'){ y-=b; h+=b; } else { x-=b; w+=b; }
  return [x*k,y*k,w*k,h*k];
}
/* The strip of screen Rust reads to choose the resting pill's colour: beside the pill, on the side away
   from the edge, where nothing is drawn while folded. */
const PROBE_GAP=4, PROBE_DEPTH=12;
function probeRect(){
  const r=document.getElementById('rest').getBoundingClientRect(), k=1;
  const z=parseFloat(document.documentElement.style.zoom)||1, g=PROBE_GAP*z, d=PROBE_DEPTH*z;
  let x=r.left-g-d,y=r.top,w=d,h=r.height;
  if(notchEdge==='left') x=r.right+g;
  else if(notchEdge==='top'){ x=r.left; y=r.bottom+g; w=r.width; h=d; }
  else if(notchEdge==='bottom'){ x=r.left; y=r.top-g-d; w=r.width; h=d; }
  return [x*k,y*k,w*k,h*k];
}
function armWatchdog(){
  requestAnimationFrame(reportHot); // wait one frame so renderCard's new content is laid out before measuring
}
// Viewport fit (pure front-end fallback, independent of Rust): Rust sizes and zooms the window so this
// page is as wide as the design, so if the CSS viewport is not that wide the WebView's DPR disagrees
// with the monitor; CSS zoom pulls the layout back to the design size.
// The design width is the window's, and the window is not the same shape on every edge. see
// `notch_window_size` in main.rs: NOTCH_W upright, NOTCH_LONG lying flat. Dividing by 360 on a
// flat edge read the wider window as a DPR error and zoomed the whole notch by 520/360. Either number
// left behind when the window changes width does the same thing, so a test in main.rs pins both.
const DESIGN_W_UPRIGHT=360, DESIGN_W_FLAT=650;
function designWidth(){ return edgeIsVertical()?DESIGN_W_UPRIGHT:DESIGN_W_FLAT; }
function fitZoom(){ return 1; }
// `settled` only from the end of a burst of resizes, which is what a landing waits for (land_on_another_screen)
function reportDpr(settled){
  const z=fitZoom();
  jslog(`dpr=${window.devicePixelRatio} inner=${innerWidth}x${innerHeight} cssZoom=${z.toFixed(3)}`);
  callq('report_dpr',{dpr:window.devicePixelRatio||1,w:innerWidth,h:innerHeight,settled:settled===true}).catch(()=>{});
}
// Not measured yet: the width to measure against depends on the edge, and only Rust knows it. The
// ask is at the bottom of this file and answers in a round trip; measuring first would zoom a flat
// window by 520/360 for that moment.
window.addEventListener('resize',()=>{clearTimeout(window._dprT);window._dprT=setTimeout(()=>{reportDpr(true);reportHot();},120);});
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change',()=>reportDpr());
// A landing on a screen at another scale: empty the page, which leaves the transparent window
// invisible while it is resized and re-zoomed, and say so once that has painted. hiding the window
// itself would pause the page, and the re-zoom would then happen in plain view
listen('notch_landing',()=>{
  document.documentElement.style.visibility='hidden';
  requestAnimationFrame(()=>requestAnimationFrame(()=>invoke('notch_hidden').catch(()=>{})));
}).catch(()=>{});
listen('notch_reveal',()=>{ document.documentElement.style.visibility=''; }).catch(()=>{});

/* Collapse test: no trust in element-level mouseenter/mouseleave/e.target at all : 
   pure geometry: is the cursor (clientX/Y) inside pill rect ∪ card rect ∪ their bounding box?
   Leaving the window: document mouseout (relatedTarget=null) plus the Rust watchdog (system cursor) as a second line. */
function inRect(x,y,r,pad){return x>=r.left-pad&&y>=r.top-pad&&x<r.right+pad&&y<r.bottom+pad;}
function cellAt(x,y){
  for(const el of pill.querySelectorAll('.cell')){ if(inRect(x,y,el.getBoundingClientRect(),6)) return el.dataset.p; }
  return null;
}
function pointerInHot(x,y){
  const p=pill.getBoundingClientRect();
  if(inRect(x,y,p,4))return true;
  if(!card.classList.contains('show'))return false;
  const c=card.getBoundingClientRect();
  if(inRect(x,y,c,4))return true;
  const u={left:Math.min(p.left,c.left),top:Math.min(p.top,c.top),right:Math.max(p.right,c.right),bottom:Math.max(p.bottom,c.bottom)};
  return inRect(x,y,u,0);
}
let hideLogged=0;
document.addEventListener('mousemove',e=>{
  // Folded, the page is sent events only over the pill, so any movement at all is the pointer reaching it
  if(!shown) return; // stowed or on its way out; only the shortcut brings it back
  if(window.agentTracking)return;
  if(dragging)return; // no card while dragging
  if(carrying) return; // the notch is in hand; the card would only be in the way
  setHovered(onHandle(e.clientX,e.clientY));
  // Over a handle or the pin/refresh row, the card gives way
  if(hovered||e.target.closest?.('.ctl')){ if(card.classList.contains('show')){ clearTimeout(hideTimer); hideCard(); } return; }
  const hot=pointerInHot(e.clientX,e.clientY);
  if(hot){
    clearTimeout(hideTimer);
    const id=cellAt(e.clientX,e.clientY);
    if(id&&id!==hoverId){ hoverId=id; if(card.classList.contains('show')){ renderCard(); armWatchdog(); } }
    if(!card.classList.contains('show')) showCard();
  }
  else if(card.classList.contains('show')){ if(hideLogged++<5) jslog(`mousemove left the hot area -> collapse at ${e.clientX},${e.clientY}`); scheduleHide(); }
});
document.addEventListener('mouseout',e=>{ // relatedTarget null = the cursor left the page
  if(!e.relatedTarget && card.classList.contains('show')){ if(hideLogged++<5) jslog('mouseout left the page -> collapse'); scheduleHide(); }
});
listen('pointer_left',()=>{clearTimeout(hideTimer);hideCard();}).catch(()=>{});
// Card content changes change its height -> report the hot rectangles again
listen('usage',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
listen('state',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
/* The pill can be dragged up and down the right edge. Press and move more than 4 px = drag (handed to Rust,
   which follows the system cursor; the card is collapsed first); release without moving = click (refetches that ring). */
let press=null, dragging=false;
/* As on the Mac, a clicked ring presses in until its reading lands, and the reading turns once.
   Each provider's reading listener below calls settle() for its ring; PRESS_MAX is only the fallback.
   Rust answers false when no reading is coming (Claude inside its rate-limit wait). */
const PRESS_MIN=380, PRESS_MAX=6000;
const refreshing={};
function refreshRing(id){
  if(refreshing[id]) return;
  refreshing[id]={at:Date.now(),timer:setTimeout(()=>settle(id),PRESS_MAX)};
  renderRing();
  turnReading(id);
  // The cell id addresses the DOM, the provider id addresses Rust: a second Claude
  // account's cell is `claude@work`, which no command answers to.
  const provider=(providers().find(p=>p.id===id)||{}).base||id;
  invoke('refresh_ring',{provider}).then(coming=>{if(!coming)settle(id);}).catch(()=>settle(id));
}
// The reading has a layer of its own that renders never replace, turned as a whole element so the
// compositor can run it; it finishes its turn whenever the press lets go
function turnReading(id,reveal=false){
  const el=pill.querySelector(`.cell[data-p="${id}"] svg.reading`);
  if(!el||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(el.getAnimations().some(a=>a.playState==='running')) return;
  el.style.transformOrigin='50% 50%';
  el.animate(reveal?[{transform:'rotate(-100deg)',opacity:0},{transform:'rotate(0deg)',opacity:1}]:[{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:reveal?650:950,easing:'cubic-bezier(.22,1,.36,1)'});
}
function settle(id){
  const r=refreshing[id]; if(!r) return;
  clearTimeout(r.timer);
  const wait=r.at+PRESS_MIN-Date.now();
  if(wait>0){ r.timer=setTimeout(()=>settle(id),wait); return; }
  delete refreshing[id];
  renderRing();
}
// Alt+drag, the Mac's ⌥-drag. Without Alt a press on the pill is only ever a click. a ring
// refreshes (#244). so one that slips can no longer carry the notch off (#251).
pill.addEventListener('mousedown',e=>{ if(e.button!==0||folded||e.target.closest('.ctl'))return; press={x:e.clientX,y:e.clientY,id:cellAt(e.clientX,e.clientY)||hoverId,alt:e.altKey}; });
document.addEventListener('mousemove',e=>{
  if(!press||dragging||!press.alt)return;
  if(Math.abs(e.clientY-press.y)>4||Math.abs(e.clientX-press.x)>4){
    dragging=true; clearTimeout(hideTimer); hideCard();
    invoke('drag_begin').catch(err=>{notice('drag_begin failed: '+err);dragging=false;});
  }
});
document.addEventListener('mouseup',e=>{
  if(e.button!==0)return;
  if(press&&!dragging&&press.id) refreshRing(press.id);
  press=null;
});
// The Mac's right-click menu, naming the ring or card under the pointer; WebView2's own menu never shows
document.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(dragging||!pointerInHot(e.clientX,e.clientY)) return;
  // The command returns once the menu has closed, which is when folding may be thought about again
  menuOpen=true;
  invoke('show_notch_menu',{provider:cellAt(e.clientX,e.clientY)||hoverId}).catch(err=>notice('show_notch_menu failed: '+err))
    .finally(()=>{ menuOpen=false; scheduleFold(); });
});
listen('drag_end',()=>{dragging=false;press=null;reportHot();scheduleFold();}).catch(()=>{});

function notice(msg){
  const n=document.getElementById('notice');
  n.textContent=msg;n.classList.add('show');
  clearTimeout(n._h);n._h=setTimeout(()=>n.classList.remove('show'),6000);
}

/* ---- The handles ----------------------------------------------------------
   Settings past the far end of the pill, move past the near one. Placed whenever the hot rectangles
   are reported, since those follow every change to the pill. Hover is a circle round each fillet's
   centre, as on the Mac, not the whole box; the card gives way while either is under the pointer.
   A click on the settings orb opens Settings; holding the move handle carries the notch. */
const orb=document.getElementById('orb'), moveHandle=document.getElementById('move');
const HANDLE_REACH=28.5; // the Mac's hot zone, half of 57; square, so it matches the rect main.cjs tests
let orbAt=null,moveAt=null,hovered=null,orbSpins=0,moveSpins=0,showMove=true,carrying=false;
// x and y are on screen; the handles live in #root, which is offset while it slides
function put(el,x,y){
  const o=document.getElementById('root').getBoundingClientRect();
  el.style.left=Math.round(x-o.left-HANDLE_REACH)+'px';el.style.top=Math.round(y-o.top-HANDLE_REACH)+'px';
  el.classList.add('placed');return {x,y,reach:HANDLE_REACH};
}
function placeHandles(){
  const r=pill.getBoundingClientRect();if(!r.width)return false;
  const R=parseFloat(getComputedStyle(pill).getPropertyValue('--fillet'))||38.7;
  // Each fillet's centre: the corner of its square diagonally opposite the one on the screen edge
  const far=notchEdge==='left'?[r.left+R,r.bottom+R]:notchEdge==='top'?[r.right+R,r.top+R]
    :notchEdge==='bottom'?[r.right+R,r.bottom-R]:[r.right-R,r.bottom+R];
  const close=notchEdge==='left'?[r.left+R,r.top-R]:notchEdge==='top'?[r.left-R,r.top+R]
    :notchEdge==='bottom'?[r.left-R,r.bottom-R]:[r.right-R,r.top-R];
  orbAt=put(orb,far[0],far[1]);
  moveAt=showMove?put(moveHandle,close[0],close[1]):null;
  if(!showMove)moveHandle.classList.remove('placed','hover');return true;
}
function near(at,x,y){return !!at&&Math.abs(x-at.x)<=at.reach&&Math.abs(y-at.y)<=at.reach;}
function onHandle(x,y){return near(orbAt,x,y)?'orb':near(moveAt,x,y)?'move':null;}
function setHovered(which){
  const was=hovered;hovered=which;orb.classList.toggle('hover',which==='orb');moveHandle.classList.toggle('hover',which==='move'||carrying);
  if(was!==which&&typeof morphHandles==='function') morphHandles();
}
orb.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();callq('activate_control',{control:'settings'}).catch(()=>{});});
orb.addEventListener('click',e=>{if(e.detail===0)callq('activate_control',{control:'settings'}).catch(()=>{});});
moveHandle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();callq('activate_control',{control:'move'}).catch(()=>{});});
// The Mac's press: down fast, back with a little bounce
function pressIn(el){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{transform:'scale(1)',easing:'ease-out'},{transform:'scale(.84)',offset:.21,easing:'cubic-bezier(.34,1.56,.64,1)'},{transform:'scale(1)'}],{duration:430});
}
// main.cjs confirms an activation from either click path (page or input helper), so both animate once
listen('control_pressed',e=>{
  if(e.payload==='settings'){orb.style.setProperty('--spins',++orbSpins);pressIn(orb);}
  const b=document.getElementById(e.payload==='pin'?'ctl-pin':e.payload==='refresh'?'ctl-refresh':'');
  if(b){ pressIn(b); if(e.payload==='refresh'&&!matchMedia('(prefers-reduced-motion: reduce)').matches) b.querySelector('svg').animate([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:800,easing:'cubic-bezier(.32,.72,.24,1)'}); }
});
pill.addEventListener('pointerdown',e=>{
  const b=e.target.closest('.ctl-btn'); if(!b||e.button!==0) return;
  e.preventDefault();e.stopPropagation();
  callq('activate_control',{control:b.id==='ctl-pin'?'pin':'refresh'}).catch(()=>{});
});
listen('notch_buttons',e=>{ if(e.payload){ notchButtons={pin:e.payload.pin!==false,refresh:e.payload.refresh!==false}; renderRing(); reportHot(); } }).catch(()=>{});
invoke('get_notch_buttons').then(v=>{ if(v){ notchButtons={pin:v.pin!==false,refresh:v.refresh!==false}; renderRing(); reportHot(); } }).catch(()=>{});
// Taking hold of the six dots draws the arms and buttons back into the notch; letting go, they bud out again
listen('move_begin',()=>{carrying=true;window.agentTracking=true;document.getElementById('root').classList.add('carrying');moveArms(0,.2);moveHandle.classList.add('armed','hover');moveHandle.style.setProperty('--spins',++moveSpins);clearTimeout(hideTimer);hideCard();});
listen('move_end',()=>{carrying=false;window.agentTracking=false;document.getElementById('root').classList.remove('carrying');moveHandle.classList.remove('armed');setHovered(null);reportHot();moveArms(1,.45,t=>1-Math.pow(1-t,3));});
document.addEventListener('pointerup',e=>{if(e.button===0&&carrying)callq('end_move').catch(()=>{});});
/* Appearing grows the notch out of the screen edge; disappearing slides it away past the edge
   (agent-usage.css). The Mac's resting-pill fold is not used: with nothing on screen at rest it read as a
   strip growing, and a slide in hides the base until the end, so the notch seemed to float in. */
let shown=false;
function setFolded(f){
  if(f===folded) return;
  folded=f;
  if(f){ clearTimeout(hideTimer); hideCard(); setHovered(null); }
  document.body.classList.toggle('folded',f);
  reportHot();
}
function unfold(){ clearTimeout(foldTimer); }
function scheduleFold(){ clearTimeout(foldTimer); }
function setShown(on,edge){
  if(on===shown) return;
  shown=on;
  const root=document.getElementById('root');
  if(!on){ root.classList.remove('visible'); cancelAnimationFrame(openFrame);openFrame=0;moveArms(0,.18);setHovered(null); return; } // absorb, then slide away
  /* Arriving: wells out of the edge instead of sliding in, so its base and flares sit on the screen edge
     from the first frame. Laid out in place and closed against the edge with transitions held, then opened. */
  document.body.classList.add('no-motion');
  if(edge&&edge!==notchEdge){ applyEdge(edge); renderRing(); }
  root.classList.add('visible','growing');
  openShape(); // closed against the edge before the first frame, then the spring (shape.js)
  void pill.offsetWidth;
  document.body.classList.remove('no-motion');
  root.classList.remove('growing'); // the arms sweep out as it opens
}
// Hit rectangles are measured on screen, so the ones taken mid-slide are re-taken once it lands
document.getElementById('root').addEventListener('transitionend',e=>{ if(e.target.id==='root') reportHot(); });
function applyUiFlags(f){ scheduleFold(); if(f){ pinnedNow=f.notch_on_hover===false&&f.notch_visible!==false; renderRing(); } }
listen('notch_pointer',e=>{ pointerIn=e.payload===true; if(pointerIn) unfold(); else scheduleFold(); }).catch(()=>{});
listen('ui_flags',e=>applyUiFlags(e.payload)).catch(()=>{});
listen('pill_backdrop',e=>{
  if(e.payload==='dark'||e.payload==='light') document.body.dataset.behind=e.payload;
  else delete document.body.dataset.behind;
}).catch(()=>{});
invoke('get_ui_flags').then(applyUiFlags).catch(()=>{});
listen('move_handle',e=>{ showMove=e.payload!==false; reportHot(); }).catch(()=>{});
invoke('get_move_handle').then(v=>{ showMove=v!==false; reportHot(); }).catch(()=>{});

listen('usage',e=>{usage=e.payload||usage;claudeActionMessage='';settle('claude');renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(usage) failed: '+e));
listen('state',e=>{stateSnap=e.payload||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(state) failed: '+e));
listen('notice',e=>notice(e.payload)).catch(()=>{});
listen('codex',e=>{codexSnap=e.payload||codexSnap;settle('codex');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('cursor',e=>{cursorSnap=e.payload||cursorSnap;settle('cursor');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_cursor').then(u=>{cursorSnap=u||cursorSnap;renderRing();}).catch(()=>{});
listen('grok',e=>{grokSnap=e.payload||grokSnap;settle('grok');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_grok').then(u=>{grokSnap=u||grokSnap;renderRing();}).catch(()=>{});

listen('antigravity',e=>{agSnap=e.payload||agSnap;settle('gemini');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_antigravity').then(u=>{agSnap=u||agSnap;renderRing();}).catch(()=>{});
listen('glm',e=>{glmSnap=e.payload||glmSnap;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_glm').then(u=>{glmSnap=u||glmSnap;renderRing();}).catch(()=>{});
listen('opencode',e=>{opencodeSnap=e.payload||opencodeSnap;settle('opencode');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_opencode').then(u=>{opencodeSnap=u||opencodeSnap;renderRing();}).catch(()=>{});
invoke('get_notch_slots').then(v=>{if(Array.isArray(v)){notchSlots=v;renderRing();}}).catch(()=>{});
listen('notch_slots',e=>{
  notchSlots=Array.isArray(e.payload)?e.payload:null;
  renderRing();
  if(card.classList.contains('show')){renderCard();armWatchdog();}
}).catch(()=>{});
invoke('get_antigravity_prefs').then(p=>{if(p){agPrefs=p;renderRing();}}).catch(()=>{});
invoke('get_weekly_ring').then(v=>{if(typeof v==='string'){weeklyRing=v;renderRing();}}).catch(()=>{});
listen('weekly_ring',e=>{if(typeof e.payload==='string'){weeklyRing=e.payload;renderRing();}}).catch(()=>{});
invoke('get_color_transition').then(v=>{if(typeof v==='string'){colorTransition=v;renderRing();}}).catch(()=>{});
listen('color_transition',e=>{if(typeof e.payload==='string'){colorTransition=e.payload;renderRing();}}).catch(()=>{});
listen('antigravity_prefs',e=>{if(e.payload){agPrefs=e.payload;renderRing();}}).catch(()=>{});
listen('glyphs',e=>{glyphs=e.payload||glyphs;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('activity',e=>{activity=e.payload||activity;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_activity').then(a=>{activity=a||activity;renderRing();}).catch(()=>{});
invoke('get_glyphs').then(g=>{glyphs=g||glyphs;renderRing();}).catch(()=>{});
// The edge: pushed on every placement (a drag that snapped elsewhere, or Settings), and asked for once
// at startup in case the placement happened before this page was listening.
listen('notch_edge',e=>applyEdge(e.payload)).catch(()=>{});
// applyEdge measures for the edge it is given; on the right-hand one it returns early, so the first
// measurement is made here either way. and still made if the ask fails, from the default edge.
invoke('get_notch_edge').then(e=>{applyEdge(e);reportDpr();}).catch(()=>reportDpr());
invoke('get_codex').then(u=>{codexSnap=u||codexSnap;renderRing();}).catch(()=>{});
invoke('get_usage').then(u=>{usage=u||usage;renderRing();}).catch(e=>notice('get_usage failed: '+e));
invoke('get_state').then(s=>{stateSnap=s||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();}).catch(()=>{});
setInterval(renderRing,30_000); // stale state and reset copy move with time


listen('refresh_started',()=>{for(const p of providers())turnReading(p.id);}).catch(()=>{});

function showUpdateBadge(state){
  const available=['available','downloading','ready','installing'].includes(state.status);
  orb.classList.toggle('update-available',available);
  orb.title=state.status==='ready'?'Restart to update':available?'Update available':'Settings';
  orb.setAttribute('aria-label',orb.title);
}
listen('update_state',event=>showUpdateBadge(event.payload)).catch(()=>{});
invoke('get_update_state').then(showUpdateBadge).catch(()=>{});
