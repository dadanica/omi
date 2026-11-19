'use strict';

const organizerApi = (kind, method, payload, id) =>
  api('/v1/organizer/' + kind + (id ? '/' + encodeURIComponent(id) : ''), method, payload);
const organizerItems = async kind => (await organizerApi(kind)).items;
const organizerRoutes = ['organizer', 'ideas', 'calendar', 'discoveries', 'discovery', 'profiles', 'quotes'];
const organizerIcons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v4m10-4v4M3 10h18m-12 5 2 2 4-4"/>',
  wishes: '<path d="M12 20V9m0 6c-5 0-7-3-7-7 4 0 7 2 7 7Zm0 2c0-5 3-7 7-7 0 4-2 7-7 7Zm0-8c-3-3-2-6 0-8 2 2 3 5 0 8Z"/>',
  profiles: '<path d="M3 9h18v4H3zm2 4h14v8H5zm7-4v12m0-12C6 10 5 5 8 4c2-1 4 5 4 5Zm0 0c6 1 7-4 4-5-2-1-4 5-4 5Z"/>',
  quotes: '<path d="M20 11a8 8 0 0 1-8 8H4l2-4a8 8 0 1 1 14-4Z"/><path d="M8 11h.01m4 0h.01m4 0h.01"/>',
  ideas: '<path d="M9 18h6m-5 3h4M9 15c0-2-4-3-4-7a7 7 0 0 1 14 0c0 4-4 5-4 7Z"/>'
};

function organizerGlyph(key) {
  const span = e('span', 'organizer-glyph');
  span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + organizerIcons[key] + '</svg>';
  return span;
}

function organizerHeader(title, subtitle, back) {
  const head = originalHeader(title, subtitle, true);
  const oldBack = head.querySelector('.head-main button');
  const button = oldBack.cloneNode(true);
  button.onclick = back;
  oldBack.replaceWith(button);
  head.querySelector('[aria-label="查找记忆"]').remove();
  return head;
}

function organizerBody(title, subtitle, back, cls = '') {
  const body = e('main', 'organizer-body ' + cls);
  screen.replaceChildren(organizerHeader(title, subtitle, back), body);
  return body;
}

function organizerRefresh() {
  go(state.page, state.scope);
}

function organizerForm(kind, title, options = {}) {
  const box = openModal(kind === 'events' ? displayDay(options.day).slice(5) + ' · ' + title : title);
  const revision = state.revision;
  const form = e('form', 'organizer-form');
  const text = e('textarea');
  text.required = kind !== 'profiles';
  text.maxLength = {profiles: 1200, ideas: 500}[kind] || 160;
  text.rows = kind === 'profiles' ? 6 : 3;
  text.value = options.text || '';
  text.placeholder = options.placeholder || '写一点想记住的内容…';
  function field(label, control, cls = '') {
    const wrapper = e('label', cls);
    wrapper.append(e('span', '', label), control);
    form.append(wrapper);
  }
  field(options.label || (kind === 'events' ? '日程名称' : '内容'), text);
  const description = e('textarea');
  if (kind === 'events') {
    text.rows = 1;
    description.rows = 2;
    description.maxLength = 500;
    field('简介（选填）', description);
  }
  const day = e('input');
  day.type = 'date';
  day.min = '0001-01-01';
  day.max = '9999-12-31';
  const annual = e('input');
  annual.type = 'checkbox';
  annual.checked = true;
  if (kind === 'events') {
    field('每年重复', annual, 'organizer-check');
  } else if (kind === 'wishes' || kind === 'reminders') {
    field('日期（选填）', day);
  }
  const submit = e('button', 'organizer-primary', '保存');
  submit.type = 'submit';
  const error = e('p', 'error-text');
  error.setAttribute('role', 'alert');
  form.append(error, submit);
  box.append(form);
  text.focus();
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled || revision !== state.revision) return;
    submit.disabled = true;
    try {
      await organizerApi(kind, 'POST', {text: text.value.trim(), day: kind === 'events' ? options.day : day.value, annual: annual.checked, description: description.value.trim()});
      if (revision === state.revision && form.isConnected) {
        closeModal();
        (options.refresh || organizerRefresh)();
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  };
}

