const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 560, height: 700 } });
  p.on('pageerror', e => console.log('[ERR]', e.message));
  await p.goto('http://127.0.0.1:3599/minifever/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const box = await p.locator('#stage').boundingBox();
  const fs = require('fs');
  for (let i = 0; i < 9; i++) {
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `port-${String(i).padStart(2,'0')}.png`, clip: box });
  }
  console.log('état :', await p.evaluate(() => document.getElementById('etat').textContent));
  // l'écran de fin est-il là ? on clique pour relancer
  await p.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'port-relance.png', clip: box });
  await b.close();
})();
