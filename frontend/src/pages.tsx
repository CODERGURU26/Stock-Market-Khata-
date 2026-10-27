import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, ApiError, type Allocation, type Asset, type AuditResult, type DashboardPerformance, type DashboardSummary, type Holding, type Portfolio, type PortfolioPerformance, type Transaction, type TransactionInput, type TransactionPage } from './api'
import { useAuth } from './auth'
import { AppShell, BackLink, Brand, Button, EmptyState, ErrorState, Icon, Loading, MetricCard, PublicHeader, StatusPill } from './components'

function useResource<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await load()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong.') }
    finally { setLoading(false) }
  // load identity is intentionally controlled by dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  useEffect(() => { void refresh() }, [refresh])
  return { data, loading, error, refresh, setData }
}

function money(value: number | string | null | undefined, currency = 'INR') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—'
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)) }
  catch { return `${currency} ${Number(value).toLocaleString('en-IN')}` }
}
function number(value: number | string | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 8 }).format(Number(value))
}
function pnlClass(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return ''
  return Number(value) > 0 ? 'pnl-positive' : Number(value) < 0 ? 'pnl-negative' : ''
}
function shortHash(value?: string | null) { return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : '—' }
function DataTable({ children, headers }: { headers: string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
}
function SectionTitle({ title, link, to }: { title: string; link?: string; to?: string }) {
  return <div className="section-title"><h2>{title}</h2>{link && to && <Link to={to} className="small-link">{link}<Icon.ArrowRight size={14} /></Link>}</div>
}
function NoPortfolio() {
  return <div className="panel"><EmptyState title="Create a portfolio to continue" text="Portfolio holdings and transactions are scoped to a portfolio. Create one to begin recording activity." action={<Link to="/app/portfolios/new" className="button button-primary">Create portfolio <Icon.Plus size={15} /></Link>} /></div>
}

export function LandingPage() {
  return <div className="landing-page"><PublicHeader />
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> PORTFOLIO RECORDS, MADE CLEAR</div>
      <h1>A clearer view of<br />what you <em>own.</em></h1>
      <p>Keep investment activity in one place. Review your holdings, follow transaction records, and inspect an auditable history—without the noise.</p>
      <div className="hero-actions"><Link to="/register" className="button button-primary button-large">Get started <Icon.ArrowRight size={17} /></Link><Link to="/audit-lookup" className="button button-secondary button-large"><Icon.FileSearch size={16} /> Look up a record</Link></div>
      <div className="hero-caption"><Icon.ShieldCheck size={16} /> Traceable records. Clear limitations. Your data stays yours.</div>
    </div><div className="hero-visual" aria-label="Portfolio audit workspace illustration">
      <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
      <div className="visual-card portfolio-card"><div className="visual-card-label"><span>PORTFOLIO OVERVIEW</span><span className="visual-menu">•••</span></div>
        <div className="visual-balance">Your portfolio</div><div className="visual-value">— <span>Connect your account</span></div>
        <div className="demo-chart-empty"><span>Portfolio history appears when records are available</span></div>
        <div className="visual-assets"><div><i className="asset-dot dot-green">•</i><span>Holdings</span><b>API-backed</b></div><div><i className="asset-dot dot-blue">•</i><span>Activity</span><b>Traceable</b></div></div>
      </div>
      <div className="verified-float"><span><Icon.Fingerprint size={19} /></span><div><b>Record integrity</b><small>Check records on demand</small></div><Icon.BadgeCheck className="float-check" size={18} /></div>
      <span className="hero-asterisk">✳</span><span className="hero-tiny">01 — OPEN RECORDS</span>
    </div></section>
    <section className="trust-row" id="principles"><div><span className="trust-symbol"><Icon.Blocks size={19} /></span><b>Traceable by design</b><small>Follow a record back to its chain reference.</small></div><div><span className="trust-symbol"><Icon.FileSearch size={19} /></span><b>Audit when you need to</b><small>Run a check and review the reported result.</small></div><div><span className="trust-symbol"><Icon.Wallet size={19} /></span><b>Your view, in one place</b><small>Holdings and activity from your connected API.</small></div></section>
    <section className="landing-bottom" id="how-it-works"><div><span className="eyebrow">HOW IT WORKS</span><h2>A record you can follow.<br /><em>Not a promise you have to take.</em></h2></div><p>Ledgerly is a practical portfolio-audit simulation. It displays the information supplied by your API; it does not provide investment advice, guarantee integrity, or quote real-time market prices.</p><Link to="/register" className="small-link">Explore your workspace <Icon.ArrowRight size={15} /></Link></section>
    <footer className="public-footer"><Brand /><span>© 2026 Ledgerly · Portfolio recordkeeping simulation</span><Link to="/audit-lookup">Public audit lookup</Link></footer>
  </div>
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isRegister = mode === 'register'
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSubmitting(true)
    try {
      const result = isRegister ? await api.register(email, password) : await api.login(email, password)
      signIn(result.access_token)
      navigate('/app')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to continue.') }
    finally { setSubmitting(false) }
  }
  return <div className="auth-page"><div className="auth-left"><Brand /><div className="auth-pitch"><div className="eyebrow"><span className="eyebrow-dot" /> RECORDS YOU CAN FOLLOW</div><h1>Your portfolio,<br /><em>clearly recorded.</em></h1><p>One calm place to review your investment activity, holdings, and audit trail.</p><div className="auth-pitch-foot"><Icon.ShieldCheck size={17} /> Account data is served by your configured API.</div></div><span className="auth-side-note">A PORTFOLIO AUDIT WORKSPACE</span></div>
    <div className="auth-right"><div className="auth-card"><Link to="/" className="back-link"><Icon.ArrowLeft size={15} /> Back to home</Link><div className="auth-heading"><div className="auth-icon"><Icon.Fingerprint size={21} /></div><h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2><p>{isRegister ? 'Register with an email and password.' : 'Sign in to your portfolio workspace.'}</p></div>
      <form className="form-stack" onSubmit={submit} noValidate><label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label>Password<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={isRegister ? 'At least 10 characters' : 'Your password'} required minLength={isRegister ? 10 : 1} /></label>
        {error && <div className="inline-error" role="alert"><Icon.CircleAlert size={16} />{error}</div>}<Button type="submit" disabled={submitting || !email || !password}>{submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'} <Icon.ArrowRight size={16} /></Button>
      </form><p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Ledgerly?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p><div className="form-disclaimer"><Icon.CircleHelp size={15} /> Requires a running backend configured with <code>VITE_API_URL</code>.</div>
    </div><footer>Portfolio recordkeeping simulation · No investment advice</footer></div></div>
}
export function LoginPage() { return <AuthPage mode="login" /> }
export function RegisterPage() { return <AuthPage mode="register" /> }

export function DashboardPage() {
  const summary = useResource<DashboardSummary>(() => api.dashboardSummary(), [])
  const allocation = useResource<Allocation[]>(() => api.dashboardAllocation(), [])
  const performance = useResource<DashboardPerformance[]>(() => api.dashboardPerformance(), [])
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const { selectedPortfolio } = useAuth()
  const activity = useResource<TransactionPage>(
    () => selectedPortfolio
      ? api.transactions(selectedPortfolio.id, 0, 100)
      : Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 }),
    [selectedPortfolio?.id],
  )
  useEffect(() => { if (!selectedPortfolio) { setPortfolio(null); return }; void api.portfolio(selectedPortfolio.id).then(setPortfolio).catch(() => setPortfolio(selectedPortfolio)) }, [selectedPortfolio])
  const activityByDate = useMemo(() => {
    const daily = new Map<string, { date: string; BUY: number; SELL: number }>()
    for (const transaction of activity.data?.items || []) {
      if (transaction.audit_status !== 'CONFIRMED' || !['BUY', 'SELL'].includes(transaction.action)) continue
      const current = daily.get(transaction.transaction_date) || { date: transaction.transaction_date, BUY: 0, SELL: 0 }
      current[transaction.action] += 1
      daily.set(transaction.transaction_date, current)
    }
    return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [activity.data])
  return <AppShell title="Overview" description={portfolio ? `Portfolio: ${portfolio.name} · account-wide summary from your API.` : 'Account-wide summary returned by your API.'} actions={<Link to="/app/portfolios/new" className="button button-secondary"><Icon.Plus size={15} /> New portfolio</Link>}>
    {summary.loading ? <Loading label="Loading dashboard…" /> : summary.error ? <ErrorState error={summary.error} retry={summary.refresh} /> : summary.data && <>
      <div className="metrics-grid">
        <MetricCard label="Current value" value={money(summary.data.current_value, summary.data.currency)} note="Confirmed holdings at API prices" icon={Icon.Wallet} tone="sage" />
        <MetricCard label="Total invested" value={money(summary.data.total_invested, summary.data.currency)} note="Confirmed buy records" icon={Icon.Coins} tone="blue" />
        <MetricCard label="Unrealized P&L" value={money(summary.data.unrealized_pnl, summary.data.currency)} note="Reported holding value less cost" icon={Icon.Activity} tone="violet" valueClassName={pnlClass(summary.data.unrealized_pnl)} />
        <MetricCard label="Realized P&L" value={money(summary.data.realized_pnl, summary.data.currency)} note="Reported confirmed sales" icon={Icon.ArrowUpRight} tone="amber" valueClassName={pnlClass(summary.data.realized_pnl)} />
        <MetricCard label="Total fees" value={money(summary.data.total_fees, summary.data.currency)} note="Fees in confirmed records" icon={Icon.Coins} tone="amber" />
        <MetricCard label="Holdings" value={number(summary.data.holdings_count)} note="Confirmed positions" icon={Icon.BriefcaseBusiness} />
        <MetricCard label="Audited transactions" value={number(summary.data.audited_transactions)} note={`Overall audit: ${summary.data.audit_status.replace(/_/g, ' ')}`} icon={Icon.ShieldCheck} tone={summary.data.audit_status === 'VALID' ? 'sage' : 'violet'} />
      </div>
      <div className="notice-banner"><Icon.CircleHelp size={17} /><span><b>Historical valuation series unavailable</b> — the dashboard API returns current holdings and performance by asset, not a time series. No historical values are inferred.</span></div>
      <div className="dashboard-grid"><section className="panel chart-panel"><SectionTitle title="Unrealized P&L by asset" /><p className="panel-subtitle">Uses the unrealized_pnl values returned by the dashboard API</p>
        {performance.loading ? <Loading label="Loading performance…" /> : performance.error ? <ErrorState error={performance.error} retry={performance.refresh} /> : !performance.data?.length ? <EmptyState title="No P&L data" text="The API has not returned confirmed holdings." /> : <div className="chart-wrap"><ResponsiveContainer width="100%" height={250}><BarChart data={performance.data.map(item => ({ ...item, unrealized_pnl: Number(item.unrealized_pnl) })).filter(item => Number.isFinite(item.unrealized_pnl))} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}><CartesianGrid vertical={false} stroke="#edf0ee" /><XAxis dataKey="symbol" tickLine={false} axisLine={false} tick={{ fill: '#89928e', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#89928e', fontSize: 10 }} tickFormatter={value => `₹${Number(value).toLocaleString('en-IN')}`} width={70} /><Tooltip formatter={(value: number) => [money(value), 'Unrealized P&L']} /><Bar dataKey="unrealized_pnl" radius={[4, 4, 0, 0]}>{performance.data.map((item, index) => <Cell key={`${item.symbol}-${index}`} fill={Number(item.unrealized_pnl) >= 0 ? '#3d8b63' : '#c46158'} />)}</Bar></BarChart></ResponsiveContainer></div>}
      </section><section className="panel integrity-card"><div className="integrity-icon"><Icon.Fingerprint size={22} /></div><span className="eyebrow">RECORD INTEGRITY</span><h3>{summary.data.audit_status.replace(/_/g, ' ')}</h3><p>Aggregate audit status returned by your account records.</p><Link to="/app/audit" className="button button-dark">Open audit tools <Icon.ArrowRight size={15} /></Link><div className="integrity-foot"><Icon.ShieldCheck size={15} /> Status reported by the backend</div></section></div>
      <section className="panel recent-panel"><SectionTitle title="Portfolio allocation" link="View holdings" to="/app/holdings" />
        {allocation.loading ? <Loading label="Loading allocation…" /> : allocation.error ? <ErrorState error={allocation.error} retry={allocation.refresh} /> : !allocation.data?.length ? <EmptyState title="No allocation data" text="The API has not returned any confirmed positions." /> : <div className="allocation-layout"><div className="allocation-chart"><ResponsiveContainer width="100%" height={270}><PieChart><Pie data={allocation.data.map(item => ({ ...item, value: Number(item.value) })).filter(item => Number.isFinite(item.value) && item.value >= 0)} dataKey="value" nameKey="category" cx="50%" cy="50%" innerRadius={66} outerRadius={100} paddingAngle={2}>{allocation.data.map((item, index) => <Cell key={item.category} fill={['#4e8d6a', '#79a991', '#adc9b6', '#d2a866', '#7592a7', '#897eaa'][index % 6]} />)}</Pie><Tooltip formatter={(value: number) => [money(value), 'Reported value']} /><Legend /></PieChart></ResponsiveContainer></div><div className="allocation-table"><DataTable headers={['Category', 'Reported value']}><>{allocation.data.map(item => <tr key={item.category}><td>{item.category}</td><td className="amount-cell">{money(item.value)}</td></tr>)}</></DataTable></div></div>}
      </section>
      <section className="panel activity-chart-panel">
        <SectionTitle title="Confirmed transaction activity" link="All transactions" to="/app/transactions" />
        <p className="panel-subtitle">BUY and SELL counts by recorded date from this portfolio’s transaction records (up to 100 latest records).</p>
        {activity.loading ? <Loading label="Loading transaction activity…" /> : activity.error ? <ErrorState error={activity.error} retry={activity.refresh} /> : !activityByDate.length ? <EmptyState title="No confirmed transaction activity" text="Confirmed BUY/SELL records will appear here when returned by the selected portfolio API." /> : <div className="activity-chart-wrap"><ResponsiveContainer width="100%" height={250}><BarChart data={activityByDate} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}><CartesianGrid vertical={false} stroke="#edf0ee" /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#89928e', fontSize: 10 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#89928e', fontSize: 10 }} /><Tooltip formatter={(value: number, name: string) => [value, name]} /><Legend /><Bar dataKey="BUY" name="Buy count" fill="#3d8b63" radius={[3, 3, 0, 0]} /><Bar dataKey="SELL" name="Sell count" fill="#c46158" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </section>
    </>}
  </AppShell>
}

export function PortfolioCreatePage() {
  const { createPortfolio } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!name.trim()) { setError('Enter a portfolio name.'); return }
    setSaving(true)
    try { await createPortfolio(name.trim(), currency); navigate('/app') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create portfolio.') }
    finally { setSaving(false) }
  }
  return <AppShell title="Create portfolio" description="Create a portfolio to organize investment transactions and holdings."><BackLink to="/app">Back to overview</BackLink><section className="panel form-panel portfolio-form"><h2>Portfolio details</h2><p className="panel-subtitle">Currency is used for transactions and displayed values.</p><form className="form-stack" onSubmit={submit}><label>Portfolio name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Long-term portfolio" required /></label><label>Base currency<select value={currency} onChange={event => setCurrency(event.target.value)}><option value="INR">Indian Rupee (INR)</option><option value="USD">US Dollar (USD)</option><option value="EUR">Euro (EUR)</option><option value="GBP">British Pound (GBP)</option></select></label>{error && <div className="inline-error" role="alert"><Icon.CircleAlert size={16} />{error}</div>}<div className="form-actions"><Link to="/app" className="button button-secondary">Cancel</Link><Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create portfolio'} <Icon.ArrowRight size={16} /></Button></div></form></section></AppShell>
}

export function HoldingsPage() {
  const { selectedPortfolio } = useAuth()
  const { data, loading, error, refresh } = useResource<Holding[]>(() => selectedPortfolio ? api.holdings(selectedPortfolio.id) : Promise.resolve([]), [selectedPortfolio?.id])
  const perf = useResource<PortfolioPerformance>(() => selectedPortfolio ? api.performance(selectedPortfolio.id) : Promise.reject(new Error('Select a portfolio.')), [selectedPortfolio?.id])
  return <AppShell title="Holdings" description={selectedPortfolio ? `${selectedPortfolio.name} · positions from confirmed transactions.` : 'Select a portfolio to review positions.'} actions={selectedPortfolio && <Button variant="secondary" onClick={refresh}><Icon.Activity size={16} /> Refresh</Button>}>
    {!selectedPortfolio ? <NoPortfolio /> : loading ? <Loading label="Loading holdings…" /> : error ? <ErrorState error={error} retry={refresh} /> : <><div className="metrics-grid"><MetricCard label="Current value" value={money(perf.data?.current_value, selectedPortfolio.base_currency)} note="Reported by portfolio API" icon={Icon.Wallet} /><MetricCard label="Invested" value={money(perf.data?.total_invested, selectedPortfolio.base_currency)} note="Confirmed BUY records" icon={Icon.Coins} /><MetricCard label="Unrealized P&L" value={money(perf.data?.unrealized_pnl, selectedPortfolio.base_currency)} note="Reported holding valuation" icon={Icon.Activity} valueClassName={pnlClass(perf.data?.unrealized_pnl)} /><MetricCard label="Realized P&L" value={money(perf.data?.realized_pnl, selectedPortfolio.base_currency)} note="Confirmed SELL records" icon={Icon.BriefcaseBusiness} valueClassName={pnlClass(perf.data?.realized_pnl)} /></div>
      {!data?.length ? <div className="panel"><EmptyState title="No confirmed holdings" text="Only confirmed blockchain-audited transactions are reflected in holdings." action={<Link to="/app/transactions/new" className="small-link">Record a transaction <Icon.ArrowRight size={14} /></Link>} /></div> : <section className="panel"><DataTable headers={['Asset', 'Category', 'Quantity', 'Average cost', 'Latest simulated price', 'Current value', 'Unrealized P&L']}>{data.map(item => <tr key={item.asset_id}><td><div className="asset-cell"><b>{item.name}</b><small>{item.symbol}</small></div></td><td>{item.category}</td><td>{number(item.quantity)}</td><td>{money(item.average_cost, selectedPortfolio.base_currency)}</td><td>{money(item.latest_price, selectedPortfolio.base_currency)}</td><td className="amount-cell">{money(item.current_value, selectedPortfolio.base_currency)}</td><td className={pnlClass(item.unrealized_pnl)}>{money(item.unrealized_pnl, selectedPortfolio.base_currency)}</td></tr>)}</DataTable><div className="table-footnote">Asset prices are simulated backend values, not live market quotes.</div></section>}</>}
  </AppShell>
}

export function TransactionsPage() {
  const { selectedPortfolio } = useAuth()
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const { data, loading, error, refresh } = useResource<TransactionPage>(() => selectedPortfolio ? api.transactions(selectedPortfolio.id, offset) : Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 }), [selectedPortfolio?.id, offset])
  const filtered = useMemo(() => (data?.items || []).filter(tx => `${tx.id} ${tx.symbol} ${tx.asset_name} ${tx.action} ${tx.audit_status}`.toLowerCase().includes(query.toLowerCase())), [data, query])
  return <AppShell title="Transactions" description={selectedPortfolio ? `${selectedPortfolio.name} · review recorded activity.` : 'Select a portfolio to review activity.'} actions={selectedPortfolio && <><Button variant="secondary" onClick={refresh}><Icon.Activity size={16} /> Refresh</Button><Link to="/app/transactions/new" className="button button-primary"><Icon.Plus size={16} /> New transaction</Link></>}>
    {!selectedPortfolio ? <NoPortfolio /> : <><div className="filter-row"><label className="search-field"><Icon.Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activity" aria-label="Search transactions" /></label><span>{data ? `${data.total} total records` : ''}</span></div>
      {loading ? <Loading label="Loading transactions…" /> : error ? <ErrorState error={error} retry={refresh} /> : (!data || !filtered.length) ? <div className="panel"><EmptyState title={query ? 'No matching transactions' : 'No transactions yet'} text={query ? 'Try another search term.' : 'Only transactions confirmed by the blockchain API are displayed.'} action={!query && <Link className="small-link" to="/app/transactions/new">Record a transaction <Icon.ArrowRight size={14} /></Link>} /></div> : <section className="panel"><DataTable headers={['Record', 'Action', 'Asset', 'Quantity', 'Unit price', 'Fee', 'Date', 'Audit status']}>{filtered.map(tx => <tr key={tx.id}><td><Link className="table-main-link mono" to={`/app/transactions/${encodeURIComponent(tx.id)}`}>{shortHash(tx.id)}</Link></td><td><span className="type-label">{tx.action}</span></td><td>{tx.asset_name} <small className="table-sub">{tx.symbol} · {tx.category}</small></td><td>{number(tx.quantity)}</td><td>{money(tx.unit_price, tx.currency)}</td><td>{money(tx.fee, tx.currency)}</td><td>{tx.transaction_date}</td><td><StatusPill status={tx.audit_status} /></td></tr>)}</DataTable><div className="table-footnote table-pagination"><span>Showing {data.offset + 1}–{Math.min(data.offset + data.items.length, data.total)} of {data.total}</span><div><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))}>Previous</Button><Button variant="secondary" disabled={offset + data.items.length >= data.total} onClick={() => setOffset(offset + data.limit)}>Next</Button></div></div></section>}
    </>}
  </AppShell>
}

