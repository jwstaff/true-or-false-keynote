// Flow tests for the keynote game, at 320, 390 and 768px.
// Run: node tests/flow.mjs   (PLAYWRIGHT_PATH can point at any installed playwright package)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.resolve(ROOT, "../sassy-edtech-eval/node_modules/playwright"));
const PORT = 8765, BASE = `http://localhost:${PORT}/`;

const ANSWERS = { r1a:"false", r1b:"unknown", r1c:"true", r2a:"true", r2b:"false", r2c:"false" };
const WORD = {
  en:{ true:"True", false:"False", unknown:"Not yet known" },
  lv:{ true:"Patiesi", false:"Aplami", unknown:"Vēl nav zināms" }
};

let failures = 0, passes = 0;
function check(cond, msg){ if (cond) passes++; else { failures++; console.log("  FAIL:", msg); } }

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch();

async function open(width, locale = "en-US", hash = ""){
  const ctx = await browser.newContext({ viewport:{ width, height:780 }, locale, isMobile: width < 700, hasTouch: width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(BASE + hash);
  return { ctx, page, errors };
}
const screen = page => page.evaluate(() => state.screen);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// Any element whose content is wider than its box means a label was squeezed or cut.
const overflowing = page => page.evaluate(() =>
  [...document.querySelectorAll("button, .chip, .stamp, h1, h2, h3, a.btn")]
    .filter(el => el.offsetParent && el.scrollWidth > el.clientWidth + 1 && !el.closest("nav"))
    .map(el => el.textContent.trim().slice(0, 40)));

// Vote on every statement in a round; `pick` chooses the vote for each item.
async function playRound(page, rk, lang, pick, width){
  for (let i = 0; i < 3; i++) {
    const id = await page.locator("[data-vote]").first().getAttribute("data-item");
    const buttons = await page.locator("[data-vote]").count();
    check(buttons === (rk === "r1" ? 3 : 2), `${rk} ${id}: expected ${rk === "r1" ? 3 : 2} vote buttons, got ${buttons}`);
    if (width === 320) check((await overflowing(page)).length === 0, `${lang} ${id} @320 overflow before vote: ${await overflowing(page)}`);
    const v = pick(id);
    await page.click(`[data-vote="${v}"]`);
    const stamp = (await page.locator(".stamp").textContent()).trim();
    check(stamp === WORD[lang][ANSWERS[id]], `${lang} ${id}: stamp "${stamp}"`);
    check(await page.locator(".reveal .headline").isVisible(), `${id}: evidence headline visible`);
    const pts = await page.locator(".reveal li").count();
    check(pts >= 2 && pts <= 4, `${id}: ${pts} evidence points`);
    check(await page.locator(".reveal .source").isVisible(), `${id}: source visible`);
    await page.waitForTimeout(60);
    check((await page.locator("#live").textContent()).includes(WORD[lang][ANSWERS[id]]), `${id}: live region announces verdict`);
    if (width === 320) check((await overflowing(page)).length === 0, `${lang} ${id} @320 overflow after vote: ${await overflowing(page)}`);
    if (i === 0) { // Change my vote, then vote again
      await page.click("[data-revote]");
      check(await page.locator("[data-vote]").count() > 0, `${id}: change my vote shows buttons again`);
      await page.click(`[data-vote="${v}"]`);
    }
    await page.click("[data-next]");
  }
}

for (const width of [320, 390, 768]) {
  for (const lang of ["en", "lv"]) {
    console.log(`Full flow, ${lang}, ${width}px`);
    const { ctx, page, errors } = await open(width, lang === "lv" ? "lv-LV" : "en-US");
    check(await page.evaluate(() => document.documentElement.lang) === lang, `${lang}: default language from locale`);
    check(await noHScroll(page), `${width} intro: no horizontal scroll`);
    check(await page.locator(".howto li").count() === 4, "intro: four how-to lines");
    await page.click('.hero [data-go="r1"]');
    // Vote correct on r1a, r1c, r2a; wrong on the rest => 3 of 6
    const correct = new Set(["r1a", "r1c", "r2a"]);
    const pick = id => correct.has(id) ? ANSWERS[id] : (ANSWERS[id] === "true" ? "false" : "true");
    await playRound(page, "r1", lang, pick, width);
    check(await screen(page) === "r2", "after r1 -> r2");
    await playRound(page, "r2", lang, pick, width);
    check(await screen(page) === "r3", "after r2 -> r3");
    const r3 = await page.locator(".lede").textContent();
    check(r3.includes("3") && r3.includes("6"), `r3 score text: ${r3}`);
    check(await page.locator(".match").count() === 3, "r3: three match cards");
    check(await noHScroll(page), `${width} r3: no horizontal scroll`);
    await page.click('[data-go="exit"].btn');
    check(await screen(page) === "exit" && page.url().endsWith("#exit"), "r3 -> exit, hash #exit");
    const sc = await page.locator(".score").textContent();
    check(sc.includes("3") && sc.includes("6"), `exit score: ${sc}`);
    const links = page.locator(".link-card a");
    check(await links.count() === 2, "exit: two link cards");
    for (let k = 0; k < 2; k++) {
      check(await links.nth(k).getAttribute("target") === "_blank", "exit link target=_blank");
      check(await links.nth(k).getAttribute("rel") === "noopener noreferrer", "exit link rel");
    }
    check((await links.nth(0).getAttribute("href")).includes("aitinkery"), "playbook card first");
    check(await noHScroll(page), `${width} exit: no horizontal scroll`);
    if (width === 320) check((await overflowing(page)).length === 0, `${lang} exit @320 overflow: ${await overflowing(page)}`);
    await page.click('[data-action="restart"]');
    check(await screen(page) === "intro", "play again -> intro");
    check(await page.evaluate(() => Object.keys(state.votes).length === 0 && state.pos.r1 === 0 && state.pos.r2 === 0), "play again clears votes and positions");
    check(await page.evaluate(() => state.lang) === lang, "play again keeps language");
    check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    await ctx.close();
  }
}

console.log("Language switch mid-round, reload, hashes");
{
  const { ctx, page, errors } = await open(390, "en-US", "#r1");
  check(await screen(page) === "r1", "#r1 opens round 1");
  await page.click('[data-vote="false"]');
  await page.evaluate(() => window.scrollTo(0, 200));
  const y0 = await page.evaluate(() => window.scrollY);
  await page.click('[data-lang="lv"]');
  check(await page.evaluate(() => document.documentElement.lang) === "lv", "switch: html lang = lv");
  check(await page.evaluate(() => document.title).then(t => t.startsWith("Patiesi")), "switch: title in Latvian");
  check(await screen(page) === "r1", "switch keeps screen");
  check(await page.evaluate(() => state.votes.r1a) === "false", "switch keeps votes");
  check(Math.abs(await page.evaluate(() => window.scrollY) - y0) < 2, "switch keeps scroll position");
  await page.reload();
  check(await screen(page) === "r1" && await page.evaluate(() => state.votes.r1a) === "false", "reload keeps screen and votes");
  check(await page.evaluate(() => state.lang) === "lv", "reload keeps language");
  for (const h of ["intro", "r1", "r2", "r3", "exit"]) {
    await page.goto(BASE + "#" + h);
    await page.waitForTimeout(50);
    check(await screen(page) === h, `#${h} opens ${h}`);
  }
  await page.goto(BASE + "#r3");
  check(await page.locator('.project h3[lang="en"]').count() === 4, "project names marked lang=en");
  // Placeholder URL hides its card
  await page.evaluate(() => { LINKS.flashLab = "https://example.com/TODO"; go("exit"); });
  check(await page.locator(".link-card").count() === 1, "placeholder link hides its card");
  check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
  await ctx.close();
}

console.log("Storage unavailable");
{
  const ctx = await browser.newContext({ viewport:{ width:390, height:780 } });
  await ctx.addInitScript(() => { Object.defineProperty(window, "localStorage", { get(){ throw new Error("blocked"); } }); });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(BASE + "#r1");
  await page.click('[data-vote="false"]');
  check(await page.locator(".stamp").isVisible(), "plays in memory without storage");
  check(errors.length === 0, `errors without storage: ${errors.join(" | ")}`);
  await ctx.close();
}

console.log("Keyboard-only");
{
  const { ctx, page } = await open(390);
  const tabTo = async sel => {
    for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); if (await page.evaluate(s => document.activeElement.matches(s), sel)) return true; }
    return false;
  };
  check(await tabTo('.hero [data-go="r1"]'), "keyboard reaches Start");
  await page.keyboard.press("Enter");
  check(await tabTo("[data-vote]"), "keyboard reaches a vote button");
  await page.keyboard.press("Enter");
  check(await page.locator(".stamp").isVisible(), "keyboard vote reveals verdict");
  check(await tabTo("[data-next]"), "keyboard reaches Next");
  await page.keyboard.press("Enter");
  check(await page.evaluate(() => state.pos.r1) === 1, "keyboard Next advances");
  await ctx.close();
}

console.log("Offline after first load");
{
  const { ctx, page } = await open(390, "en-US");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await ctx.setOffline(true);
  await page.reload();
  check(await page.locator(".hero h1").isVisible(), "page loads offline");
  await page.click('.hero [data-go="r1"]');
  await page.click('[data-vote="false"]');
  check(await page.locator(".stamp").isVisible(), "plays offline");
  check(await page.evaluate(() => document.fonts.check('600 20px "Oswald"') && document.fonts.check('400 16px "Public Sans"')), "fonts available offline");
  await ctx.close();
}

console.log("Size");
{
  const fs = await import("node:fs");
  const kb = fs.statSync(path.join(ROOT, "index.html")).size / 1024;
  check(kb < 150, `index.html is ${kb.toFixed(1)} KB`);
  console.log(`  index.html: ${kb.toFixed(1)} KB`);
}

await browser.close();
server.kill();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
