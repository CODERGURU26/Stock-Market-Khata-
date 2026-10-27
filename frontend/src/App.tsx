import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import {
  AuditLookupPage, AuditPage, DashboardPage, HoldingsPage,
  LandingPage, LoginPage, PortfolioCreatePage, ProfilePage, RegisterPage, TransactionDetailPage,
  TransactionFormPage, TransactionsPage, ValuationsPage,
} from './pages'

function Protected({ children }: { children: JSX.Element }) {
  const { token } = useAuth()
  const location = useLocation()
  return token ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/audit-lookup" element={<AuditLookupPage />} />
    <Route path="/app" element={<Protected><DashboardPage /></Protected>} />
    <Route path="/app/portfolios/new" element={<Protected><PortfolioCreatePage /></Protected>} />
    <Route path="/app/holdings" element={<Protected><HoldingsPage /></Protected>} />
    <Route path="/app/transactions" element={<Protected><TransactionsPage /></Protected>} />
    <Route path="/app/transactions/new" element={<Protected><TransactionFormPage /></Protected>} />
    <Route path="/app/transactions/:id" element={<Protected><TransactionDetailPage /></Protected>} />
    <Route path="/app/explorer" element={<Navigate to="/app" replace />} />
    <Route path="/app/audit" element={<Protected><AuditPage /></Protected>} />
    <Route path="/app/valuations" element={<Protected><ValuationsPage /></Protected>} />
    <Route path="/app/profile" element={<Protected><ProfilePage /></Protected>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
