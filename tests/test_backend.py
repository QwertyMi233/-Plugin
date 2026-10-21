import copy
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'backend' / 'server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

def payload():
    return {'requestId': 'test-request', 'notes': '', 'courseTitle': '测试课程', 'questions': [
        {'id': 'question12817', 'type': 'judge', 'stem': '一加一等于二。', 'options': [{'label': '正确', 'text': '正确'}, {'label': '错误', 'text': '错误'}]}]}

def result():
    return {'answers': [{'id': 'question12817', 'selected': ['正确'], 'reason': '基本算术'}]}

class ValidationTests(unittest.TestCase):
    def test_valid_mapping(self):
        data=payload()
        self.assertEqual(bridge.validate_questions(data), data['questions'])
        self.assertEqual(bridge.validate_answers(result(), data['questions']), result()['answers'])

    def test_duplicate_and_invalid_questions(self):
        data=payload();data['questions']*=2
        with self.assertRaises(ValueError): bridge.validate_questions(data)
        data=payload();data['questions'][0]['options'][1]['label']='正确'
        with self.assertRaises(ValueError): bridge.validate_questions(data)

    def test_reject_missing_unknown_multiple_empty_answers(self):
        for answers in ([], [{'id': 'unknown', 'selected': ['正确'], 'reason': ''}],
                        [{'id': 'question12817', 'selected': [], 'reason': ''}],
                        [{'id': 'question12817', 'selected': ['A'], 'reason': ''}],
                        [{'id': 'question12817', 'selected': ['正确','错误'], 'reason': ''}], result()['answers']*2):
            with self.subTest(answers=answers),self.assertRaises(ValueError):
                bridge.validate_answers({'answers': answers},payload()['questions'])

    def test_job_deduplication(self):
        calls=[]
        def fake(*args):calls.append(args);return result()
        service=bridge.Service('test-token','fake-api-key',provider=fake)
        try:
            first=service.submit(payload());second=service.submit(payload())
            service.pool.shutdown(wait=True)
            self.assertEqual(first,second);self.assertEqual(len(calls),1);self.assertEqual(service.jobs[first]['status'],'done')
        finally: service.pool.shutdown(wait=True)

    def test_error_redacts_api_key(self):
        def bad(*args):raise RuntimeError('failed with fake-private-api-key')
        service=bridge.Service('test-token','fake-private-api-key',provider=bad)
        jid=service.submit(payload());service.pool.shutdown(wait=True)
        self.assertEqual(service.jobs[jid]['status'],'error');self.assertNotIn('fake-private-api-key',service.jobs[jid]['error'])

    def test_requires_configuration(self):
        service=bridge.Service('test-token')
        try:
            with self.assertRaises(ValueError):service.submit(payload())
        finally:service.pool.shutdown(wait=True)

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=bridge.ThreadingHTTPServer(('127.0.0.1',0),bridge.Handler)
        cls.server.service=bridge.Service('test-bridge-token','fake-api-key',provider=lambda *args:result())
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.server.service.pool.shutdown(wait=True)

    def req(self,path,token=None,origin=None,data=None,host=None):
        headers={}
        if token:headers['Authorization']='Bearer '+token
        if origin:headers['Origin']=origin
        if host:headers['Host']=host
        request=urllib.request.Request(self.base+path,headers=headers,data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.urlopen(request) as response:return response.status,response.read(),dict(response.headers)
        except urllib.error.HTTPError as error:return error.code,error.read(),dict(error.headers)

    def test_protected_health(self):
        self.assertEqual(self.req('/health')[0],401)
        self.assertEqual(self.req('/health',token='wrong')[0],401)
        status,body,_=self.req('/health',token='test-bridge-token')
        self.assertEqual(status,200);self.assertTrue(json.loads(body)['configured']);self.assertNotIn(b'fake-api-key',body)

    def test_origin_and_host_guards(self):
        self.assertEqual(self.req('/health',token='test-bridge-token',origin='https://evil.example')[0],403)
        self.assertEqual(self.req('/health',token='test-bridge-token',host='evil.example')[0],403)
        origin='chrome-extension://'+'a'*32
        status,_,headers=self.req('/health',token='test-bridge-token',origin=origin)
        self.assertEqual(status,200);self.assertEqual(headers['Access-Control-Allow-Origin'],origin)

    def test_local_config_csp(self):
        status,body,headers=self.req('/')
        self.assertEqual(status,200);self.assertIn(b'config.js',body);self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])

    def test_async_job_roundtrip(self):
        status,body,_=self.req('/jobs',token='test-bridge-token',data=payload())
        self.assertEqual(status,202);jid=json.loads(body)['id']
        self.server.service.pool.submit(lambda:None).result(timeout=2)
        for _ in range(100):
            status,body,_=self.req('/jobs/'+jid,token='test-bridge-token');job=json.loads(body)
            if job['status']!='pending':break
            time.sleep(.01)
        self.assertEqual(job['status'],'done');self.assertEqual(job['answers'],result()['answers'])

if __name__=='__main__':unittest.main(verbosity=2)
