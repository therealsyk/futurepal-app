
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: '+m.text()); });
  await page.goto('http://localhost:5176/');
  await page.waitForTimeout(1500);
  // complete setup wizard by clicking skip-btn if present
  const skip = await page.$('button.skip-btn, #skip-btn, .finish-btn');
  if (skip) { await skip.click(); await page.waitForTimeout(1500); }
  const navInfo = await page.evaluate(() => {
    const nav = document.querySelector('.topnav');
    return { navExists: !!nav, links: nav ? Array.from(nav.querySelectorAll('a')).map(a=>({href:a.getAttribute('href'), cls:a.className})) : [] };
  });
  console.log('NAV:', JSON.stringify(navInfo));
  if (navInfo.navExists) {
    await page.evaluate(() => document.querySelector('.topnav a:nth-child(2)').click());
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => ({ url: location.hash, mainText: document.querySelector('.app-main')?.textContent.slice(0,120) }));
    console.log('AFTER CLICK:', JSON.stringify(res));
  }
  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
