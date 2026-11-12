import { expect, test, type Locator, type Page } from '@playwright/test'

test.setTimeout(120_000)

async function exercise(page: Page, touch: boolean) {
  const press = async (locator: Locator) => touch ? locator.tap() : locator.click()
  await page.goto('/')
  const search = page.getByRole('textbox', { name: 'Cerca componenti' })
  await search.fill('YSI03036')
  await press(page.getByRole('button', { name: 'Aggiungi Fianco YSI 03036 · 1080', exact: true }))
  await press(page.locator('.cfg-inspector summary', { hasText: 'Coppia specchiata' }))
  await press(page.getByRole('button', { name: /^101\.4 cm/ }))
  await search.fill('KDW40236')
  await press(page.locator('.app-product-card'))
  await press(page.getByRole('button', { name: 'Aggancia nella scena', exact: true }))
  await press(page.locator('.cfg-point-list button').filter({ hasText: 'Estremità sinistra' }))
  await press(page.locator('.cfg-point-list button').filter({ hasText: 'Fianco YSI 03036' }).first())
  await expect(page.locator('.cfg-point-list button').filter({ hasText: 'Frontale esterno' })).toHaveCount(0)
  await press(page.getByRole('checkbox', { name: 'Mostra anche i punti non compatibili' }))
  await expect(page.locator('.cfg-point-list button').filter({ hasText: 'Frontale esterno' }).first()).toBeDisabled()
  await press(page.getByRole('checkbox', { name: 'Mostra anche i punti non compatibili' }))
  await press(page.locator('.cfg-point-list button').filter({ hasText: 'Frontale interno 14' }))
  // A tap/click selects the preview; the explicit confirmation commits it.
  const confirm = page.getByRole('button', { name: 'Conferma aggancio', exact: true })
  await expect(confirm).toBeEnabled()
  await expect(page.getByText('Scegli il punto di destinazione')).toBeVisible()
  if (!touch) await page.mouse.move(1000, 40)
  await expect(confirm).toBeEnabled()
  await press(confirm)
  await expect(page.getByText('Aggancio completato', { exact: true })).toBeVisible()
  const save = async () => {
    await press(page.getByRole('button', { name: 'Salva', exact: true }))
    return JSON.parse((await page.locator('.app-project-tools pre').textContent())!)
  }
  const before = await save()
  const original = before.items.find((item: { catalogId: string }) => item.catalogId === 'kdw40236')
  expect(before.connections).toHaveLength(2)
  await expect(page.getByRole('button', { name: '↑ Sposta su', exact: true })).toBeEnabled()
  await page.screenshot({ path: `test-results/snap-step-${touch ? 'touch' : 'mouse'}.png`, fullPage: true })
  await press(page.getByRole('button', { name: '↑ Sposta su', exact: true }))
  const after = await save()
  const moved = after.items.find((item: { id: string }) => item.id === original.id)
  expect(moved.position[1] - original.position[1]).toBeCloseTo(0.036, 7)
  expect(after.connections.every((joint: { targetPointId: string }) => joint.targetPointId === 'front-15')).toBe(true)
  for (const side of before.items.filter((item: { id: string }) => item.id !== original.id)) expect(after.items.find((item: { id: string }) => item.id === side.id)).toEqual(side)
  await press(page.getByRole('button', { name: '↓ Sposta giù', exact: true }))
  const returned = await save()
  expect(returned.items.find((item: { id: string }) => item.id === original.id).position[1]).toBeCloseTo(original.position[1], 7)
  expect(returned.connections.every((joint: { targetPointId: string }) => joint.targetPointId === 'front-14')).toBe(true)
}

test('mouse: preview, confirm and step a drawer between holes without moving the frame', async ({ page }) => { await exercise(page, false) })

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 930 } })
  test('tap: preview, confirm and step a drawer between holes', async ({ page }) => { await exercise(page, true) })
})
