/* 第二版交互：沿用原始记录服务；好友、置顶及对话开关为本机原型偏好。 */
const originalGo=go,originalChat=chat;
const originalHeader=header;
header=function(...args){
  if(state.page!=='home')return originalHeader(...args);
  const h=e('header','app-head chat-search-head');
  const ip=e('button','head-cat');ip.append(avatar());ip.setAttribute('aria-label','打开菜单');ip.onclick=openDrawer;
  const form=e('form','header-search');const input=e('input');input.type='search';input.placeholder='搜索';input.setAttribute('aria-label','搜索聊天记忆，可输入 @ 和聊天名称限定范围');input.maxLength=200;form.append(input);
  const menu=e('button','icon-button');menu.innerHTML=icon('menu');menu.setAttribute('aria-label','打开菜单');menu.onclick=openDrawer;
  const add=e('button','icon-button','＋');add.setAttribute('aria-label','添加好友');add.onclick=()=>go('contacts');
  h.append(ip,form,menu,add);return h;
};
const pref=(k,v)=>{const key='meow:v2:'+state.user+':'+k;if(v!==undefined)localStorage.setItem(key,JSON.stringify(v));try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const panels={shared:[['📅 重要日程','生日、纪念日、聚会与共同活动'],['🌷 愿望与约定','共同愿望、约定与近期计划'],['🎁 彼此喜好','食物、礼物、兴趣与生活偏好'],['❤️ 重要时刻','重要事件与纪念日'],['💬 珍贵话语','收藏的有特殊意义的原话']],personal:[['💡 想法记录','创意、想做的事、值得尝试的方向'],['✅ 今日待办','今天的任务与临时事项'],['📆 近期待办','本周与未来几天'],['🗓️ 以后再做','尚未安排时间的事项'],['✔️ 已完成','展开查看已完成事项']],assistant:[['💗 感情与关系','关系状态、重要的人与共同经历'],['💭 内心想法','主动表达的心事、困惑和在意的事'],['🪞 自我认知','性格描述、价值观与人生看法'],['🌷 喜好与期待','相处偏好、生活期待与喜欢的事'],['📖 重要经历','人生事件、故事与难忘回忆']]};
function row(title,desc,fn){const b=e('button','space-row');const t=e('div','space-info');t.append(e('h3','',title),e('p','',desc));b.append(t,e('span','row-arrow','›'));b.onclick=fn;return b;}
function swipe(node,fn){if(state.page==='home')return;let p;node.addEventListener('touchstart',ev=>{if(ev.target.closest('button,input,textarea'))return;p=ev.touches[0];},{passive:true});node.addEventListener('touchend',ev=>{if(p&&ev.changedTouches[0].clientX-p.clientX>80&&Math.abs(ev.changedTouches[0].clientY-p.clientY)<40)fn();p=null;},{passive:true});}
function catFriend(){const box=openModal('可爱咪');box.append(avatar(),e('p','','我是你和重要的人共同的记忆伙伴。共同聊天里，我安静记录；与你单独交流时，我只使用你有权访问的记忆。'),e('p','source-hint','私人对话不会向另一位成员开放。好友关系目前保存在本机原型中。'));box.append(smallButton(pref('friend')?'发消息':'＋ 添加好友',()=>{pref('friend',true);go('assistant');}));}
home=async function(revision){const [a,b]=await Promise.all([api('/v1/conversation/personal'),api('/v1/conversation/shared')]);if(revision!==state.revision)return;screen.replaceChildren(header());const list=e('div','home-body');const rows=[{id:'personal',name:'个人咪',sub:a.messages.at(-1)?.body||'专属我的记忆，只记录，不对话',animal:'cat'},{id:'shared',name:names[state.user==='A'?'B':'A'],sub:b.messages.at(-1)?.body||'邀请重要的人，一起记录',animal:who(state.user==='A'?'B':'A')}];if(pref('friend'))rows.push({id:'assistant',name:'可爱咪',sub:'懂我的经历，也陪我理解自己',animal:'cat'});rows.sort((x,y)=>Number(!!pref('pin:'+y.id))-Number(!!pref('pin:'+x.id)));for(const r of rows){const wrap=e('div','conversation-row');const button=row(r.name,r.sub,()=>go(r.id));const av=e('div','perched-avatar');av.append(avatar(r.animal));if(r.id==='shared'){const cat=avatar();cat.classList.add('perched');av.append(cat);}button.prepend(av);wrap.append(button);const pin=smallButton(pref('pin:'+r.id)?'取消置顶':'置顶',()=>{pref('pin:'+r.id,!pref('pin:'+r.id));go('home');},'pin');wrap.append(pin);list.append(wrap);}screen.append(list);bindHomeSearch(list,revision);swipe(list,openDrawer);};
function bindHomeSearch(list,revision){
  const form=$('.header-search'),input=form.querySelector('input');
  const results=e('div','home-body inline-search-results');results.hidden=true;screen.append(results);
  let timer,sequence=0;
  async function search(){
    const seq=++sequence,raw=input.value.trim();
    if(!raw){list.hidden=false;results.hidden=true;results.replaceChildren();return;}
    list.hidden=true;results.hidden=false;
    const parsed=parseChatSearch(raw,names[state.user==='A'?'B':'A']);
    if(parsed.error){results.replaceChildren(e('p','empty',parsed.error));return;}
    if(!parsed.query){results.replaceChildren();return;}
    results.replaceChildren(e('p','empty','正在搜索…'));
    try{
      const data=await Promise.all(parsed.scopes.map(k=>api('/v1/conversation/'+k)));
      if(seq!==sequence||revision!==state.revision||!results.isConnected)return;
      results.replaceChildren();let count=0;
      data.forEach((d,i)=>{for(const r of d.messages){if(!r.body.toLocaleLowerCase().includes(parsed.query.toLocaleLowerCase()))continue;
        const label=parsed.scopes[i]==='personal'?'个人咪':parsed.scopes[i]==='shared'?names[state.user==='A'?'B':'A']:'可爱咪';
        const item=e('button','inline-search-hit');item.append(e('small','',label+' · '+names[r.sender]),e('p','',r.body));item.onclick=()=>openSource(r.id);results.append(item);count++;
      }});
      if(!count)results.append(e('p','empty','没有找到相关记录'));
    }catch(err){if(seq===sequence&&revision===state.revision&&results.isConnected)results.replaceChildren(e('p','error-text',err.message));}
  }
  input.addEventListener('input',()=>{sequence++;clearTimeout(timer);timer=setTimeout(search,180);});
  form.onsubmit=ev=>{ev.preventDefault();clearTimeout(timer);search();};
  input.addEventListener('keydown',ev=>{if(ev.key==='Escape'){input.value='';clearTimeout(timer);search();}});
}
chat=async function(kind,revision){await originalChat(kind,revision);if(revision!==state.revision)return;const title=$('.app-head h2');if(title)title.textContent=kind==='personal'?'个人咪':kind==='shared'?names[state.user==='A'?'B':'A']:'可爱咪';const cat=$('.head-cat');if(cat)cat.onclick=catFriend;const strip=$('.memory-strip button');if(strip)strip.onclick=()=>go('board',kind);if(kind==='personal'){$('.subtitle').textContent='沉浸记录 · 仅自己可见 · 不对话';if(cat)cat.remove();}if(kind==='assistant'){const notice=$('.ai-notice');if(notice)notice.textContent='对话模式可切换；两种模式的记录都会保存。AI 整理与回答尚未接入。';const toggle=e('div','memory-strip');toggle.append(smallButton(pref('talk')===false?'对话模式：关闭':'对话模式：开启',()=>{pref('talk',pref('talk')===false);go('assistant');},''),smallButton('关于我的记忆 →',()=>go('board','assistant'),''));$('.app-head').after(toggle);}const list=$('.chat-scroll');if(list)swipe(list,()=>go('board',kind));};
async function board(kind){
  if(kind==='personal')return personalBoard();
  screen.replaceChildren(header(kind==='shared'?'我们的可视化记录':'可爱咪记得的我','点开分类，慢慢回顾',true));const body=e('div','info-body');for(const [label,description] of panels[kind])body.append(row(label,description,()=>{const box=openModal(label);box.append(e('p','',description),e('p','source-hint','尚无已确认的结构化信息。AI 分类未接入，不会把聊天自动认定为日程、偏好或正式待办。'),smallButton('查看原始记录',()=>go('memories',kind)));}));body.append(smallButton('查看全部原始记录',()=>go('memories',kind),'wide-btn'));screen.append(body);
}
async function personalBoard(){
  const revision=state.revision;
  screen.replaceChildren(header('我的想法与待办','想法独立收好，待办按时间排列',true));
  const body=e('div','info-body inline-board');screen.append(body);
  const sections=[];
  const empty=['还没有已整理的想法。','今天暂无已确认待办。','近期暂无已确认待办。','暂无待安排事项。','还没有已完成的事项。'];
  for(const [i,[label,description]] of panels.personal.entries()){
    const section=e('section','inline-category');
    section.append(e('h3','',label),e('p','category-caption',i===4?'已完成的事项也留在这里':description));
    const content=e('div','category-content');content.append(e('p','category-empty',empty[i]));section.append(content);body.append(section);sections.push(content);
  }
  const rawSection=e('section','inline-category');rawSection.append(e('h3','','其他原始记录'),e('p','category-caption','尚未分类的内容直接保留原文；不会自动认定为待办。'));
  const raw=e('div','category-content');raw.append(e('p','category-empty','正在读取…'));rawSection.append(raw);body.append(rawSection);
  function record(r){const article=e('article','inline-record');article.append(e('p','',r.body),e('time','',dateLabel(r.created_at)+' · 原始记录'));return article;}
  try{
    const data=await api('/v1/memories/personal');if(revision!==state.revision||!body.isConnected)return;
    const ideas=data.memories.filter(r=>(r.tags||[]).some(t=>t==='灵感'||t==='想法'));
    const other=data.memories.filter(r=>!ideas.includes(r));
    if(ideas.length){sections[0].replaceChildren(...ideas.map(record));sections[0].prepend(e('p','category-caption','按已有标签展示原文，尚未经 AI 归纳。'));}
    raw.replaceChildren(...other.map(record));if(!other.length)raw.append(e('p','category-empty','没有其他原始记录。'));
  }catch(err){if(revision!==state.revision||!body.isConnected)return;raw.replaceChildren(e('p','error-text','记录未能加载：'+err.message),smallButton('重新加载',personalBoard,'soft-btn'));}
}
function contacts(){screen.replaceChildren(header('通讯录','添加好友，让共同记忆开始'));const body=e('div','info-body');body.append(row('＋ 添加好友','邀请一位重要的人',()=>{const box=openModal('邀请重要的人');box.append(e('p','','当前体验空间已有两名成员：我和桐桐。'),e('p','source-hint','微信邀请尚未接入。本版保留一个双人空间，不开放第三人加入。'));}),row(names[state.user==='A'?'B':'A'],'我的邀请对象 · 共同空间',()=>go('shared')),row('可爱咪',pref('friend')?'已添加 · 记忆陪伴角色':'添加后，可以与她单独交流',catFriend));screen.append(body);}
function mine(){screen.replaceChildren(header('我的','关于我的一切'));const body=e('div','info-body');body.append(e('h3','nebula-title','关于我'));const neb=e('div','nebula');for(const [i,label] of ['我的身份','我的关系','我的喜好','我的信念','我的向往'].entries()){const b=e('button','orb orb-'+i,label);b.onclick=()=>{const box=openModal(label);box.append(e('p','','这里将呈现可查看、修改和删除的 AI 记录。'),e('p','source-hint','当前尚未接入 AI，暂无已确认记录。'),smallButton('回顾我的原始记录',()=>go('memories','personal')));};neb.append(b);}body.append(neb);screen.append(body);}
const accountItems=[['个人资料','头像、昵称、个人简介'],['我的记忆','查看、搜索、修改与删除'],['我的咪','名称、形象与参与的空间'],['隐私与权限','可见范围、授权与共同空间'],['数据管理','导出数据、删除记忆、注销账号'],['通知与提醒','待办、重要日期与记忆回顾'],['设置与帮助','消息设置、反馈与协议']];
function accountAction(label){if(label==='我的记忆')return go('memories','personal');if(label==='我的咪')return go('cat');if(label==='隐私与权限')return go('privacy');const box=openModal(label);box.append(e('p','',accountItems.find(x=>x[0]===label)[1]),e('p','source-hint','本项已纳入页面结构，实际设置功能尚未接入。'));}
function space(){
  const head=e('header','app-head moments-head');head.append(e('h2','','空间'));
  const camera=e('button','icon-button');camera.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg>';camera.setAttribute('aria-label','发表动态');
  camera.onclick=()=>{const box=openModal('发表动态');box.append(smallButton('从相册选择照片',()=>{closeModal();composeMoment(true);},'moment-action'),smallButton('发表文字',()=>{closeModal();composeMoment(false);},'moment-action'));};head.append(camera);screen.replaceChildren(head);
  const body=e('div','moments-scroll');const cover=e('div','moments-cover');cover.append(e('span','cover-line','把生活，留在此刻。'));const identity=e('div','moments-identity');identity.append(e('strong','',names[state.user]),avatar(who(state.user)));cover.append(identity);body.append(cover,e('p','moments-caption','一些日常，一些值得记住的小事。'));
  const feed=e('div','moments-feed');body.append(feed);screen.append(body);
  const posts=pref('posts')||[];
  if(!posts.length)feed.append(e('p','empty','还没有动态\n点击右上角相机，分享此刻。'));
  for(const post of posts){const card=e('article','moment');card.append(avatar(who(state.user)));const content=e('div','moment-content');content.append(e('h3','',names[state.user]),e('p','moment-text',post.text));if(post.images?.length){const grid=e('div','moment-images');for(const src of post.images){const img=e('img');img.src=src;img.alt='动态照片';const b=e('button','moment-photo');b.append(img);b.onclick=()=>{const box=openModal('照片');const full=e('img','moment-full');full.src=src;full.alt='动态照片大图';box.append(full);};grid.append(b);}content.append(grid);}const foot=e('div','moment-foot');foot.append(e('time','',new Date(post.date).toLocaleString('zh-CN')),smallButton('删除',()=>{const box=openModal('删除这条动态？');box.append(e('p','','删除后无法恢复。'),smallButton('确认删除',()=>{pref('posts',(pref('posts')||[]).filter(p=>p.id!==post.id));closeModal();space();},'danger'));},'source-link'));content.append(foot);card.append(content);feed.append(card);}
  body.append(e('p','moments-local','本机体验 · 动态尚未对好友发布'));
}
function composeMoment(pickPhoto){
  const uid=state.user;
  state.momentDrafts=state.momentDrafts||{};
  const draft=state.momentDrafts[uid]||(state.momentDrafts[uid]={text:'',images:[]});
  const head=e('header','app-head');const cancel=smallButton('取消',()=>go('space'),'');const publish=smallButton('发表',save,'moment-publish');head.append(cancel,e('h2','','发表动态'),publish);screen.replaceChildren(head);
  const body=e('div','moment-editor');const input=e('textarea');input.placeholder='这一刻的想法…';input.setAttribute('aria-label','动态正文');input.maxLength=2000;input.value=draft.text;input.oninput=()=>{draft.text=input.value;refresh();};body.append(input);
  const grid=e('div','moment-images editor-images');body.append(grid);
  const file=e('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.multiple=true;file.hidden=true;body.append(file);
  body.append(e('p','source-hint','本机预览，尚未对好友发布。可选择最多 3 张照片，每张不超过 800 KB。'));screen.append(body);
  let reading=false;
  function refresh(){publish.disabled=reading||(!draft.text.trim()&&!draft.images.length);grid.replaceChildren();draft.images.forEach((src,i)=>{const tile=e('div','editor-photo');const img=e('img');img.src=src;img.alt='待发表照片 '+(i+1);tile.append(img,smallButton('×',()=>{draft.images.splice(i,1);refresh();},'remove-photo'));grid.append(tile);});if(draft.images.length<3)grid.append(smallButton('＋',()=>file.click(),'photo-add'));}
  file.onchange=async()=>{reading=true;refresh();try{for(const f of file.files){if(draft.images.length>=3)break;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>800*1024){toast('请选择不超过 800 KB 的 JPG、PNG 或 WebP 图片。');continue;}const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(f);});draft.images.push(src);}}catch{toast('照片读取失败，请重试。');}finally{reading=false;file.value='';if(grid.isConnected&&state.user===uid)refresh();}};
  function save(){if(reading||state.user!==uid)return;try{pref('posts',[{id:crypto.randomUUID(),text:draft.text.trim(),images:[...draft.images],date:Date.now()},...(pref('posts')||[])]);}catch{toast('本机存储空间不足，请减少照片后重试；草稿已保留。');return;}delete state.momentDrafts[uid];go('space');toast('动态已保存到本机预览。');}
  refresh();if(pickPhoto)file.click();else input.focus();
}
function welcome(){
  screen.replaceChildren();
  const body=e('div','welcome-v2 login-page');
  const art=e('div','login-art');art.setAttribute('aria-hidden','true');art.append(e('span','login-blob mint'),e('span','login-blob butter'),avatar(),e('span','login-arch'));
  const words=e('div','login-words');words.append(e('h2','','可爱咪'),e('p','quote','We are what we remember, and who we remember with.'),e('p','translation','记忆塑造了我们，也让一起记忆的人，成为我们的一部分。'));
  const actions=e('div','login-actions');
  const unavailable=method=>{const box=openModal(method);box.append(e('p','',method+'尚未接通，目前无法使用真实账号登录。'),smallButton('先体验可爱咪',()=>login('A'),'wide-btn'));};
  actions.append(smallButton('微信一键登录',()=>unavailable('微信登录'),'login-wechat'),smallButton('手机号登录',()=>unavailable('手机号登录'),'login-phone'),smallButton('先体验一下 →',()=>login('A'),'login-demo'),e('p','login-note','本地体验 · 微信与手机号登录待接入'));
  body.append(art,words,actions);screen.append(body);
}
catPage=function(){
  screen.replaceChildren(header('我的咪','属于你的记忆伙伴',true));
  const body=e('div','info-body cats-list');
  for(const [kind,title,description] of [['personal','个人咪','专属你的记录伙伴，安静保存想法与待办。'],['assistant','可爱咪','见证你和邀请对象的日常，也陪你单独聊聊。']]){
    const card=e('section','cat-card');card.append(avatar(),e('h3','',title),e('p','',description),e('p','source-hint','尚未取名 · 名字由你和邀请对象一起决定。'),smallButton(kind==='personal'?'开始记录':'查看简介',()=>kind==='personal'?go('personal'):catFriend(),'wide-btn'));body.append(card);
  }
  screen.append(body);
};

