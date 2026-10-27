export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
export const TOKEN_KEY = 'ledgerly_access_token'

export class ApiError extends Error {
  status: number
  transactionId?: string
  constructor(message: string, status: number, transactionId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.transactionId = transactionId
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${API_URL}/api${path}`, { ...init, headers })
  } catch {
    throw new ApiError(`Can't reach the API at ${API_URL}. Check the server and VITE_API_URL.`, 0)
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    let transactionId: string | undefined
    try {
      const body = await response.json()
      const detail = body.detail || body.message || body.error
      if (typeof detail === 'string') message = detail
      else if (detail && typeof detail.message === 'string') {
        message = detail.message
        if (typeof detail.transaction_id === 'string') {
          transactionId = detail.transaction_id
          message += ` (Transaction ID: ${transactionId})`
        }
      }
      else if (Array.isArray(detail)) message = detail.map(item => item.msg || item.message || String(item)).join('; ')
    } catch { /* Use the status message when the response is not JSON. */ }
    throw new ApiError(message, response.status, transactionId)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const id = (value: string) => encodeURIComponent(value)
export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<User>('/auth/me'),
  portfolios: () => request<Portfolio[]>('/portfolios'),
  createPortfolio: (name: string, base_currency: string) =>
    request<Portfolio>('/portfolios', { method: 'POST', body: JSON.stringify({ name, base_currency }) }),
  portfolio: (portfolioId: string) => request<Portfolio>(`/portfolios/${id(portfolioId)}`),
  holdings: (portfolioId: string) => request<Holding[]>(`/portfolios/${id(portfolioId)}/holdings`),
  performance: (portfolioId: string) => request<PortfolioPerformance>(`/portfolios/${id(portfolioId)}/performance`),
  transactions: (portfolioId: string, offset = 0, limit = 50) =>
    request<TransactionPage>(`/portfolios/${id(portfolioId)}/transactions?limit=${limit}&offset=${offset}`),
  transaction: (transactionId: string) => request<Transaction>(`/transactions/${id(transactionId)}`),
  createTransaction: (portfolioId: string, data: TransactionInput) =>
    request<Transaction>(`/portfolios/${id(portfolioId)}/transactions`, { method: 'POST', body: JSON.stringify(data) }),
  transactionAudit: (transactionId: string) => request<AuditResult>(`/transactions/${id(transactionId)}/audit`),
  assets: () => request<Asset[]>('/assets'),
  createAsset: (data: AssetInput) => request<Asset>('/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAssetPrice: (assetId: string, latest_price: string) =>
    request<Asset>(`/assets/${id(assetId)}/price`, { method: 'PATCH', body: JSON.stringify({ latest_price }) }),
  blockchainStatus: () => request<BlockchainStatus>('/blockchain/status'),
  blockchainAudits: (limit = 20) => request<Transaction[]>(`/blockchain/audits?limit=${limit}`),
  blocks: (limit = 10) => request<BlockPage>(`/blockchain/blocks?limit=${limit}`),
  blockchainTransaction: (hash: string) => request<ChainTransaction>(`/blockchain/transactions/${id(hash)}`),
  publicAudit: (transactionId: string) => request<AuditResult>(`/blockchain/audit/${id(transactionId)}`),
  reconcile: () => request<ReconcileResult>('/blockchain/reconcile', { method: 'POST' }),
  dashboardSummary: () => request<DashboardSummary>('/dashboard/summary'),
  dashboardAllocation: () => request<Allocation[]>('/dashboard/allocation'),
  dashboardPerformance: () => request<DashboardPerformance[]>('/dashboard/performance'),
  tamper: (transactionId: string, unit_price: string) =>
    request<TamperResult>(`/demo/tamper/${id(transactionId)}`, { method: 'POST', body: JSON.stringify({ unit_price }) }),
}

export interface AuthResponse { id: string; email: string; access_token: string }
export interface User { id: string; email: string; is_admin: boolean; demo_tampering_enabled: boolean }
export interface Portfolio { id: string; name: string; base_currency: string; created_at: string }
export interface Holding {
  asset_id: string; symbol: string; name: string; category: string; quantity: string
  average_cost: string; latest_price: string; invested_value: string; current_value: string
  unrealized_pnl: string; realized_pnl: string
}
export interface PortfolioPerformance {
  total_invested: string; current_value: string; unrealized_pnl: string; realized_pnl: string
  total_fees: string; holdings_count: number; audited_transactions: number; audit_status: string; currency: string
}
export interface Transaction {
  id: string; portfolio_id: string; symbol: string; asset_name: string; category: string
  action: 'BUY' | 'SELL'; quantity: string; unit_price: string; fee: string; transaction_date: string
  currency: string; canonical_hash: string; hash_schema_version: string; audit_status: string
  blockchain_tx_hash: string | null; block_number: number | null; contract_address: string | null; created_at: string
}
export interface TransactionInput {
  symbol: string; asset_name: string; category: string; action: 'BUY' | 'SELL'
  quantity: string; unit_price: string; fee: string; transaction_date: string; currency: string
}
export interface TransactionPage { items: Transaction[]; total: number; limit: number; offset: number }
export interface AuditResult {
  status: 'VALID' | 'UNAVAILABLE' | 'TAMPERING_DETECTED' | 'INVALID' | string
  message?: string; database_hash?: string; recalculated_hash?: string
  database_matches_original?: boolean; on_chain_hash?: string | null; on_chain_record_exists?: boolean | null
  event_verified?: boolean | null; receipt_status?: string; blockchain_tx_hash?: string | null; block_number?: number | null
}
export interface Asset { id: string; symbol: string; name: string; category: string; latest_price: string; simulated: boolean }
export interface AssetInput { symbol: string; name: string; category: string; latest_price: string }
export interface BlockchainStatus { connected: boolean; error?: string; chain_id?: number | null; latest_block?: number | null; contract_address?: string | null }
export interface BlockchainAudit extends Transaction {}
export interface Block { number: number; hash: string; timestamp: number; transaction_count: number; transactions: string[] }
export interface BlockPage { latest_block: number; blocks: Block[] }
export interface ChainTransaction {
  hash: string; block_number: number; status: number; from: string; to: string
  gas_used: number; contract_address: string | null
}
export interface ReconcileResult { confirmed: number; needs_attention: number }
export interface DashboardSummary {
  total_invested: string; current_value: string; unrealized_pnl: string; realized_pnl: string
  total_fees: string; holdings_count: number; audited_transactions: number; audit_status: string; currency: string
}
export interface Allocation { category: string; value: string }
export interface DashboardPerformance { symbol: string; unrealized_pnl: string; current_value: string }
export interface TamperResult { transaction_id: string; tampered: boolean; audit_status: string }
