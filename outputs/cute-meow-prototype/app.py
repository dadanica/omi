"""Local, fictional-account UI preview for 可爱咪. No model calls."""
import argparse
import json
import mimetypes
import secrets
import sqlite3
import sys
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import unquote
from wsgiref.simple_server import make_server, WSGIRequestHandler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'memory-backend'))
from server import Lab, Fault


class Prototype(Lab):
    def __init__(self, db_path):
        super().__init__(db_path)
        with self.db() as c:
            exists = c.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        if not exists:
            fixture = json.loads((HERE.parent/'memory-backend/fixture.json').read_text())
            fixture += [
                {'id':'s10','scope':'shared','speaker':'B','text':'今天路过那家小书店，门口的猫又在晒太阳。下次一起去吧。','date':'2026-11-10','topics':['生活']},
                {'id':'s11','scope':'shared','speaker':'A','text':'好呀。也想和你慢慢走一段路，不赶时间的那种。','date':'2026-11-10','topics':['生活']},
                {'id':'a09','scope':'A','speaker':'A','text':'今天的小发现：留一点空白，反而更能听见自己在想什么。','date':'2026-11-10','topics':['灵感']}
            ]
            self.bootstrap(fixture)
        else:
            fixture = json.loads((HERE.parent/'memory-backend/fixture.json').read_text())
        with self.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS message_meta(id TEXT PRIMARY KEY REFERENCES messages(id),created_at TEXT NOT NULL,tags TEXT NOT NULL)')
            for r in fixture:
                if c.execute('SELECT 1 FROM messages WHERE id=?',(r['id'],)).fetchone():
                    c.execute('INSERT OR IGNORE INTO message_meta VALUES (?,?,?)',(r['id'],r['date']+'T10:00:00+08:00',json.dumps(r.get('topics',[]),ensure_ascii=False)))
            c.execute("INSERT OR IGNORE INTO message_meta SELECT id,'2026-11-10T10:00:00+08:00','[]' FROM messages")

    def demo_session(self, uid):
        if uid not in ('A','B'):
            raise Fault(400,'仅支持两个虚构体验账号')
        token = secrets.token_urlsafe(32)
        with self.db() as c:
            c.execute('DELETE FROM sessions WHERE expires_at<=?',(int(time.time()),))
            c.execute('INSERT INTO sessions VALUES (?,?,?)',(self.digest(token),uid,int(time.time())+86400))
        return token

    def dispatch(self, token, method, path, data):
        if method == 'POST' and path == '/v1/messages':
            result = super().dispatch(token, method, path, data)
            mid = result['message_id']
            with self.db() as c:
                c.execute('INSERT OR IGNORE INTO message_meta VALUES (?,?,?)',(mid,time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'["随手记"]'))
            self.process_job('job:'+mid)
            return result
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            uid = self.authenticate(c,token)
            if method=='GET' and path=='/v1/spaces':
                return {'user':uid,'spaces':[dict(r) for r in c.execute('SELECT s.id,s.kind FROM spaces s JOIN members m ON m.space_id=s.id WHERE m.user_id=? AND m.active=1',(uid,))]}
            if method=='GET' and (path.startswith('/v1/conversation/') or path.startswith('/v1/memories/')):
                kind = path.rsplit('/',1)[1]
                if kind not in ('shared','personal','assistant'):
                    raise Fault(404,'空间不可用')
                sid = 'shared' if kind=='shared' else kind+':'+uid
                if not self.permitted(c,uid,sid):
                    raise Fault(404,'空间不可用')
                if path.startswith('/v1/conversation/'):
                    rows=c.execute('SELECT x.id,x.space_id,x.sender,x.body,t.created_at FROM messages x LEFT JOIN message_meta t ON t.id=x.id WHERE x.space_id=? AND x.deleted=0 ORDER BY t.created_at,x.rowid',(sid,)).fetchall()
                    return {'messages':[dict(r) for r in rows],'user':uid}
                rows=c.execute('SELECT m.id,m.body,s.message_id,t.created_at,t.tags FROM memories m JOIN sources s ON s.memory_id=m.id JOIN messages x ON x.id=s.message_id LEFT JOIN message_meta t ON t.id=x.id WHERE m.space_id=? AND m.valid=1 AND x.deleted=0 AND x.version=s.source_version AND x.space_id=m.space_id ORDER BY t.created_at DESC,x.rowid DESC',(sid,)).fetchall()
                return {'memories':[dict(r,tags=json.loads(r['tags'] or '[]')) for r in rows],'mode':'original_records_not_ai_summaries'}
        return super().dispatch(token,method,path,data)


class Web:
    def __init__(self, app):
        self.app=app

    @staticmethod
    def respond(start, status, body, mime='application/json; charset=utf-8',extra=()):
        if not isinstance(body,bytes):
            body=json.dumps(body,ensure_ascii=False).encode()
        start(status,[('Content-Type',mime),('Content-Length',str(len(body))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),*extra])
        return [body]

    def __call__(self,env,start):
        path=env.get('PATH_INFO','/')
        host=env.get('HTTP_HOST','')
        # Local preview only. Reject DNS rebinding and cross-origin writes.
        if host.split(':')[0] not in ('127.0.0.1','localhost'):
            return self.respond(start,'403 Forbidden',{'error':'仅限本机预览'})
        if env.get('REQUEST_METHOD') in ('POST','DELETE','PATCH'):
            if env.get('HTTP_ORIGIN')!='http://'+host or env.get('HTTP_X_MEOW_PREVIEW')!='1':
                return self.respond(start,'403 Forbidden',{'error':'请求来源不匹配'})
        if path=='/demo/session' and env.get('REQUEST_METHOD')=='POST':
            try:
                size=int(env.get('CONTENT_LENGTH') or 0)
                if not 0<size<256:
                    raise ValueError()
                data=json.loads(env['wsgi.input'].read(size))
                token=self.app.demo_session(data.get('user'))
                return self.respond(start,'200 OK',{'user':data['user'],'demo':True},extra=[('Set-Cookie','meow_demo='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400')])
            except (ValueError,AttributeError,Fault):
                return self.respond(start,'400 Bad Request',{'error':'体验账号无效'})
        if path.startswith('/v1/'):
            try:
                cookies=SimpleCookie(env.get('HTTP_COOKIE',''))
                token=cookies['meow_demo'].value if 'meow_demo' in cookies else ''
            except Exception:
                token=''
            env['HTTP_AUTHORIZATION']='Bearer '+token
            return self.app(env,start)
        if env.get('REQUEST_METHOD')!='GET':
            return self.respond(start,'405 Method Not Allowed',{'error':'不支持此方法'})
        static=HERE/'static'
        file=(static/('index.html' if path=='/' else unquote(path).lstrip('/'))).resolve()
        if static not in file.parents or not file.is_file():
            return self.respond(start,'404 Not Found',{'error':'页面不存在'})
        mime=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
        return self.respond(start,'200 OK',file.read_bytes(),mime,extra=[('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")])


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):
        pass


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--db',default=str(HERE/'runtime'/'preview.sqlite'))
    args=parser.parse_args()
    Path(args.db).parent.mkdir(parents=True,exist_ok=True)
    with make_server('127.0.0.1',args.port,Web(Prototype(args.db)),handler_class=QuietHandler) as server:
        print('可爱咪本地体验：http://127.0.0.1:'+str(args.port),flush=True)
        print('仅虚构体验账号；AI、媒体上传和微信登录未接入。',flush=True)
        server.serve_forever()
