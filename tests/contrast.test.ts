import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

function declarationFor(selector: string, property: string) {
  let value: string | undefined
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((item) => item.trim())
    if (!selectors.includes(selector)) continue
    const declaration = new RegExp(`${property}:([^;}]*)`).exec(match[2])
    if (declaration) value = declaration[1]
  }
  return value
}

function relativeLuminance(hex: string) {
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset + 1, offset + 3), 16) / 255)
  return channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
}

function contrast(first: string, second: string) {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

describe('actual CSS contrast tokens and selectors', () => {
  it('defines the reviewed light surface tokens', () => {
    expect(css).toContain('--accent:#c24a33')
    expect(css).toContain('--accent-hover:#a63c28')
    expect(css).toContain('--text-muted:#5f665f')
    expect(css).toContain('--input-border:#8a8f89')
  })

  it('meets text contrast for the primary light contexts', () => {
    expect(contrast('#c24a33', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#5f665f', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#5f665f', '#f6f3ee')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#a63c28', '#f8e3dc')).toBeGreaterThanOrEqual(4.5)
    expect(css).toContain('.primary-button{background:var(--accent)}')
    expect(css).toContain('.eyebrow,.lede,.sync-chip,.surface-note,.metric-strip span')
    expect(css).toContain('.strategy,.calendar-event b,.calendar-task-link b')
  })

  it('keeps borders and focus indicators visible on both surfaces', () => {
    expect(contrast('#8a8f89', '#fffcf8')).toBeGreaterThanOrEqual(3)
    expect(contrast('#8a8f89', '#343837')).toBeGreaterThanOrEqual(3)
    expect(contrast('#ec7b62', '#343837')).toBeGreaterThanOrEqual(3)
    expect(css).toContain(':focus-visible{outline:3px solid var(--accent)')
    expect(css).toContain('.sidebar input:focus-visible{outline-color:#ec7b62')
  })

  it('resolves dark sidebar cascade rules to contrasting colors', () => {
    expect(declarationFor('.sidebar .eyebrow', 'color')).toBe('#c7cbc6')
    expect(declarationFor('.timezone-settings input', 'border-color')).toBe('var(--input-border)')
    expect(declarationFor('.log-item time', 'color')).toBe('var(--text-muted)')
    expect(contrast('#c7cbc6', '#232525')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#8a8f89', '#343837')).toBeGreaterThanOrEqual(3)
    expect(contrast('#5f665f', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
