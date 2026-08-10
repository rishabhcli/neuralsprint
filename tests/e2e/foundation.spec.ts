import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('foundation release boundary', () => {
  test('states the unsupported document boundary without a dead input control', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Forensic PDF redaction verifier',
    );
    await expect(page.getByText('not yet in production', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'This release has no PDF-processing surface and makes no document-safety claim.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('button, input, select, textarea')).toHaveCount(0);

    expect(requests.length).toBeGreaterThan(0);
    for (const requestUrl of requests) {
      expect(new URL(requestUrl).origin).toBe('http://127.0.0.1:4212');
    }
  });

  test('the built preview uses only loopback assets and remains readable after network loss', async ({
    context,
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') await route.continue();
      else await route.abort('blockedbyclient');
    });

    await page.goto('http://127.0.0.1:4211/');
    await expect(page.getByRole('main')).toBeVisible();
    expect(requests.length).toBeGreaterThan(1);
    for (const requestUrl of requests) {
      expect(new URL(requestUrl).origin).toBe('http://127.0.0.1:4211');
    }
    expect(requests.some((requestUrl) => new URL(requestUrl).pathname.startsWith('/assets/'))).toBe(
      true,
    );

    await context.setOffline(true);

    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      'Refuses to imply safety before the verifier exists.',
    );
    await expect(page.getByText('Zero document bytes accepted')).toBeVisible();
  });

  test('@accessibility has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test('@accessibility reflows without horizontal page overflow at 400% equivalent zoom', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
