// Visual QA: capture key pages in a real browser (uses the installed Chrome).
//   npm run dev            # in another terminal
//   node scripts/screenshots.mjs [baseUrl] [outDir]
// Fails if any page logs a console error, shows the error boundary, or overflows
// horizontally. WIDTH=400 for a phone-width pass.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5190";
const out = process.argv[3] ?? "../outputs/screens";
mkdirSync(out, { recursive: true });

const manifest = await (await fetch(`${base}/data/manifest.json`)).json();
const synth = await (await fetch(`${base}/data/synthetic/bundle.json`)).json();
const pages = [
  ["landing", "/"],
  ["dashboard", "/synthetic/dashboard"],
  ["locations", "/synthetic/locations"],
  ["location", `/synthetic/locations/${synth.metros[0].slug}`],
  ["system", `/synthetic/systems/${synth.systems[0].slug}`],
  ["directory", `/synthetic/cardiologists?metro=${synth.metros[0].slug}&timing=Now,Near`],
  ["cardiologist", `/synthetic/cardiologists/${synth.leads[0].npi}`],
  ["groups", "/synthetic/groups"],
  ["group", `/synthetic/groups/${synth.groups[0].id}`],
  ["signals", "/synthetic/signals"],
  ["signal", "/synthetic/signals/disruption"],
  ["news", "/synthetic/news"],
];
if (manifest.sources.find((s) => s.id === "real")?.available) {
  const real = await (await fetch(`${base}/data/real/bundle.json`)).json();
  pages.push(["real-dashboard", "/real/dashboard"], ["real-cardiologist", `/real/cardiologists/${real.leads[0].npi}`]);
}

if (manifest.sources.find((s) => s.id === "public")?.available) {
  const pub = await (await fetch(`${base}/data/public/bundle.json`)).json();
  pages.push(
    ["public-dashboard", "/public/dashboard"],
    ["public-cardiologist", `/public/cardiologists/${pub.leads[0].npi}`],
    ["public-signals", "/public/signals"],
    ["public-signal", "/public/signals/disruption"],
    ["public-news", "/public/news"],
  );
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const width = Number(process.env.WIDTH ?? 1440);
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
let failed = 0;
for (const [name, path] of pages) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector("h1", { timeout: 15000 });
  const boom = await page.locator("text=Something went wrong").count();
  // responsive guard: the page body must never scroll sideways (tables scroll in their card)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`horizontal page overflow of ${overflow}px`);
  const file = `${out}/${name}${width !== 1440 ? `-${width}` : ""}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const ok = !boom && errors.length === 0;
  failed += ok ? 0 : 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(18)} ${path}${errors.length ? "\n     " + errors.join("\n     ") : ""}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