export function TransactionFormPage() {
  const navigate = useNavigate()
  const { selectedPortfolio } = useAuth()
  const assets = useResource<Asset[]>(() => api.assets(), [])
  const [symbol, setSymbol] = useState('')
  const [assetName, setAssetName] = useState('')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [fee, setFee] = useState('0')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [failedTransactionId, setFailedTransactionId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const quantityValue = Number(quantity)
  const priceValue = Number(unitPrice)
  const feeValue = Number(fee)
  const previewValid = quantity.trim() !== '' && unitPrice.trim() !== '' && fee.trim() !== ''
    && Number.isFinite(quantityValue) && Number.isFinite(priceValue) && Number.isFinite(feeValue)
  const previewTotal = previewValid
    ? quantityValue * priceValue + (action === 'SELL' ? -feeValue : feeValue)
    : null
  function chooseSymbol(value: string) {
    setSymbol(value)
    const asset = assets.data?.find(item => item.symbol === value)
    if (asset) { setAssetName(asset.name); setUnitPrice(asset.latest_price) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setFailedTransactionId('')
    if (!selectedPortfolio) { setError('Create or select a portfolio first.'); return }
    if (!symbol.trim() || !assetName.trim() || !date || !quantity.trim() || !unitPrice.trim() || !fee.trim()
      || !Number.isFinite(quantityValue) || !Number.isFinite(priceValue) || !Number.isFinite(feeValue)
      || quantityValue <= 0 || priceValue <= 0 || feeValue < 0) {
      setError('Enter an Indian stock symbol and name, valid date, positive quantity and price, and a non-negative fee.'); return
    }
    setSubmitting(true)
    const payload: TransactionInput = { symbol: symbol.trim().toUpperCase(), asset_name: assetName.trim(), category: 'Stocks', action, quantity, unit_price: unitPrice, fee, transaction_date: date, currency: selectedPortfolio.base_currency }
    try { const result = await api.createTransaction(selectedPortfolio.id, payload); navigate(`/app/transactions/${encodeURIComponent(result.id)}`) }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this transaction.')
      if (reason instanceof ApiError && reason.transactionId) setFailedTransactionId(reason.transactionId)
    }
    finally { setSubmitting(false) }
  }
  return <AppShell title="New transaction" description="Record a BUY or SELL for an Indian listed stock."><BackLink to="/app/transactions">Back to transactions</BackLink>
    {!selectedPortfolio ? <NoPortfolio /> : <div className="form-layout"><section className="panel form-panel"><h2>Transaction details</h2><p className="panel-subtitle">Use an NSE/BSE-listed company symbol. Sample prices are simulated, not live quotes.</p>
      <form className="form-stack" onSubmit={submit} noValidate>
        <div className="form-two"><label>Action<select value={action} onChange={event => setAction(event.target.value as 'BUY' | 'SELL')}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label><label>Asset symbol<select value={symbol} onChange={event => chooseSymbol(event.target.value)}><option value="">Select existing asset or enter one below</option>{assets.data?.map(asset => <option key={asset.id} value={asset.symbol}>{asset.symbol} — {asset.name}</option>)}</select></label></div>
        {assets.error && <div className="helper-text">Could not load asset suggestions: {assets.error}. Enter asset details manually.</div>}
        <div className="form-two"><label>Indian stock symbol<input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} placeholder="e.g. RELIANCE" required /></label><label>Stock name<input value={assetName} onChange={event => setAssetName(event.target.value)} placeholder="Name of listed Indian company" required /></label></div>
        <label>Transaction date<input type="date" value={date} onChange={event => setDate(event.target.value)} max={new Date().toISOString().slice(0, 10)} required /></label>
        <div className="form-two"><label>Quantity<input type="number" min="0" step="any" value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="0.00" required /></label><label>Unit price ({selectedPortfolio.base_currency})<input type="number" min="0" step="any" value={unitPrice} onChange={event => setUnitPrice(event.target.value)} placeholder="0.00" required /></label></div>
        <div className="form-two"><label>Fee ({selectedPortfolio.base_currency})<input type="number" min="0" step="any" value={fee} onChange={event => setFee(event.target.value)} required /></label><div className="calculated-total"><span>{action === 'SELL' ? 'Estimated proceeds after fee' : 'Estimated total including fee'}</span><b>{previewTotal === null ? '—' : money(previewTotal, selectedPortfolio.base_currency)}</b></div></div>
        {error && <div className="inline-error transaction-error" role="alert"><Icon.CircleAlert size={16} /><span>{error}{failedTransactionId && <Link to={`/app/transactions/${encodeURIComponent(failedTransactionId)}`}>Open transaction record</Link>}</span></div>}
        <div className="form-actions"><Link to="/app/transactions" className="button button-secondary">Cancel</Link><Button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit transaction'} <Icon.ArrowRight size={16} /></Button></div>
      </form></section><aside className="form-aside"><div className="aside-icon"><Icon.ShieldCheck size={19} /></div><h3>Blockchain confirmation required</h3><p>A successful API response means the transaction was confirmed. If blockchain submission fails, reconcile before retrying.</p><div className="aside-note"><Icon.CircleHelp size={15} /> Prices in this simulation are supplied or entered by the account owner.</div></aside></div>}
  </AppShell>
}