function removeOrganizerItem(kind, item, refresh) {
  const box = openModal('移除这条记录？');
  const button = smallButton('确认移除', async () => {
    button.disabled = true;
    try {
      await organizerApi(kind, 'DELETE', undefined, item.id);
      if (!button.isConnected) return;
      closeModal();
      refresh();
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  }, 'danger');
  box.append(e('p', '', item.text), button);
}

function organizerList(kind, items, refresh = organizerRefresh) {
  const list = e('ul', 'organizer-list');
  for (const item of items) {
    const line = e('li', item.done ? 'is-done' : '');
    if (kind === 'reminders') {
      const check = e('input', 'reminder-check');
      check.type = 'checkbox';
      check.checked = Boolean(item.done);
      check.setAttribute('aria-label', '完成：' + item.text);
      check.onchange = async () => {
        check.disabled = true;
        try {
          await organizerApi(kind, 'PATCH', {done: check.checked}, item.id);
          line.classList.toggle('is-done', check.checked);
        } catch (err) {
          check.checked = !check.checked;
          toast(err.message);
        } finally {
          check.disabled = false;
        }
      };
      line.append(check);
    }
    const copy = e('div', 'organizer-item');
    copy.append(e('p', '', item.text));
    if (item.description) copy.append(e('p', 'event-description', item.description));
    if (item.day) copy.append(e('time', '', displayDay(item.day) + (item.annual ? ' · 每年' : '')));
    line.append(copy);
    if (item.owner === state.user) {
      const remove = smallButton('×', () => removeOrganizerItem(kind, item, refresh), 'organizer-remove');
      remove.setAttribute('aria-label', '移除：' + item.text);
      line.append(remove);
    }
    list.append(line);
  }
  return list;
}

function deskCard(title, glyph, count, add, extra) {
  const card = e('section', 'desk-card');
  const head = e('div', 'desk-head');
  head.append(organizerGlyph(glyph), e('h3', '', title));
  if (count) head.append(e('small', 'desk-count', count));
  if (extra) head.append(extra);
  const button = smallButton('＋', add, 'desk-add');
  button.setAttribute('aria-label', '添加' + title);
  head.append(button);
  card.append(head);
  return {card, button};
}

async function renderDesk() {
  const layer = e('div','desk-layer');
  const shade = smallButton('', () => go('home'), 'desk-shade');
  shade.setAttribute('aria-label','关闭随手记');
  const panel = e('section','desk-panel');
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label','随手记');
  const head = e('header','desk-head');
  const close = smallButton('×', () => go('home'), 'desk-add');
  close.setAttribute('aria-label','收起随手记');
  head.append(e('h2','','随手记'),close);
  const body = e('div','organizer-body desk-body');
  panel.append(head,body);
  layer.append(shade,panel);
  $('.phone').append(layer);
  close.focus();
  const [reminders, ideas] = await Promise.all([organizerItems('reminders'), organizerItems('ideas')]);
  if (!body.isConnected) return;
  const tasks = deskCard('提醒事项', 'calendar', reminders.length + ' / 10', () => organizerForm('reminders', '添加提醒事项'));
  tasks.button.disabled = reminders.length >= 10;
  tasks.card.append(reminders.length ? organizerList('reminders', reminders) : e('p', 'organizer-empty', '还没有提醒事项'));
  const notes = deskCard('灵感', 'ideas', '', () => organizerForm('ideas', '添加灵感'), smallButton('查看全部', () => go('ideas'), 'desk-all'));
  notes.card.append(ideas.length ? organizerList('ideas', ideas.slice(0, 4)) : e('p', 'organizer-empty', '还没有灵感'));
  body.append(tasks.card, notes.card);
}

async function renderIdeas() {
  const body = organizerBody('全部灵感', '只对自己可见', () => go('organizer'));
  const ideas = await organizerItems('ideas');
  if (!body.isConnected) return;
  body.append(smallButton('＋ 添加灵感', () => organizerForm('ideas', '添加灵感'), 'organizer-primary'));
  body.append(ideas.length ? organizerList('ideas', ideas) : e('p', 'organizer-empty', '还没有灵感'));
}

const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
});
function todayKey() {
  const parts = Object.fromEntries(shanghaiDate.formatToParts(new Date()).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
const padDay = value => String(value).padStart(2, '0');
const displayDay = key => key.slice(0, 4) + '年' + Number(key.slice(5, 7)) + '月' + Number(key.slice(8, 10)) + '日';
const utcDay = key => Date.parse(key + 'T00:00:00Z');
const dayKey = value => new Date(value).toISOString().slice(0, 10);
const withinDays = (value, today, days) => value >= today && utcDay(value) <= utcDay(today) + days * 86400000;

function validDay(key) {
  const value = utcDay(key);
  return Number.isFinite(value) && dayKey(value) === key;
}

function nextEventDay(item, today) {
  if (!item.annual || item.day >= today) return item.day;
  const startYear = Number(today.slice(0, 4));
  for (let year = startYear; year <= Math.min(startYear + 8, 9999); year++) {
    const key = String(year).padStart(4, '0') + item.day.slice(4);
    if (key >= today && validDay(key)) return key;
  }
  return '';
}

function chatPlans(messages, today) {
  const plans = [];
  for (const message of messages) {
    if (!/见面|聚会|出发|活动|旅行|演出|约好|一起|聚餐|会议|庆祝/.test(message.body)) continue;
    const date = message.body.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日|\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (!date) continue;
    let year = date[1] || date[4] || today.slice(0, 4);
    const suffix = '-' + padDay(date[2] || date[5]) + '-' + padDay(date[3] || date[6]);
    const spokenOn = message.created_at ? shanghaiDate.formatToParts(new Date(message.created_at)) : [];
    if (!date[1] && !date[4] && spokenOn.length) {
      const parts = Object.fromEntries(spokenOn.map(part => [part.type, part.value]));
      year = parts.year;
      if (suffix < '-' + parts.month + '-' + parts.day) year = String(Number(year) + 1);
    }
    const day = year + suffix;
    if (validDay(day) && withinDays(day, today, 14)) {
      const clauses = message.body.replace(date[0], '').split(/[，,。！？!?；;]/).map(part => part.trim());
      const text = clauses.find(part => /见面|聚会|出发|活动|旅行|演出|一起|聚餐|会议|庆祝/.test(part)) || clauses.find(Boolean);
      plans.push({day, text: text.replace(/吧$/, ''), source: message.id});
    }
  }
  return plans;
}

function iceTile(route, title, description) {
  const tile = smallButton('', () => go(route), 'ice-tile ice-' + route);
  tile.append(organizerGlyph(route), e('strong', '', title), e('small', '', description));
  return tile;
}

async function renderSharedBoard() {
  const body = organizerBody('我们的可视化记录', '点开分类，慢慢回顾', () => go('shared'), 'ice-board');
  const upcoming = e('section', 'upcoming');
  const upcomingItems = e('div', 'upcoming-items');
  upcomingItems.append(e('p', 'organizer-empty', '正在读取…'));
  upcoming.append(row('重要日程','',()=>go('calendar')), upcomingItems);
  body.append(upcoming,
    row('冲突与发现','那些影响我们关系、让我们重新认识彼此的时刻。',()=>go('discoveries')),
    row('彼此喜好','翻一翻两个人的喜好',()=>go('profiles')),
    row('收藏','值得留下的文字、照片和瞬间',()=>go('quotes')));
  const [events, chat] = await Promise.all([
    organizerItems('events'), api('/v1/conversation/shared')
  ]);
  if (!body.isConnected) return;
  const today = todayKey();
  const rows = [
    ...events.map(item => ({...item, day: nextEventDay(item, today), type: item.annual ? '每年日程' : '已添加日程', route: 'calendar'}))
      .filter(item => withinDays(item.day, today, 3)),
    ...chatPlans(chat.messages, today)
  ].sort((a, b) => a.day.localeCompare(b.day));
  upcomingItems.replaceChildren();
  if (!rows.length) upcomingItems.append(e('p', 'organizer-empty', '近期没有安排'));
  for (const item of rows) {
    const entry = smallButton('', () => {
      if (item.source) return openSource(item.source);
      calendarStart = item.day;
      go('calendar');
    }, 'upcoming-entry');
    entry.append(e('time', '', Number(item.day.slice(5, 7)) + '月' + Number(item.day.slice(8)) + '日'), e('span', '', item.text));
    upcomingItems.append(entry);
  }
}

function calendarMonth(value, shift) {
  const date = new Date(utcDay(value));
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + shift);
  return dayKey(date);
}

let calendarStart;
async function renderCalendar() {
  const body = organizerBody('重要日程', '生日、纪念日与其他重要日期', () => go('board', 'shared'));
  const today = todayKey();
  let selected = calendarStart || today;
  calendarStart = null;
  body.classList.add('month-page');
  let month = calendarMonth(selected, 0);
  let events = await organizerItems('events');
  if (!body.isConnected) return;
  const onDay = key => events.filter(item => item.day === key || (item.annual && item.day < key && item.day.slice(4) === key.slice(4)));
  async function refresh() {
    try {
      events = await organizerItems('events');
      if (body.isConnected) draw();
    } catch (err) {
      toast(err.message);
    }
  }
  function draw() {
    const shell = e('section', 'calendar-shell');
    const head = e('div', 'calendar-head');
    const turn = (shift, label, text) => {
      const b = smallButton(text, () => { month = calendarMonth(month, shift); selected = month; draw(); }, 'calendar-arrow');
      b.setAttribute('aria-label', label);
      b.disabled = shift < 0 ? month === '0001-01-01' : month === '9999-12-01';
      return b;
    };
    head.append(turn(-1, '上个月', '‹'), e('h3', '', month.slice(0, 4) + '年' + Number(month.slice(5, 7)) + '月'), turn(1, '下个月', '›'));
    const grid = e('div', 'calendar-days');
    for (const day of '一二三四五六日') grid.append(e('span', 'calendar-weekday', day));
    const first = new Date(utcDay(month));
    for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) grid.append(e('span'));
    for (let number = 1; number <= 31; number++) {
      const key = month.slice(0, 8) + padDay(number);
      if (!validDay(key)) break;
      const items = onDay(key);
      const add = () => organizerForm('events','添加重要日程',{day:key,refresh});
      const b = smallButton('', () => {
        selected = key;
        draw();
        body.querySelector('.calendar-selected').focus();
        if (!items.length) return add();
        const box = openModal(displayDay(key));
        box.append(organizerList('events', items, () => { closeModal(); refresh(); }),
          smallButton('＋ 添加重要日程', add, 'organizer-primary'));
      }, 'calendar-day');
      const numeral = e('span','day-number',String(number));
      b.append(numeral);
      if (items.length) {
        const ring = e('span','cat-ring');
        ring.innerHTML='<svg viewBox="0 0 38 36" aria-hidden="true"><path d="M5 13 5 4q0-2 2-1l7 5q5-2 10 0l7-6q2-1 2 2l-1 10q4 6 0 12c-5 9-22 10-28 1q-4-7 1-14Z"/></svg>';
        numeral.append(ring);
        for (const item of items) {
          b.append(e('strong','day-caption',item.text));
          if (item.description) b.append(e('small','day-description',item.description));
        }
      }
      const marked = onDay(key).length;
      b.classList.toggle('calendar-selected', key === selected);
      b.classList.toggle('calendar-today', key === today);
      b.classList.toggle('calendar-marked', Boolean(marked));
      b.setAttribute('aria-label', displayDay(key) + (marked ? '，' + marked + '项日程' : ''));
      b.setAttribute('aria-pressed', String(key === selected));
      grid.append(b);
    }
    shell.append(head, grid);
    body.replaceChildren(shell);
  }
  draw();
}

