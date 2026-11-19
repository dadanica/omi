import io
import json
from pathlib import Path
import tempfile
import unittest
from wsgiref.util import setup_testing_defaults
from app import Prototype, Web


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.lab=Prototype(Path(self.temp.name)/'preview.sqlite')
        self.web=Web(self.lab)
        self.cookie=''

    def tearDown(self):
        self.temp.cleanup()

    def request(self,path,method='GET',data=None,origin='http://127.0.0.1:8879',host='127.0.0.1:8879',cookie=None):
        env={};setup_testing_defaults(env)
        raw=json.dumps(data or {}).encode()
        env.update(PATH_INFO=path,REQUEST_METHOD=method,HTTP_HOST=host,HTTP_ORIGIN=origin,HTTP_X_MEOW_PREVIEW='1',HTTP_COOKIE=self.cookie if cookie is None else cookie,CONTENT_LENGTH=str(len(raw)),**{'wsgi.input':io.BytesIO(raw)})
        meta={}
        def start(status,headers):
            meta.update(code=int(status.split()[0]),headers=dict(headers))
        body=b''.join(self.web(env,start))
        if meta['headers'].get('Content-Type','').startswith('application/json'):
            body=json.loads(body)
        return meta,body

    def login(self,user):
        meta,body=self.request('/demo/session','POST',{'user':user})
        self.assertEqual(meta['code'],200)
        self.cookie=meta['headers']['Set-Cookie'].split(';')[0]
        return meta

    def test_static_home(self):
        meta,body=self.request('/')
        self.assertEqual(meta['code'],200)
        for entry in ['共同聊天','我的个人空间','与咪单独聊聊']:
            self.assertIn(entry,body.decode())
        self.assertIn('Content-Security-Policy',meta['headers'])

    def test_assets(self):
        for path in ['/app.js','/style.css','/assets/animals.png']:
            meta,body=self.request(path)
            self.assertEqual(meta['code'],200,path)
            self.assertGreater(len(body),100)

    def test_traversal(self):
        self.assertEqual(self.request('/../app.py')[0]['code'],404)
        self.assertEqual(self.request('/%2e%2e/app.py')[0]['code'],404)

    def test_rebinding_rejected(self):
        self.assertEqual(self.request('/',host='evil.example')[0]['code'],403)

    def test_cross_origin_write_rejected(self):
        self.assertEqual(self.request('/demo/session','POST',{'user':'A'},origin='https://evil.example')[0]['code'],403)

    def test_no_session_denied(self):
        self.assertEqual(self.request('/v1/conversation/personal')[0]['code'],401)

    def test_cookie_not_exposed_in_body(self):
        meta=self.login('A')
        self.assertIn('HttpOnly',meta['headers']['Set-Cookie'])
        self.assertIn('SameSite=Strict',meta['headers']['Set-Cookie'])
        self.assertEqual(self.request('/v1/me')[1],{'user_id':'A'})

    def test_three_conversations(self):
        self.login('A')
        for kind in ['personal','shared','assistant']:
            meta,body=self.request('/v1/conversation/'+kind)
            self.assertEqual(meta['code'],200)
            self.assertTrue(body['messages'])

    def test_switch_identity_has_no_personal_overlap(self):
        self.login('A'); a=self.request('/v1/conversation/personal')[1]['messages']
        self.login('B'); b=self.request('/v1/conversation/personal')[1]['messages']
        self.assertTrue(a and b)
        self.assertFalse(set(r['id'] for r in a)&set(r['id'] for r in b))
        self.assertEqual(self.request('/v1/messages/a09')[0]['code'],404)

    def test_shared_history_same_for_both(self):
        self.login('A');a=self.request('/v1/conversation/shared')[1]['messages']
        self.login('B');b=self.request('/v1/conversation/shared')[1]['messages']
        self.assertEqual(a,b)

    def test_send_index_source_delete(self):
        self.login('A')
        meta,body=self.request('/v1/messages','POST',{'space_id':'personal:A','text':'测试：今天看到一棵银杏树。','client_id':'preview-test'})
        self.assertEqual(meta['code'],200)
        mid=body['message_id']
        rows=self.request('/v1/memories/personal')[1]['memories']
        self.assertTrue(any(r['message_id']==mid for r in rows))
        self.assertIn('银杏',self.request('/v1/messages/'+mid)[1]['body'])
        self.assertEqual(self.request('/v1/messages/'+mid,'DELETE')[0]['code'],200)
        self.assertFalse(any(r['message_id']==mid for r in self.request('/v1/memories/personal')[1]['memories']))

    def test_private_question_has_no_fake_ai_reply(self):
        self.login('A')
        self.request('/v1/messages','POST',{'space_id':'assistant:A','text':'我为什么想换工作？','client_id':'question'})
        rows=self.request('/v1/conversation/assistant')[1]['messages']
        self.assertEqual(rows[-1]['body'],'我为什么想换工作？')
        self.assertTrue(all(r['sender']=='A' for r in rows))
        self.login('B')
        self.assertEqual(self.request('/v1/conversation/assistant')[1]['messages'],[])

    def test_group_mention_no_private_context(self):
        self.login('A')
        self.request('/v1/messages','POST',{'space_id':'shared','text':'@咪 回顾工作','client_id':'mention'})
        rows=self.request('/v1/search','POST',{'context':'shared','query':'工作'})[1]['results']
        self.assertTrue(rows)
        self.assertTrue(all(r['space_id']=='shared' for r in rows))

    def test_restart_keeps_written_message(self):
        self.login('A')
        mid=self.request('/v1/messages','POST',{'space_id':'personal:A','text':'重启仍在','client_id':'restart'})[1]['message_id']
        self.web=Web(Prototype(self.lab.path))
        self.assertEqual(self.request('/v1/messages/'+mid)[1]['body'],'重启仍在')


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PreviewTests))
    Path(__file__).with_name('test-results.json').write_text(json.dumps({'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'passed':result.wasSuccessful(),'method':'真实 WSGI 应用与独立 SQLite 数据库，不依赖网络','browser_qa':'未完成：浏览器访问本机预览的权限未获批准'},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
