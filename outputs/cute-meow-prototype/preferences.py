"""Evidence-backed preference candidates for the local two-person preview."""
import hashlib
import re

from server import Fault


TOPICS = (
    ('兴趣与爱好', {'阅读':'阅读|读书|书店','摄影':'摄影|拍照','音乐':'音乐|听歌','电影':'电影','旅行':'旅行|旅游','散步':'散步','看展':'看展|插画展'}),
    ('沟通与相处', {'提前沟通':'提前商量|提前沟通|提前告诉','倾听':'听完|倾听','陪伴':'陪伴'}),
    ('生活方式', {'作息':'早起|早睡|晚睡','独处':'独处','安排时间':'时间安排|日程表'}),
    ('吃喝与美食', {'茶饮':'乌龙|奶茶|红茶|绿茶','咖啡':'咖啡','甜点':'甜点|蛋糕','辣味':'微辣|辣的|吃辣'}),
    ('审美与体验', {'光线':'自然光|暖光','礼物':'手写卡片|香氛|礼物','空间氛围':'极简|复古|安静的环境'}),
    ('愿望与向往', {'目的地':'去日本|去京都|看极光','新体验':'看日出|看星星|学陶艺'}),
)
DIRECT = re.compile('最爱|偏好|喜欢|不爱|讨厌|爱吃|很享受|特别享受')
WISH = re.compile('想尝试|想试试|想去|希望有一天|想学|想一起')
HABIT = re.compile('每次都|经常|总会|又去|又选|又点')


def setup(db):
    db.execute("""CREATE TABLE IF NOT EXISTS preference_review(
        owner TEXT, topic TEXT, fingerprint TEXT, name TEXT, description TEXT,
        PRIMARY KEY(owner,topic))""")


def candidates(db,room='shared'):
    rows = db.execute("""SELECT m.id,m.sender,m.body,t.created_at FROM messages m
        JOIN message_meta t ON t.id=m.id WHERE m.deleted=0 AND m.space_id=?
        ORDER BY t.created_at,m.rowid""",(room,))
    records = {}
    for row in rows:
        for clause in re.findall(r'[^。！？!?；;\n]+[？?]?',row['body']):
            # Require first-person testimony, excluding reported speech and questions.
            if not re.match(r'^(最近|这阵子|以前|现在|其实|这次|那天|今天|以后)*我(?!们|朋友|妈妈|爸爸|觉得[你他她]|听说|听你|猜你)',clause.strip()):
                continue
            if re.search('你喜欢|她喜欢|他喜欢|朋友说|同事说|[“「？?]|吗$|是不是|不确定|不知道|我觉得[你他她]|我听说',clause):
                continue
            direct, wish, habit = DIRECT.search(clause), WISH.search(clause), HABIT.search(clause)
            if not (direct or wish or habit):
                continue
            for dim, topics in TOPICS:
                for topic, pattern in topics.items():
                    if not re.search(pattern,clause):
                        continue
                    key = (row['sender'],topic)
                    entry = records.setdefault(key,dict(owner=key[0],topic=topic,sources=[],days=set()))
                    if not entry['sources'] or entry['sources'][-1]['id']!=row['id']:
                        entry['sources'].append(dict(id=row['id'],text=row['body']))
                    entry['days'].add(row['created_at'][:10])
                    matched=re.search(pattern,clause).group()
                    entry.update(name=matched if topic in ('目的地','新体验','茶饮','光线','礼物') else topic,description=clause.strip(),dimension='愿望与向往' if wish else dim,
                        positive=bool(re.search('我(?:一直|也|特别|很|最近|最|更)*喜欢'+pattern.split('|')[0],clause)) and not re.search('不喜欢|讨厌|不再|以前|但',clause),
                        kind='未来愿望' if wish else '临时兴趣' if re.search('最近|这阵子|这次|今天',clause)
                        else '持续偏好' if habit or re.search('一直|多年|长期|从小',clause) else '明确表达',
                        explicit=bool(direct or wish))
    result=[]
    for entry in records.values():
        days=entry.pop('days')
        if not entry.pop('explicit') and len(days)<2:
            continue
        digest=hashlib.sha256(str(entry['sources']).encode()).hexdigest()
        review=db.execute('SELECT * FROM preference_review WHERE owner=? AND topic=?',(entry['owner'],review_key(room,entry['topic']))).fetchone()
        entry.update(fingerprint=digest,confirmed=bool(review and review['fingerprint']==digest))
        if entry['confirmed']:
            entry.update(name=review['name'],description=review['description'])
            if entry['description'] != entry['sources'][-1]['text'].strip('。'):
                entry['positive']=False
        result.append(entry)
    return result


def review_key(room,topic):
    return topic if room=='shared' else room+'|'+topic


def handle(db,user,method,data,room='shared'):
    items=candidates(db,room)
    if method=='GET':
        return {'items':items}
    item=next((x for x in items if x['owner']==user and x['topic']==data.get('topic')),None)
    if method!='PATCH' or not item or item['fingerprint']!=data.get('fingerprint'):
        raise Fault(409,'来源已变化，请重新查看卡片')
    values=[data.get(k) for k in ('name','description')]
    if not all(isinstance(v,str) and 0<len(v.strip())<=500 for v in values):
        raise Fault(400,'名称和描述需填写 1 至 500 字')
    db.execute('INSERT OR REPLACE INTO preference_review VALUES(?,?,?,?,?)',(user,review_key(room,item['topic']),item['fingerprint'],*values))
    return {'ok':True}
