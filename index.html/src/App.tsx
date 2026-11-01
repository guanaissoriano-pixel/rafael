import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  BarChart3,
  CarFront,
  CreditCard,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock,
  History,
  LockKeyhole,
  Pause,
  Play,
  ReceiptText,
  RotateCcw,
  Smartphone,
  TimerReset,
  TrendingUp,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type SessionStatus = 'active' | 'paused' | 'completed' | 'cancelled';
type PaymentMethod = 'cash' | 'pix' | 'card';
type Tab = 'home' | 'history' | 'cash' | 'reports';

type DurationOption = 0 | 10 | 30;

type RentalSession = {
  id: string;
  slot_number: number;
  duration_minutes: DurationOption;
  child_name: string;
  responsible_name: string | null;
  status: SessionStatus;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
  elapsed_seconds: number;
  price: number;
  payment_method: PaymentMethod;
  created_at: string;
};

type Sale = {
  id: string;
  session_id: string;
  amount: number;
  payment_method: PaymentMethod;
  status: 'completed' | 'cancelled';
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

type Closure = {
  id: string;
  closing_date: string;
  cash_total: number;
  pix_total: number;
  card_total: number;
  sales_count: number;
  notes: string | null;
};

type Modal = { type: 'start'; slot: number } | { type: 'cancel'; sale: Sale } | { type: 'close' } | { type: 'finishFree'; session: RentalSession } | null;

const formatMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

function elapsedFor(session: RentalSession, now: number) {
  if (session.status !== 'active') return session.elapsed_seconds;
  return session.elapsed_seconds + Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000));
}

function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
  const remainder = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

const WARNING_THRESHOLD = 60;

function useAlertSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, []);
  const playBeep = useCallback((freq: number, duration: number, count: number) => {
    const ctx = getCtx();
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = ctx.currentTime + i * (duration + 0.08);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      osc.start(start);
      osc.stop(start + duration);
    }
  }, [getCtx]);
  return { playWarning: () => playBeep(880, 0.15, 2), playExpired: () => playBeep(440, 0.3, 3) };
}