async function renderWishes() {
  const body = organizerBody('愿望与约定', '和重要的人一起记下来', () => go('board', 'shared'));
  const items = await organizerItems('wishes');
  if (!body.isConnected) return;
  body.append(smallButton('＋ 添加愿望或约定', () => organizerForm('wishes', '添加愿望或约定'), 'organizer-primary'));
  for (const [title, subset] of [
    ['有日期的约定', items.filter(item => item.day).sort((a, b) => a.day.localeCompare(b.day))],
    ['想一起做的事', items.filter(item => !item.day)]
  ]) {
    const section = e('section', 'organizer-section');
    section.append(e('h3', '', title), subset.length ? organizerList('wishes', subset) : e('p', 'organizer-empty', '这里还没有记录'));
    body.append(section);
  }
}

async function renderProfiles() {
  const body = organizerBody('彼此喜好', '轻点卡片或左右滑动，看看另一面', () => go('board', 'shared'));
  const [items, preferences] = await Promise.all([organizerItems('profiles'),api('/v1/preferences')]);
  if (!body.isConnected) return;
  const card = e('div', 'profile-card');
  const inner = e('div', 'profile-inner');
  const partner = otherMember();
  const faces = [];
  let flipped = false;
  function flip() {
    flipped = !flipped;
    card.classList.toggle('is-flipped', flipped);
    for (const [i, face] of faces.entries()) face.inert = i !== Number(flipped);
    faces[Number(flipped)].querySelector('button').focus({preventScroll: true});
  }
  for (const [i, uid] of [state.user, partner].entries()) {
    const mine = uid === state.user;
    const title = mine ? '我的喜好' : memberLabel(uid) + '的喜好';
    const text = items.find(item => item.owner === uid)?.text || '';
    const face = e('section', 'profile-face ' + (mine ? 'profile-front' : 'profile-back'));
    const turn = smallButton('', flip, 'profile-turn');
    turn.append(avatar(who(uid)), e('h3', '', title), e('span', '', '↻ ' + (mine ? '看看对方' : '回到我的喜好')));
    face.append(turn);
    const personal=preferences.items.filter(pref=>pref.owner===uid);
    if (!personal.length) face.append(e('p','event-meta','还没有可追溯的偏好发现'));
    for (const pref of personal) {
      const piece=e('article','pref-piece');
      piece.append(e('small','event-meta',pref.dimension+' · '+pref.kind),e('h4','',pref.name),
        e('p','',pref.description),e('small','event-meta',pref.confirmed?'本人已确认':'待本人确认'));
      const sources=smallButton('查看依据 · '+pref.sources.length,()=>{
        const box=openModal(pref.name+' · 来源');
        for (const source of pref.sources) box.append(e('p','',source.text),smallButton('查看原话',()=>openSource(source.id),'source-link'));
      },'source-link');
      piece.append(sources);
      if (mine) piece.append(smallButton(pref.confirmed?'修改':'确认或修改',()=>{
        const box=openModal('我的偏好'),form=e('form','organizer-form');
        const fields={};
        for (const [key,label] of [['name','偏好名称'],['description','我的描述']]) {
          const wrap=e('label'),input=e('textarea');
          input.value=pref[key]; input.required=true;input.maxLength=500;
          fields[key]=input;wrap.append(e('span','',label),input);form.append(wrap);
        }
        const submit=e('button','organizer-primary','确认保存');
        form.append(submit);box.append(form);
        form.onsubmit=async event=>{
          event.preventDefault();submit.disabled=true;
          try {
            await api('/v1/preferences','PATCH',{topic:pref.topic,fingerprint:pref.fingerprint,
              name:fields.name.value,description:fields.description.value});
            if(form.isConnected) await go('profiles');
          } catch(error){toast(error.message);submit.disabled=false;}
        };
      },'source-link'));
      face.append(piece);
    }
    const bio=e('details','pref-bio');
    bio.append(e('summary','','个人自述'),e('p','profile-copy',text||'尚未填写'));
    if (mine) bio.append(smallButton('编辑我的自述',()=>organizerForm('profiles','编辑我的自述',{text,label:'双方可见的喜好'})));
    face.append(bio);
    face.inert = Boolean(i);
    faces.push(face);
    inner.append(face);
  }
  let start = null;
  let suppressClick = false;
  card.addEventListener('pointerdown', event => { start = {x: event.clientX, y: event.clientY}; });
  card.addEventListener('pointerup', event => {
    if (start && Math.abs(event.clientX - start.x) > 45 && Math.abs(event.clientY - start.y) < 35) {
      suppressClick = true;
      flip();
      setTimeout(() => { suppressClick = false; }, 350);
    }
    start = null;
  });
  card.addEventListener('pointercancel', () => { start = null; });
  card.addEventListener('click', event => {
    if (suppressClick) {
      event.stopPropagation();
      suppressClick = false;
      return;
    }
    if (!event.target.closest('button,details,.pref-piece')) flip();
  }, true);
  card.append(inner);
  const overlap=preferences.items.filter(x=>x.owner===state.user)
    .map(a=>[a,preferences.items.find(b=>b.owner===partner && b.topic===a.topic)]).filter(pair=>pair[1]);
  for (const [a,b] of overlap) {
    const common=e('article','pref-piece pref-shared');
    common.append(e('small','event-meta',a.positive && b.positive?'共同兴趣':'同一话题 · 各自的表达'),
      e('h3','',a.topic),e('p','','我：'+a.description),e('p','','对方：'+b.description));
    common.append(smallButton('查看双方原话',()=>{
      const box=openModal(a.topic+' · 双方原话');
      for (const pref of [a,b]) for (const src of pref.sources)
        box.append(e('p','',(pref===a?'我：':'对方：')+src.text),smallButton('查看原话',()=>openSource(src.id),'source-link'));
    },'source-link'));
    body.append(common);
  }
  body.append(card);
}

