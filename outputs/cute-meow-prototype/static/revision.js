/* 第二版交互：沿用原始记录服务；好友、置顶及对话开关为本机原型偏好。 */
const originalGo=go,originalChat=chat;
const originalHeader=header;
header=function(...args){
  if(state.page!=='home')return originalHeader(...args);
  const h=e('header','app-head chat-search-head');
  const ip=e('button','head-cat');ip.append(avatar());ip.setAttribute('aria-label','打开菜单');ip.onclick=openDrawer;
  const form=e('form','header-search');const input=e('input');input.type='search';input.placeholder='搜索';input.setAttribute('aria-label','搜索聊天记忆，可输入 @ 和聊天名称限定范围');input.maxLength=200;form.append(input);
  const menu=e('button','icon-button');menu.innerHTML=icon('menu');menu.setAttribute('aria-label','打开菜单');menu.onclick=openDrawer;
  const add=e('button','icon-button');add.innerHTML=icon('book');add.setAttribute('aria-label','打开提醒事项和灵感');add.onclick=()=>go('organizer');
  h.append(ip,form,menu,add);return h;
};
const pref=(k,v)=>{const key='meow:v2:'+state.user+':'+k;if(v!==undefined)localStorage.setItem(key,JSON.stringify(v));try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const assistantPanels=[['💗 感情与关系','关系状态、重要的人与共同经历'],['💭 内心想法','主动表达的心事、困惑和在意的事'],['🪞 自我认知','性格描述、价值观与人生看法'],['🌷 喜好与期待','相处偏好、生活期待与喜欢的事'],['📖 重要经历','人生事件、故事与难忘回忆']];
function row(title,desc,fn){const b=e('button','space-row');const t=e('div','space-info');t.append(e('h3','',title));if(desc)t.append(e('p','',desc));b.append(t,e('span','row-arrow','›'));b.onclick=fn;return b;}
function swipe(node,fn){if(state.page==='home')return;let p;node.addEventListener('touchstart',ev=>{if(ev.target.closest('button,input,textarea'))return;p=ev.touches[0];},{passive:true});node.addEventListener('touchend',ev=>{if(p&&ev.changedTouches[0].clientX-p.clientX>80&&Math.abs(ev.changedTouches[0].clientY-p.clientY)<40)fn();p=null;},{passive:true});}
function catFriend(){const box=openModal('omi');box.append(avatar(),e('p','','我是你和重要的人共同的记忆伙伴。共同聊天里，我安静记录；与你单独交流时，我只使用你有权访问的记忆。'),e('p','source-hint','私人对话不会向另一位成员开放。好友关系目前保存在本机原型中。'));box.append(smallButton('发消息',()=>go('assistant')));}
const friendNames={che:'阿澈',man:'小满',zhou:'林舟',tao:'桃子'};
Object.assign(names,friendNames,{omi:'omi'});
const friendKeys=['shared',...Object.keys(friendNames)];
const friendLabel=id=>id==='shared'?(state.user==='A'?'桐桐':'好友 A'):friendNames[id];
let relationship='shared';
const otherMember=()=>relationship==='shared'?(state.user==='A'?'B':'A'):relationship;
const memberLabel=uid=>uid===state.user?'我':friendLabel(relationship);
const baseApi=api;
api=function(path,method,body){
  if(relationship!=='shared'){
    if(path==='/v1/conversation/shared')path='/v1/conversation/'+relationship;
    if(path==='/v1/messages' && body?.space_id==='shared')body={...body,space_id:'friend:'+state.user+':'+relationship};
    if(/^\/v1\/(preferences$|discoveries(?:\/|$)|organizer\/(?:profiles|events|voices|quotes)(?:\/|$))/.test(path) || (path==='/v1/search'&&body?.context==='shared')){
      path='/v1/rooms/'+relationship+path.slice(3);
    }
  }
  return baseApi(path,method,body);
};
function friendPortrait(id){
  if(id==='shared')return avatar(who(state.user==='A'?'B':'A'));
  return e('span','friend-portrait portrait-'+id,friendNames[id].slice(-1));
}
home=async function(revision){
  const histories=await Promise.all(friendKeys.map(key=>api('/v1/conversation/'+key)));
  if(revision!==state.revision)return;
  screen.replaceChildren(header());
  const list=e('div','home-body');
  const rows=friendKeys.map((id,i)=>({id,name:friendLabel(id),sub:histories[i].messages.at(-1)?.body||'开始聊天',time:histories[i].messages.at(-1)?.created_at}));
  rows.sort((x,y)=>Number(!!pref('pin:'+y.id))-Number(!!pref('pin:'+x.id)));
  for(const r of rows){
    const wrap=e('div','conversation-row');
    const button=row(r.name,r.sub,()=>{relationship=r.id;go('shared');});
    const av=e('div','perched-avatar');
    av.append(friendPortrait(r.id));
    button.prepend(av);
    if(r.time)button.querySelector('.space-info').append(e('time','chat-stamp',dateLabel(r.time)));
    wrap.append(button,smallButton(pref('pin:'+r.id)?'取消置顶':'置顶',()=>{pref('pin:'+r.id,!pref('pin:'+r.id));go('home');},'pin'));
    list.append(wrap);
  }
  screen.append(list);
  bindHomeSearch(list,revision);
};
function bindHomeSearch(list,revision){
  const form=$('.header-search'),input=form.querySelector('input');
  const results=e('div','home-body inline-search-results');results.hidden=true;screen.append(results);
  let timer,sequence=0;
  async function search(){
    const seq=++sequence,raw=input.value.trim();
    if(!raw){list.hidden=false;results.hidden=true;results.replaceChildren();return;}
    list.hidden=true;results.hidden=false;
    const parsed=parseChatSearch(raw,friendLabel('shared'),friendNames);
    if(parsed.error){results.replaceChildren(e('p','empty',parsed.error));return;}
    if(!parsed.query){results.replaceChildren();return;}
    results.replaceChildren(e('p','empty','正在搜索…'));
    try{
      const data=await Promise.all(parsed.scopes.map(k=>api('/v1/conversation/'+k)));
      if(seq!==sequence||revision!==state.revision||!results.isConnected)return;
      results.replaceChildren();let count=0;
      data.forEach((d,i)=>{for(const r of d.messages){if(!r.body.toLocaleLowerCase().includes(parsed.query.toLocaleLowerCase()))continue;
        const label=parsed.scopes[i]==='assistant'?'omi':friendLabel(parsed.scopes[i]);
        const item=e('button','inline-search-hit');item.append(e('small','',label+' · '+names[r.sender]),e('p','',r.body));item.onclick=()=>openSource(r.id);results.append(item);count++;
      }});
      if(!count)results.append(e('p','empty','没有找到相关记录'));
    }catch(err){if(seq===sequence&&revision===state.revision&&results.isConnected)results.replaceChildren(e('p','error-text',err.message));}
  }
  input.addEventListener('input',()=>{sequence++;clearTimeout(timer);timer=setTimeout(search,180);});
  form.onsubmit=ev=>{ev.preventDefault();clearTimeout(timer);search();};
  input.addEventListener('keydown',ev=>{if(ev.key==='Escape'){input.value='';clearTimeout(timer);search();}});
}
chat=async function(kind,revision){await originalChat(kind,revision);if(revision!==state.revision)return;const title=$('.app-head h2');if(title)title.textContent=kind==='shared'?friendLabel(relationship):'omi';if(kind==='shared')$('.subtitle').textContent='我与'+friendLabel(relationship)+' · 共同空间';const cat=$('.head-cat');if(cat)cat.onclick=catFriend;const strip=$('.memory-strip button');if(strip)strip.onclick=()=>go('board',kind);if(kind==='personal'){$('.subtitle').textContent='沉浸记录 · 仅自己可见 · 不对话';if(cat)cat.remove();}if(kind==='assistant'){const notice=$('.ai-notice');if(notice)notice.textContent='对话模式可切换；两种模式的记录都会保存。AI 整理与回答尚未接入。';const toggle=e('div','memory-strip');toggle.append(smallButton(pref('talk')===false?'对话模式：关闭':'对话模式：开启',()=>{pref('talk',pref('talk')===false);go('assistant');},''),smallButton('关于我的记忆 →',()=>go('board','assistant'),''));$('.app-head').after(toggle);}const list=$('.chat-scroll');if(list)swipe(list,()=>go('board',kind));};
const dialogueDrafts=new Map();
async function renderDialogue(kind,revision){
  const omi=kind==='assistant',uid=state.user;
  const {messages}=await api('/v1/conversation/'+kind);
  if(revision!==state.revision)return;
  const head=originalHeader(omi?'omi':friendLabel(kind),omi?'私人对话 · 本机引导体验':'与我的对话',!omi);
  const actions=head.querySelector('.head-actions');
  actions.replaceChildren(smallButton(omi?'个人记录':'共同记录',()=>{
    if(omi)return go('board','assistant');
    const box=openModal('和'+friendLabel(kind)+'的共同记录');
    for(const msg of messages)box.append(e('small','event-meta',dateLabel(msg.created_at)),smallButton(msg.body,()=>openSource(msg.id),'space-row'));
  },'soft-btn'));
  const list=e('div','chat-scroll dialogue-scroll');
  screen.replaceChildren(head,list);
  for(const msg of messages){
    const mine=msg.sender===uid, line=e('div','message'+(mine?' mine':''));
    line.append(mine?avatar(who(uid)):omi?avatar():friendPortrait(kind));
    const content=e('div','message-content');
    content.append(e('div','sender-name',mine?'我':omi?'omi':friendLabel(kind)),
      smallButton(msg.body,()=>openSource(msg.id),'bubble'));
    for(const ref of msg.refs||[])content.append(smallButton('回看聊天原话',()=>openSource(ref),'source-link'));
    line.append(content);list.append(line);
  }
  const key=uid+':'+kind;
  const draft=dialogueDrafts.get(key)||{friends:new Set(),topics:new Set(),text:''};
  dialogueDrafts.set(key,draft);
  const form=e('form','composer dialogue-composer'),chips=e('div','draft-chips');
  const input=e('textarea');input.rows=1;input.maxLength=9000;input.value=draft.text;
  input.placeholder=omi?'想从哪里聊起？':'说点什么…';input.setAttribute('aria-label',omi?'给 omi 的私人消息':'消息内容');
  input.oninput=()=>{draft.text=input.value;draft.client=null;};
  const choices=e('div','reflection-choices');
  const toggles=[];
  function tags(){
    chips.replaceChildren();
    for(const {set,id,label,button} of toggles){
      const selected=set.has(id);button.setAttribute('aria-pressed',String(selected));
      if(selected)chips.append(smallButton(label+' ×',()=>{set.delete(id);draft.client=null;tags();},'draft-chip'));
    }
  }
  if(omi){
    function group(prompt,items,set){
      const section=e('section');
      section.append(e('h3','',prompt));
      for(const [id,label] of items){
        const button=smallButton(label,()=>{
          if(set.has(id))set.delete(id);else set.add(id);
          draft.client=null;tags();
        },'reflection-tag');
        toggles.push({set,id,label,button});section.append(button);
      }
      choices.append(section);
    }
    group('今天，有什么关于自己的事想聊聊？',['最近的心情','一个反复出现的念头','我在犹豫的事','今天的小发现'].map(v=>[v,v]),draft.topics);
    group('想一起回看和谁的聊天？',friendKeys.map(id=>[id,friendLabel(id)]),draft.friends);
    if(messages.at(-1)?.sender==='omi'){
      choices.hidden=true;
      list.append(smallButton('选择话题或好友',()=>{choices.hidden=!choices.hidden;if(!choices.hidden)list.scrollTop=list.scrollHeight;},'source-link'));
    }
    list.append(choices);tags();
  }
  const compose=e('div','compose-row');
  const send=e('button','send');send.type='submit';send.setAttribute('aria-label','发送消息');send.innerHTML=icon('send');
  compose.append(input,send);form.append(chips,compose);screen.append(form);
  input.onkeydown=event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    if(send.disabled||!(input.value.trim()||draft.friends.size||draft.topics.size))return;
    const client=draft.client||(draft.client=crypto.randomUUID());
    send.disabled=true;input.readOnly=true;choices.inert=true;chips.inert=true;
    try {
      if(omi)await api('/v1/reflect','POST',{text:input.value.trim(),friends:[...draft.friends],topics:[...draft.topics],client});
      else await api('/v1/messages','POST',{space_id:'friend:'+uid+':'+kind,text:input.value.trim(),client_id:client});
      dialogueDrafts.delete(key);
      if(form.isConnected&&state.user===uid)await go(kind);
    }catch(err){toast(err.message);send.disabled=false;input.readOnly=false;choices.inert=false;chips.inert=false;}
  };
  requestAnimationFrame(()=>{if(list.isConnected)list.scrollTop=list.scrollHeight;});
}
async function board(kind){
  if(kind==='shared')return renderSharedBoard();
  const body=organizerBody('omi 记得的我','点开分类，慢慢回顾',()=>go('assistant'));
  const {messages}=await api('/v1/conversation/assistant');
  if(!body.isConnected)return;
  const themes=[/关系|和谁|桐桐|小满|阿澈|林舟|桃子|好友/,/心情|失落|困惑|犹豫|担心|不安|念头/,/发现|意识到|我觉得|我认为/,/喜欢|希望|期待|想要/,/经历|那天|当时|小时候|记得/];
  for(const [i,[label, description]] of assistantPanels.entries()){
    body.append(row(label,description,()=>{
      const box=openModal(label);
      const found=messages.filter(msg=>msg.sender===state.user&&themes[i].test(msg.body));
      for(const msg of found.reverse())box.append(e('small','event-meta',dateLabel(msg.created_at)),smallButton(msg.body,()=>openSource(msg.id),'space-row'));
      if(!found.length)box.append(e('p','organizer-empty','这里还没有对应的私人记录。'));
    }));
  }
}
function contacts(){screen.replaceChildren(header('通讯录','添加好友，让共同记忆开始'));const body=e('div','info-body');body.append(row('＋ 添加好友','邀请一位重要的人',()=>{const box=openModal('邀请重要的人');box.append(e('p','','当前体验空间已有两名成员：我和桐桐。'),e('p','source-hint','微信邀请尚未接入。本版保留一个双人空间，不开放第三人加入。'));}),row(names[state.user==='A'?'B':'A'],'我的邀请对象 · 共同空间',()=>go('shared')),row('omi','记忆陪伴角色',catFriend));screen.append(body);}
function mine(){screen.replaceChildren(header('我的','关于我的一切'));const body=e('div','info-body');body.append(e('h3','nebula-title','关于我'));const neb=e('div','nebula');for(const [i,label] of ['我的身份','我的关系','我的喜好','我的信念','我的向往'].entries()){const b=e('button','orb orb-'+i,label);b.onclick=()=>{const box=openModal(label);box.append(e('p','','这里将呈现可查看、修改和删除的 AI 记录。'),e('p','source-hint','当前尚未接入 AI，暂无已确认记录。'),smallButton('回顾我的原始记录',()=>go('memories','personal')));};neb.append(b);}body.append(neb);screen.append(body);}
const accountItems=[['个人资料','头像、昵称、个人简介'],['我的记忆','查看、搜索、修改与删除'],['我的 omi','名称、形象与参与的空间'],['隐私与权限','可见范围、授权与共同空间'],['数据管理','导出数据、删除记忆、注销账号'],['通知与提醒','待办、重要日期与记忆回顾'],['设置与帮助','消息设置、反馈与协议']];
function accountAction(label){if(label==='我的记忆')return go('memories','personal');if(label==='我的 omi')return go('cat');if(label==='隐私与权限')return go('privacy');const box=openModal(label);box.append(e('p','',accountItems.find(x=>x[0]===label)[1]),e('p','source-hint','本项已纳入页面结构，实际设置功能尚未接入。'));}
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
  const words=e('div','login-words');words.append(e('h2','','omi'),e('p','quote','We are what we remember, and who we remember with.'),e('p','translation','记忆塑造了我们，也让一起记忆的人，成为我们的一部分。'));
  const actions=e('div','login-actions');
  const unavailable=method=>{const box=openModal(method);box.append(e('p','',method+'尚未接通，目前无法使用真实账号登录。'),smallButton('先体验omi',()=>login('A'),'wide-btn'));};
  actions.append(smallButton('微信一键登录',()=>unavailable('微信登录'),'login-wechat'),smallButton('手机号登录',()=>unavailable('手机号登录'),'login-phone'),smallButton('先体验一下 →',()=>login('A'),'login-demo'),e('p','login-note','本地体验 · 微信与手机号登录待接入'));
  body.append(art,words,actions);screen.append(body);
}
catPage=function(){
  const body=organizerBody('omi 的档案','属于你的记忆伙伴',()=>go('home'),'cats-list');
  const card=e('section','cat-card');
  card.append(avatar(),e('h3','','omi'),e('p','','见证你和重要的人的日常，也陪你单独聊聊。'),
    smallButton('查看简介',catFriend,'wide-btn'));
  body.append(card);
};

