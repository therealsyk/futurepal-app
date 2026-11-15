const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(async () => {
    const db = window.__walletDb;
    const now = new Date().toISOString();
    const rows = [
      ['2026-01-10','income',900000],['2026-02-12','income',850000],['2026-03-14','income',930000],
      ['2026-04-18','income',980500],['2026-05-20','income',910000],['2026-06-22','income',970000],
      ['2026-01-15','expense',300000],['2026-02-18','expense',280000],['2026-03-20','expense',340000],
      ['2026-04-25','expense',310000],['2026-05-27','expense',360000],['2026-06-29','expense',330000],
    ];
    for (const [date,type,cents] of rows) {
      await db.transactions.add({ id:crypto.randomUUID(), createdAt:now, updatedAt:now, deletedAt:null,
        date, type, categoryId:'seed', description:'seed', amountCents:cents, currency:'EUR' });
    }
  });

  const n = await page.evaluate(() => window.__walletDb.transactions.count());
  console.log('db rows after seed:', n);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const svg = await page.$('.line-chart');
  console.log('line-chart present:', !!svg);
  if (svg) {
    const box = await svg.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.waitForTimeout(800);
    const tip = await page.$('.chart-tip');
    console.log('tooltip:', tip ? (await tip.textContent()).trim() : 'none');
    const paths = await page.$$eval('.line-chart path', els => els.map(e => e.getAttribute('fill')||e.getAttribute('stroke')));
    console.log('paths:', JSON.stringify(paths));
  }
  await page.screenshot({ path: 'panel-chart.png', fullPage: true });
  await browser.close();
})();