function photoKeepsakes(section) {
  const files = ['1470770841072-f978cf4d019e','1441974231531-c6227db76b6e','1472396961693-142e6e269027','1464822759023-fed622ff2c3b','1500530855697-b586d89ba3ee','1447752875215-b2761acb3c5d','1470252649378-9c29740c9fa8','1472214103451-9374bd1c798e','1501785888041-af3ef285b470'];
  const album = e('div','photo-album');
  const strip = e('div','photo-strip');
  let spread = 0, start = null, dragged = false;
  const subsets={che:[3,4,1,8],man:[1,5,2],zhou:[8,0,3],tao:[7,6,5,1]};
  const photos=subsets[relationship]?.map(i=>files[i])||files;
  const expandLabel='展开 '+photos.length+' 张';
  const toggle = smallButton(expandLabel, () => arrange(spread < 0.5 ? 1 : 0), 'source-link');
  function arrange(value) {
    spread = Math.min(1, Math.max(0, value));
    strip.style.setProperty('--spread', spread);
    toggle.textContent = spread >= 0.5 ? '收起相册' : expandLabel;
    toggle.setAttribute('aria-expanded', String(spread >= 0.5));
    album.classList.toggle('spread', spread === 1);
    if (!spread) album.scrollLeft = 0;
  }
  photos.forEach((file, index) => {
    const img = e('img');
    img.src = '/keepsakes/' + file + '.jpg';
    img.alt = '山野散步 · 第 ' + (index + 1) + ' 张';
    img.draggable = false;
    const photo = smallButton('', () => {
      if (!dragged) openModal(img.alt).append(img.cloneNode());
    }, 'album-photo');
    photo.style.zIndex = files.length - index;
    photo.append(img);
    strip.append(photo);
  });
  album.onpointerdown = event => {
    dragged = false;
    if (spread === 1 && album.scrollLeft > 1) return;
    start = {x:event.clientX, value:spread};
  };
  album.onpointermove = event => {
    if (!start) return;
    const delta = event.clientX - start.x;
    if (!dragged && (Math.abs(delta) < 7 || (start.value === 1 && delta > 0))) return;
    dragged = true;
    album.setPointerCapture(event.pointerId);
    arrange(start.value + delta / 130);
  };
  album.onpointerup = album.onpointercancel = () => {
    if (start && dragged) arrange(spread > 0.35 ? 1 : 0);
    start = null;
  };
  album.append(strip);
  section.querySelector('header').append(toggle);
  section.append(album);
}

