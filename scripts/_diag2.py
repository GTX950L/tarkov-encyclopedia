import sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
B = 'https://gtx950l.github.io/tarkov-encyclopedia'

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    for url, target in [('/entries/engagement-rules/', 'Boss 图鉴'),
                        ('/entries/raid-flow/', '交火中的技术动作')]:
        print(f'--- {url} → {target}')
        for i in range(4):
            pg.goto(B + url, wait_until='load', timeout=90000)
            pg.wait_for_timeout(1200)
            pg.evaluate('window.scrollTo(0,2600)')
            pg.wait_for_timeout(300)
            before = pg.evaluate('window.scrollY')
            pg.evaluate("""(t)=>{const a=[...document.querySelectorAll('a.md-nav__link')]
                .find(x=>x.textContent.trim().includes(t)); if(a) a.click();}""", target)
            s = []
            prev = 0
            for d in [50, 150, 400, 900, 1800, 3500]:
                pg.wait_for_timeout(d - prev)
                prev = d
                s.append((d, pg.evaluate('window.scrollY')))
            print(f'   #{i+1} before={before} {s}')
    b.close()