go=async function(page,scope){if(!state.authenticated&&page!=='welcome')page='welcome';$('.phone').classList.toggle('show-login',page==='welcome');if(page==='assistant'&&!pref('friend'))return catFriend();if(['contacts','space','mine','board','welcome'].includes(page)){rememberScroll();closeDrawer();closeModal();state.page=page;state.revision++;if(scope)state.scope=scope;if(page==='contacts')contacts();if(page==='space')space();if(page==='mine')mine();if(page==='board')await board(scope||state.scope);if(page==='welcome')welcome();}else await originalGo(page,scope);document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));};
$('.bottom-nav').innerHTML='<button data-page="home">☏<small>聊天</small></button><button data-page="contacts" class="contact-highlight">＋<small>通讯录</small></button><button data-page="space">◌<small>空间</small></button><button data-page="mine">♙<small>我的</small></button>';
$('.tour').innerHTML='<button data-page="welcome">01 登录页</button><button data-page="home">02 聊天列表</button><button data-page="contacts">03 通讯录</button><button data-page="space">04 动态空间</button><button data-page="mine">05 关于我</button>';
const drawerPanel=$('#drawer-layer .drawer');
const curve=document.createElementNS('http://www.w3.org/2000/svg','svg');curve.setAttribute('viewBox','0 0 320 900');curve.setAttribute('preserveAspectRatio','none');curve.setAttribute('aria-hidden','true');curve.classList.add('menu-curve');
const curvePath=document.createElementNS('http://www.w3.org/2000/svg','path');curvePath.setAttribute('d','M 80 0 C -20 220 -20 680 80 900 L 320 900 L 320 0 Z');curve.append(curvePath);drawerPanel.prepend(curve);
const menuBody=e('div','menu-body');menuBody.append($('.drawer-person'),$('.drawer nav'),$('.drawer-note'));drawerPanel.append(menuBody);
const menuIcons=['users','book','cat','lock','leaf','heart','menu'];
$('.drawer nav').replaceChildren(...accountItems.map(([label,description],i)=>{const button=smallButton('',()=>{closeDrawer();accountAction(label);},'menu-entry');const symbol=e('span','menu-symbol');symbol.innerHTML=icon(menuIcons[i]);const copy=e('span','menu-copy');copy.append(e('strong','',label),e('small','',description));button.append(symbol,copy);return button;}));
// 首页向左滑打开右侧菜单；聊天页向右滑仍进入各自记忆。
let homeGesture=null,suppressHomeClick=false;
screen.addEventListener('pointerdown',ev=>{if(state.page!=='home'||ev.target.closest('input,textarea,select'))return;homeGesture={x:ev.clientX,y:ev.clientY};});
screen.addEventListener('pointerup',ev=>{if(!homeGesture)return;const dx=ev.clientX-homeGesture.x,dy=ev.clientY-homeGesture.y;homeGesture=null;if(state.page==='home'&&dx < -65&&Math.abs(dy)<45){suppressHomeClick=true;openDrawer();setTimeout(()=>suppressHomeClick=false,350);}});
screen.addEventListener('pointercancel',()=>homeGesture=null);
screen.addEventListener('click',ev=>{if(suppressHomeClick){ev.preventDefault();ev.stopImmediatePropagation();suppressHomeClick=false;}},true);
$('.drawer-note').textContent='记忆的边界，由你决定。';
$('.intro h1').textContent='We are what we remember, and who we remember with.';
$('.intro p').textContent='记忆塑造了我们，也让共同记忆的人，成为我们的一部分。';
$('.intro h1').style.fontSize='30px';

$('.drawer-person h2').textContent='可爱咪';
state.page='welcome';go('welcome');
