import { Link, NavLink } from 'react-router-dom'
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck,
  Blocks, BriefcaseBusiness, Check, ChevronDown, CircleAlert, CircleHelp,
  Coins, ExternalLink, FileSearch, Fingerprint, LayoutDashboard, LogOut,
  Menu, Plus, Search, Settings, ShieldCheck, Wallet, X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAuth } from './auth'

export const Icon = {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck,
  Blocks, BriefcaseBusiness, Check, ChevronDown, CircleAlert, CircleHelp,
  Coins, ExternalLink, FileSearch, Fingerprint, LayoutDashboard, LogOut,
  Menu, Plus, Search, Settings, ShieldCheck, Wallet, X,
}

export function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Ledgerly home">
    <span className="brand-mark"><Icon.Blocks size={18} strokeWidth={2.2} /></span>
    <span>ledgerly<span className="brand-period">.</span></span>
  </Link>
}

const navigation = [
  { to: '/app', label: 'Overview', icon: Icon.LayoutDashboard, end: true },
  { to: '/app/holdings', label: 'Holdings', icon: Icon.BriefcaseBusiness },
  { to: '/app/transactions', label: 'Transactions', icon: Icon.Activity },
  { to: '/app/audit', label: 'Audit & integrity', icon: Icon.ShieldCheck },
  { to: '/app/valuations', label: 'Valuations', icon: Icon.Coins },
  { to: '/app/profile', label: 'Profile', icon: Icon.Settings },
]

export function AppShell({ children, title, description, actions }: {
  children: ReactNode; title: string; description?: string; actions?: ReactNode
}) {
  const { signOut, portfolios, selectedPortfolio, selectPortfolio, user, loadingAccount } = useAuth()
  const [open, setOpen] = useState(false)
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon.X /></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">
        {navigation.map(({ to, label, icon: NavIcon, end }) => <NavLink key={to} to={to} end={end}
          onClick={() => setOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <NavIcon size={18} /><span>{label}</span>
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-help"><span className="help-icon"><Icon.CircleHelp size={17} /></span><div><strong>Need a hand?</strong><span>Visit the help center</span></div><Icon.ArrowUpRight size={15} /></div>
        <Link className="nav-item" to="/app/portfolios/new"><Icon.Plus size={18} /><span>Create portfolio</span></Link>
        <button className="nav-item signout-button" onClick={signOut}><Icon.LogOut size={18} /><span>Sign out</span></button>
        <div className="user-mini"><div className="avatar">{user?.email.slice(0, 2).toUpperCase() || '…'}</div><div><strong>{user?.email || 'Account'}</strong><span>{user?.is_admin ? 'Administrator' : 'Portfolio workspace'}</span></div></div>
      </div>
    </aside>
    {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" aria-label="Open menu" onClick={() => setOpen(true)}><Icon.Menu /></button>
        <div className="breadcrumbs">Workspace <span>/</span> <b>{title}</b></div>
        <div className="topbar-right"><span className="api-status"><i /> API data on request</span>
          {loadingAccount ? <span className="portfolio-loading">Loading portfolios…</span> : portfolios.length > 0 && <label className="portfolio-picker"><span>Portfolio</span><select aria-label="Select portfolio" value={selectedPortfolio?.id || ''} onChange={event => selectPortfolio(event.target.value)}>{portfolios.map(portfolio => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select></label>}
          <Link className="add-portfolio-link" to="/app/portfolios/new" title="Create portfolio" aria-label="Create portfolio"><Icon.Plus size={16} /></Link>
          <div className="avatar small">{user?.email.slice(0, 2).toUpperCase() || '…'}</div></div>
      </header>
      <div className="page-wrap">
        <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>
        {children}
        <footer className="app-footer"><span>Ledgerly is a portfolio recordkeeping simulation.</span><span>Values are provided by your configured API.</span></footer>
      </div>
    </main>
  </div>
}

export function Button({ children, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button className={`button button-${variant}`} {...props}>{children}</button>
}

export function Loading({ label = 'Loading data…' }: { label?: string }) {
  return <div className="state-card" role="status"><span className="spinner" />{label}</div>
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="state-card error-state" role="alert"><Icon.CircleAlert size={19} /><div><strong>We couldn’t load this data</strong><p>{error}</p>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div></div>
}
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon.FileSearch size={22} /></div><strong>{title}</strong><p>{text}</p>{action}</div>
}
export function MetricCard({ label, value, note, icon: MetricIcon, tone = 'sage', valueClassName = '' }: {
  label: string; value: string; note: string; icon: typeof Icon.Wallet; tone?: 'sage' | 'blue' | 'amber' | 'violet'; valueClassName?: string
}) {
  return <article className="metric-card"><div className="metric-label">{label}<span className={`metric-icon ${tone}`}><MetricIcon size={17} /></span></div><strong className={`metric-value ${valueClassName}`}>{value}</strong><span className="metric-note">{note}</span></article>
}
export function StatusPill({ status }: { status?: string }) {
  const value = (status || 'unknown').toLowerCase()
  const good = ['verified', 'confirmed', 'completed', 'success', 'intact', 'valid'].includes(value)
  const warn = ['pending', 'processing', 'review'].includes(value)
  const bad = ['failed', 'invalid', 'tampering_detected', 'error'].includes(value)
  return <span className={`status-pill ${good ? 'status-good' : warn ? 'status-warn' : bad ? 'status-bad' : 'status-neutral'}`}><i />{status || 'Unknown'}</span>
}
export function PublicHeader() {
  return <header className="public-header"><Brand /><nav><a href="#how-it-works">How it works</a><a href="#principles">Our principles</a></nav><div className="public-actions"><Link to="/login" className="login-link">Log in</Link><Link to="/register" className="button button-primary">Create account <Icon.ArrowRight size={16} /></Link></div></header>
}
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back-link" to={to}><Icon.ArrowLeft size={16} />{children}</Link>
}
