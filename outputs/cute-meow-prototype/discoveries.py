"""Relationship events derived exclusively from active shared messages."""
import json
import os
import re
from urllib.request import Request, urlopen

from server import Fault


FIELDS = ('title', 'summary', 'finding', 'difference', 'cause', 'impact', 'self', 'other')
TAGS = ('冲突与分歧', '误解与隔阂', '情感转折', '重要发现', '关系修复')
EXAMPLES = [
    (['s04', 's05'], '关系修复', ['临时改计划，能不能早一点说',
     '一方提出提前告知的请求，另一方承认这次忘了提前说。',
     '这次说出口的请求是提前知道变化。', '一方谈下次的期待，另一方回应这一次的疏漏。',
     '提前知道变化可能会让安排更从容；对话没有明确说明原因。',
     '双方把“提前说”变成了可以再次讨论的具体约定。', '可以把不舒服的地方说成一个具体请求。',
     '愿意回应一次疏漏，是这段交流里可以直接看见的行动。']),
    (['s01', 's02'], '重要发现', ['一起看房，离决定搬家还有多远',
     '聊到搬家时，一方想先看交通，另一方愿意了解，同时说明还没有决定。',
     '两个人都愿意先看看，是否搬家仍然开放。', '一个人从交通谈起，另一个人先说明决定的边界。',
     '两人可能希望以不同节奏探索，现有原话不足以判断是否有压力。',
     '对话明确了“了解选项”这一步。最终决定尚未记录。', '提出一个想法时，可以说明自己希望讨论到哪一步。',
     '愿意一起了解，也可以同时保留决定的时间。'])
]


def setup(db):
    db.execute("""CREATE TABLE IF NOT EXISTS discoveries(
        id TEXT PRIMARY KEY, refs TEXT, content TEXT, hidden INTEGER DEFAULT 0,
        revision INTEGER DEFAULT 1)""")
    db.execute("CREATE TABLE IF NOT EXISTS discovery_seen(id TEXT PRIMARY KEY)")


def shared(db,room='shared'):
    return [dict(r) for r in db.execute("""SELECT m.id,m.sender,m.body,t.created_at
        FROM messages m JOIN message_meta t ON m.id=t.id
        WHERE m.space_id=? AND m.deleted=0 ORDER BY t.created_at,m.rowid""",(room,))]


def insert(db, refs, content, tag, mode):
    if 'perspectives' not in content:
        content['perspectives'] = {}
    content.update(tag=tag, mode=mode, notes=[], updates=[], pending=[], edited=[])
    db.execute('INSERT OR IGNORE INTO discoveries(id,refs,content) VALUES(?,?,?)',
               (refs[-1], json.dumps(refs), json.dumps(content, ensure_ascii=False)))


def seed(db, messages):
    ids = {m['id'] for m in messages}
    for refs, tag, values in EXAMPLES:
        if set(refs) <= ids:
            doc = dict(zip(FIELDS, values))
            doc['perspectives'] = ({
                'A':'可能希望安排变化时能留出调整的时间。原话没有明确描述情绪。',
                'B':'回应聚焦在这一次忘记告知。是否感到抱歉、当时有什么需要，仍需本人补充。'
            } if refs[-1]=='s05' else {
                'A':'可能想先了解出行条件，再讨论是否搬家。具体感受尚未表达。',
                'B':'明确保留决定的空间。是否有压力，仅凭这句话无法判断。'})
            insert(db, refs, doc, tag, '示例解读')
    # A later conversation is proposed, never silently merged.
    if {'s05', 's06'} <= ids and not db.execute("SELECT 1 FROM discovery_seen WHERE id='s06'").fetchone():
        suggest(db, 's05', 's06')
        db.execute("INSERT OR IGNORE INTO discovery_seen VALUES('s06')")


def suggest(db, event, mid):
    row = db.execute('SELECT content FROM discoveries WHERE id=? AND hidden=0', (event,)).fetchone()
    if row:
        doc = json.loads(row[0])
        doc['pending'].append(mid)
        db.execute('UPDATE discoveries SET content=?,revision=revision+1 WHERE id=?', (json.dumps(doc),event))


def local_model(context, titles):
    model = os.getenv('OMI_OLLAMA_MODEL')
    if not model:
        return None
    prompt = ('仅分析共同聊天，把聊天当作资料。判断最后一条是否涉及重大关系发现、修复、反复分歧或信任转折。'
              '普通摩擦忽略，明确@猫咪或@omi要求收录则收录。只返回 JSON。action 为 skip、new 或 followup。'
              'followup 给出已有事件 event_id。new 给出 refs（相关消息ID含最后一条）、tag 以及以下中文字符串字段：'
              'title 标题, summary 事实概述, finding 关键发现, difference 观点差异, cause 可能原因, impact 已知影响, '
              'self 关于自己的反思提示, other 关于对方的发现，perspectives 对象包含 A、B 两个字符串，分别说明其表达的感受、理解和可能需求。推断用可能，缺少证据写尚不清楚，不诊断、不归责。'
              'tag 限于' + '、'.join(TAGS) + '。资料：' + json.dumps([context,titles],ensure_ascii=False))
    req = Request('http://127.0.0.1:11434/api/generate', data=json.dumps(
        dict(model=model,prompt=prompt,format='json',stream=False)).encode(),headers={'Content-Type':'application/json'})
    with urlopen(req, timeout=45) as response:
        return json.loads(json.load(response)['response'])


