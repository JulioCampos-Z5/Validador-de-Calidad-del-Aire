import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { comparar, ordenar } from './orden'
import DataTable from './DataTable'

describe('ordenar', () => {
  it('números como números, texto en español y lo vacío al final', () => {
    expect(comparar('9', '12')).toBeLessThan(0)
    expect(comparar('Árbol', 'beta')).toBeLessThan(0)
    const filas = [{ v: 3 }, { v: null }, { v: 10 }, { v: 1 }]
    expect(ordenar(filas, { clave: 'v', dir: 'asc' }, (f, c) => f[c as 'v']).map((f) => f.v)).toEqual([1, 3, 10, null])
    expect(ordenar(filas, { clave: 'v', dir: 'desc' }, (f, c) => f[c as 'v']).map((f) => f.v)).toEqual([10, 3, 1, null])
    expect(ordenar(filas, null, () => 0)).toBe(filas)
  })
})

describe('DataTable', () => {
  const datos = [
    { STATION: 'CEN', O3: 0.02 },
    { STATION: 'AGU', O3: 0.05 },
    { STATION: 'OBL', O3: 'IR' },
  ]
  const columna = (n: number) => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[n].textContent)

  it('un clic en el título ordena, otro invierte y el tercero vuelve al original', async () => {
    render(<DataTable data={datos} />)
    const o3 = screen.getByRole('button', { name: 'O3' })
    await userEvent.click(screen.getByRole('button', { name: 'STATION' }))
    expect(columna(0)).toEqual(['AGU', 'CEN', 'OBL'])
    expect(screen.getByRole('columnheader', { name: 'STATION' })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(screen.getByRole('button', { name: 'STATION' }))
    expect(columna(0)).toEqual(['OBL', 'CEN', 'AGU'])
    await userEvent.click(screen.getByRole('button', { name: 'STATION' }))
    expect(columna(0)).toEqual(['CEN', 'AGU', 'OBL'])
    await userEvent.click(o3)
    await userEvent.click(o3)
    expect(columna(0)).toEqual(['AGU', 'CEN', 'OBL'])
  })
})