function App() {
  const [sessions, setSessions] = useState<RentalSession[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { playWarning, playExpired } = useAlertSound();
  const alertStateRef = useRef<Map<string, 'none' | 'warned' | 'expired'>>(new Map());

  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 3800);
  };

  const loadData = useCallback(async () => {
    const [sessionResult, saleResult, closureResult] = await Promise.all([
      supabase.from('carretinha_sessions').select('*').order('slot_number'),
      supabase.from('carretinha_sales').select('*').order('created_at', { ascending: false }),
      supabase.from('carretinha_cash_closures').select('*').order('closing_date', { ascending: false }),
    ]);
    if (sessionResult.error || saleResult.error || closureResult.error) {
      showNotice('error', 'Não foi possível carregar os dados do caixa.');
      setLoading(false);
      return;
    }
    setSessions((sessionResult.data ?? []) as RentalSession[]);
    setSales((saleResult.data ?? []) as Sale[]);
    setClosures((closureResult.data ?? []) as Closure[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => void loadData(), 15000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(refresh);
    };
  }, [loadData]);

  const activeSessions = useMemo(() => sessions.filter((session) => session.status === 'active' || session.status === 'paused'), [sessions]);

  useEffect(() => {
    const activeTimed = activeSessions.filter((s) => s.status === 'active' && s.duration_minutes > 0);
    for (const session of activeTimed) {
      const remaining = session.duration_minutes * 60 - elapsedFor(session, now);
      const current = alertStateRef.current.get(session.id) ?? 'none';
      if (remaining <= 0 && current !== 'expired') {
        alertStateRef.current.set(session.id, 'expired');
        playExpired();
      } else if (remaining > 0 && remaining <= WARNING_THRESHOLD && current === 'none') {
        alertStateRef.current.set(session.id, 'warned');
        playWarning();
      }
    }
    const activeIds = new Set(activeTimed.map((s) => s.id));
    for (const id of alertStateRef.current.keys()) {
      if (!activeIds.has(id)) alertStateRef.current.delete(id);
    }
  }, [activeSessions, now, playWarning, playExpired]);
  const completedSales = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return sales.filter((sale) => sale.status === 'completed' && new Date(sale.created_at) >= dayStart);
  }, [sales]);
  const cashTotal = completedSales.filter((sale) => sale.payment_method === 'cash').reduce((total, sale) => total + Number(sale.amount), 0);
  const pixTotal = completedSales.filter((sale) => sale.payment_method === 'pix').reduce((total, sale) => total + Number(sale.amount), 0);
  const cardTotal = completedSales.filter((sale) => sale.payment_method === 'card').reduce((total, sale) => total + Number(sale.amount), 0);
  const total = cashTotal + pixTotal + cardTotal;
  const lastClosure = closures.find((closure) => closure.closing_date === today());

  async function startSession(slotNumber: number, childName: string, responsibleName: string, duration: DurationOption, paymentMethod: PaymentMethod) {
    const price = duration === 10 ? 10 : duration === 30 ? 20 : 0;
    const { data: session, error: sessionError } = await supabase.from('carretinha_sessions').insert({
      slot_number: slotNumber,
      duration_minutes: duration,
      child_name: childName.trim(),
      responsible_name: responsibleName.trim() || null,
      price,
      payment_method: paymentMethod,
      status: 'active',
    }).select().maybeSingle();
    if (sessionError || !session) {
      showNotice('error', 'Não foi possível iniciar esta sessão. Confira se a vaga está livre.');
      return;
    }
    if (duration > 0) {
      const { error: saleError } = await supabase.from('carretinha_sales').insert({
        session_id: session.id,
        amount: price,
        payment_method: paymentMethod,
        status: 'completed',
      });
      if (saleError) {
        await supabase.from('carretinha_sessions').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', session.id);
        showNotice('error', 'Não foi possível registrar o pagamento.');
        return;
      }
    }
    setModal(null);
    showNotice('success', `Sessão da ${childName.trim()} iniciada na vaga ${slotNumber}.`);
    await loadData();
  }

  async function updateTimer(session: RentalSession, action: 'pause' | 'resume' | 'finish') {
    if (action === 'finish' && session.duration_minutes === 0) {
      setModal({ type: 'finishFree', session });
      return;
    }
    const elapsed = elapsedFor(session, now);
    const updates = action === 'pause'
      ? { status: 'paused', elapsed_seconds: elapsed, paused_at: new Date().toISOString() }
      : action === 'resume'
        ? { status: 'active', started_at: new Date().toISOString(), paused_at: null, elapsed_seconds: elapsed }
        : { status: 'completed', elapsed_seconds: elapsed, ended_at: new Date().toISOString() };
    const { error } = await supabase.from('carretinha_sessions').update(updates).eq('id', session.id);
    if (error) {
      showNotice('error', 'Não foi possível atualizar o cronômetro.');
      return;
    }
    showNotice('success', action === 'finish' ? 'Sessão finalizada.' : action === 'pause' ? 'Sessão pausada.' : 'Sessão retomada.');
    await loadData();
  }

  async function finishFreeTime(session: RentalSession, paymentMethod: PaymentMethod) {
    const elapsed = elapsedFor(session, now);
    const minutes = Math.max(1, Math.ceil(elapsed / 60));
    const amount = Math.min(999.99, minutes);
    const { error: sessionError } = await supabase.from('carretinha_sessions').update({
      status: 'completed', elapsed_seconds: elapsed, ended_at: new Date().toISOString(),
    }).eq('id', session.id);
    if (sessionError) {
      showNotice('error', 'Não foi possível finalizar a sessão.');
      return;
    }
    const { error: saleError } = await supabase.from('carretinha_sales').insert({
      session_id: session.id, amount, payment_method: paymentMethod, status: 'completed',
    });
    if (saleError) {
      showNotice('error', 'Não foi possível registrar o pagamento do tempo livre.');
      return;
    }
    setModal(null);
    showNotice('success', `Tempo livre finalizado · ${minutes} min · ${formatMoney(amount)}.`);
    await loadData();
  }

  async function cancelSale(sale: Sale, password: string, reason: string) {
    const { error } = await supabase.rpc('cancel_carretinha_sale', { p_sale_id: sale.id, p_admin_password: password, p_reason: reason });
    if (error) {
      showNotice('error', 'Senha de administrador inválida ou cancelamento não permitido.');
      return;
    }
    setModal(null);
    showNotice('success', 'Venda cancelada e registrada no histórico.');
    await loadData();
  }

  async function closeDay(notes: string) {
    const { error } = await supabase.from('carretinha_cash_closures').upsert({
      closing_date: today(), cash_total: cashTotal, pix_total: pixTotal, card_total: cardTotal, sales_count: completedSales.length, notes: notes.trim() || null,
    }, { onConflict: 'closing_date' });
    if (error) {
      showNotice('error', 'Não foi possível salvar o fechamento.');
      return;
    }
    setModal(null);
    showNotice('success', 'Fechamento do dia salvo com sucesso.');
    await loadData();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><CarFront size={25} strokeWidth={2.7} /></div>
          <div><strong>Carretinha</strong><span>PLAY</span><em>Desenvolvido por @RafaelGuanais</em></div>
        </div>
        <div className="live-pill"><span className="live-dot" /> operação aberta</div>
      </header>

      <main>
        <section className="hero-card">
          <div className="hero-copy">
            <p className="eyebrow">PAINEL DE OPERAÇÃO</p>
            <h1>Brincadeira que<br /><em>cabe no coração.</em></h1>
            <p className="hero-subtitle">Controle as vagas, acompanhe os pequenos e cuide do seu caixa em um só lugar.</p>
          </div>
          <div className="hero-illustration" aria-hidden="true">
            <div className="sun" /><div className="cloud cloud-one" /><div className="cloud cloud-two" />
            <div className="hill hill-back" /><div className="hill hill-front" />
            <div className="road" /><div className="toy-car car-red"><span /></div><div className="toy-car car-orange"><span /></div><div className="toy-car car-green"><span /></div>
            <img className="hero-logo" src="/940929BD-38E6-4D4C-AAD4-D3ABAFFFE4E1.png" alt="Carretinha Play" />
          </div>
        </section>
        <div className="hero-cash"><span>CAIXA DE HOJE</span><strong>{formatMoney(total)}</strong><small><TrendingUp size={14} /> {completedSales.length} vendas registradas</small></div>

        {notice && <div className={`notice ${notice.type}`}><span>{notice.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={16} /></button></div>}

        {tab === 'home' && <HomeView sessions={sessions} activeSessions={activeSessions} now={now} loading={loading} onStart={(slot) => setModal({ type: 'start', slot })} onTimer={updateTimer} />}
      {modal?.type === 'finishFree' && <FinishFreeModal session={modal.session} now={now} onClose={() => setModal(null)} onSubmit={finishFreeTime} />}
        {tab === 'history' && <HistoryView sales={sales} sessions={sessions} onCancel={(sale) => setModal({ type: 'cancel', sale })} />}
        {tab === 'cash' && <CashView cashTotal={cashTotal} pixTotal={pixTotal} cardTotal={cardTotal} total={total} completedSales={completedSales.length} lastClosure={lastClosure} onClose={() => setModal({ type: 'close' })} />}
        {tab === 'reports' && <ReportsView sales={sales} />}
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        <NavButton active={tab === 'home'} onClick={() => setTab('home')} icon={<CarFront size={21} />} label="Vagas" />
        <NavButton active={tab === 'history'} onClick={() => setTab('history')} icon={<History size={21} />} label="Histórico" />
        <NavButton active={tab === 'cash'} onClick={() => setTab('cash')} icon={<CircleDollarSign size={21} />} label="Caixa" />
        <NavButton active={tab === 'reports'} onClick={() => setTab('reports')} icon={<BarChart3 size={21} />} label="Relatórios" />
      </nav>

      {modal?.type === 'start' && <StartModal slot={modal.slot} onClose={() => setModal(null)} onSubmit={startSession} />}
      {modal?.type === 'cancel' && <CancelModal sale={modal.sale} onClose={() => setModal(null)} onSubmit={cancelSale} />}
      {modal?.type === 'close' && <CloseModal cashTotal={cashTotal} pixTotal={pixTotal} cardTotal={cardTotal} total={total} onClose={() => setModal(null)} onSubmit={closeDay} />}
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

const TOTAL_SLOTS = 15;
const FREE_RATE = 1;

function HomeView({ sessions, activeSessions, now, loading, onStart, onTimer }: { sessions: RentalSession[]; activeSessions: RentalSession[]; now: number; loading: boolean; onStart: (slot: number) => void; onTimer: (session: RentalSession, action: 'pause' | 'resume' | 'finish') => void }) {
  const slotMap = new Map(activeSessions.map((session) => [session.slot_number, session]));
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">VISÃO GERAL</p><h2>Vagas atuais <span>{activeSessions.length}/{TOTAL_SLOTS} em uso</span></h2></div><div className="capacity"><span className="capacity-dot" /> {TOTAL_SLOTS - activeSessions.length} livres</div></div>
    <div className="duration-strip"><TimerReset size={19} /><span>Escolha uma vaga livre para iniciar uma nova brincadeira</span><strong>10 min · R$ 10 <i /> 30 min · R$ 20 <i /> Livre · R$ 1/min</strong></div>
    {loading ? <div className="empty-state"><RotateCcw className="spin" size={26} /><p>Carregando as vagas...</p></div> : <div className="slots-grid">{Array.from({ length: TOTAL_SLOTS }, (_, index) => index + 1).map((slot) => <SlotCard key={slot} slot={slot} session={slotMap.get(slot)} now={now} onStart={onStart} onTimer={onTimer} />)}</div>}
    <div className="capacity-note"><LockKeyhole size={16} /> Os dados são salvos automaticamente e continuam disponíveis mesmo se você atualizar esta tela.</div>
    {sessions.length === 0 && !loading && <div className="empty-state welcome"><CarFront size={30} /><p>As {TOTAL_SLOTS} vagas estão prontas para receber a primeira brincadeira.</p></div>}
  </section>;
}

function SlotCard({ slot, session, now, onStart, onTimer }: { slot: number; session?: RentalSession; now: number; onStart: (slot: number) => void; onTimer: (session: RentalSession, action: 'pause' | 'resume' | 'finish') => void }) {
  if (!session) return <article className="slot-card free"><div className="slot-top"><div className="mini-car free-car"><CarFront size={25} /></div><div><p className="slot-label">VAGA {slot}</p><strong>livre</strong></div><span className="free-badge">LIVRE</span></div><div className="free-actions"><button className="primary-action" onClick={() => onStart(slot)}>Iniciar sessão <ChevronRight size={19} /></button></div></article>;
  const elapsed = elapsedFor(session, now);
  const isFree = session.duration_minutes === 0;
  const progress = isFree ? 0 : Math.min(100, Math.round((elapsed / (session.duration_minutes * 60)) * 100));
  const overTime = !isFree && elapsed >= session.duration_minutes * 60;
  const freeMinutes = Math.max(0, Math.ceil(elapsed / 60));
  const freeCost = Math.min(999, freeMinutes) * FREE_RATE;
  return <article className={`slot-card occupied ${session.status === 'paused' ? 'paused' : ''} ${overTime ? 'overtime' : ''} ${isFree ? 'free-time' : ''}`}><div className="slot-top"><div className="mini-car occupied-car"><CarFront size={25} /></div><div className="slot-person"><p className="slot-label">VAGA {slot} <span>· {isFree ? 'LIVRE' : `${session.duration_minutes} MIN`}</span></p><strong>{session.child_name}</strong>{session.responsible_name && <small>resp. {session.responsible_name}</small>}</div><div className="timer-block"><span>{session.status === 'paused' ? 'pausado' : isFree ? 'decorrido' : overTime ? 'tempo extra' : 'restante'}</span><strong>{isFree ? formatTimer(elapsed) : formatTimer(Math.max(0, session.duration_minutes * 60 - elapsed))}</strong></div></div>{isFree ? <div className="free-cost-bar"><span>Cobrança atual</span><strong>{formatMoney(freeCost)}</strong><small>R$ 1 / min</small></div> : <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>}<div className="slot-actions"><span className={`status-label ${session.status}`}>{session.status === 'paused' ? <><Pause size={13} /> Pausada</> : <><span className="pulse-dot" /> Em andamento</>}</span>{session.status === 'paused' ? <button className="secondary-action" onClick={() => onTimer(session, 'resume')}><Play size={15} /> Retomar</button> : <button className="secondary-action" onClick={() => onTimer(session, 'pause')}><Pause size={15} /> Pausar</button>}<button className="finish-action" onClick={() => onTimer(session, 'finish')}>{isFree ? 'Finalizar e pagar' : 'Finalizar'}</button></div></article>;
}

function HistoryView({ sales, sessions, onCancel }: { sales: Sale[]; sessions: RentalSession[]; onCancel: (sale: Sale) => void }) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">MOVIMENTAÇÕES</p><h2>Histórico de vendas</h2></div><div className="history-count">{sales.length} registros</div></div><div className="info-banner"><ReceiptText size={19} /><span>Cancelamentos precisam da senha do administrador e ficam registrados para conferência.</span></div><div className="history-list">{sales.length === 0 ? <div className="empty-state"><History size={28} /><p>Nenhuma venda registrada ainda.</p></div> : sales.map((sale) => { const session = sessionById.get(sale.session_id); return <article className={`sale-row ${sale.status === 'cancelled' ? 'sale-cancelled' : ''}`} key={sale.id}><div className="sale-icon">{sale.payment_method === 'pix' ? <Smartphone size={19} /> : sale.payment_method === 'card' ? <CreditCard size={19} /> : <Banknote size={19} />}</div><div className="sale-main"><strong>{session?.child_name ?? 'Sessão'}</strong><span>Vaga {session?.slot_number ?? '—'} · {formatDate(sale.created_at)}</span></div><div className="sale-method"><span>{sale.payment_method === 'pix' ? 'Pix' : sale.payment_method === 'card' ? 'Cartão' : 'Dinheiro'}</span><strong>{sale.status === 'cancelled' ? 'Cancelada' : formatMoney(Number(sale.amount))}</strong></div>{sale.status === 'completed' && <button className="icon-button danger" onClick={() => onCancel(sale)} aria-label="Cancelar venda"><X size={18} /></button>}</article>; })}</div></section>;
}

function CashView({ cashTotal, pixTotal, cardTotal, total, completedSales, lastClosure, onClose }: { cashTotal: number; pixTotal: number; cardTotal: number; total: number; completedSales: number; lastClosure?: Closure; onClose: () => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">CONTROLE FINANCEIRO</p><h2>Caixa do dia</h2></div><div className="date-chip">{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</div></div><div className="total-card"><div><span>Total recebido</span><strong>{formatMoney(total)}</strong><small>{completedSales} vendas concluídas hoje</small></div><div className="total-icon"><CircleDollarSign size={29} /></div></div><div className="breakdown-grid"><div className="breakdown-card"><div className="breakdown-icon cash"><Banknote size={20} /></div><span>Dinheiro</span><strong>{formatMoney(cashTotal)}</strong><small>recebido no balcão</small></div><div className="breakdown-card"><div className="breakdown-icon pix"><Smartphone size={20} /></div><span>Pix</span><strong>{formatMoney(pixTotal)}</strong><small>pagamentos digitais</small></div><div className="breakdown-card"><div className="breakdown-icon card"><CreditCard size={20} /></div><span>Cartão</span><strong>{formatMoney(cardTotal)}</strong><small>pagamentos no cartão</small></div></div><button className="close-day-button" onClick={onClose}><LockKeyhole size={19} /> Fazer fechamento do dia <ChevronRight size={18} /></button>{lastClosure && <div className="last-closure"><Check size={17} /><div><strong>Fechamento salvo hoje</strong><span>Dinheiro {formatMoney(Number(lastClosure.cash_total))} · Pix {formatMoney(Number(lastClosure.pix_total))} · Cartão {formatMoney(Number(lastClosure.card_total))}</span></div></div>}</section>;
}

function ReportsView({ sales }: { sales: Sale[] }) {
  const [range, setRange] = useState<'week' | 'month'>('week');

  const validSales = useMemo(() => sales.filter((s) => s.status === 'completed'), [sales]);

  const dailyData = useMemo(() => {
    const days: { label: string; date: string; total: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short' });
      days.push({ label: label.replace('.', ''), date: key, total: 0, count: 0 });
    }
    for (const sale of validSales) {
      const saleDate = new Date(sale.created_at);
      saleDate.setHours(0, 0, 0, 0);
      const key = saleDate.toISOString().slice(0, 10);
      const day = days.find((d) => d.date === key);
      if (day) {
        day.total += Number(sale.amount);
        day.count += 1;
      }
    }
    return days;
  }, [validSales]);

  const weeklyData = useMemo(() => {
    const span = range === 'week' ? 4 : 8;
    const weeks: { label: string; total: number; count: number }[] = [];
    for (let i = span - 1; i >= 0; i--) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - i * 7 - 6);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startStr = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const endStr = end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      let total = 0;
      let count = 0;
      for (const sale of validSales) {
        const sd = new Date(sale.created_at);
        sd.setHours(0, 0, 0, 0);
        if (sd >= start && sd <= end) {
          total += Number(sale.amount);
          count += 1;
        }
      }
      weeks.push({ label: `${startStr} - ${endStr}`, total, count });
    }
    return weeks;
  }, [validSales, range]);

  const hourlyData = useMemo(() => {
    const buckets = new Array(24).fill(0).map((_, i) => ({ hour: i, total: 0, count: 0 }));
    for (const sale of validSales) {
      const h = new Date(sale.created_at).getHours();
      buckets[h].total += Number(sale.amount);
      buckets[h].count += 1;
    }
    return buckets;
  }, [validSales]);

  const maxDaily = Math.max(1, ...dailyData.map((d) => d.total));
  const maxWeekly = Math.max(1, ...weeklyData.map((w) => w.total));
  const maxHourlyCount = Math.max(1, ...hourlyData.map((h) => h.count));

  const peakHours = useMemo(() => {
    return [...hourlyData]
      .map((h) => ({ ...h, score: h.count }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .filter((h) => h.count > 0);
  }, [hourlyData]);

  const weekTotal = dailyData.reduce((sum, d) => sum + d.total, 0);
  const weekSales = dailyData.reduce((sum, d) => sum + d.count, 0);
  const avgDaily = weekTotal / 7;
  const bestDay = dailyData.reduce((best, d) => (d.total > best.total ? d : best), dailyData[0]);

  const paymentTotals = useMemo(() => {
    let cash = 0, pix = 0, card = 0;
    for (const sale of validSales) {
      if (sale.payment_method === 'cash') cash += Number(sale.amount);
      else if (sale.payment_method === 'pix') pix += Number(sale.amount);
      else card += Number(sale.amount);
    }
    const total = cash + pix + card || 1;
    return { cash, pix, card, total, cashPct: (cash / total) * 100, pixPct: (pix / total) * 100, cardPct: (card / total) * 100 };
  }, [validSales]);

  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ANÁLISE DE DESEMPENHO</p>
          <h2>Relatórios</h2>
        </div>
        <div className="range-toggle">
          <button className={range === 'week' ? 'active' : ''} onClick={() => setRange('week')}>4 sem.</button>
          <button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>8 sem.</button>
        </div>
      </div>

      <div className="report-kpis">
        <div className="kpi-card">
          <div className="kpi-icon"><TrendingUp size={20} /></div>
          <span>Faturamento (7 dias)</span>
          <strong>{formatMoney(weekTotal)}</strong>
          <small>{weekSales} vendas</small>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon avg"><BarChart3 size={20} /></div>
          <span>Média diária</span>
          <strong>{formatMoney(avgDaily)}</strong>
          <small>por dia de operação</small>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon best"><Clock size={20} /></div>
          <span>Melhor dia</span>
          <strong>{formatMoney(bestDay.total)}</strong>
          <small>{bestDay.label}</small>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <h3>Faturamento diário</h3>
          <span>últimos 7 dias</span>
        </div>
        <div className="bar-chart daily-chart">
          {dailyData.map((d) => (
            <div className="bar-col" key={d.date}>
              <div className="bar-value">{d.total > 0 ? formatMoney(d.total) : ''}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ height: `${(d.total / maxDaily) * 100}%` }} />
              </div>
              <span className="bar-label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <h3>Faturamento semanal</h3>
          <span>{range === 'week' ? 'últimas 4 semanas' : 'últimas 8 semanas'}</span>
        </div>
        <div className="bar-chart weekly-chart">
          {weeklyData.map((w, i) => (
            <div className="bar-col" key={i}>
              <div className="bar-value">{w.total > 0 ? formatMoney(w.total) : ''}</div>
              <div className="bar-track">
                <div className="bar-fill weekly" style={{ height: `${(w.total / maxWeekly) * 100}%` }} />
              </div>
              <span className="bar-label small">{w.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <h3>Horários de maior movimento</h3>
          <span>vendas por hora</span>
        </div>
        {peakHours.length > 0 && (
          <div className="peak-hours">
            {peakHours.map((h, i) => (
              <div className="peak-chip" key={h.hour}>
                <span className="peak-rank">{i + 1}º</span>
                <strong>{h.hour.toString().padStart(2, '0')}:00 - {(h.hour + 1).toString().padStart(2, '0')}:00</strong>
                <small>{h.count} vendas · {formatMoney(h.total)}</small>
              </div>
            ))}
          </div>
        )}
        <div className="heat-chart">
          {hourlyData.map((h) => (
            <div className="heat-col" key={h.hour} style={{ opacity: h.count > 0 ? 0.35 + (h.count / maxHourlyCount) * 0.65 : 0.08 }} title={`${h.hour}:00 - ${h.count} vendas · ${formatMoney(h.total)}`}>
              <span className="heat-count">{h.count > 0 ? h.count : ''}</span>
              <span className="heat-label">{h.hour}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <h3>Métodos de pagamento</h3>
          <span>distribuição do período</span>
        </div>
        <div className="payment-distribution">
          <div className="dist-bar">
            <div className="dist-seg cash" style={{ width: `${paymentTotals.cashPct}%` }} />
            <div className="dist-seg pix" style={{ width: `${paymentTotals.pixPct}%` }} />
            <div className="dist-seg card" style={{ width: `${paymentTotals.cardPct}%` }} />
          </div>
          <div className="dist-legend">
            <div className="dist-item"><span className="dot cash" /><div><strong>Dinheiro</strong><span>{formatMoney(paymentTotals.cash)} · {paymentTotals.cashPct.toFixed(0)}%</span></div></div>
            <div className="dist-item"><span className="dot pix" /><div><strong>Pix</strong><span>{formatMoney(paymentTotals.pix)} · {paymentTotals.pixPct.toFixed(0)}%</span></div></div>
            <div className="dist-item"><span className="dot card" /><div><strong>Cartão</strong><span>{formatMoney(paymentTotals.card)} · {paymentTotals.cardPct.toFixed(0)}%</span></div></div>
          </div>
        </div>
      </div>

      {validSales.length === 0 && <div className="empty-state"><BarChart3 size={28} /><p>Sem dados suficientes para relatórios ainda.</p></div>}
    </section>
  );
}

function ModalShell({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20} /></button><p className="eyebrow">CARRETINHA PLAY</p><h2>{title}</h2><p className="modal-subtitle">{subtitle}</p>{children}</div></div>;
}

const DURATION_OPTIONS: { value: DurationOption; label: string; price: number; hint: string }[] = [
  { value: 10, label: '10 min', price: 10, hint: 'R$ 10' },
  { value: 30, label: '30 min', price: 20, hint: 'R$ 20' },
  { value: 0, label: 'Livre', price: 0, hint: 'R$ 1/min' },
];

function StartModal({ slot, onClose, onSubmit }: { slot: number; onClose: () => void; onSubmit: (slot: number, child: string, responsible: string, duration: DurationOption, payment: PaymentMethod) => Promise<void> }) {
  const [child, setChild] = useState(''); const [responsible, setResponsible] = useState(''); const [duration, setDuration] = useState<DurationOption>(10); const [payment, setPayment] = useState<PaymentMethod>('cash'); const [submitting, setSubmitting] = useState(false);
  const selectedOption = DURATION_OPTIONS.find((o) => o.value === duration)!;
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!child.trim()) return; setSubmitting(true); await onSubmit(slot, child, responsible, duration, payment); setSubmitting(false); }
  return <ModalShell title={`Iniciar vaga ${slot}`} subtitle="Preencha os dados da criança para começar a brincadeira." onClose={onClose}><form onSubmit={submit}><label>Nome da criança *<input autoFocus value={child} onChange={(event) => setChild(event.target.value)} placeholder="Ex.: Sofia" maxLength={80} required /></label><label>Responsável <span className="optional">opcional</span><input value={responsible} onChange={(event) => setResponsible(event.target.value)} placeholder="Ex.: Ana" maxLength={80} /></label><fieldset><legend>Tempo de diversão</legend><div className="choice-grid three">{DURATION_OPTIONS.map((opt) => <button type="button" key={opt.value} className={`choice ${duration === opt.value ? 'selected' : ''}`} onClick={() => setDuration(opt.value)}><strong>{opt.label}</strong><span>{opt.hint}</span></button>)}</div></fieldset><fieldset><legend>Forma de pagamento</legend><div className="payment-grid"><button type="button" className={`payment-choice ${payment === 'cash' ? 'selected' : ''}`} onClick={() => setPayment('cash')}><Banknote size={19} /> Dinheiro</button><button type="button" className={`payment-choice ${payment === 'pix' ? 'selected' : ''}`} onClick={() => setPayment('pix')}><Smartphone size={19} /> Pix</button><button type="button" className={`payment-choice ${payment === 'card' ? 'selected' : ''}`} onClick={() => setPayment('card')}><CreditCard size={19} /> Cartão</button></div></fieldset><button className="submit-button" disabled={!child.trim() || submitting} type="submit">{submitting ? 'Salvando...' : `Confirmar e iniciar${duration > 0 ? ` · ${formatMoney(selectedOption.price)}` : ' · tempo livre'}`}<Play size={18} /></button></form></ModalShell>;
}

function FinishFreeModal({ session, now, onClose, onSubmit }: { session: RentalSession; now: number; onClose: () => void; onSubmit: (session: RentalSession, payment: PaymentMethod) => Promise<void> }) {
  const [payment, setPayment] = useState<PaymentMethod>('cash'); const [submitting, setSubmitting] = useState(false);
  const elapsed = elapsedFor(session, now);
  const minutes = Math.max(1, Math.ceil(elapsed / 60));
  const amount = Math.min(999, minutes) * FREE_RATE;
  async function submit(event: React.FormEvent) { event.preventDefault(); setSubmitting(true); await onSubmit(session, payment); setSubmitting(false); }
  return <ModalShell title="Finalizar tempo livre" subtitle="Confira o tempo e escolha a forma de pagamento." onClose={onClose}><form onSubmit={submit}><div className="closing-summary"><div><span>Tempo decorrido</span><strong>{minutes} min</strong></div><div><span>Cobrança</span><strong>{formatMoney(amount)}</strong></div><div className="summary-total"><span>Total a pagar</span><strong>{formatMoney(amount)}</strong></div></div><fieldset><legend>Forma de pagamento</legend><div className="payment-grid"><button type="button" className={`payment-choice ${payment === 'cash' ? 'selected' : ''}`} onClick={() => setPayment('cash')}><Banknote size={19} /> Dinheiro</button><button type="button" className={`payment-choice ${payment === 'pix' ? 'selected' : ''}`} onClick={() => setPayment('pix')}><Smartphone size={19} /> Pix</button><button type="button" className={`payment-choice ${payment === 'card' ? 'selected' : ''}`} onClick={() => setPayment('card')}><CreditCard size={19} /> Cartão</button></div></fieldset><button className="submit-button" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : `Confirmar pagamento · ${formatMoney(amount)}`}<Check size={18} /></button></form></ModalShell>;
}

function CancelModal({ sale, onClose, onSubmit }: { sale: Sale; onClose: () => void; onSubmit: (sale: Sale, password: string, reason: string) => Promise<void> }) {
  const [password, setPassword] = useState(''); const [reason, setReason] = useState(''); const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSubmitting(true); await onSubmit(sale, password, reason); setSubmitting(false); }
  return <ModalShell title="Cancelar venda" subtitle="Esta ação exige autorização e ficará registrada no histórico." onClose={onClose}><form onSubmit={submit}><div className="warning-box"><AlertCircle size={19} /><span>Valor da venda: <strong>{formatMoney(Number(sale.amount))}</strong></span></div><label>Senha do administrador<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite a senha" required /></label><label>Motivo do cancelamento<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: pagamento duplicado" minLength={3} maxLength={240} required /></label><button className="danger-submit" disabled={!password || reason.trim().length < 3 || submitting} type="submit">{submitting ? 'Validando...' : 'Autorizar cancelamento'}<LockKeyhole size={17} /></button></form></ModalShell>;
}

function CloseModal({ cashTotal, pixTotal, cardTotal, total, onClose, onSubmit }: { cashTotal: number; pixTotal: number; cardTotal: number; total: number; onClose: () => void; onSubmit: (notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState(''); const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSubmitting(true); await onSubmit(notes); setSubmitting(false); }
  return <ModalShell title="Fechar caixa" subtitle="Confira os valores antes de salvar o fechamento do dia." onClose={onClose}><form onSubmit={submit}><div className="closing-summary"><div><span>Dinheiro</span><strong>{formatMoney(cashTotal)}</strong></div><div><span>Pix</span><strong>{formatMoney(pixTotal)}</strong></div><div><span>Cartão</span><strong>{formatMoney(cardTotal)}</strong></div><div className="summary-total"><span>Total</span><strong>{formatMoney(total)}</strong></div></div><label>Observação <span className="optional">opcional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: conferido com o responsável" /></label><button className="submit-button" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar fechamento'}<Check size={18} /></button></form></ModalShell>;
}

export default App;