export function TransactionDetailPage() {
  const { id = '' } = useParams()
  const { data, loading, error, refresh } = useResource<Transaction>(() => api.transaction(id), [id])
  const audit = useResource<AuditResult>(() => api.transactionAudit(id), [id])
  return <AppShell title="Transaction details"><BackLink to="/app/transactions">Back to transactions</BackLink>
    {loading ? <Loading label="Loading transaction…" /> : error ? <ErrorState error={error} retry={refresh} /> : !data ? <EmptyState title="Record unavailable" text="No transaction details were returned." /> : <section className="panel detail-panel"><div className="detail-top"><div><span className="eyebrow">TRANSACTION RECORD</span><h2>{data.asset_name} <small className="muted">{data.symbol}</small></h2></div><StatusPill status={data.audit_status} /></div>
      <dl className="detail-list"><div><dt>Record ID</dt><dd className="mono">{data.id}</dd></div><div><dt>Portfolio</dt><dd className="mono">{data.portfolio_id}</dd></div><div><dt>Action / category</dt><dd>{data.action} · {data.category}</dd></div><div><dt>Quantity</dt><dd>{number(data.quantity)}</dd></div><div><dt>Unit price</dt><dd>{money(data.unit_price, data.currency)}</dd></div><div><dt>Fee</dt><dd>{money(data.fee, data.currency)}</dd></div><div><dt>Transaction date</dt><dd>{data.transaction_date}</dd></div><div><dt>Blockchain transaction</dt><dd className="mono">{data.blockchain_tx_hash || 'Not confirmed'}</dd></div><div><dt>Block number</dt><dd>{data.block_number ?? '—'}</dd></div><div><dt>Canonical hash</dt><dd className="mono">{shortHash(data.canonical_hash)}</dd></div></dl>
      <div className="audit-detail"><SectionTitle title="Audit result" />{audit.loading ? <Loading label="Loading audit result…" /> : audit.error ? <ErrorState error={audit.error} retry={audit.refresh} /> : audit.data && <AuditResultCard result={audit.data} />}</div>
    </section>}
  </AppShell>
}

