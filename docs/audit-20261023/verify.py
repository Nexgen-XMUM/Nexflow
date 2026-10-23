"""Offline repository audit. Run from the repository root; never calls an AI provider.

Writes evidence.json beside this script. All mutations use TemporaryDirectory.
Optional --http checks GET resources of the already running local demo on port 8000.
"""
import argparse
import ast
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from datetime import datetime
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ['AI_PROVIDER'] = 'local_demo'
os.environ['DEEPSEEK_API_KEY'] = ''

import httpx
from fastapi.testclient import TestClient
from backend.desktop_demo import create_demo_app
from backend.blind_boxes.pickup import LOCAL
from backend import main, ai_copy


def blocked(*args, **kwargs):
    raise AssertionError('Real HTTPX network transport is forbidden in this audit')


def run(live_http=False):
    report = {'date': datetime.now(LOCAL).isoformat(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'python': sys.version, 'checks': {}, 'probes': {}}
    checks, probes = report['checks'], report['probes']
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    python_files = [p for p in tracked if p.endswith('.py')]
    for p in python_files:
        ast.parse((ROOT / p).read_text('utf-8-sig'), filename=p)
    checks['python_syntax_files'] = len(python_files)
    json_files = [p for p in tracked if p.endswith(('.json', '.jason'))]
    for p in json_files:
        json.loads((ROOT / p).read_text('utf-8-sig'))
    checks['json_files'] = len(json_files)
    checks['dependencies'] = {p: importlib.metadata.version(p) for p in
                              ('fastapi', 'pydantic', 'starlette', 'uvicorn', 'python-dotenv', 'pytest', 'httpx')}
    with TemporaryDirectory(prefix='nexflow-audit-') as folder, \
         patch.object(httpx.HTTPTransport, 'handle_request', blocked), \
         patch.object(httpx.AsyncHTTPTransport, 'handle_async_request', blocked):
        app = create_demo_app(Path(folder) / 'audit.sqlite3')
        with TestClient(app, raise_server_exceptions=False) as client:
            def call(method, url, body=None, expected=200):
                r = client.request(method, url, **({'json': body} if body is not None else {}))
                assert r.status_code == expected, (url, r.status_code, r.text[:150])
                return r.json()

            checks['resources'] = {p: client.get(p).status_code for p in
                ('/app', '/docs', '/openapi.json', '/app/assets/integration.js',
                 '/app/assets/integration.css', '/app/assets/rescue-module.js', '/app/assets/rescue-module.css')}
            assert all(v == 200 for v in checks['resources'].values())
            checks['static_protection'] = {p: client.get(p).status_code for p in
                ('/app/assets/.env', '/backend/.env', '/data/users.json')}
            assert all(v == 404 for v in checks['static_protection'].values())
            checks['redirects'] = {p: client.get(p, follow_redirects=False).headers.get('location') for p in
                                  ('/app/', '/app/rescue', '/app/customer')}
            session = call('GET', '/api/demo/session')
            day = session['now'][:10]
            payload = [{'item': 'croissant', 'qty': 10}]
            promo = call('POST', '/api/generate-promo', payload)
            assert promo['totals']['clearance_total'] == '30.00'
            assert promo['totals']['estimated_co2e_kg'] == '2'
            assert promo['promo']['source'] == 'local_demo'
            checks['promo'] = promo
            checks['bad_quantity'] = call('POST', '/api/generate-promo', [{'item':'croissant','qty':True}], 422)
            checks['overstock'] = call('POST', '/api/generate-promo', [{'item':'croissant','qty':999}], 422)
            checks['registration'] = call('POST', '/api/demo/leftovers', payload)
            call('POST', '/api/demo/leftovers', payload)
            inv = call('GET', '/api/blind-boxes/inventory')
            assert sum(b['on_hand'] for b in inv['batches']) == 10
            calc = {'pickup_start':f'{day}T21:30:00+08:00','pickup_end':f'{day}T22:00:00+08:00'}
            plan = call('POST', '/api/blind-boxes/calculate', calc)
            assert plan['status'] == 'OPTIONS'
            checks['calculate_options'] = len(plan['options'])
            checks['allergen_fallback'] = call('POST', '/api/blind-boxes/calculate',
                                               {**calc,'preferences':{'avoid_allergens':['wheat']}})['status']
            broken = Path(folder) / 'broken-charities.json'
            for name, content in [('invalid_json','{'), ('wrong_shape','[]')]:
                broken.write_text(content, encoding='utf-8')
                with patch.dict(os.environ, {'CHARITIES_PATH':str(broken)}):
                    r = client.post('/api/blind-boxes/calculate', json=calc)
                    probes['charities_' + name] = {'http':r.status_code,'body':r.text[:120]}
            reversed_slot = {**calc, 'pickup_start':f'{day}T22:30:00+08:00',
                             'pickup_end':f'{day}T21:30:00+08:00'}
            r = client.post('/api/blind-boxes/calculate', json=reversed_slot)
            probes['reversed_calculator_slot'] = {'http':r.status_code,'status':r.json().get('status')}
            order = call('POST', '/api/blind-boxes/orders', {**calc,'user_id':'audit_user',
                                                           'idempotency_key':'audit-order-001'})
            picked = call('POST', '/api/blind-boxes/pickup', {'order_id':order['order_id']})
            call('POST', '/api/blind-boxes/pickup', {'order_id':order['order_id']})
            assert picked['status'] == 'PICKED_UP'
            checks['purchase_pickup_api'] = {'status':picked['status'],'qty':picked['qty'],
                                           'price_sen':picked['price_sen']}
            call('POST', '/api/demo/close', {})
            ds = call('GET', '/api/blind-boxes/donations')['donations']
            assert len(ds) == 1
            r = client.post('/api/blind-boxes/donations/handoff',
                            json={'donation_id':ds[0]['id'],'recipient':'   '})
            probes['blank_recipient'] = {'http':r.status_code,'recipient':r.json().get('recipient')}
            if r.status_code != 200:
                call('POST', '/api/blind-boxes/donations/handoff',
                     {'donation_id':ds[0]['id'],'recipient':'Audit demo recipient'})
            board = call('GET', '/api/blind-boxes/dashboard')
            assert board['picked_up_qty'] + board['donated_qty'] == 10
            assert board['estimated_co2e_kg'] == 2
            checks['final_dashboard'] = board
            old_inventory = main.INVENTORY_PATH
            bad_inventory = Path(folder) / 'inventory.json'
            bad_inventory.write_text('{', encoding='utf-8')
            with patch.object(main, 'INVENTORY_PATH', bad_inventory):
                checks['invalid_inventory'] = call('GET','/api/inventory', expected=503)
            # These mocked responses independently probe semantic claims, with zero network traffic.
            async def fake_post(self, url, **kwargs):
                return httpx.Response(200, request=httpx.Request('POST',url), json={
                    'choices':[{'finish_reason':'stop','message':{'content':json.dumps({
                        'opening':'Jom lah, doorstep service!', 'closing':'Enjoy a gift! 😊'})}}]})
            with patch.dict(os.environ, {'DEEPSEEK_API_KEY':'audit-fake-key'}), \
                 patch.object(httpx.AsyncClient,'post',fake_post):
                try:
                    lines = ai_copy.deepseek_lines([])
                    probes['unsupported_claim_synonyms'] = {'accepted':True, **lines.model_dump()}
                except ai_copy.CopyUnavailable as exc:
                    probes['unsupported_claim_synonyms'] = {'accepted':False,'reason':str(exc)}
            inventory = json.loads(old_inventory.read_text('utf-8'))
            inventory['products'][0]['name'] = ' '.join(['VeryLongName'] * 60)
            long_inventory = Path(folder) / 'long-inventory.json'
            long_inventory.write_text(json.dumps(inventory), encoding='utf-8')
            with patch.object(main, 'INVENTORY_PATH', long_inventory):
                long_promo = call('POST','/api/generate-promo',payload)
                probes['long_catalogue_name'] = {'word_count':len(long_promo['promo']['text'].split()),
                                                 'source':long_promo['promo']['source']}
        with patch.dict(os.environ, {'BLIND_BOX_DB_PATH':str(Path(folder) / 'normal.sqlite3')}):
            with TestClient(main.create_app()) as normal:
                checks['normal_app'] = {p:normal.get(p).status_code for p in
                    ('/app','/api/inventory','/api/blind-boxes/dashboard','/api/demo/session')}
                assert checks['normal_app'] == {'/app':200,'/api/inventory':200,
                    '/api/blind-boxes/dashboard':200,'/api/demo/session':404}
    if live_http:
        # Fixed local destination, read-only; no provider URLs or secrets involved.
        checks['real_http'] = {}
        for p in ('/app','/docs','/openapi.json','/api/products','/api/inventory',
                  '/api/demo/session','/app/assets/integration.js','/app/assets/rescue-module.js'):
            with urlopen('http://127.0.0.1:8000' + p, timeout=10) as r:
                checks['real_http'][p] = {'status':r.status,'bytes':len(r.read())}
        with urlopen('http://127.0.0.1:8000/api/demo/session', timeout=10) as r:
            session = json.load(r)
        # Mutate only a fresh temporary demo session explicitly started for this audit.
        if not session.get('temporary_database') or session.get('leftovers_registered'):
            checks['real_http_donation_flow'] = 'Skipped: demo session is not fresh'
        else:
            def http_call(path, body=None):
                request = Request('http://127.0.0.1:8000' + path,
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={'Content-Type':'application/json'})
                with urlopen(request,timeout=10) as r:
                    return json.load(r)
            promo = http_call('/api/generate-promo',[{'item':'croissant','qty':10}])
            assert promo['promo']['source'] == 'local_demo'
            http_call('/api/demo/leftovers',[{'item':'croissant','qty':10}])
            http_call('/api/demo/close',{})
            ds = http_call('/api/blind-boxes/donations')['donations']
            assert len(ds) == 1
            for _ in range(2):
                http_call('/api/blind-boxes/donations/handoff',
                    {'donation_id':ds[0]['id'],'recipient':'Audit synthetic recipient'})
            board = http_call('/api/blind-boxes/dashboard')
            assert board['donated_qty'] == 10 and board['estimated_co2e_kg'] == 2
            assert board['picked_up_qty'] == 0 and board['simulated_revenue_sen'] == 0
            checks['real_http_donation_flow'] = board
    target = Path(__file__).with_name('evidence.json')
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'evidence':str(target),'checks':list(checks),'probes':probes},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--http', action='store_true')
    run(parser.parse_args().http)
