import { expect, test, type Page } from '@playwright/test';

async function openSidebarRoute(page: Page, label: string): Promise<void> {
  await page.locator(`a:has-text("${label}")`).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('dashboard key cards and selectors remain visible after account/period changes', async ({ page }) => {
  await expect(page.getByText('Net Worth', { exact: true })).toBeVisible();

  const accountSelect = page.getByRole('combobox').first();
  const periodSelect = page.getByRole('combobox').nth(1);

  await accountSelect.click();
  await page.getByRole('option', { name: 'All Accounts' }).click();

  await periodSelect.click();
  await page.getByRole('option', { name: '24 Months' }).click();

  await expect(periodSelect).toContainText('24 Months');
  await expect(page.getByText('Budget Progress', { exact: true })).toBeVisible();
});

test('transactions and holdings remain navigable after rapid route changes', async ({ page }) => {
  await openSidebarRoute(page, 'Transactions');
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await page.getByPlaceholder('Search transactions...').fill('rent');

  await openSidebarRoute(page, 'Holdings');
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();

  await openSidebarRoute(page, 'Transactions');
  const searchInput = page.getByPlaceholder('Search transactions...');
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await expect(searchInput).toBeVisible();
  await searchInput.fill('rent');
  await expect(searchInput).toHaveValue('rent', { timeout: 10_000 });
});
