import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, TOKEN_KEY, type Portfolio, type User } from './api'

const PORTFOLIO_KEY = 'ledgerly_selected_portfolio'
interface AuthContextValue {
  token: string | null
  user: User | null
  portfolios: Portfolio[]
  selectedPortfolio: Portfolio | null
  loadingAccount: boolean
  accountError: string
  signIn: (token: string) => void
  signOut: () => void
  selectPortfolio: (id: string) => void
  refreshPortfolios: () => Promise<void>
  createPortfolio: (name: string, currency: string) => Promise<Portfolio>
}
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(null)
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(PORTFOLIO_KEY) || '')
  const [loadingAccount, setLoadingAccount] = useState(false)
  const [accountError, setAccountError] = useState('')

  const refreshPortfolios = useCallback(async () => {
    const result = await api.portfolios()
    setPortfolios(result)
    const saved = localStorage.getItem(PORTFOLIO_KEY)
    const selected = result.find(portfolio => portfolio.id === saved) || result[0]
    if (selected) {
      localStorage.setItem(PORTFOLIO_KEY, selected.id)
      setSelectedId(selected.id)
    } else {
      localStorage.removeItem(PORTFOLIO_KEY)
      setSelectedId('')
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setUser(null); setPortfolios([]); setAccountError('')
      return
    }
    let active = true
    setLoadingAccount(true)
    setAccountError('')
    Promise.all([api.me(), api.portfolios()])
      .then(([me, list]) => {
        if (!active) return
        setUser(me)
        setPortfolios(list)
        const saved = localStorage.getItem(PORTFOLIO_KEY)
        const selected = list.find(portfolio => portfolio.id === saved) || list[0]
        if (selected) {
          localStorage.setItem(PORTFOLIO_KEY, selected.id)
          setSelectedId(selected.id)
        } else {
          localStorage.removeItem(PORTFOLIO_KEY)
          setSelectedId('')
        }
      })
      .catch(reason => {
        if (!active) return
        setAccountError(reason instanceof Error ? reason.message : 'Unable to load account.')
        if ('status' in (reason as object) && (reason as { status?: number }).status === 401) {
          localStorage.removeItem(TOKEN_KEY)
          setToken(null)
        }
      })
      .finally(() => { if (active) setLoadingAccount(false) })
    return () => { active = false }
  }, [token])

  const signIn = (value: string) => {
    localStorage.setItem(TOKEN_KEY, value)
    setToken(value)
  }
  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PORTFOLIO_KEY)
    setToken(null); setUser(null); setPortfolios([]); setSelectedId('')
  }
  const selectPortfolio = (id: string) => {
    localStorage.setItem(PORTFOLIO_KEY, id)
    setSelectedId(id)
  }
  const createPortfolio = async (name: string, currency: string) => {
    const portfolio = await api.createPortfolio(name, currency)
    setPortfolios(current => [...current, portfolio])
    selectPortfolio(portfolio.id)
    return portfolio
  }
  const selectedPortfolio = portfolios.find(portfolio => portfolio.id === selectedId) || null
  const value = useMemo(() => ({
    token, user, portfolios, selectedPortfolio, loadingAccount, accountError,
    signIn, signOut, selectPortfolio, refreshPortfolios, createPortfolio,
  }), [token, user, portfolios, selectedPortfolio, loadingAccount, accountError, refreshPortfolios])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