async function renderQuotes() {
  const body = organizerBody('收藏', '值得留下的文字、照片和瞬间', () => go('board', 'shared'), 'keepsakes');
  function section(title) {
    const block = e('section','keepsake-section');
    const head = e('header');
    head.append(e('h3','',title));
    block.append(head);
    body.append(block);
    return block;
  }
  photoKeepsakes(section('照片'));
  const voices = section('语音条');
  function voice(label, src) {
    const player = e('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = src;
    player.onplay = () => voices.querySelectorAll('audio').forEach(other => { if (other !== player) other.pause(); });
    voices.append(e('p','quote-meta',label), player);
  }
  voice(friendLabel(relationship)+' · 语音样例',relationship==='shared'?'/keepsakes/memory.m4a':'/keepsakes/'+relationship+'.m4a');
  const upload = e('input');
  upload.type = 'file';
  upload.accept = 'audio/*';
  upload.hidden = true;
  voices.querySelector('header').append(smallButton('收藏语音', () => upload.click(), 'source-link'), upload);
  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file) return;
    try {
      if (file.size > 2*1024*1024) throw Error('请选择 2 MB 以内的语音');
      const data = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('无法读取语音'));
        reader.readAsDataURL(file);
      });
      await organizerApi('voices','POST',{text:file.name, description:data});
      voice(file.name,data);
    } catch (error) { toast(error.message); }
    upload.value = '';
  };
  const words = section('文字');
  const other = section('其他');
  const [memo,detail]=({che:['摄影散步清单','带备用电池和薄外套，日落前在旧街集合。'],man:['老面馆的约定','两碗细面，醋另外放，再去附近书店逛逛。'],zhou:['午餐想聊的事','先听听最近的工作感受，再聊要不要看新的机会。'],tao:['河堤散步路线','从桥下出发，沿着河堤走，累了就找长椅歇一会儿。']})[relationship]||['湖边散步清单','带上相机、围巾和热茶。傍晚沿湖走到木桥，一起等日落。'];
  other.append(row(memo,'备忘 · 示例',()=>openModal(memo).append(e('p','',detail))));
  for (const item of await organizerItems('voices')) voice(item.text,item.description);
  const items = await organizerItems('quotes');
  if (!body.isConnected) return;
  if (!items.length) {
    words.append(e('p', 'organizer-empty', '在共同聊天里点开一条消息，就可以收藏到这里。'),
      smallButton('去共同聊天', () => go('shared'), 'organizer-primary'));
    return;
  }
  for (const item of items) {
    const card = e('article', 'quote-card');
    card.append(e('span', 'quote-mark', '“'), e('blockquote', '', item.text),
      e('p', 'quote-meta', names[item.sender] + ' · ' + dateLabel(item.created_at)));
    const actions = e('div', 'quote-actions');
    actions.append(smallButton('查看原话', () => openSource(item.source), 'source-link'));
    if (item.owner === state.user) actions.append(smallButton('取消收藏', () => removeOrganizerItem('quotes', item, organizerRefresh), 'source-link'));
    card.append(actions);
    words.append(card);
  }
}

