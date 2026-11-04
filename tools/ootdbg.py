# Headless helper: boots Ocarina of Time with the real ROM, starts a new game, then exercises the debug tools.
from playwright.sync_api import sync_playwright
import sys,json,os
PAGE=os.environ.get('PAGE','file:///tmp/w/triforce.html')
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    ctx=b.new_context(viewport={'width':1280,'height':1100}); ctx.add_init_script("Element.prototype.requestFullscreen=function(){return Promise.resolve()};")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(PAGE); pg.wait_for_timeout(1500)
    pg.locator('.fr-tab',has_text='Zelda').first.click(); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('.game[data-g=\"oot\"]').click()"); pg.wait_for_timeout(500)
    pg.locator('#playerToggle').click(); pg.wait_for_timeout(500)
    pg.set_input_files('#playerRom',os.environ.get('ROM','/tmp/rom/oot.z64'))
    for i in range(60):
        pg.wait_for_timeout(4000)
        if pg.evaluate("typeof SOHRT!=='undefined' && SOHRT.started()"): break
    pg.wait_for_timeout(10000)
    print('booted',pg.evaluate("JSON.stringify(OOTDBG.state())")[:200],flush=True)
    cv=pg.locator('canvas.soh-canvas'); cv.scroll_into_view_if_needed(); cv.click(position={'x':100,'y':100}); pg.wait_for_timeout(500)
    seq=[('Enter',6),('Enter',6),('x',5),('Space',2),('x',4),('x',4),('x',5),('x',5)]+[('Space',3)]*4+[('x',2)]*40
    for i,(k,w) in enumerate(seq):
        pg.keyboard.down(k); pg.wait_for_timeout(250); pg.keyboard.up(k); pg.wait_for_timeout(w*1000)
        if i>=14 and pg.evaluate("OOTDBG.state().playing"): print('playing at step',i,flush=True); break
    pg.wait_for_timeout(3000)
    s0=pg.evaluate("OOTDBG.state()"); print('before',json.dumps(s0),flush=True)
    pg.evaluate("OOTDBG.poke('heartCapacity',5); OOTDBG.poke('hearts',5); OOTDBG.poke('rupees',123); OOTDBG.poke('allItems')"); pg.wait_for_timeout(2500)
    s1=pg.evaluate("OOTDBG.state()"); print('after',json.dumps(s1),flush=True)
    pg.locator('#playerDbgBtn').click(); pg.wait_for_timeout(1200)
    pg.screenshot(path='/tmp/dbgui.png',full_page=True)
    rep=pg.evaluate("(()=>{const r=OOTDBG.report('test'); return JSON.stringify({keys:Object.keys(r),log:r.log.length,inputs:r.inputs.length,shot:r.screenshot.length,cfg:(r.engineConfig||'').slice(0,120)})})()"); print('report',rep)
    sav=pg.evaluate("(()=>{try{const fs=SOHRT.options.fs(); return Array.from(fs.readFile('/Save/file1.sav'))}catch(e){return String(e)}})()")
    if isinstance(sav,list): open('/tmp/rom/file1.sav','wb').write(bytes(sav)); print('saved file1.sav',len(sav))
    else: print('save read:',sav)
    print(errs); b.close()
