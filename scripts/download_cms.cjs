// Download public CMS provider-data files through real Chrome (the host refuses non-browser clients).
//   node scripts/download_cms.cjs data/raw/cms <url> [<url> ...]
const { chromium } = require("../web/node_modules/playwright-core");
const fs = require("fs");
const path = require("path");
(async () => {
  const [out, ...urls] = process.argv.slice(2);
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ acceptDownloads: true });
  for (const u of urls) {
    const dest = path.join(out, path.basename(new URL(u).pathname));
    if (fs.existsSync(dest)) { console.log("have", dest); continue; }
    const t = Date.now();
    const p = await ctx.newPage();
    try {
      const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 120000 }), p.goto(u).catch(() => {})]);
      await dl.saveAs(dest + ".part");
      fs.renameSync(dest + ".part", dest);
      console.log("got", dest, (fs.statSync(dest).size / 1e6).toFixed(1) + "MB", ((Date.now() - t) / 1000).toFixed(0) + "s");
    } catch (e) { console.log("FAIL", u, e.message.slice(0, 150)); }
    await p.close();
  }
  await b.close();
})();