let activeDiscovery;
const discoveryLabels = {title:'事件标题',summary:'事件概述',finding:'关键发现',difference:'认知差异',
  cause:'深层原因',impact:'对关系的影响',self:'关于自己的发现',other:'关于对方的发现'};

async function showDiscoveries(detail) {
  const body = organizerBody(detail ? '事件详情' : '冲突与发现',
    detail ? '' : '那些影响我们关系、让我们重新认识彼此的时刻。',
    () => detail ? go('discoveries') : go('board','shared'), 'discovery-page');
  const {items} = await api('/v1/discoveries');
  if (!body.isConnected) return;
  if (!detail) {
    body.append(e('p','event-meta','已发现 ' + items.length + ' 个重要事件'));
    for (const item of items) {
      const card = e('article','event-card');
      const meta = e('div','event-meta');
      meta.append(e('span','event-tag',item.tag), e('time','',dateLabel(item.sources.at(-1).created_at)));
      const remove = smallButton('删除',()=>{
        const box=openModal('删除“'+item.title+'”？');
        const confirm=smallButton('确认删除',async()=>{
          confirm.disabled=true;
          try {
            await api('/v1/discoveries/'+encodeURIComponent(item.id),'DELETE',{revision:item.revision});
            if (body.isConnected) await go('discoveries');
          } catch(error) { toast(error.message); confirm.disabled=false; }
        },'danger');
        box.append(e('p','','双方的事件列表都会移除这张卡，共同聊天原话会保留。'),confirm);
      },'event-remove');
      meta.append(remove);
      const finding = e('aside','event-finding');
      finding.append(e('small','',item.edited.includes('finding') ? '用户修订 · 关键发现' : item.mode + ' · 关键发现'),e('p','',item.finding));
      card.append(meta,e('h3','',item.title),e('p','',item.summary),finding,
        smallButton('查看详情 ›',()=>{activeDiscovery=item.id;go('discovery');},'source-link'));
      body.append(card);
    }
    if (!items.length) body.append(e('p','organizer-empty','在共同聊天中 @猫咪 并说“收录这件事”，可以留下一次值得回顾的交流。'));
    return;
  }
  const item = items.find(record=>record.id===activeDiscovery);
  const speaker = memberLabel;
  if (!item) return go('discoveries');
  const endpoint = '/v1/discoveries/' + encodeURIComponent(item.id);
  async function save(method, payload, button) {
    button.disabled = true;
    try {
      await api(endpoint,method,{...payload,revision:item.revision});
      if (body.isConnected) await go(method==='DELETE'?'discoveries':'discovery');
    } catch(error) { toast(error.message); button.disabled=false; }
  }
  const headActions=screen.querySelector('.head-actions');
  const fields = {};
  function editableText(tag, key, cls='') {
    const node=e(tag,cls,item[key]);
    node.setAttribute('aria-label',discoveryLabels[key]);
    fields[key]=node;
    return node;
  }
  function editor() {
    for (const node of Object.values(fields)) node.contentEditable='plaintext-only';
    const submit=smallButton('保存',()=>{
      const payload={action:'edit'};
      for (const [key,node] of Object.entries(fields)) {
        const value=node.innerText.trim();
        if (!value || value.length>2000) {
          toast(discoveryLabels[key]+'需填写 1 至 2000 字'); node.focus(); return;
        }
        payload[key]=value;
      }
      save('PATCH',payload,submit);
    },'organizer-primary');
    headActions.replaceChildren(smallButton('取消',()=>go('discovery'),'soft-btn'),submit);
  }
  function section(title) {
    const part=e('section','story-part');
    part.append(e('h3','',title)); body.append(part); return part;
  }
  function sourceLine(source) {
    const line=e('div','story-line');
    line.append(e('small','event-meta',dateLabel(source.created_at)+' · '+speaker(source.sender)),
      e('p','',source.body),smallButton('查看原始对话',()=>openSource(source.id),'source-link'));
    return line;
  }
  function reading(part,key,label) {
    part.append(e('small','event-meta',item.edited.includes(key)?'用户修订':label+' · '+item.mode),editableText('p',key));
  }
  body.append(e('small','event-tag',item.tag),editableText('h2','title','story-title'));
  const overview=section('01｜事件概述');
  reading(overview,'summary','经过');
  item.sources.forEach(source=>overview.append(sourceLine(source)));
  const views=section('02｜双方视角'), pair=e('div','story-pair');
  for (const uid of [state.user,otherMember()]) {
    const side=e('div');
    const words=item.sources.filter(source=>source.sender===uid).map(source=>source.body);
    side.append(e('strong','',speaker(uid)),e('small','event-meta','当事人表达'),e('p','',words.join('\n')||'暂无这一方的原话'),
      e('small','event-meta','感受与需要 · 待核对'),e('p','',item.perspectives?.[uid]||'尚未明确，可以由本人补充。'));
    pair.append(side);
  }
  views.append(pair,e('h4','','认知差异')); reading(views,'difference','可能的理解');
  reading(section('03｜深层原因'),'cause','可能原因');
  reading(section('04｜对关系的影响'),'impact','从现有记录观察');
  const findings=section('05｜新的发现');
  reading(findings,'finding','关键发现');
  for (const key of ['self','other']) {
    findings.append(e('h4','',discoveryLabels[key])); reading(findings,key,'待核对的理解');
  }
  const changes=section('06｜后续变化');
  if (!item.updates.length) changes.append(e('p','event-meta','暂无已确认的后续交流'));
  item.updates.forEach(source=>changes.append(sourceLine(source)));
  for (const source of item.pending) {
    const block=e('div','event-finding');
    block.append(e('strong','','可能相关的后续交流'),sourceLine(source));
    for (const [action,label] of [['accept','补充到时间线'],['dismiss','忽略']]) {
      const button=smallButton(label,()=>save('PATCH',{action,source:source.id},button),'soft-btn');
      block.append(button);
    }
    changes.append(block);
  }
  for (const note of item.notes) changes.append(e('small','event-meta',speaker(note.author)+' · 补充与纠正'),e('p','',note.text));
  headActions.append(smallButton('编辑',editor,'soft-btn'));
}

const renderOrganizer = {
  organizer: renderDesk, ideas: renderIdeas, calendar: renderCalendar,
  discoveries: () => showDiscoveries(false), discovery: () => showDiscoveries(true), profiles: renderProfiles, quotes: renderQuotes
};
