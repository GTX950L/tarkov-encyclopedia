import sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
B = 'https://gtx950l.github.io/tarkov-encyclopedia'

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    bad = []
    pg.on('response', lambda r: bad.append((r.status, r.url)) if r.status >= 400 else None)

    print('【线上 · 回顶】整页加载 → 滚到底 → 点侧栏，每场景 4 次')
    allok = True
    for url, target in [('/entries/engagement-rules/', 'Boss 图鉴'),
                        ('/entries/karma/', '任务系统'),
                        ('/entries/ammo/', 'PMC 与 Scav'),
                        ('/entries/raid-flow/', '交火中的技术动作'),
                        ('/entries/bosses/', '战局流程与节奏')]:
        res = []
        for i in range(4):
            pg.goto(B + url, wait_until='load', timeout=90000)
            pg.wait_for_timeout(1000)
            pg.evaluate('window.scrollTo(0,2600)')
            pg.wait_for_timeout(250)
            pg.evaluate("""(t)=>{const a=[...document.querySelectorAll('a.md-nav__link')]
                .find(x=>x.textContent.trim().includes(t)); if(a) a.click();}""", target)
            pg.wait_for_timeout(700)
            res.append(pg.evaluate('window.scrollY'))
        ok = all(v == 0 for v in res)
        allok &= ok
        print(f"   {'✅' if ok else '❌'} {url.split('/')[-2]:<18} → {target}: {res}")
    print('   合计:', '✅ 20/20 全部归零' if allok else '❌ 仍有失败')

    print()
    print('【线上 · 锚点未受影响】')
    pg.goto(B + '/entries/skills/#categories', wait_until='load', timeout=90000)
    pg.wait_for_timeout(1500)
    print('   直接打开 #categories → scrollY =', pg.evaluate('window.scrollY'), '（应非 0）')
    pg.goto(B + '/entries/weapon-mastery/', wait_until='load', timeout=90000)
    pg.wait_for_timeout(900)
    href = pg.evaluate("""() => {
        const a=[...document.querySelectorAll('a[href]')]
          .filter(x=>{const h=x.getAttribute('href')||''; return h.indexOf('#')>0 && h.charAt(0)!=='#';});
        return a.length? a[0].getAttribute('href') : null; }""")
    if href:
        pg.evaluate("""() => {
            const a=[...document.querySelectorAll('a[href]')]
              .filter(x=>{const h=x.getAttribute('href')||''; return h.indexOf('#')>0 && h.charAt(0)!=='#';});
            a[0].click(); }""")
        pg.wait_for_timeout(1500)
        print(f'   点击跨页锚点 {href} → scrollY =', pg.evaluate('window.scrollY'), '（应非 0）')

    print()
    print('【线上 · 其余复核】')
    for page, href, label in [('/entries/gunsmith/', 'weapons', 'gunsmith→枪械图鉴'),
                              ('/entries/traders/', 'trader-questlines', 'traders→商人任务线图鉴')]:
        pg.goto(B + page, wait_until='load', timeout=90000)
        pg.wait_for_timeout(700)
        ok = pg.evaluate("(h) => !!document.querySelector('a[href*=\"' + h + '\"]')", href)
        print(f"   {'✅' if ok else '❌'} {label}")
    pg.goto(B + '/entries/', wait_until='load', timeout=90000)
    pg.wait_for_timeout(800)
    print('   总览页首句 =', pg.evaluate("""() => {
        const l=document.body.innerText.split('\\n').filter(x=>x.indexOf('已收录')>=0);
        return l.length? l[0] : null; }"""))
    pg.goto(B + '/entries/karma/', wait_until='load', timeout=90000)
    pg.wait_for_timeout(900)
    print('   术语标注 =', pg.evaluate("document.querySelectorAll('.tk-term').length"),
          '| restoration =', pg.evaluate('history.scrollRestoration'))
    print('   非 2xx（排除主题 release API）:',
          [x for x in bad if 'api.github.com' not in x[1]] or '无 ✅')
    b.close()
