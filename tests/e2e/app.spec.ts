import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

// The test application on the production path: catalogue from the published
// revision, a pair of sides and a drawer composed through the interface,
// saved as JSON and opened again.

test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Aggiungi Fianco YSI 03036 · 1080' })).toBeVisible({ timeout: 30_000 })
})

test('a wall is composed by hand, saved and opened again', async ({ page }, testInfo) => {
  const current = JSON.parse(await readFile('public/catalog/current.json', 'utf8'))
  await expect(page.getByText(`Catalogo ${current.revision}`)).toBeVisible()

  await page.getByRole('button', { name: 'Aggiungi Fianco YSI 03036 · 1080' }).click()
  await page.locator('.cfg-inspector summary', { hasText: 'Coppia specchiata' }).click()
  await page.getByRole('button', { name: /^101\.4 cm/ }).click()
  await page.getByRole('button', { name: 'Aggiungi Cassetto KDW 40236 · h64' }).click()
  // The catalogue tells the parts that do not mate with the selection.
  await expect(page.getByText('Compatibile').first()).toBeVisible()

  await page.locator('.cfg-inspector').getByRole('button', { name: /Aggancia nella scena|Scegli i punti/ }).click()
  await page.getByText(/^Punti di aggancio/).click()
  await page.getByRole('button', { name: /Estremità sinistra/ }).click()
  await page.getByRole('button', { name: /Fianco YSI 03036 · 1080 ·/ }).first().click()
  const points = page.locator('.cfg-point-list button')
  await expect(points.filter({ hasText: /^31Foro posteriore 1h/ })).toBeDisabled()
  await points.filter({ hasText: /^4Foro anteriore 4h/ }).click()
  await expect(page.getByText('Aggancio completato')).toBeVisible()
  await expect(page.getByText('3 componenti', { exact: true })).toBeVisible()

  await page.getByText('Strumenti progetto').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica JSON' }).click()])
  const saved = testInfo.outputPath('progetto.json')
  await download.saveAs(saved)
  const project = JSON.parse(await readFile(saved, 'utf8'))
  expect(project.items).toHaveLength(3)
  expect(project.connections).toHaveLength(2)
  expect(project.catalog.revision).toBe(current.revision)

  await page.getByRole('button', { name: 'Nuovo progetto' }).click()
  await expect(page.getByText('0 componenti', { exact: true })).toBeVisible()
  await page.getByLabel('File progetto').setInputFiles(saved)
  await expect(page.getByText(/Aperto «.*» con 3 componenti/)).toBeVisible()
  await expect(page.getByText('3 componenti', { exact: true })).toBeVisible()
  await expect(page.getByText('Configurazione valida')).toBeVisible({ timeout: 30_000 })

  // A project from a revision that is no longer published is not opened silently.
  const stale = testInfo.outputPath('vecchio.json')
  await writeFile(stale, JSON.stringify({ ...project, catalog: { revision: 'rev-inesistente' } }))
  await page.getByLabel('File progetto').setInputFiles(stale)
  await expect(page.getByText(/rev-inesistente, non più disponibile/)).toBeVisible()
  await page.getByRole('button', { name: 'Apri con la revisione corrente' }).click()
  await expect(page.getByText(/Aperto «.*» con 3 componenti.*avvisi/)).toBeVisible()
})