function AuditResultCard({ result }: { result: AuditResult }) {
  const unavailable = result.status === 'UNAVAILABLE'
  const mismatch = result.status === 'TAMPERING_DETECTED'
  const invalid = result.status === 'INVALID'
  return <div className={`audit-inline-result ${unavailable ? 'audit-unavailable' : mismatch || invalid ? 'audit-mismatch' : result.status === 'VALID' ? 'audit-valid' : ''}`} role="status">
    <div className="audit-report-head"><span className="audit-report-icon"><Icon.Fingerprint size={19} /></span><div><span className="eyebrow">ON-CHAIN AUDIT</span><h3>{unavailable ? 'Audit unavailable' : mismatch ? 'Mismatch detected' : invalid ? 'Audit invalid' : result.status === 'VALID' ? 'Audit valid' : result.status.replace(/_/g, ' ')}</h3></div><StatusPill status={result.status} /></div>
    {result.message && <p>{result.message}</p>}
    {unavailable && <p>Integrity could not be determined because the blockchain connection was unavailable. This is not a pass or a mismatch.</p>}
    {mismatch && <p>The stored transaction does not match the available canonical/on-chain evidence. Review the hash details below.</p>}
    {invalid && <p>The audit did not confirm every required condition. This is distinct from an unavailable audit and may not mean the transaction data itself mismatches.</p>}
    <dl className="audit-hashes"><div><dt>Database hash</dt><dd>{shortHash(result.database_hash)}</dd></div><div><dt>Recalculated hash</dt><dd>{shortHash(result.recalculated_hash)}</dd></div><div><dt>On-chain hash</dt><dd>{shortHash(result.on_chain_hash)}</dd></div><div><dt>Database matches original</dt><dd>{result.database_matches_original === undefined ? 'Not available' : result.database_matches_original ? 'Yes' : 'No'}</dd></div><div><dt>On-chain record</dt><dd>{result.on_chain_record_exists === null || result.on_chain_record_exists === undefined ? 'Not available' : result.on_chain_record_exists ? 'Exists' : 'Not found'}</dd></div><div><dt>Event verified</dt><dd>{result.event_verified === null || result.event_verified === undefined ? 'Not available' : result.event_verified ? 'Yes' : 'No'}</dd></div></dl>
  </div>
}

