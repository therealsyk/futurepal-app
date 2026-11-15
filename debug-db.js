const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  const info = await page.evaluate(async () => {
    const db = window.__walletDb;
    if (!db) return { error: 'no __walletDb' };
    const count = await db.transactions.count();
    const sample = await db.transactions.toArray().then(a => a.slice(0,3));
    // Try inserting one and re-counting
    await db.transactions.add({ id:'debug1', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null, date:'2026-04-01', type:'income', categoryId:'seed', description:'x', amountCents:5000, currency:'EUR' });
    const count2 = await db.transactions.count();
    return { count, count2, sample };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
