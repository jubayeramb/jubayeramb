import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/projects/",
  "/projects/focrel/",
  "/writings/",
  "/writings/ai-skills-vs-mcp-when-to-use-what/",
  "/writings/2024-year-in-review-and-next-goals/",
  "/about/",
  "/now/",
  "/contact/",
  "/tags/",
  "/tags/ai/",
  "/ask/",
  "/404.html",
];
const WIDTHS = [390, 768, 1440];
const THEMES = ["light", "dark"] as const;

/** Sets the theme the same way a returning visitor's toggle would. */
async function openWithTheme(page: Page, route: string, theme: (typeof THEMES)[number]) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(route);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`${theme} @ ${width}px`, () => {
      test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

      for (const route of ROUTES) {
        test(`${route} fits and passes axe`, async ({ page }) => {
          await openWithTheme(page, route, theme);
          await expect(page.locator("h1")).toHaveCount(1);

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, "horizontal page scroll").toBeLessThanOrEqual(0);

          // axe once per theme at the extremes; the middle width only
          // guards layout.
          if (width === 768) return;
          const { violations } = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const serious = violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
          expect(serious, "serious or critical axe violations").toEqual([]);
        });
      }
    });
  }
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const route of ["/", "/now/", "/writings/ai-skills-vs-mcp-when-to-use-what/", "/about/"]) {
    test(`${route} renders its content`, async ({ page }) => {
      await page.goto(route);
      const h1 = page.locator("h1");
      await expect(h1).toBeVisible();
      await expect(h1).toHaveCSS("opacity", "1");
      const text = await page.locator("main").innerText();
      expect(text.length).toBeGreaterThan(400);
    });
  }

  test("the hero signature is fully drawn", async ({ page }) => {
    await page.goto("/");
    const offsets = await page
      .locator(".hero__signature .sig-stroke")
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).strokeDashoffset));
    expect(offsets.length).toBeGreaterThan(0);
    for (const o of offsets) expect(o).toBe("0px");
  });
});

test("reduced motion shows the signature without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // Scroll-linked effects (the header hairline) follow the scrollbar, not
  // the clock, so they're fine under reduced motion. Count timed ones only.
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.timeline instanceof DocumentTimeline).length,
  );
  expect(running).toBe(0);
  const offsets = await page
    .locator(".hero__signature .sig-stroke")
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).strokeDashoffset));
  for (const o of offsets) expect(o).toBe("0px");
});

test("the signature waits until it's on screen, draws letter by letter, then replays on hover", async ({ page }) => {
  const offsets = () =>
    page
      .locator(".hero__signature .sig-stroke")
      .evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).strokeDashoffset)));

  // Short enough that the signature starts below the fold.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  // Off screen: nothing drawn, however long we wait.
  await page.waitForTimeout(2000);
  for (const o of await offsets()) expect(o).toBe(100);

  // On screen: the first letter starts before the last.
  await page.locator(".hero__signature").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const early = await offsets();
  expect(early[0]).toBeLessThan(100);
  expect(early.at(-1)).toBe(100);

  await page.waitForTimeout(2200);
  for (const o of await offsets()) expect(o).toBe(0);

  await page.locator(".portrait").hover();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
});

test("client-side navigation keeps the document and lands on the post", async ({ page }) => {
  await page.goto("/writings/");
  await page.evaluate(() => ((window as any).__marker = true));
  await page.getByRole("link", { name: "AI Skills vs MCP: When to Use What" }).first().click();
  await expect(page).toHaveURL(/ai-skills-vs-mcp-when-to-use-what\/$/);
  await expect(page.locator("h1")).toHaveText("AI Skills vs MCP: When to Use What");
  expect(await page.evaluate(() => (window as any).__marker)).toBe(true);
});

test("command palette opens, searches and navigates", async ({ page }) => {
  await page.goto("/writings/");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.locator("dialog#palette");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("mcp");
  // Enter before the index arrives falls back to "Ask"; wait for the hit.
  await expect(page.getByRole("option", { name: /AI Skills vs MCP/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/ai-skills-vs-mcp/);
});

test("mobile menu opens, traps focus and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.click();
  await expect(page.locator(".nav-sheet__link").first()).toBeFocused();
  await expect(page.locator(".home-chat")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

test("theme toggle flips and persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: /theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

// The home overlay's chat subscription used to survive client-side
// navigation and throw on its detached dialog, so /ask showed nothing.
// The API isn't served here; the question itself must still render.
test("asking on /ask after arriving from home shows the question", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => (document.getElementById("home-chat") as any)?.__wired);
  await page.locator('header a[href="/ask/"]').first().click();
  await expect(page).toHaveURL(/\/ask\/$/);
  await page.locator("#chat-input").fill("What does he work on?");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".bubble--user")).toHaveText("What does he work on?");
});

test("a home question sent before the chat loads is answered on /ask", async ({ page }) => {
  await page.route(/home-chat-input\.[\w-]+\.js$/, (route) => route.abort());
  await page.goto("/");
  await page.locator("#home-chat-input").fill("hello there");
  await page.locator("#home-chat-input").press("Enter");
  await expect(page).toHaveURL(/\/ask\/$/);
  await expect(page.locator(".bubble--user")).toHaveText("hello there");
});
