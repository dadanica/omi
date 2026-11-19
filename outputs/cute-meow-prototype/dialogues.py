"""Fictional relationship conversations and private reflection turns."""
import json
import time
from datetime import date,timedelta
import discoveries
from uuid import uuid4
from server import Fault

FRIENDS = {
    'che': ('阿澈', ['昨天洗出来的照片看了吗？','看了，有一张树叶糊了，我差点删掉。','这张别删，我喜欢你拍到风吹过来的那一下。']),
    'man': ('小满', ['路过以前放学那家面馆，招牌居然还在。','我还记得你每次都多加一勺醋。最近忙，一直没找你。','等你有空再回，我就是突然想起你了。']),
    'zhou': ('林舟', ['这周的工作还顺利吗？','项目快结束了。我在想，是不是可以试试另一个方向。','你昨天说想换个方向，后来又想到什么了？']),
    'tao': ('桃子', ['这几天坐得太久，有点想念以前傍晚散步的时候。','我也是。想出去透气，又懒得规划路线。','今晚走一圈？不用赶步数，楼下见就行。'])}
TOPICS = ['最近的心情','一个反复出现的念头','我在犹豫的事','今天的小发现']
ROOM_EXAMPLES = {
    'che': ('旧街摄影散步','摄影','我喜欢摄影，一条街慢慢拍就好。','我也喜欢摄影，更想拍走动的人。','一张模糊的照片要不要留下','我嫌树叶糊了，想删掉。','我反倒想留着，那一下风很特别。','一张照片也可以留下当时的感觉。'),
    'man': ('老面馆重聚','阅读','我喜欢阅读，特别是旧书里的批注。','我也喜欢阅读，短篇可以在通勤时读完。','很久没回消息的时候','我最近回得慢，有点担心你会误会。','看到再回就好，我只是想说我记得你。','一句想念，也可以给对方留下回应的时间。'),
    'zhou': ('项目复盘午餐','咖啡','我喜欢咖啡，早上会点一杯拿铁。','我也喜欢咖啡，更喜欢清淡的手冲。','聊换工作时先听一会儿','上次你列了很多岗位，其实我还没想好要不要走。','明白了，下次我先听你讲，等你想看机会再一起找。','讨论一个选择，可以先约好这次是倾听还是出主意。'),
    'tao': ('河堤傍晚散步','散步','我喜欢散步，想找一条安静的路。','我也喜欢散步，不用赶步数最好。','散步需要有目标吗','我昨天总在看步数，反而忘了看路边的花。','下次把手环收起来吧，我们走累了就坐一会儿。','一起出门的理由也可以只是放松。')}

def seed_room(c,sid,uid,key):
    marker=sid+':keepsakes-v1'
    if c.execute('SELECT 1 FROM room_samples WHERE id=?',(marker,)).fetchone():
        return
    event,topic,mine,theirs,title,first,second,finding=ROOM_EXAMPLES[key]
    day=date.today()+timedelta(days=2)
    lines=[(uid,mine),(key,theirs),(uid,first),(key,second),(key,f'{day.month}月{day.day}日一起去{event}吧。')]
    refs=[]
    for n,(sender,text) in enumerate(lines):
        mid=marker+':'+str(n);refs.append(mid)
        c.execute('INSERT INTO messages(id,space_id,sender,body) VALUES(?,?,?,?)',(mid,sid,sender,text))
        c.execute("INSERT INTO message_meta VALUES(?,?,'[]')",(mid,f'2026-11-18T19:1{n}:00+08:00'))
    c.execute("INSERT INTO organizer(id,owner,kind,text,day,description,room) VALUES(?,?,'events',?,?,?,?)",(marker+':event',uid,event,day.isoformat(),'我们提前约好的见面时间。',sid))
    c.execute("INSERT INTO organizer(id,owner,kind,source,room) VALUES(?,?,'quotes',?,?)",(marker+':quote',uid,refs[3],sid))
    for owner,text in [(uid,mine),(key,theirs)]:
        c.execute("INSERT INTO organizer(id,owner,kind,text,room) VALUES(?,?,'profiles',?,?)",('profile:'+owner+':'+sid,owner,text,sid))
    doc=dict(title=title,summary=first+' '+second,finding=finding,difference='两人分别说出了当时在意的事。',cause='两个人关注的细节可能不同，原因仍可继续讨论。',
             impact='对话中出现了一个新的看法，后续感受还可以补充。',self=first,other=second)
    discoveries.insert(c,refs[2:4],doc,'重要发现','示例解读')
    c.execute('INSERT INTO room_samples VALUES(?)',(marker,))


def room(uid, friend):
    return 'shared' if friend=='shared' else 'friend:'+uid+':'+friend


