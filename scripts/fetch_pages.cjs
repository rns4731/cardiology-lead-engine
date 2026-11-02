// Fetch pages in real Chrome (some hosts refuse non-browser clients; Google News article
// links only resolve to the publisher in a browser). Used by the news pipeline.
//   node scripts/fetch_pages.cjs <in.json: [{id,url}]> <out.jsonl> [concurrency]
// Writes one line per page: {id, url, finalUrl, status, html} -- html omitted on failure.
const { chromium } = require("../web/node_modules/playwright-core");
const fs = require("fs");
(async () => {
  const [inPath, outPath, conc = "6"] = process.argv.slice(2);
  const items = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const done = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const todo = items.filter((x) => !done.has(x.id));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const out = fs.createWriteStream(outPath, { flags: "a" });
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const it = todo[i++];
      const page = await ctx.newPage();
      let rec = { id: it.id, url: it.url };
      try {
        const r = await page.goto(it.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Google News article links bounce to the publisher via script
        for (let t = 0; t < 20 && /news\.google\.com/.test(page.url()); t++) await page.waitForTimeout(500);
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1500);
        rec = { ...rec, finalUrl: page.url(), status: r ? r.status() : null, html: await page.content() };
      } catch (e) {
        rec = { ...rec, finalUrl: page.url(), error: String(e.message).slice(0, 200) };
      }
      out.write(JSON.stringify(rec) + "\n");
      await page.close();
    }
  }
  await Promise.all(Array.from({ length: Number(conc) }, worker));
  out.end();
  await browser.close();
  console.log(`fetched ${todo.length} pages (${done.size} already cached)`);
})();