export function AuditLookupPage() {
  const [recordId, setRecordId] = useState('')
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setResult(null)
    if (!recordId.trim()) { setError('Enter a transaction or record ID to look up.'); return }
    setLoading(true)
    try { setResult(await api.publicAudit(recordId.trim())) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Lookup failed.') }
    finally { setLoading(false) }
  }
  return <div className="lookup-page"><header className="lookup-header"><Brand /><Link to="/login" className="button button-secondary">Sign in <Icon.ArrowRight size={15} /></Link></header><main className="lookup-main"><BackLink to="/">Back to home</BackLink><div className="lookup-heading"><div className="lookup-icon"><Icon.FileSearch size={23} /></div><span className="eyebrow">PUBLIC RECORD LOOKUP</span><h1>Look up a record.</h1><p>Enter a transaction ID to request its audit result from the blockchain API.</p></div>
    <form className="lookup-form" onSubmit={submit}><label htmlFor="audit-id">Transaction ID</label><div className="lookup-input-row"><input id="audit-id" value={recordId} onChange={event => setRecordId(event.target.value)} placeholder="Paste a transaction ID" /><Button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Check record'} <Icon.ArrowRight size={15} /></Button></div>{error && <div className="inline-error" role="alert"><Icon.CircleAlert size={16} />{error}</div>}</form>
    {loading && <Loading label="Checking record…" />}{result && <div className="lookup-result"><div className="result-heading"><div className="result-icon"><Icon.Fingerprint size={19} /></div><div><b>Audit response</b><small>For record {recordId}</small></div><StatusPill status={result.status} /></div><AuditResultCard result={result} /></div>}
    <div className="lookup-notice"><Icon.ShieldCheck size={17} /><span>UNAVAILABLE means the chain could not be reached. INVALID or TAMPERING_DETECTED indicate a mismatch. Results are reported by the backend.</span></div></main><footer className="public-footer lookup-footer"><Brand /><span>Ledgerly · Portfolio recordkeeping simulation</span></footer></div>
}

