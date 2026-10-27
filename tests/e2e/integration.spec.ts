import { expect, test, type Page } from '@playwright/test'

const scene = (page: Page, index: number) => page.getByRole('region', { name: `Scena ${index}` })
const status = (page: Page, index: number) => scene(page, index).getByText(/^Stato:/)
const components = (page: Page, index: number) => scene(page, index).getByText(/^Componenti:/)

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/index.html')
  for (const index of [1, 2]) await expect(status(page, index)).toHaveText(/pronto: true/, { timeout: 30_000 })
})

test('two configurators on one page keep their own state', async ({ page }) => {
  await page.getByRole('button', { name: 'Aggiungi 1' }).click()
  await expect(components(page, 1)).toHaveText(/Componenti: 1;.*registro: 1/)
  await expect(components(page, 2)).toHaveText(/Componenti: 0;.*registro: 0/)
  await page.getByRole('button', { name: 'Undo 1' }).click()
  await expect(components(page, 1)).toHaveText(/Componenti: 0;/)
})

test('read-only blocks editing and undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Aggiungi 1' }).click()
  await page.getByRole('button', { name: /Sola lettura 1/ }).click()
  await expect(page.getByRole('button', { name: 'Aggiungi 1' })).toBeDisabled()
  await page.getByRole('button', { name: 'Undo 1' }).click()
  await expect(components(page, 1)).toHaveText(/Componenti: 1;/)
})

test('a broken product model is reported and recovers', async ({ page }) => {
  await page.getByRole('button', { name: 'Aggiungi 1' }).click()
  await page.getByRole('button', { name: /Modello 1/ }).click()
  await expect(status(page, 1)).toHaveText(/Errore modello/)
  await page.getByRole('button', { name: /Modello 1/ }).click()
  await expect(status(page, 1)).toHaveText(/pronto: true/)
})

test('the PDF export produces a document', async ({ page }) => {
  await page.getByRole('button', { name: 'Aggiungi 1' }).click()
  await expect(status(page, 1)).toHaveText(/pronto: true/)
  await page.getByRole('button', { name: 'Genera PDF 1' }).click()
  const link = page.getByRole('link', { name: /Scarica PDF 1/ })
  await expect(link).toBeVisible({ timeout: 30_000 })
  const bytes = Number((await link.textContent())?.match(/\((\d+) byte\)/)?.[1])
  expect(bytes).toBeGreaterThan(10_000)
})

test('the isometric view frames the enclosure', async ({ page }) => {
  await scene(page, 1).getByRole('button', { name: 'Vista isometrica anteriore destra' }).click()
  await page.getByRole('button', { name: 'Verifica isometria 1' }).click()
  await expect(scene(page, 1).getByText(/^(PASS|FAIL):/)).toHaveText(/^PASS/)
})
