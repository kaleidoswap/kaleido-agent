import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KALEIDO_API_URL, getKaleidoApiUrl } from '../../src/runtime-paths.js'

describe('getKaleidoApiUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to signet', () => {
    vi.stubEnv('KALEIDOSWAP_API_URL', '')
    vi.stubEnv('KALEIDO_NETWORK', '')
    expect(getKaleidoApiUrl()).toBe(DEFAULT_KALEIDO_API_URL)
  })

  it('requires an explicit URL on mainnet', () => {
    vi.stubEnv('KALEIDOSWAP_API_URL', '')
    vi.stubEnv('KALEIDO_NETWORK', 'mainnet')
    expect(() => getKaleidoApiUrl()).toThrow(/KALEIDOSWAP_API_URL/)
  })

  it('uses the explicit URL when set', () => {
    vi.stubEnv('KALEIDOSWAP_API_URL', 'https://maker.example.com')
    vi.stubEnv('KALEIDO_NETWORK', 'mainnet')
    expect(getKaleidoApiUrl()).toBe('https://maker.example.com')
  })
})