export function AuditPage() {
  const { selectedPortfolio, user } = useAuth()
  const transactions = useResource<TransactionPage>(() => selectedPortfolio ? api.transactions(selectedPortfolio.id, 0, 100) : Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 }), [selectedPortfolio?.id])
  const [transactionId, setTransactionId] = useState('')
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [auditError, setAuditError] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)
  const [reconcileLoading, setReconcileLoading] = useState(false)
  const [reconcile, setReconcile] = useState<{ confirmed: number; needs_attention: number } | null>(null)
  const [tamperPrice, setTamperPrice] = useState('')
  const [tamperLoading, setTamperLoading] = useState(false)
  const [tamperResult, setTamperResult] = useState<{ transaction_id: string; tampered: boolean; audit_status: string } | null>(null)
  const [tamperError, setTamperError] = useState('')
  async function checkAudit() {
    if (!transactionId) { setAuditError('Select a transaction to audit.'); return }
    setAuditError(''); setAudit(null); setAuditLoading(true)
    try { setAudit(await api.transactionAudit(transactionId)) }
    catch (reason) { setAuditError(reason instanceof Error ? reason.message : 'Audit request failed.') }
    finally { setAuditLoading(false) }
  }
  async function runReconcile() {
    setReconcileLoading(true); setAuditError(''); setReconcile(null)
    try { setReconcile(await api.reconcile()); await transactions.refresh() }
    catch (reason) { setAuditError(reason instanceof Error ? reason.message : 'Reconciliation failed.') }
    finally { setReconcileLoading(false) }
  }
  async function runTamper(event: FormEvent) {
    event.preventDefault(); setTamperError(''); setTamperResult(null)
    if (!transactionId) { setTamperError('Select a transaction before running the tamper demo.'); return }
    if (!tamperPrice.trim() || !Number.isFinite(Number(tamperPrice)) || Number(tamperPrice) <= 0) { setTamperError('Enter an explicit demo unit price greater than zero.'); return }
    setTamperLoading(true)
    try { const result = await api.tamper(transactionId, tamperPrice); setTamperResult(result); setAudit(await api.transactionAudit(transactionId)) }
    catch (reason) { setTamperError(reason instanceof Error ? reason.message : 'Tamper demo failed.') }
    finally { setTamperLoading(false) }
  }
  const selectedTx = transactions.data?.items.find(tx => tx.id === transactionId)
  return <AppShell title="Audit & integrity" description="Review an individual transaction audit or reconcile pending blockchain submissions.">
    <div className="notice-banner"><Icon.CircleHelp size={17} /><span><b>Audit status is explicit:</b> VALID is a successful check; UNAVAILABLE means no conclusion; INVALID or TAMPERING_DETECTED means evidence did not match.</span></div>
    {auditError && <div className="inline-error audit-error" role="alert"><Icon.CircleAlert size={16} />{auditError}</div>}
    {!selectedPortfolio ? <NoPortfolio /> : <section className="panel audit-tool"><span className="tool-icon"><Icon.FileSearch size={18} /></span><h3>Choose a transaction</h3><p>Select a transaction from the active portfolio to inspect its blockchain audit.</p>
      {transactions.loading ? <Loading label="Loading portfolio transactions…" /> : transactions.error ? <ErrorState error={transactions.error} retry={transactions.refresh} /> : <div className="audit-select-row"><label>Transaction<select aria-label="Select transaction to audit" value={transactionId} onChange={event => { setTransactionId(event.target.value); setAudit(null); setTamperResult(null) }}><option value="">Select a transaction</option>{transactions.data?.items.map(tx => <option key={tx.id} value={tx.id}>{tx.transaction_date} · {tx.action} {tx.quantity} {tx.symbol} · {tx.audit_status}</option>)}</select></label><Button onClick={checkAudit} disabled={!transactionId || auditLoading}>{auditLoading ? 'Checking…' : 'Check audit'} <Icon.ArrowRight size={15} /></Button></div>}
      {!transactions.loading && !transactions.error && !transactions.data?.items.length && <EmptyState title="No transaction records" text="There are no transactions in the selected portfolio to audit." />}
    </section>}
    {auditLoading && <Loading label="Checking transaction audit…" />}{audit && <section className="panel audit-report"><AuditResultCard result={audit} /></section>}
    <section className="panel audit-tool reconcile-tool"><span className="tool-icon"><Icon.Blocks size={18} /></span><h3>Reconcile pending records</h3><p>Ask the backend to recover and verify records awaiting blockchain confirmation.</p><Button variant="secondary" disabled={reconcileLoading} onClick={runReconcile}>{reconcileLoading ? 'Reconciling…' : 'Reconcile records'} <Icon.ArrowRight size={15} /></Button>
      {reconcile && <div className="reconcile-result" role="status"><b>Reconciliation response</b><span>Confirmed: {reconcile.confirmed}</span><span>Needs attention: {reconcile.needs_attention}</span></div>}
    </section>
    {user?.is_admin && user.demo_tampering_enabled && <section className="panel audit-tool demo-tool"><span className="tool-icon amber-icon"><Icon.Activity size={18} /></span><span className="demo-label">ADMIN DEMONSTRATION</span><h3>Tamper detection demo</h3><p>Select a transaction above, then submit an explicit demo unit price. The demo mutates that transaction in the backend.</p>
      <form className="tamper-form" onSubmit={runTamper}><label>Demo unit price ({selectedTx?.currency || selectedPortfolio?.base_currency || 'INR'})<input type="number" min="0" step="any" value={tamperPrice} onChange={event => setTamperPrice(event.target.value)} placeholder="Enter a different price" /></label><Button variant="secondary" disabled={!transactionId || tamperLoading}>{tamperLoading ? 'Running…' : 'Run tamper demo'} <Icon.ArrowRight size={15} /></Button></form>
      {tamperError && <div className="inline-error" role="alert">{tamperError}</div>}{tamperResult && <div className="tamper-response" role="status"><b>Backend demo response</b><span>Transaction: <code>{tamperResult.transaction_id}</code></span><span>Tampered: {tamperResult.tampered ? 'Yes' : 'No'}</span><span>Audit status: {tamperResult.audit_status}</span></div>}
    </section>}
    {!user?.is_admin && <div className="table-footnote admin-note">Tamper demonstration is available only to administrator accounts.</div>}
    {user?.is_admin && !user.demo_tampering_enabled && <div className="notice-banner admin-note"><Icon.CircleHelp size={17} /><span><b>Tamper demonstration disabled</b> — the backend has not enabled the development-only tamper demo for this environment.</span></div>}
  </AppShell>
}

