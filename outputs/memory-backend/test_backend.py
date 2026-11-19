import io
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from wsgiref.util import setup_testing_defaults
from server import Lab


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'lab.sqlite'
        self.app = Lab(self.path)
        self.tokens = self.app.bootstrap(json.loads(Path(__file__).with_name('fixture.json').read_text()))

    def tearDown(self):
        self.temp.cleanup()

    def request(self, user, method, path, data=None, token=None, app=None):
        env = {}
        setup_testing_defaults(env)
        raw = json.dumps(data if data is not None else {}).encode()
        env.update(REQUEST_METHOD=method, PATH_INFO=path, CONTENT_LENGTH=str(len(raw)), **{'wsgi.input':io.BytesIO(raw)})
        if user is not None:
            env['HTTP_AUTHORIZATION']='Bearer '+(token if token is not None else self.tokens[user])
        meta={}
        def start(status, headers):
            meta.update(code=int(status.split()[0]),headers=dict(headers))
        body=b''.join((app or self.app)(env,start))
        return meta['code'],json.loads(body)

    def search(self,user,context,query):
        code, body=self.request(user,'POST','/v1/search',{'context':context,'query':query})
        self.assertEqual(code,200)
        return body['results']

    def test_01_missing_token(self):
        self.assertEqual(self.request(None,'GET','/v1/messages/s01')[0],401)

    def test_02_forged_token(self):
        self.assertEqual(self.request('A','GET','/v1/me',token='A')[0],401)

    def test_03_identity_from_token(self):
        self.assertEqual(self.request('B','GET','/v1/me',{'user_id':'A'})[1],{'user_id':'B'})

    def test_04_expired_token(self):
        with self.app.db() as c:
            c.execute('UPDATE sessions SET expires_at=0 WHERE user_id=?',('A',))
        self.assertEqual(self.request('A','GET','/v1/me')[0],401)

    def test_05_revoked_session(self):
        with self.app.db() as c:
            c.execute("DELETE FROM sessions WHERE user_id='A'")
        self.assertEqual(self.request('A','GET','/v1/me')[0],401)

    def test_06_private_ownership(self):
        self.assertEqual(self.request('A','GET','/v1/messages/a03')[0],200)
        self.assertEqual(self.request('B','GET','/v1/messages/a03')[0],404)
        self.assertEqual(self.request('A','GET','/v1/messages/b01')[0],404)

    def test_07_assistant_is_private(self):
        self.assertEqual(self.request('A','GET','/v1/messages/p01')[0],200)
        self.assertEqual(self.request('B','GET','/v1/messages/p01')[0],404)

    def test_08_nonmember_shared(self):
        self.assertEqual(self.request('C','GET','/v1/messages/s01')[0],404)
        self.assertEqual(self.search('C','shared','搬家'),[])

    def test_09_membership_revocation(self):
        with self.app.db() as c:
            c.execute("UPDATE members SET active=0 WHERE user_id='A' AND space_id='shared'")
        self.assertEqual(self.request('A','GET','/v1/messages/s01')[0],404)
        self.assertEqual(self.search('A','assistant','搬家'),[])

    def test_10_shared_search_excludes_private(self):
        self.assertEqual(self.search('A','shared','工作'),[])
        self.assertTrue(self.search('A','assistant','换工作'))

    def test_11_search_cannot_choose_other_user(self):
        code,result=self.request('A','POST','/v1/search',{'context':'assistant','query':'工作','user_id':'B','space_id':'personal:B'})
        self.assertEqual(code,200)
        self.assertTrue(result['results'])
        self.assertTrue(all(x['space_id']!='personal:B' for x in result['results']))

    def test_12_unknown_query(self):
        self.assertEqual(self.search('A','assistant','冰岛'),[])

    def test_13_query_is_data_not_sql(self):
        self.assertEqual(self.search('A','assistant',"' OR 1=1 --"),[])
        self.assertEqual(self.request('A','GET','/v1/me')[0],200)

    def test_14_gift_excerpt_only(self):
        code,body=self.request('B','GET','/v1/gifts/gift01')
        self.assertEqual(code,200)
        self.assertEqual(body['excerpt'],'旅行片段：西湖边的桂花香很难忘。')
        self.assertNotIn('焦虑',json.dumps(body,ensure_ascii=False))
        self.assertEqual(self.request('B','GET','/v1/messages/a07')[0],404)

    def test_15_gift_revoke_owner_only(self):
        self.assertEqual(self.request('B','DELETE','/v1/gifts/gift01')[0],403)
        self.assertEqual(self.request('C','GET','/v1/gifts/gift01')[0],404)
        self.assertEqual(self.request('A','DELETE','/v1/gifts/gift01')[0],200)
        self.assertEqual(self.request('B','GET','/v1/gifts/gift01')[0],404)

    def test_16_gift_revoke_survives_new_instance(self):
        self.request('A','DELETE','/v1/gifts/gift01')
        self.assertEqual(self.request('B','GET','/v1/gifts/gift01',app=Lab(self.path))[0],404)

    def test_17_delete_owner_only(self):
        self.assertEqual(self.request('B','DELETE','/v1/messages/a03')[0],404)
        self.assertEqual(self.request('B','DELETE','/v1/messages/s01')[0],403)
        self.assertEqual(self.request('A','GET','/v1/messages/a03')[0],200)

    def test_18_delete_invalidates_source_memory_and_index(self):
        self.request('A','DELETE','/v1/messages/a03')
        self.assertEqual(self.request('A','GET','/v1/messages/a03')[0],404)
        self.assertFalse(any('a03' in x['source_ids'] for x in self.search('A','assistant','工作')))
        with self.app.db() as c:
            self.assertEqual(c.execute("SELECT body FROM messages WHERE id='a03'").fetchone()[0],'')
            self.assertEqual(c.execute("SELECT valid FROM memories WHERE id='memory:a03'").fetchone()[0],0)
            self.assertIsNone(c.execute("SELECT 1 FROM search_index WHERE memory_id='memory:a03'").fetchone())

    def test_19_delete_invalidates_gift(self):
        self.request('A','DELETE','/v1/messages/a07')
        self.assertEqual(self.request('B','GET','/v1/gifts/gift01')[0],404)

    def send(self, client_id='one', text='独有的测试记录'):
        return self.request('A','POST','/v1/messages',{'space_id':'personal:A','text':text,'client_id':client_id})

    def test_20_sender_cannot_be_forged(self):
        self.assertEqual(self.request('A','POST','/v1/messages',{'space_id':'shared','sender':'B','text':'x','client_id':'x'})[0],400)

    def test_21_cannot_write_other_space(self):
        self.assertEqual(self.request('A','POST','/v1/messages',{'space_id':'personal:B','text':'x','client_id':'x'})[0],404)

    def test_22_retry_is_idempotent(self):
        one=self.send()[1];two=self.send()[1]
        self.assertEqual(one['message_id'],two['message_id'])
        self.assertTrue(two['duplicate'])
        with self.app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],1)

    def test_23_idempotency_conflict(self):
        self.send()
        self.assertEqual(self.send(text='不同内容')[0],409)

    def test_24_parallel_retries(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.send(),range(8)))
        self.assertTrue(all(x[0]==200 for x in results))
        self.assertEqual(len(set(x[1]['message_id'] for x in results)),1)
        self.assertEqual(sum(not x[1]['duplicate'] for x in results),1)

    def test_25_worker_can_finish_once(self):
        mid=self.send()[1]['message_id']
        self.assertTrue(self.app.process_job('job:'+mid))
        self.assertFalse(self.app.process_job('job:'+mid))
        self.assertEqual(len(self.search('A','personal','独有的测试记录')),1)

    def test_26_delete_before_worker(self):
        mid=self.send()[1]['message_id']
        self.request('A','DELETE','/v1/messages/'+mid)
        self.assertFalse(self.app.process_job('job:'+mid))
        self.assertEqual(self.search('A','personal','独有的测试记录'),[])

    def test_27_stale_job_version(self):
        mid=self.send()[1]['message_id']
        with self.app.db() as c:
            c.execute('UPDATE messages SET version=version+1 WHERE id=?',(mid,))
        self.assertFalse(self.app.process_job('job:'+mid))

    def test_28_delete_after_worker(self):
        mid=self.send()[1]['message_id']
        self.app.process_job('job:'+mid)
        self.request('A','DELETE','/v1/messages/'+mid)
        self.assertEqual(self.search('A','personal','独有的测试记录'),[])

    def test_29_persistent_messages(self):
        mid=self.send()[1]['message_id']
        code,body=self.request('A','GET','/v1/messages/'+mid,app=Lab(self.path))
        self.assertEqual(code,200)
        self.assertEqual(body['sender'],'A')

    def test_30_malformed_json_shape(self):
        self.assertEqual(self.request('A','POST','/v1/messages',[])[0],400)

    def test_31_cross_scope_source_is_not_retrieved(self):
        with self.app.db() as c:
            c.execute("INSERT INTO memories VALUES ('bad','shared','混入私人来源',1)")
            c.execute("INSERT INTO sources VALUES ('bad','b01',1)")
            c.execute("INSERT INTO search_index VALUES ('bad','混入私人来源')")
        self.assertEqual(self.search('A','shared','混入'),[])


if __name__=='__main__':
    class Report(unittest.TextTestResult):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs)
            self.passed=[]
        def addSuccess(self,test):
            super().addSuccess(test)
            self.passed.append(test._testMethodName)
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(BackendTests)
    result=unittest.TextTestRunner(verbosity=2,resultclass=Report).run(suite)
    report={'total':result.testsRun,'passed':len(result.passed),'tests':result.passed,
            'failures':[(str(t),e) for t,e in result.failures+result.errors],
            'transport':'WSGI 请求级集成测试，直接调用应用；未打开网络端口',
            'storage':'每项独立的真实 SQLite 临时数据库，结束后销毁',
            'not_verified':['真实 HTTP/TLS 网络服务与浏览器联调','微信登录、生产会话与部署','AI 提取、语义检索、关系建议','对象存储、向量索引、缓存、备份物理擦除','分布式队列与生产并发负载']}
    Path(__file__).with_name('test-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