go=async function(page,scope){
  if(friendNames[page]){relationship=page;page='shared';}
  if(['home','assistant','welcome','contacts','space','mine'].includes(page))relationship='shared';
  document.querySelector('.desk-layer')?.remove();
  if(page==='organizer' && state.authenticated && state.page!=='home')await go('home');
  if(!state.authenticated&&page!=='welcome')page='welcome';
  if(page==='personal')page='assistant';
  $('.phone').classList.toggle('show-login',page==='welcome');
  if(['contacts','space','mine','board','welcome','assistant',...Object.keys(friendNames),...organizerRoutes].includes(page)){
    rememberScroll();closeDrawer();closeModal();state.page=page;state.revision++;
    if(scope)state.scope=scope;
    const revision=state.revision;
    try {
      if(page==='contacts')contacts();
      if(page==='space')space();
      if(page==='mine')mine();
      if(page==='board')await board(scope||state.scope);
      if(page==='welcome')welcome();
      if(page==='assistant'||friendNames[page])await renderDialogue(page,revision);
      if(renderOrganizer[page])await renderOrganizer[page]();
    } catch(err){
      if(revision===state.revision){
        const body=$('.organizer-body')||screen;
        body.append(e('p','error-text',err.message),smallButton('重试',()=>go(page,scope)));
      }
    }
  }else await originalGo(page,scope);
  if(state.page!==page)return;
  const activeTab=page==='assistant'||(page==='board'&&scope==='assistant')?'assistant':'home';
  document.querySelectorAll('.bottom-nav button').forEach(b=>{
    b.classList.toggle('active',b.dataset.page===activeTab);
    b.setAttribute('aria-current',b.dataset.page===activeTab?'page':'false');
  });
};
$('.bottom-nav').innerHTML='<button data-page="home">☏<small>聊天</small></button><button data-page="assistant"><span class="mini-cat avatar cat"></span><small>omi</small></button>';
$('.tour').innerHTML='<button data-page="welcome">01 登录页</button><button data-page="home">02 聊天列表</button><button data-page="contacts">03 通讯录</button><button data-page="space">04 动态空间</button><button data-page="mine">05 关于我</button>';
const drawerPanel=$('#drawer-layer .drawer');
const curve=document.createElementNS('http://www.w3.org/2000/svg','svg');curve.setAttribute('viewBox','0 0 320 900');curve.setAttribute('preserveAspectRatio','none');curve.setAttribute('aria-hidden','true');curve.classList.add('menu-curve');
const curvePath=document.createElementNS('http://www.w3.org/2000/svg','path');curvePath.setAttribute('d','M 80 0 C -20 220 -20 680 80 900 L 320 900 L 320 0 Z');curve.append(curvePath);drawerPanel.prepend(curve);
const menuBody=e('div','menu-body');menuBody.append($('.drawer-person'),$('.drawer nav'),$('.drawer-note'));drawerPanel.append(menuBody);
const menuIcons=['users','book','cat','lock','leaf','heart','menu'];
$('.drawer nav').replaceChildren(...accountItems.map(([label,description],i)=>{const button=smallButton('',()=>{closeDrawer();accountAction(label);},'menu-entry');const symbol=e('span','menu-symbol');symbol.innerHTML=icon(menuIcons[i]);const copy=e('span','menu-copy');copy.append(e('strong','',label),e('small','',description));button.append(symbol,copy);return button;}));
// 首页右滑进入随手记，左滑打开原有菜单。
let homeGesture=null,suppressHomeClick=false;
screen.addEventListener('pointerdown',ev=>{
  if(!['home','assistant'].includes(state.page)||!ev.isPrimary||ev.target.closest('input,textarea,select'))return;
  homeGesture={x:ev.clientX,y:ev.clientY,id:ev.pointerId};
  if(ev.pointerType==='touch')ev.target.setPointerCapture(ev.pointerId);
});
screen.addEventListener('pointerup',ev=>{
  if(homeGesture?.id!==ev.pointerId)return;
  const dx=ev.clientX-homeGesture.x,dy=ev.clientY-homeGesture.y;
  homeGesture=null;
  if(!['home','assistant'].includes(state.page)||Math.abs(dx)<65||Math.abs(dy)>=45||(state.page==='assistant'&&dx<0))return;
  suppressHomeClick=true;
  if(state.page==='assistant')go('board','assistant');else if(dx>0)go('organizer');else openDrawer();
  setTimeout(()=>suppressHomeClick=false,350);
});
screen.addEventListener('pointercancel',()=>homeGesture=null);
screen.addEventListener('click',ev=>{if(suppressHomeClick){ev.preventDefault();ev.stopImmediatePropagation();suppressHomeClick=false;}},true);
$('.drawer-note').textContent='记忆的边界，由你决定。';
$('.intro h1').textContent='We are what we remember, and who we remember with.';
$('.intro p').textContent='记忆塑造了我们，也让共同记忆的人，成为我们的一部分。';
$('.intro h1').style.fontSize='30px';

$('.drawer-person h2').textContent='omi';
state.page='welcome';go('welcome');