export function ValuationsPage() {
  const { user } = useAuth()
  const { data, loading, error, refresh, setData } = useResource<Asset[]>(() => api.assets(), [])
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [priceError, setPriceError] = useState('')
  const [assetForm, setAssetForm] = useState({ symbol: '', name: '', latest_price: '' })
  const [formError, setFormError] = useState('')
  async function updatePrice(asset: Asset) {
    setMessage(''); setPriceError('')
    if (!user?.is_admin) { setPriceError('403 Forbidden — administrator authorization is required to update asset prices.'); return }
    const latestPrice = editing[asset.id] ?? asset.latest_price
    if (!latestPrice.trim() || !Number.isFinite(Number(latestPrice)) || Number(latestPrice) < 0) {
      setPriceError('Enter a valid non-negative simulated price.')
      return
    }
    try {
      const updated = await api.updateAssetPrice(asset.id, latestPrice)
      setData(current => current?.map(item => item.id === updated.id ? updated : item) || [])
      setMessage(`Updated simulated price for ${asset.symbol}.`)
    } catch (reason) {
      setPriceError(reason instanceof ApiError && reason.status === 403
        ? `403 Forbidden — ${reason.message}`
        : reason instanceof Error ? reason.message : 'Price update failed.')
    }
  }
  async function createAsset(event: FormEvent) {
    event.preventDefault(); setFormError('')
    if (!assetForm.symbol.trim() || !assetForm.name.trim() || !assetForm.latest_price.trim() || !Number.isFinite(Number(assetForm.latest_price)) || Number(assetForm.latest_price) < 0) { setFormError('Enter an Indian stock symbol, company name, and non-negative simulated price.'); return }
    try {
      const created = await api.createAsset({ symbol: assetForm.symbol.trim().toUpperCase(), name: assetForm.name.trim(), category: 'Stocks', latest_price: assetForm.latest_price })
      setData(current => [...(current || []), created].sort((a, b) => a.symbol.localeCompare(b.symbol)))
      setAssetForm({ symbol: '', name: '', latest_price: '' }); setMessage(`Created asset ${created.symbol}.`)
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Asset creation failed.') }
  }
  return <AppShell title="Assets & valuations" description="Manage backend-supplied simulated asset prices. These are not live market quotes." actions={<Button variant="secondary" onClick={refresh}><Icon.Activity size={16} /> Refresh</Button>}>
    <div className="notice-banner"><Icon.CircleHelp size={17} /><span>Asset prices are explicitly simulated records maintained through this API. They are not real-market data.</span></div>
    {message && <div className="success-message" role="status">{message}</div>}
    {priceError && <div className="inline-error" role="alert"><Icon.CircleAlert size={16} />{priceError}</div>}
    {!user?.is_admin && <div className="notice-banner"><Icon.CircleHelp size={17} /><span><b>Administrator authorization required</b> — asset price updates are restricted to administrator accounts.</span></div>}
    {loading ? <Loading label="Loading assets…" /> : error ? <ErrorState error={error} retry={refresh} /> : !data?.length ? <div className="panel"><EmptyState title="No assets available" text="Create a simulated asset below or add one while recording a transaction." /></div> : <section className="panel">
      <DataTable headers={['Asset', 'Category', 'Simulated latest price', user?.is_admin ? 'Update price' : 'Price access']}>
        {data.map(asset => <tr key={asset.id}>
          <td><b>{asset.name}</b><small className="table-sub">{asset.symbol}</small></td>
          <td>{asset.category}</td>
          <td className="amount-cell">{money(asset.latest_price)}</td>
          <td>{user?.is_admin
            ? <div className="price-update"><input aria-label={`New price for ${asset.symbol}`} type="number" min="0" step="any" value={editing[asset.id] ?? asset.latest_price} onChange={event => setEditing(current => ({ ...current, [asset.id]: event.target.value }))} /><Button variant="secondary" onClick={() => void updatePrice(asset)}>Update</Button></div>
            : <Button variant="secondary" disabled aria-label={`Update price for ${asset.symbol} (administrator only)`}>Administrator only</Button>}</td>
        </tr>)}
      </DataTable>
    </section>}
    <section className="panel asset-create"><h2>Add Indian listed stock</h2><form className="form-two asset-create-form" onSubmit={createAsset}><label>Indian stock symbol<input value={assetForm.symbol} onChange={event => setAssetForm({ ...assetForm, symbol: event.target.value })} placeholder="e.g. RELIANCE" required /></label><label>Company name<input value={assetForm.name} onChange={event => setAssetForm({ ...assetForm, name: event.target.value })} required /></label><label>Initial simulated price<input type="number" min="0" step="any" value={assetForm.latest_price} onChange={event => setAssetForm({ ...assetForm, latest_price: event.target.value })} required /></label><Button type="submit">Add stock <Icon.Plus size={15} /></Button></form>{formError && <div className="inline-error" role="alert">{formError}</div>}</section>
  </AppShell>
}

export function ProfilePage() {
  const { data, loading, error, refresh } = useResource(() => api.me(), [])
  return <AppShell title="Profile" description="Read-only account information returned by the authentication API." actions={<Button variant="secondary" onClick={refresh}><Icon.Activity size={16} /> Refresh</Button>}>
    {loading ? <Loading label="Loading account profile…" /> : error ? <ErrorState error={error} retry={refresh} /> : !data ? <EmptyState title="Account profile unavailable" text="The authentication API returned no account details." /> : <section className="panel profile-panel"><div className="profile-heading"><div className="avatar profile-avatar">{data.email.slice(0, 2).toUpperCase()}</div><div><h2>{data.email}</h2><p>{data.is_admin ? 'Administrator account' : 'Standard account'}</p></div></div><dl className="detail-list"><div><dt>Account ID</dt><dd className="mono">{data.id}</dd></div><div><dt>Email</dt><dd>{data.email}</dd></div><div><dt>Role</dt><dd>{data.is_admin ? 'Administrator' : 'Standard user'}</dd></div></dl><div className="table-footnote">Account details are read-only in this frontend. Profile editing is not supported by the API.</div></section>}
  </AppShell>
}
