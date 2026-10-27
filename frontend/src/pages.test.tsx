import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './auth'
import { AuditLookupPage, AuditPage, ProfilePage, TransactionFormPage, ValuationsPage } from './pages'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function renderWithRouter(element: React.ReactNode, initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><AuthProvider>{element}</AuthProvider></MemoryRouter>)
}

function authResponse(url: string) {
  if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'user-1', email: 'test@example.com', is_admin: false, demo_tampering_enabled: false }), { status: 200 })
  if (url.endsWith('/portfolios')) return new Response(JSON.stringify([{ id: 'portfolio-1', name: 'Test portfolio', base_currency: 'INR', created_at: '2026-01-01' }]), { status: 200 })
  if (url.endsWith('/assets')) return new Response(JSON.stringify([]), { status: 200 })
  return null
}

describe('portfolio transaction form integration', () => {
  it('validates required transaction data before posting', async () => {
    localStorage.setItem('ledgerly_access_token', 'test-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return authResponse(url) || new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<TransactionFormPage />)
    await screen.findByRole('button', { name: /submit transaction/i })
    fireEvent.click(screen.getByRole('button', { name: /submit transaction/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter an indian stock symbol and name/i)
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/transactions') && options?.method === 'POST')).toBe(false)
  })

  it('posts the exact portfolio transaction shape and displays the backend failure', async () => {
    localStorage.setItem('ledgerly_access_token', 'test-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const initial = authResponse(url)
      if (initial) return initial
      if (url.endsWith('/portfolios/portfolio-1/transactions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ detail: { message: 'Blockchain audit unavailable. Reconcile this record.', transaction_id: 'pending-tx-1', audit_status: 'RECONCILIATION_REQUIRED' } }), { status: 503 })
      }
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<TransactionFormPage />)
    await screen.findByLabelText('Indian stock symbol')
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Indian stock symbol'), { target: { value: 'reliance' } })
    fireEvent.change(screen.getByLabelText('Stock name'), { target: { value: 'Reliance Industries Limited' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/unit price/i), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Transaction date'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: /submit transaction/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Blockchain audit unavailable. Reconcile this record. (Transaction ID: pending-tx-1)')
    expect(screen.getByRole('link', { name: /open transaction record/i })).toHaveAttribute('href', '/app/transactions/pending-tx-1')
    const [url, options] = fetchMock.mock.calls.find(([value, init]) => String(value).endsWith('/portfolios/portfolio-1/transactions') && init?.method === 'POST')!
    expect(url).toBe('http://localhost:8000/api/portfolios/portfolio-1/transactions')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(JSON.parse(String(options?.body))).toEqual({
      symbol: 'RELIANCE', asset_name: 'Reliance Industries Limited', category: 'Stocks', action: 'BUY',
      quantity: '2', unit_price: '10', fee: '0', transaction_date: '2026-10-20', currency: 'INR',
    })
  })

  it('previews SELL proceeds after fees and preserves decimal strings in the payload', async () => {
    localStorage.setItem('ledgerly_access_token', 'test-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const initial = authResponse(url)
      if (initial) return initial
      if (url.endsWith('/portfolios/portfolio-1/transactions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ detail: 'Insufficient confirmed holdings for this sale.' }), { status: 422 })
      }
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<TransactionFormPage />)
    await screen.findByLabelText('Indian stock symbol')
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Indian stock symbol'), { target: { value: 'reliance' } })
    fireEvent.change(screen.getByLabelText('Stock name'), { target: { value: 'Reliance Industries Limited' } })
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'SELL' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2.125' } })
    fireEvent.change(screen.getByLabelText(/unit price/i), { target: { value: '10.50' } })
    fireEvent.change(screen.getByLabelText(/fee/i), { target: { value: '0.25' } })
    expect(screen.getByText('₹22.06')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /submit transaction/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient confirmed holdings for this sale.')
    const [, options] = fetchMock.mock.calls.find(([value, init]) => String(value).endsWith('/portfolios/portfolio-1/transactions') && init?.method === 'POST')!
    expect(JSON.parse(String(options?.body))).toMatchObject({
      action: 'SELL', quantity: '2.125', unit_price: '10.50', fee: '0.25',
    })
  })
})

describe('public blockchain audit lookup', () => {
  it('validates an empty transaction ID without requesting the audit endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderWithRouter(<AuditLookupPage />)
    fireEvent.click(screen.getByRole('button', { name: /check record/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a transaction or record id/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows unavailable distinctly from an integrity mismatch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'UNAVAILABLE',
      message: 'Audit unavailable — blockchain connection failed.',
      database_hash: 'abc123',
      recalculated_hash: 'abc123',
      on_chain_hash: null,
      on_chain_record_exists: null,
      event_verified: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderWithRouter(<AuditLookupPage />)
    fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'record-123' } })
    fireEvent.click(screen.getByRole('button', { name: /check record/i }))
    expect(await screen.findByText('Audit unavailable')).toBeInTheDocument()
    expect(screen.getByText(/this is not a pass or a mismatch/i)).toBeInTheDocument()
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/blockchain/audit/record-123',
      expect.objectContaining({ headers: expect.any(Headers) }),
    ))
  })
})

describe('admin tamper demonstration', () => {
  it('requires an admin, selected transaction, and explicit demo price', async () => {
    localStorage.setItem('ledgerly_access_token', 'admin-token')
    const tx = {
      id: 'transaction-1', portfolio_id: 'portfolio-1', symbol: 'RELIANCE', asset_name: 'Reliance Industries Limited',
      category: 'Stocks', action: 'BUY', quantity: '2', unit_price: '10', fee: '0',
      transaction_date: '2026-10-20', currency: 'INR', canonical_hash: 'abc', hash_schema_version: 'portfolio-tx-v1',
      audit_status: 'CONFIRMED', blockchain_tx_hash: '0xhash', block_number: 1, contract_address: null, created_at: '2026-10-20T00:00:00',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'admin-1', email: 'admin@example.com', is_admin: true, demo_tampering_enabled: true }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([{ id: 'portfolio-1', name: 'Test portfolio', base_currency: 'INR', created_at: '2026-01-01' }]), { status: 200 })
      if (url.includes('/portfolios/portfolio-1/transactions')) return new Response(JSON.stringify({ items: [tx], total: 1, limit: 100, offset: 0 }), { status: 200 })
      if (url.endsWith('/demo/tamper/transaction-1')) return new Response(JSON.stringify({ transaction_id: 'transaction-1', tampered: true, audit_status: 'CONFIRMED' }), { status: 200 })
      if (url.endsWith('/transactions/transaction-1/audit')) return new Response(JSON.stringify({ status: 'TAMPERING_DETECTED', database_hash: 'abc', recalculated_hash: 'def' }), { status: 200 })
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<AuditPage />)
    const transactionSelect = await screen.findByLabelText('Select transaction to audit')
    fireEvent.change(transactionSelect, { target: { value: 'transaction-1' } })
    fireEvent.click(screen.getByRole('button', { name: /run tamper demo/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/explicit demo unit price/i)
    fireEvent.change(screen.getByLabelText(/demo unit price/i), { target: { value: '12.5' } })
    expect(screen.getByLabelText(/demo unit price/i)).toHaveValue(12.5)
    fireEvent.click(screen.getByRole('button', { name: /run tamper demo/i }))
    expect(await screen.findByText('Mismatch detected')).toBeInTheDocument()
    expect(screen.getByText('Backend demo response')).toBeInTheDocument()
    expect(screen.getByText('TAMPERING_DETECTED')).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls.find(([value, init]) => String(value).endsWith('/demo/tamper/transaction-1') && init?.method === 'POST')!
    expect(url).toBe('http://localhost:8000/api/demo/tamper/transaction-1')
    expect(JSON.parse(String(options?.body))).toEqual({ unit_price: '12.5' })
  })

  it('does not expose the demo control to non-admin accounts', async () => {
    localStorage.setItem('ledgerly_access_token', 'user-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'user-1', email: 'user@example.com', is_admin: false, demo_tampering_enabled: false }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([{ id: 'portfolio-1', name: 'Test portfolio', base_currency: 'INR', created_at: '2026-01-01' }]), { status: 200 })
      if (url.includes('/portfolios/portfolio-1/transactions')) return new Response(JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }), { status: 200 })
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<AuditPage />)
    expect(await screen.findByText(/tamper demonstration is available only to administrator accounts/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run tamper demo/i })).not.toBeInTheDocument()
  })

  it('explains when an admin cannot use the demo because the backend disabled it', async () => {
    localStorage.setItem('ledgerly_access_token', 'admin-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'admin-1', email: 'admin@example.com', is_admin: true, demo_tampering_enabled: false }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<AuditPage />)
    expect(await screen.findByText(/tamper demonstration disabled/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run tamper demo/i })).not.toBeInTheDocument()
  })
})

describe('read-only profile', () => {
  it('loads account details from the authenticated profile endpoint', async () => {
    localStorage.setItem('ledgerly_access_token', 'profile-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'user-profile-1', email: 'profile@example.com', is_admin: false, demo_tampering_enabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderWithRouter(<ProfilePage />)
    expect((await screen.findAllByText('profile@example.com')).length).toBeGreaterThan(0)
    expect(screen.getByText('Standard user')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/auth/me',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
  })
})

describe('admin asset price controls', () => {
  const asset = { id: 'asset-1', symbol: 'RELIANCE', name: 'Reliance Industries Limited', category: 'Stocks', latest_price: '100', simulated: true }

  it('disables price updates for non-admin accounts', async () => {
    localStorage.setItem('ledgerly_access_token', 'user-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'user-1', email: 'user@example.com', is_admin: false, demo_tampering_enabled: false }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([]), { status: 200 })
      if (url.endsWith('/assets')) return new Response(JSON.stringify([asset]), { status: 200 })
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<ValuationsPage />)
    expect(await screen.findByRole('button', { name: /update price for reliance \(administrator only\)/i })).toBeDisabled()
    expect(screen.getByText(/administrator authorization required/i)).toBeInTheDocument()
  })

  it('shows the backend 403 response clearly to an admin when a price update is forbidden', async () => {
    localStorage.setItem('ledgerly_access_token', 'admin-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'admin-1', email: 'admin@example.com', is_admin: true, demo_tampering_enabled: false }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([]), { status: 200 })
      if (url.endsWith('/assets') && init?.method !== 'PATCH') return new Response(JSON.stringify([asset]), { status: 200 })
      if (url.endsWith('/assets/asset-1/price') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ detail: 'Administrator authorization required.' }), { status: 403 })
      }
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<ValuationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('403 Forbidden — Administrator authorization required.')
  })

  it('sends simulated asset prices as decimal strings for creation and price updates', async () => {
    localStorage.setItem('ledgerly_access_token', 'admin-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'admin-1', email: 'admin@example.com', is_admin: true, demo_tampering_enabled: false }), { status: 200 })
      if (url.endsWith('/portfolios')) return new Response(JSON.stringify([]), { status: 200 })
      if (url.endsWith('/assets') && init?.method !== 'POST') return new Response(JSON.stringify([asset]), { status: 200 })
      if (url.endsWith('/assets/asset-1/price') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ...asset, latest_price: '123.4500' }), { status: 200 })
      }
      if (url.endsWith('/assets') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ...asset, id: 'asset-2', symbol: 'TCS', name: 'Tata Consultancy Services Limited', latest_price: '0.0001250' }), { status: 201 })
      }
      return new Response(JSON.stringify({ detail: 'Unexpected request.' }), { status: 500 })
    })
    renderWithRouter(<ValuationsPage />)
    fireEvent.change(await screen.findByLabelText('New price for RELIANCE'), { target: { value: '123.4500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await screen.findByText(/updated simulated price/i)
    fireEvent.change(screen.getByLabelText('Indian stock symbol'), { target: { value: 'TCS' } })
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Tata Consultancy Services Limited' } })
    fireEvent.change(screen.getByLabelText('Initial simulated price'), { target: { value: '0.0001250' } })
    fireEvent.click(screen.getByRole('button', { name: /add stock/i }))
    await screen.findByText(/created asset tcs/i)
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/assets/asset-1/price') && init?.method === 'PATCH')!
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/assets') && init?.method === 'POST')!
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ latest_price: '123.4500' })
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({
      symbol: 'TCS', name: 'Tata Consultancy Services Limited', category: 'Stocks', latest_price: '0.0001250',
    })
  })
})