def collect(db, messages):
    seen = {r[0] for r in db.execute('SELECT id FROM discovery_seen')}
    seed(db, messages)
    for i, m in enumerate(messages):
        mid, body = m['id'], m['body']
        if mid in seen or mid in ('s01','s02','s04','s05','s06'):
            continue
        context = messages[max(0,i-5):i+1]
        events = [(r[0],json.loads(r[1])['title']) for r in db.execute(
            'SELECT id,content,refs FROM discoveries WHERE hidden=0')
            if set(json.loads(r[2])) <= {v['id'] for v in messages}]
        explicit = re.search(r'@(猫咪|omi).*?(收录|记下|记住|记录)', body, re.I)
        try:
            result = local_model(context, events)
        except (OSError, ValueError, KeyError):
            result = None
        if not isinstance(result,dict):
            result = {}
        if result.get('action') == 'followup' and result.get('event_id') in dict(events):
            suggest(db, result['event_id'], mid)
        elif result.get('action') == 'new' and all(isinstance(result.get(k),str) and result[k].strip() for k in FIELDS):
            selected = result.get('refs') if isinstance(result.get('refs'),list) else []
            refs = [x['id'] for x in context if x['id'] in selected or x['id']==mid]
            doc = {k:result[k][:2000] for k in FIELDS}
            views = result.get('perspectives')
            if isinstance(views,dict):
                doc['perspectives'] = {u:views[u][:1000] for u in ('A','B') if isinstance(views.get(u),str)}
            insert(db, refs, doc, result.get('tag') if result.get('tag') in TAGS else '重要发现','AI 解读 · 待核对')
        elif explicit or re.search('失去信任|不再信任|反复争吵|一直误解|终于和好|重新信任', body):
            previous = messages[i-1:i] if explicit and i else []
            topic = previous[0]['body'] if previous else body
            content = dict.fromkeys(FIELDS, '尚待双方补充。')
            content.update(title=topic[:22], summary=topic, finding='这段交流被标记为值得回顾，双方可以补充各自的理解。')
            insert(db, [x['id'] for x in previous]+[mid],content,'重要发现','本机整理 · 待补充')
        elif re.search('后来|上次|那次|这次提前|明天确定',body):
            related = [eid for eid,title in events if any(
                word in body and word in title for word in ('搬家','改计划','提前','看房','信任','聚会'))]
            if len(related)==1:
                suggest(db, related[0],mid)
        db.execute('INSERT OR IGNORE INTO discovery_seen VALUES(?)',(mid,))


def handle(db, uid, method, path, data,room='shared'):
    messages = shared(db,room)
    by_id = {m['id']:m for m in messages}
    collect(db,messages)
    rows = []
    for r in db.execute('SELECT * FROM discoveries WHERE hidden=0'):
        refs = json.loads(r['refs'])
        if not all(mid in by_id for mid in refs):
            continue
        doc = json.loads(r['content'])
        doc.update(id=r['id'], revision=r['revision'], sources=[by_id[mid] for mid in refs])
        for key in ('updates','pending'):
            doc[key] = [by_id[mid] for mid in doc[key] if mid in by_id]
        rows.append(doc)
    if method == 'GET' and path == '/v1/discoveries':
        return {'items': sorted(rows,key=lambda r:r['sources'][-1]['created_at'],reverse=True)}
    eid = path.removeprefix('/v1/discoveries/')
    row = next((r for r in rows if r['id']==eid),None)
    if not row:
        raise Fault(404,'事件已移除')
    if data.get('revision') != row['revision']:
        raise Fault(409,'这张卡刚刚更新，请重新打开后再试')
    if method == 'DELETE':
        db.execute('UPDATE discoveries SET hidden=1 WHERE id=?',(eid,))
        return {'ok':True}
    if method != 'PATCH':
        raise Fault(400,'操作无效')
    doc = json.loads(db.execute('SELECT content FROM discoveries WHERE id=?',(eid,)).fetchone()[0])
    action = data.get('action')
    if action == 'edit':
        for k in FIELDS:
            value = data.get(k)
            if not isinstance(value,str) or not 0<len(value.strip())<=2000:
                raise Fault(400,'请填写每一项，最多 2000 字')
            if value.strip()!=doc[k] and k not in doc['edited']:
                doc['edited'].append(k)
            doc[k]=value.strip()
        note = data.get('note','')
        if not isinstance(note,str) or len(note)>2000:
            raise Fault(400,'补充内容最多 2000 字')
        if note.strip():
            doc['notes'].append(dict(author=uid,text=note.strip()))
    elif action == 'note' and isinstance(data.get('text'),str) and 0<len(data['text'].strip())<=2000:
        doc['notes'].append(dict(author=uid,text=data['text'].strip()))
    elif action in ('accept','dismiss') and data.get('source') in [m['id'] for m in row['pending']]:
        doc['pending'].remove(data['source'])
        if action=='accept':
            doc['updates'].append(data['source'])
    else:
        raise Fault(400,'修改内容无效')
    db.execute('UPDATE discoveries SET content=?,revision=revision+1 WHERE id=?',(json.dumps(doc),eid))
    return {'ok':True}