def setup(c):
    c.execute('CREATE TABLE IF NOT EXISTS room_samples(id TEXT PRIMARY KEY)')
    c.execute("INSERT OR IGNORE INTO users VALUES ('omi')")
    c.execute('CREATE TABLE IF NOT EXISTS reflection_turns(owner TEXT, client TEXT, reply TEXT, refs TEXT, PRIMARY KEY(owner,client))')
    for i,(sender,text) in enumerate([('B','原本约好一起看展，周六我可能赶不回来。'),('A','有点可惜，我还挺期待一起看的。要不要换一天？'),('B','那周日下午呢？我还想和你一起去看那个展。')]):
        mid='showcase:gallery-chat:'+str(i)
        c.execute("INSERT OR IGNORE INTO messages(id,space_id,sender,body) VALUES(?,'shared',?,?)",(mid,sender,text))
        c.execute("INSERT OR IGNORE INTO message_meta VALUES(?,?,'[]')",(mid,f'2026-11-19T20:4{i}:00+08:00'))
    for uid in ('A','B'):
        for index,(key,(_,lines)) in enumerate(FRIENDS.items()):
            sid=room(uid,key)
            c.execute('INSERT OR IGNORE INTO users VALUES (?)',(key,))
            c.execute("INSERT OR IGNORE INTO spaces VALUES (?,'shared')",(sid,))
            for member in (uid,key):
                c.execute('INSERT OR IGNORE INTO members VALUES (?,?,1)',(sid,member))
            for n,body in enumerate(lines):
                mid=sid+':sample:'+str(n)
                c.execute('INSERT OR IGNORE INTO messages(id,space_id,sender,body) VALUES(?,?,?,?)',
                          (mid,sid,uid if n==1 else key,body))
                c.execute("INSERT OR IGNORE INTO message_meta VALUES(?,?,'[]')",(mid,f'2026-11-19T{16+index}:{10+n*4:02}:00+08:00'))
            seed_room(c,sid,uid,key)


def reflect(c,uid,data,permitted):
    sid='assistant:'+uid
    text=data.get('text','')
    friends=data.get('friends',[])
    topics=data.get('topics',[])
    client=data.get('client')
    if not permitted(c,uid,sid) or not isinstance(text,str) or len(text)>9000 or not isinstance(client,str) or not 0<len(client)<=128:
        raise Fault(400,'消息无效')
    if not isinstance(friends,list) or not isinstance(topics,list) or len(friends)>5 or len(topics)>4 or not all(isinstance(f,str) and f in (*FRIENDS,'shared') for f in friends) or not all(t in TOPICS for t in topics):
        raise Fault(400,'请选择有效标签')
    if not(text.strip() or friends or topics):
        raise Fault(400,'请写一句话或选一个标签')
    if c.execute('SELECT 1 FROM reflection_turns WHERE owner=? AND client=?',(uid,client)).fetchone():
        return {'ok':True}
    refs=[]
    labels=list(topics)
    for friend in friends:
        target=room(uid,friend)
        if not permitted(c,uid,target):
            raise Fault(404,'对话不可用')
        labels.append(('桐桐' if uid=='A' else '好友 A') if friend=='shared' else FRIENDS[friend][0])
        msg=c.execute('SELECT m.id FROM messages m JOIN message_meta t ON m.id=t.id WHERE m.space_id=? AND m.sender!=? AND m.deleted=0 ORDER BY t.created_at DESC,m.rowid DESC LIMIT 1',(target,uid)).fetchone()
        if msg:
            refs.append(msg[0])
    if '失落' in text:
        reply='你提到有些失落。回到当时，哪一刻让这种感觉最明显？'
    elif '犹豫' in text or TOPICS[2] in topics:
        reply='如果把你在意的两种选择摆在一起，每一种最让你舍不得的是什么？'
    elif friends:
        reply='回看和'+ '、'.join(labels[len(topics):]) +'的聊天，有哪句话让你想多停留一会儿？'
    elif TOPICS[3] in topics:
        reply='今天是哪个小瞬间，让你对自己有了一点新的认识？'
    elif TOPICS[1] in topics:
        reply='最近一次冒出这个念头时，你当时正在做什么？'
    elif text.strip():
        reply='你说「'+text.strip()[:36]+'」。如果从一个具体的瞬间讲起，你会从哪里开始？'
    else:
        reply='今天的心情，有没有在哪一刻发生过变化？'
    now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    for sender,body in [(uid,' '.join('〔'+v+'〕' for v in labels)+ ('\n' if labels and text else '')+text.strip()),('omi',reply)]:
        mid=uuid4().hex
        c.execute('INSERT INTO messages(id,space_id,sender,body) VALUES(?,?,?,?)',(mid,sid,sender,body))
        c.execute('INSERT INTO message_meta VALUES(?,?,?)',(mid,now,json.dumps(labels,ensure_ascii=False)))
    c.execute('INSERT INTO reflection_turns VALUES(?,?,?,?)',(uid,client,mid,json.dumps(refs)))
    return {'ok':True}
