#!/usr/bin/env python3
"""Optional real Chromium mouse/keyboard regression. All responses are local fixtures.
Run with the collector's Playwright virtualenv and PLAYWRIGHT_BROWSERS_PATH.
No server, credentials, production requests, screenshots or recording are used.
"""
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
NODES = [
    dict(id='world', name='World', kind='world', supported=True),
    dict(id='continent:North America', name='North America', kind='continent', parent='world', supported=True),
    dict(id='continent:South America', name='South America', kind='continent', parent='world', supported=True),
    dict(id='AR', name='Argentina', kind='country', parent='continent:South America', supported=False),
    dict(id='CL', name='Chile', kind='country', parent='continent:South America', supported=False),
    dict(id='CO', name='Colombia', kind='country', parent='continent:South America', supported=True, quizSupported=True),
    dict(id='EC', name='Ecuador', kind='country', parent='continent:South America', supported=False),
    dict(id='CO-CAL', name='Caldas', kind='subnational1', parent='CO', supported=True),
    dict(id='CO-MET', name='Meta', kind='subnational1', parent='CO', supported=True),
]
BY_ID = {n['id']: n for n in NODES}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for language in ['en', 'es-CO']:
        for mode in ['mouse', 'keyboard', 'retry']:
            calls = []
            failed = [False]
            context = browser.new_context(viewport=dict(width=1440, height=1000))
            context.add_init_script("localStorage.setItem('aviquiz:statistics-consent:v1','decline')")

            def respond(route):
                url = urlparse(route.request.url)
                if url.netloc != 'quiz.test':
                    route.abort()
                    return
                path = url.path
                def value(data, status=200):
                    route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
                if path == '/explore':
                    route.fulfill(path=str(ROOT / ('dist/explore.html' if language == 'en' else 'dist/explore.es-CO.html')), content_type='text/html')
                elif path == '/api/geography':
                    query = parse_qs(url.query)
                    ident = query['parent'][0]
                    kind = query['type'][0]
                    calls.append((ident, kind))
                    if mode == 'retry' and ident == 'CO' and not failed[0]:
                        failed[0] = True
                        value({}, 503)
                        return
                    node = BY_ID[ident]
                    ancestors = []
                    while node:
                        ancestors.insert(0, node)
                        node = BY_ID.get(node.get('parent'))
                    children = [n for n in NODES if n.get('parent') == ident] if kind == 'regions' else []
                    value(dict(parent=BY_ID[ident], ancestors=ancestors, children=children, notice='Fixture directory', fetchedAt=None))
                elif path == '/api/geography/catalog':
                    value(dict(families=[]))
                elif path == '/api/geography/quiz':
                    value(dict(species=[], pool=[], sampledSeasons=0, notice='Fixture species'))
                elif path == '/geography-seed.json':
                    value(dict(nodes=NODES))
                elif path == '/route-pilot.json':
                    value({})
                elif path == '/data.json':
                    value(dict(birds=[], sites=[]))
                elif path == '/api/account':
                    value(dict(kind='guest'))
                elif path == '/auth-config.mjs':
                    route.fulfill(content_type='text/javascript', body='export const authConfig={enabled:false};')
                else:
                    file = (ROOT / 'dist' / path.lstrip('/')).resolve()
                    if file.is_relative_to(ROOT / 'dist') and file.is_file() and file.suffix in ['.mjs', '.css']:
                        route.fulfill(path=str(file), content_type='text/javascript' if file.suffix == '.mjs' else 'text/css')
                    else:
                        route.abort()

            context.route('**/*', respond)
            page = context.new_page()
            page.set_default_timeout(5000)
            page.goto('https://quiz.test/explore', wait_until='domcontentloaded')
            page.locator('#geo-list-0 option[value="continent:South America"]').click()
            countries = page.locator('#geo-list-1')
            countries.wait_for()
            assert countries.input_value() == ''
            assert countries.locator('option[value="EC"]').is_disabled()
            if mode == 'keyboard':
                countries.focus()
                page.keyboard.press('ArrowDown')
                page.keyboard.press('Enter')
            else:
                # Real mouse activation: do NOT replace with select_option(),
                # which synthesizes change and conceals the original defect.
                countries.locator('option[value="CO"]').click()
            if mode == 'retry':
                message = json.loads((ROOT / 'locales' / language / 'geography-ui.json').read_text())['locations_could_not_load_select_this_place_again_to_ret_54e85ab7']
                page.wait_for_function("expected=>document.querySelector('#geo-loading').textContent===expected", arg=message)
                assert calls.count(('CO', 'regions')) == 1
                countries = page.locator('#geo-list-1')
                countries.locator('option[value="CO"]').click()
            page.locator('#geo-list-2 option[value="CO-CAL"]').wait_for(state='attached')
            assert calls.count(('CO', 'regions')) == (2 if mode == 'retry' else 1), calls
            assert page.locator('#geo-list-2 option').count() == 2
            print(json.dumps(dict(language=language, mode=mode, countryLoads=calls.count(('CO', 'regions')), passed=True)), flush=True)
            context.close()
    browser.close()
