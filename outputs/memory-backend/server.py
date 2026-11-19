"""可爱咪技术验证 02：stdlib WSGI + SQLite。仅虚构测试数据。

无微信登录、模型、向量、媒体存储或生产部署。离线签发随机实验凭证；
请求不能选择用户身份。跨实例使用同一 SQLite 文件，权限由数据库决定。
"""
import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager


SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('personal','shared','assistant')));
CREATE TABLE IF NOT EXISTS members(space_id TEXT REFERENCES spaces(id),user_id TEXT REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(space_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id),sender TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id),body TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sources(memory_id TEXT REFERENCES memories(id),message_id TEXT REFERENCES messages(id),source_version INTEGER NOT NULL,PRIMARY KEY(memory_id,message_id));
CREATE TABLE IF NOT EXISTS search_index(memory_id TEXT PRIMARY KEY REFERENCES memories(id),text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gifts(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),recipient TEXT REFERENCES users(id),source_id TEXT REFERENCES messages(id),excerpt TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,source_id TEXT REFERENCES messages(id),source_version INTEGER NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(user_id TEXT REFERENCES users(id),client_id TEXT NOT NULL,message_id TEXT REFERENCES messages(id),payload_hash TEXT NOT NULL,PRIMARY KEY(user_id,client_id));
'''


class Fault(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Lab:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as con:
            con.executescript(SCHEMA)

    @contextmanager
    def db(self):
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA foreign_keys=ON')
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    def bootstrap(self, fixture):
        """仅供测试/本地离线初始化；不是 HTTP 注册或登录接口。"""
        credentials = {}
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            for uid in ('A', 'B', 'C'):
                c.execute('INSERT INTO users VALUES (?)', (uid,))
                token = secrets.token_urlsafe(32)
                credentials[uid] = token
                c.execute('INSERT INTO sessions VALUES (?,?,?)',
                          (self.digest(token), uid, int(time.time()) + 3600))
                for prefix in ('personal', 'assistant'):
                    sid = prefix + ':' + uid
                    c.execute('INSERT INTO spaces VALUES (?,?)', (sid, prefix))
                    c.execute('INSERT INTO members(space_id,user_id) VALUES (?,?)', (sid, uid))
            c.execute("INSERT INTO spaces VALUES ('shared','shared')")
            c.executemany("INSERT INTO members(space_id,user_id) VALUES ('shared',?)", [('A',), ('B',)])
            for r in fixture:
                scope = r['scope'] if r['scope'] not in ('A', 'B') else 'personal:' + r['scope']
                c.execute('INSERT INTO messages(id,space_id,sender,body) VALUES (?,?,?,?)',
                          (r['id'], scope, r['speaker'], r['text']))
                # 复制原文作为检索条目，不冒充 AI 摘要。
                mid = 'memory:' + r['id']
                c.execute('INSERT INTO memories(id,space_id,body) VALUES (?,?,?)', (mid, scope, r['text']))
                c.execute('INSERT INTO sources VALUES (?,?,1)', (mid, r['id']))
                c.execute('INSERT INTO search_index VALUES (?,?)', (mid, r['text']))
            c.execute('INSERT INTO gifts VALUES (?,?,?,?,?,1)',
                      ('gift01', 'A', 'B', 'a07', '旅行片段：西湖边的桂花香很难忘。'))
        return credentials

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    @staticmethod
    def permitted(c, uid, sid):
        return c.execute('SELECT 1 FROM members WHERE user_id=? AND space_id=? AND active=1', (uid, sid)).fetchone() is not None

    def authenticate(self, c, token):
        row = c.execute('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',
                        (self.digest(token), int(time.time()))).fetchone()
        if not row:
            raise Fault(401, '需要有效实验凭证')
        return row['user_id']

    def get_message(self, c, uid, mid):
        row = c.execute('SELECT id,space_id,sender,body,version FROM messages WHERE id=? AND deleted=0', (mid,)).fetchone()
        if not row or not self.permitted(c, uid, row['space_id']):
            raise Fault(404, '记录不可用')
        return dict(row)

    def dispatch(self, token, method, path, data):
        with self.db() as c:
            # 单事务内身份、权限和操作保持一致。此原型以串行写事务换取简单一致性。
            c.execute('BEGIN IMMEDIATE')
            uid = self.authenticate(c, token)
            if method == 'GET' and path == '/v1/me':
                return {'user_id': uid}
            if path.startswith('/v1/messages/'):
                mid = path[len('/v1/messages/'):]
                row = self.get_message(c, uid, mid)
                if method == 'GET':
                    return row
                if method == 'DELETE':
                    if row['sender'] != uid:
                        raise Fault(403, '只能删除自己发送的记录')
                    ids = [r[0] for r in c.execute('SELECT memory_id FROM sources WHERE message_id=?', (mid,))]
                    for memory_id in ids:
                        c.execute('UPDATE memories SET valid=0,body=? WHERE id=?', ('', memory_id))
                        c.execute('DELETE FROM search_index WHERE memory_id=?', (memory_id,))
                    c.execute('UPDATE messages SET deleted=1,body=?,version=version+1 WHERE id=?', ('', mid))
                    c.execute('UPDATE gifts SET active=0,excerpt=? WHERE source_id=?', ('', mid))
                    c.execute("UPDATE jobs SET state='cancelled' WHERE source_id=? AND state='queued'", (mid,))
                    return {'deleted': mid, 'invalidated_memories': len(ids)}
            if method == 'POST' and path == '/v1/messages':
                if any(k in data for k in ('sender', 'user_id', 'owner')):
                    raise Fault(400, '身份由凭证确定')
                sid, body, client_id = data.get('space_id'), data.get('text'), data.get('client_id')
                if not isinstance(body, str) or not 0 < len(body) <= 10000 or not isinstance(client_id, str) or not 0 < len(client_id) <= 128:
                    raise Fault(400, '消息与 client_id 必须有效')
                if not self.permitted(c, uid, sid):
                    raise Fault(404, '空间不可用')
                fingerprint = self.digest(json.dumps([sid, body], ensure_ascii=False))
                receipt = c.execute('SELECT * FROM receipts WHERE user_id=? AND client_id=?', (uid, client_id)).fetchone()
                if receipt:
                    if receipt['payload_hash'] != fingerprint:
                        raise Fault(409, '重试标识对应的内容不同')
                    return {'message_id': receipt['message_id'], 'duplicate': True}
                mid = secrets.token_hex(12)
                c.execute('INSERT INTO messages(id,space_id,sender,body) VALUES (?,?,?,?)', (mid, sid, uid, body))
                c.execute('INSERT INTO receipts VALUES (?,?,?,?)', (uid, client_id, mid, fingerprint))
                c.execute('INSERT INTO jobs VALUES (?,?,1,?)', ('job:' + mid, mid, 'queued'))
                return {'message_id': mid, 'duplicate': False}
            if method == 'POST' and path == '/v1/search':
                context, query = data.get('context'), data.get('query')
                if context not in ('personal', 'shared', 'assistant') or not isinstance(query, str) or not 0 < len(query) <= 200:
                    raise Fault(400, '需要有效 context 与 query')
                if context == 'shared':
                    scopes = ['shared'] if self.permitted(c, uid, 'shared') else []
                elif context == 'personal':
                    scopes = ['personal:' + uid]
                else:
                    scopes = ['personal:' + uid, 'assistant:' + uid]
                    if self.permitted(c, uid, 'shared'):
                        scopes.append('shared')
                rows = []
                # SQL 参数绑定；关键词只参与内容匹配，无法改变范围。
                for sid in scopes:
                    if not self.permitted(c, uid, sid):
                        continue
                    for r in c.execute('SELECT m.id,m.space_id,m.body FROM memories m JOIN search_index i ON i.memory_id=m.id WHERE m.valid=1 AND m.space_id=? AND instr(i.text,?)>0', (sid, query)):
                        sources = c.execute('SELECT s.message_id FROM sources s JOIN messages x ON x.id=s.message_id WHERE s.memory_id=? AND x.deleted=0 AND x.version=s.source_version AND x.space_id=?', (r['id'], sid)).fetchall()
                        total = c.execute('SELECT COUNT(*) FROM sources WHERE memory_id=?', (r['id'],)).fetchone()[0]
                        if sources and len(sources) == total:
                            rows.append(dict(r, source_ids=[s[0] for s in sources]))
                return {'context': context, 'results': rows, 'mode': 'literal_keyword_no_ai'}
            if path == '/v1/gifts/gift01':
                gift = c.execute('SELECT * FROM gifts WHERE id=?', ('gift01',)).fetchone()
                if not gift or uid not in (gift['owner'], gift['recipient']):
                    raise Fault(404, '礼物不可用')
                if method == 'DELETE':
                    if uid != gift['owner']:
                        raise Fault(403, '只有发送者可撤销')
                    c.execute('UPDATE gifts SET active=0 WHERE id=?', ('gift01',))
                    return {'revoked': True}
                if method == 'GET':
                    source = c.execute('SELECT deleted FROM messages WHERE id=?', (gift['source_id'],)).fetchone()
                    if not gift['active'] or not source or source['deleted']:
                        raise Fault(404, '礼物不可用')
                    return {'id': 'gift01', 'excerpt': gift['excerpt'], 'access': 'selected_excerpt_only'}
            raise Fault(404, '接口不存在')

    def process_job(self, job_id):
        """离线 Worker 实验：在写入时再次检查来源及版本，不经过公开接口。"""
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            job = c.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not job or job['state'] != 'queued':
                return False
            r = c.execute('SELECT * FROM messages WHERE id=?', (job['source_id'],)).fetchone()
            if not r or r['deleted'] or r['version'] != job['source_version']:
                c.execute("UPDATE jobs SET state='cancelled' WHERE id=?", (job_id,))
                return False
            mid = 'memory:' + r['id']
            c.execute('INSERT INTO memories(id,space_id,body) VALUES (?,?,?)', (mid, r['space_id'], r['body']))
            c.execute('INSERT INTO sources VALUES (?,?,?)', (mid, r['id'], r['version']))
            c.execute('INSERT INTO search_index VALUES (?,?)', (mid, r['body']))
            c.execute("UPDATE jobs SET state='done' WHERE id=?", (job_id,))
            return True

    def __call__(self, environ, start_response):
        status = 200
        try:
            auth = environ.get('HTTP_AUTHORIZATION', '')
            if not auth.startswith('Bearer '):
                raise Fault(401, '需要有效实验凭证')
            try:
                size = int(environ.get('CONTENT_LENGTH') or 0)
            except ValueError:
                raise Fault(400, '请求长度无效')
            if size < 0 or size > 32768:
                raise Fault(413, '请求过大')
            raw = environ['wsgi.input'].read(size) if size else b'{}'
            try:
                data = json.loads(raw)
            except (ValueError, UnicodeError):
                raise Fault(400, 'JSON 无效')
            if not isinstance(data, dict):
                raise Fault(400, '需要 JSON 对象')
            result = self.dispatch(auth[7:], environ.get('REQUEST_METHOD'), environ.get('PATH_INFO'), data)
        except Fault as exc:
            status, result = exc.status, {'error': exc.message}
        except Exception:
            status, result = 500, {'error': '内部错误'}
        body = json.dumps(result, ensure_ascii=False).encode()
        reasons = {200:'OK',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',409:'Conflict',413:'Payload Too Large',500:'Internal Server Error'}
        start_response(str(status)+' '+reasons[status], [('Content-Type','application/json; charset=utf-8'),('Content-Length',str(len(body))),('Cache-Control','no-store')])
        return [body]
