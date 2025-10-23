// pages/index.tsx
import { useEffect, useMemo, useState } from "react"

import { db } from "@/lib/firebase"
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  Timestamp, updateDoc, where
} from "firebase/firestore"

type Deposito = {
  id?: string;
  valor: number;
  data: string;
  suporte: string;
  idUsuario: string;
  email?: string;
  telefone?: string;

  // Tickets (compat + novo)
  ticket: number;          // legado: primeiro ticket gerado
  qtdTickets?: number;     // quantidade base (antes do multiplicador VIP)
  tickets?: number[];      // todos os tickets gerados

  // VIP
  vip?: boolean;

  // Comprovante
  comprovanteUrl?: string; // dataURL base64 (imagem OU PDF)
  criadoEm?: any;
}

type Indicador = {
  id?: string;
  suporte: string;
  data: string; // yyyy-mm-dd
  leads: number; mentoria: number; vip: number; grupoExclusivo: number;
  kirvano: number; treino7x1: number; estrategias: number;
  criadoEm?: any;
}

const SUPORTES = ["Edmária", "Ryan", "Igor"]
const LOGIN = { user: "adminsuportegarcia", pass: "adminsuporte221015" }
type Tab = "dados" | "meus" | "todos" | "indicadores"

export default function Home() {
  const [logado, setLogado] = useState(false)
  const [formLogin, setFormLogin] = useState({ user: "", pass: "" })
  const [suporte, setSuporte] = useState<string>("")
  const [tab, setTab] = useState<Tab>("dados")

  // depósitos
  const [dep, setDep] = useState<Partial<Deposito>>({
    data: new Date().toISOString().slice(0,10),
    qtdTickets: 1,
    vip: false
  })
  const [file, setFile] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string| null>(null)
  const [todos, setTodos] = useState<Deposito[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  // modal comprovante
  const [modalUrl, setModalUrl] = useState<string | null>(null)

  // indicadores
  const [ind, setInd] = useState<any>({
    data: new Date().toISOString().slice(0,10),
    leads: 0, mentoria: 0, vip: 0, grupoExclusivo: 0, kirvano: 0, treino7x1: 0, estrategias: 0
  })
  const [periodo, setPeriodo] = useState<"Diário" | "Semanal" | "Mensal">("Diário")
  const [listaIndicadores, setListaIndicadores] = useState<Indicador[]>([])

  // --------- ESTADO DO VALIDADOR ----------
  const [valStatus, setValStatus] = useState<"" | "ok" | "nao" | "erro" | "loading">("")
  const [valMsg, setValMsg] = useState<string>("")

  useEffect(() => {
    const q = query(collection(db, "depositos"), orderBy("criadoEm", "desc"))
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Deposito[]
      setTodos(list)
    })
    return () => unsub()
  }, [])

  const meus = useMemo(() => todos.filter(d => d.suporte === suporte), [todos, suporte])
  const now = new Date()
  const ym = now.toISOString().slice(0,7)
  const doMes = useMemo(() => todos.filter(d => (d.data || "").startsWith(ym)), [todos, ym])
  const totalMes = useMemo(() => doMes.reduce((s,d)=> s + (Number(d.valor)||0), 0), [doMes])
  const qtdMes = doMes.length
  const usuariosAtivos = useMemo(() => new Set(doMes.map(d=>d.idUsuario)).size, [doMes])
  const ranking = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of doMes) map.set(d.suporte, (map.get(d.suporte)||0) + (Number(d.valor)||0))
    return Array.from(map.entries()).sort((a,b)=> b[1]-a[1])
  }, [doMes])
  const myRank = useMemo(() => {
    const pos = ranking.findIndex(([name]) => name===suporte)
    const valor = ranking.find(([name]) => name===suporte)?.[1] ?? 0
    return { pos: pos>=0? pos+1 : null, valor }
  }, [ranking, suporte])

  // ---------------- Utils ----------------
  async function fileToDataURL(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"))
      reader.readAsDataURL(f) // funciona para imagem e PDF
    })
  }

  // tickets usados (legado e novo)
  async function carregarTicketsUsados(): Promise<Set<number>> {
    const snap = await getDocs(collection(db, "depositos"))
    const used = new Set<number>()
    snap.forEach(d => {
      const data = d.data() as any
      const v = data.ticket
      if (typeof v === "number") used.add(v)
      const arr: number[] | undefined = data.tickets
      if (Array.isArray(arr)) arr.forEach((n: number) => typeof n === "number" && used.add(n))
    })
    return used
  }

  // gera N tickets únicos 1..1000
  async function gerarTickets(qtd: number): Promise<number[]> {
    const used = await carregarTicketsUsados()
    if (used.size >= 1000) throw new Error("Todos os 1000 tickets já foram usados.")
    const out: number[] = []
    while (out.length < qtd) {
      if (used.size + out.length >= 1000) {
        throw new Error("Não há tickets suficientes disponíveis.")
      }
      const n = Math.floor(Math.random() * 1000) + 1
      if (!used.has(n) && !out.includes(n)) out.push(n)
    }
    return out
  }

  // ---------------- Salvar/Atualizar ----------------
  async function salvarOuAtualizar() {
    setErro(null)
    if (!suporte) return setErro("Selecione o suporte.")

    // obrigatórios: ID, Valor, Comprovante
    if (!dep.idUsuario || String(dep.idUsuario).trim() === "") {
      return setErro("Informe o ID do usuário.")
    }
    if (dep.valor == null || Number.isNaN(Number(dep.valor))) {
      return setErro("Informe o Valor.")
    }
    const temComprovante = Boolean(file) || Boolean(dep.comprovanteUrl)
    if (!temComprovante) {
      return setErro("Anexe o Comprovante (imagem ou PDF).")
    }
    if (!dep.data) return setErro("Informe a data.")

    setSalvando(true)
    try {
      // comprovante (imagem ou PDF)
      let comprovanteUrl: string | undefined = dep.comprovanteUrl as any
      if (file) {
        const okType = file.type.startsWith("image/") || file.type === "application/pdf"
        if (!okType) throw new Error("Comprovante inválido. Envie imagem ou PDF.")
        const maxBytes = 900 * 1024
        if (file.size > maxBytes) throw new Error("Comprovante muito grande. Envie até ~900KB.")
        comprovanteUrl = await fileToDataURL(file)
      }

      // tickets: quantidade base * (VIP ? 4 : 1)
      const qtdBase = Math.max(1, Number(dep.qtdTickets) || 1)
      const multiplicador = dep.vip ? 4 : 1
      const qtdFinal = qtdBase * multiplicador
      const tickets = await gerarTickets(qtdFinal)
      const ticketLegacy = tickets[0]

      const payload: Deposito = {
        valor: Number(dep.valor),
        data: String(dep.data),
        suporte,
        idUsuario: String(dep.idUsuario),
        email: dep.email || "",
        telefone: dep.telefone || "",
        ticket: ticketLegacy,   // compat
        qtdTickets: qtdBase,
        tickets,
        vip: !!dep.vip,
        comprovanteUrl,
        criadoEm: Timestamp.now()
      }

      if (editingId) {
        await updateDoc(doc(db, "depositos", editingId), payload as any)
        alert("Depósito atualizado!")
      } else {
        await addDoc(collection(db, "depositos"), payload)
        alert("Depósito salvo!")
      }

      setDep({ data: new Date().toISOString().slice(0,10), qtdTickets: 1, vip: false })
      setFile(null)
      setEditingId(null)
    } catch (e:any) {
      setErro(e.message || "Erro ao salvar")
    } finally {
      setSalvando(false)
    }
  }

  function startEdit(d: Deposito) {
    setEditingId(d.id!)
    setDep({ ...d })
    setTab("meus")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function remover(id?: string) {
    if (!id) return
    if (!confirm("Remover este depósito?")) return
    await deleteDoc(doc(db, "depositos", id))
    alert("Depósito removido.")
  }

  // ---- Indicadores ----
  function rangePeriodo(): {start: string, end: string, label: string} {
    const d = new Date(ind.data || new Date().toISOString().slice(0,10))
    const toStr = (x: Date) => x.toISOString().slice(0,10)
    if (periodo === "Diário") { return { start: toStr(d), end: toStr(d), label: toStr(d) } }
    if (periodo === "Semanal") {
      const end = new Date(d); const start = new Date(d); start.setDate(start.getDate()-6)
      return { start: toStr(start), end: toStr(end), label: `${toStr(start)} a ${toStr(end)}` }
    }
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0)
    return { start: toStr(start), end: toStr(end), label: `${toStr(start)} a ${toStr(end)}` }
  }

  // >>> Restaurada: não depende do suporte para listar <<<
  async function carregarIndicadores() {
    const snap = await getDocs(collection(db, "indicadores"))
    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Indicador[]
    const { start, end } = rangePeriodo()
    const filtrados = all.filter(i => {
      const noPeriodo = i.data >= start && i.data <= end
      const doSuporte = suporte ? i.suporte === suporte : true
      return noPeriodo && doSuporte
    })
    setListaIndicadores(filtrados.sort((a,b)=> a.data.localeCompare(b.data)))
  }
  useEffect(() => { carregarIndicadores() }, [suporte, periodo, ind.data])

  async function salvarIndicadores() {
    if (!suporte) return alert("Selecione o suporte.")
    const payload: Indicador = {
      suporte, data: String(ind.data||new Date().toISOString().slice(0,10)),
      leads:+(ind.leads||0), mentoria:+(ind.mentoria||0), vip:+(ind.vip||0),
      grupoExclusivo:+(ind.grupoExclusivo||0), kirvano:+(ind.kirvano||0),
      treino7x1:+(ind.treino7x1||0), estrategias:+(ind.estrategias||0),
      criadoEm: Timestamp.now()
    }
    await addDoc(collection(db, "indicadores"), payload)
    alert("Indicadores salvos!")
    setInd((v:any)=>({ ...v, leads:0, mentoria:0, vip:0, grupoExclusivo:0, kirvano:0, treino7x1:0, estrategias:0 }))
    carregarIndicadores()
  }

  function login() {
    if (formLogin.user === LOGIN.user && formLogin.pass === LOGIN.pass) setLogado(true)
    else alert("Login incorreto")
  }

  // --------- VALIDAR USUÁRIO ----------
  async function validarUsuario() {
    const user_id = dep.idUsuario ? String(dep.idUsuario).trim() : null
    const user_email = dep.email ? String(dep.email).trim() : null

    if (!user_id && !user_email) {
      alert("Preencha ID do usuário ou Email para validar.")
      return
    }

    setValStatus("loading")
    setValMsg("Validando...")

    try {
      const r = await fetch("/api/affiduser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id, user_email })
      })

      const raw = await r.text()
      let data: any = null
      try { data = JSON.parse(raw) } catch { data = { raw } }

      let affiliated: boolean | null = null
      if (typeof data?.user === "boolean") affiliated = data.user
      else if (typeof data?.upstream?.user === "boolean") affiliated = data.upstream.user
      else if (typeof data?.upstream?.affiliated === "boolean") affiliated = data.upstream.affiliated
      else if (typeof data?.upstream?.is_affiliate === "boolean") affiliated = data.upstream.is_affiliate
      else if (typeof data?.upstream?.isAffiliated === "boolean") affiliated = data.upstream.isAffiliated
      else if (data?.upstream?.status === "AFFILIATED" || data?.upstream?.status === "OK") affiliated = true
      else if (data?.upstream?.status === "NOT_AFFILIATED" || data?.upstream?.status === "NOT_FOUND") affiliated = false

      if (!r.ok) {
        setValStatus("erro")
        setValMsg(`Erro ${r.status}: ${data?.error || "Falha na validação"}`)
      } else if (affiliated === true) {
        setValStatus("ok")
        setValMsg("ok")
      } else if (affiliated === false) {
        setValStatus("nao")
        setValMsg("nao")
      } else {
        setValStatus("erro")
        setValMsg("Não foi possível determinar (verifique logs).")
      }
    } catch (e:any) {
      setValStatus("erro")
      setValMsg("Falha na requisição.")
    }
  }

  if (!logado) {
    return (
      <div className="wrap" style={{display:"grid", placeItems:"center", minHeight:"100vh"}}>
        <div className="card" style={{width:420}}>
          <h1 className="gradient" style={{margin:"0 0 8px"}}>Painel de Suporte</h1>
          <div className="grid">
            <label>Usuário</label>
            <input className="input" placeholder="Usuário" value={formLogin.user}
              onChange={e=>setFormLogin(v=>({...v, user:e.target.value}))} />
            <label>Senha</label>
            <input className="input" type="password" placeholder="Senha" value={formLogin.pass}
              onChange={e=>setFormLogin(v=>({...v, pass:e.target.value}))} />
            <button className="primary" onClick={login}>Entrar</button>
          </div>
        </div>
      </div>
    )
  }

  const range = rangePeriodo()

  return (
    <div className="wrap">
      <header className="header">
        <div>
          <h1 className="gradient" style={{margin:0}}>Dados Gerais</h1>
          <div className="banner" style={{marginTop:12}}>
            <div style={{fontWeight:700, fontSize:18}}>🏆 PREMIAÇÃO EM GRUPO — OUTUBRO (01/10 a 31/10)</div>
            <div className="small">500k ➜ R$300 · 1M ➜ R$500 · 1,5M ➜ R$750 · 2M ➜ R$1.000</div>
            {suporte && <div style={{marginTop:6}} className="small">Seu ranking: <span className="rank-badge">#{myRank.pos ?? "—"}</span> • Total: R$ {Number(myRank.valor).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>}
          </div>
        </div>
        <div className="flex">
          <select className="input" value={suporte} onChange={e=>setSuporte(e.target.value)}>
            <option value="">-- Suporte --</option>
            {SUPORTES.map(s=>(<option key={s} value={s}>{s}</option>))}
          </select>
          <button className="warn" onClick={()=>{ setLogado(false); setFormLogin({user:"", pass:""}); }}>Sair</button>
        </div>
      </header>

      <nav className="tabs">
        <a className={tab==="dados"?"active":""} onClick={()=>setTab("dados")}>📊 Dados gerais</a>
        <a className={tab==="meus"?"active":""} onClick={()=>setTab("meus")}>💼 Meus depósitos</a>
        <a className={tab==="todos"?"active":""} onClick={()=>setTab("todos")}>💰 Todos os depósitos</a>
        <a className={tab==="indicadores"?"active":""} onClick={()=>setTab("indicadores")}>🏁 Indicadores</a>
      </nav>

      {tab==="dados" && (
        <section className="grid" style={{gap:16}}>
          <div className="kpi">
            <div className="card"><div className="small">Total do mês</div><div style={{fontSize:22, fontWeight:700}}>R$ {totalMes.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>
            <div className="card"><div className="small">Depósitos no mês</div><div style={{fontSize:22, fontWeight:700}}>{qtdMes}</div></div>
            <div className="card"><div className="small">Usuários ativos</div><div style={{fontSize:22, fontWeight:700}}>{usuariosAtivos}</div></div>
            <div className="card"><div className="small">Sua posição</div><div style={{fontSize:22, fontWeight:700}}>{myRank.pos ? `#${myRank.pos}` : "—"}</div></div>
          </div>

          <div className="card">
            <div className="section-title"><h3 style={{marginTop:0}}>Ranking do mês</h3></div>
            <table>
              <thead><tr><th>Pos</th><th>Suporte</th><th>Total</th></tr></thead>
              <tbody>
                {ranking.map(([name,val],i)=>(
                  <tr key={name}><td>#{i+1}</td><td>{name}</td><td>R$ {val.toLocaleString("pt-BR",{minimumFractionDigits:2})}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab==="meus" && (
        <section className="grid" style={{gap:16}}>
          <div className="card">
            <h3 style={{marginTop:0}}>{editingId ? "Editar depósito" : "Novo depósito"}</h3>
            {erro && <div className="badge" style={{borderColor:"#7f1d1d", color:"#fca5a5"}}>{erro}</div>}
            <div className="grid" style={{gridTemplateColumns:"1fr 1fr", gap:12}}>
              {/* VALOR -> number (obrigatório) */}
              <div>
                <label>Valor (R$)</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  placeholder="Valor (R$)"
                  value={dep.valor ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const num = val === "" ? undefined : Number(val.replace(",", "."));
                    setDep(v => ({ ...v, valor: num as any }));
                  }}
                />
              </div>

              <div><label>Data</label><input className="input" type="date" value={dep.data||""} onChange={e=>setDep(v=>({...v, data:e.target.value}))} /></div>

              {/* ID do usuário + Validador */}
              <div style={{gridColumn:"1 / -1"}}>
                <label>ID do usuário</label>
                <div className="flex" style={{gap:8}}>
                  <input
                    className="input"
                    placeholder="ID do usuário"
                    value={dep.idUsuario||""}
                    onChange={e=>setDep(v=>({...v, idUsuario:e.target.value}))}
                    style={{flex:1}}
                  />
                  <button className="btn" onClick={validarUsuario}>Validar</button>
                </div>
                {valStatus === "loading" && <div className="small" style={{marginTop:6}}>Validando...</div>}
                {valStatus === "ok" && <div className="badge" style={{marginTop:6, borderColor:"#14532d", color:"#22c55e"}}>ok</div>}
                {valStatus === "nao" && <div className="badge" style={{marginTop:6, borderColor:"#7f1d1d", color:"#ef4444"}}>nao</div>}
                {valStatus === "erro" && <div className="badge" style={{marginTop:6, borderColor:"#7f1d1d", color:"#fca5a5"}}>{valMsg || "erro"}</div>}
              </div>

              <div><label>Email (opcional)</label><input className="input" placeholder="Email (opcional)" value={dep.email||""} onChange={e=>setDep(v=>({...v, email:e.target.value}))} /></div>
              <div><label>Telefone (opcional)</label><input className="input" placeholder="Telefone (opcional)" value={dep.telefone||""} onChange={e=>setDep(v=>({...v, telefone:e.target.value}))} /></div>

              {/* VIP + Quantidade de tickets */}
              <div className="flex" style={{gap:8, alignItems:"center"}}>
                <input id="vip" type="checkbox" checked={!!dep.vip} onChange={e=>setDep(v=>({...v, vip: e.target.checked}))} />
                <label htmlFor="vip">Lead VIP (4x tickets)</label>
              </div>
              <div className="flex" style={{gap:8}}>
                <div style={{flex:1}}>
                  <label>Qtd. de tickets</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={dep.qtdTickets ?? 1}
                    onChange={e=>setDep(v=>({...v, qtdTickets: Math.max(1, parseInt(e.target.value||"1"))}))}
                  />
                  <div className="small" style={{marginTop:4}}>
                    Total gerado: {(Math.max(1, dep.qtdTickets||1)) * (dep.vip ? 4 : 1)} ticket(s)
                  </div>
                </div>
                <div style={{alignSelf:"end"}}>
                  <button className="badge" onClick={async ()=>{
                    try {
                      const qtdBase = Math.max(1, Number(dep.qtdTickets)||1);
                      const mult = dep.vip ? 4 : 1;
                      const total = qtdBase * mult;
                      const tks = await gerarTickets(total);
                      setDep(v=>({ ...v, ticket: tks[0], tickets: tks }));
                      alert(`Foram separados ${total} ticket(s): ${tks.slice(0,10).join(", ")}${tks.length>10?"...":""}`);
                    } catch (e:any) {
                      alert(e?.message || "Falha ao gerar tickets");
                    }
                  }}>Gerar agora</button>
                </div>
              </div>

              {/* Comprovante (obrigatório) */}
              <div style={{gridColumn:"1 / -1"}}>
                <label>Comprovante (imagem ou PDF até ~900KB)</label>
                <input className="input" type="file" accept="image/*,.pdf,application/pdf"
                  onChange={e=>setFile(e.target.files?.[0]||null)} />
              </div>
            </div>

            <div className="flex" style={{marginTop:12}}>
              <button className="primary" onClick={salvarOuAtualizar} disabled={salvando}>
                {salvando? (editingId?"Atualizando...":"Salvando...") : (editingId ? "Salvar alterações" : "Salvar depósito")}
              </button>
              {editingId && <button className="btn" onClick={()=>{ setEditingId(null); setDep({ data: new Date().toISOString().slice(0,10), qtdTickets: 1, vip: false }); }}>Cancelar</button>}
            </div>
            <p className="small" style={{marginTop:8}}>Ao salvar, entra em "Meus Depósitos" e também em "Todos os Depósitos".</p>
          </div>

          <div className="card">
            <div className="section-title"><h3 style={{marginTop:0}}>Meus depósitos ({suporte||"--"})</h3></div>
            <table>
              <thead><tr><th>Data</th><th>Tickets</th><th>Valor</th><th>ID Usuário</th><th>Comprovante</th><th></th></tr></thead>
              <tbody>
                {meus.map(d=>(
                  <tr key={d.id}>
                    <td>{d.data}</td>
                    <td>
                      {d.tickets && d.tickets.length > 0
                        ? <>#{d.tickets.slice(0,5).join(", #")}{d.tickets.length>5?"…":""}</>
                        : <>#{d.ticket}</>
                      }
                      {d.vip && <span className="badge" style={{marginLeft:6}}>VIP</span>}
                      {d.qtdTickets && <span className="small" style={{marginLeft:6}}>{(d.vip? d.qtdTickets*4 : d.qtdTickets)} no total</span>}
                    </td>
                    <td>R$ {Number(d.valor).toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                    <td>{d.idUsuario}</td>
                    <td>{d.comprovanteUrl ? <button className="btn" onClick={()=>setModalUrl(d.comprovanteUrl!)}>ver</button> : "-"}</td>
                    <td className="row-actions">
                      <button className="btn" onClick={()=>startEdit(d)}>Editar</button>
                      <button className="warn" onClick={()=>remover(d.id)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TODOS OS DEPÓSITOS */}
      {tab==="todos" && (
        <section className="grid" style={{gap:16}}>
          <div className="card">
            <h3 style={{marginTop:0}}>Filtro por Período</h3>
            <div className="grid" style={{gridTemplateColumns:"auto auto", gap:12}}>
              <div className="flex">
                <button className={`btn ${periodo==="Diário"?"primary":""}`} onClick={()=>setPeriodo("Diário")}>Diário</button>
                <button className={`btn ${periodo==="Semanal"?"primary":""}`} onClick={()=>setPeriodo("Semanal")}>Semanal</button>
                <button className={`btn ${periodo==="Mensal"?"primary":""}`} onClick={()=>setPeriodo("Mensal")}>Mensal</button>
              </div>
              <input className="input" type="date" value={ind.data||""} onChange={e=>setInd((v:any)=>({...v, data:e.target.value}))} />
            </div>
            <div className="small" style={{marginTop:8}}>Exibindo: {range.label}</div>
          </div>

          {(() => {
            const { start, end } = range
            const filtrados = todos.filter(d => d.data >= start && d.data <= end)
            const totalPeriodo = filtrados.reduce((s,d)=> s + (Number(d.valor)||0), 0)
            const qtdPeriodo = filtrados.length
            const usuariosPeriodo = new Set(filtrados.map(d=>d.idUsuario)).size

            return (
              <>
                <div className="kpi">
                  <div className="card">
                    <div className="small">Total Este Período</div>
                    <div style={{fontSize:22, fontWeight:700}}>R$ {totalPeriodo.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                  </div>
                  <div className="card">
                    <div className="small">Depósitos Este Período</div>
                    <div style={{fontSize:22, fontWeight:700}}>{qtdPeriodo}</div>
                  </div>
                  <div className="card">
                    <div className="small">Usuários Ativos</div>
                    <div style={{fontSize:22, fontWeight:700}}>{usuariosPeriodo}</div>
                  </div>
                  <div className="card">
                    <div className="small">Período</div>
                    <div style={{fontSize:16, fontWeight:700}}>{range.label}</div>
                  </div>
                </div>

                <div className="card">
                  <h3 style={{marginTop:0}}>🏆 Ranking - Este Período ({range.label})</h3>
                  <table>
                    <thead>
                      <tr><th>#</th><th>Suporte</th><th>Total</th><th className="small">Qtd depósitos</th></tr>
                    </thead>
                    <tbody>
                      {Array.from(
                        filtrados.reduce((m, d) => {
                          const key = d.suporte
                          const cur = m.get(key) || { total:0, qtd:0 }
                          cur.total += Number(d.valor)||0
                          cur.qtd += 1
                          m.set(key, cur)
                          return m
                        }, new Map<string, {total:number, qtd:number}>())
                      )
                      .sort((a,b)=> b[1].total - a[1].total)
                      .map(([name,info], idx)=>(
                        <tr key={name}>
                          <td>#{idx+1}</td>
                          <td>{name}</td>
                          <td>R$ {info.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                          <td className="small">{info.qtd} depósito{info.qtd>1?"s":""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <h3 style={{marginTop:0}}>Depósitos Detalhados - Este Período</h3>
                  <table>
                    <thead><tr>
                      <th>Data</th><th>Suporte</th><th>Tickets</th><th>Valor</th><th>ID Usuário</th><th>Comprovante</th>
                    </tr></thead>
                    <tbody>
                      {filtrados.length === 0 && (
                        <tr><td colSpan={6} className="small">Nenhum depósito encontrado no período.</td></tr>
                      )}
                      {filtrados.map(d=>(
                        <tr key={d.id}>
                          <td>{d.data}</td>
                          <td>{d.suporte}</td>
                          <td>
                            {d.tickets && d.tickets.length > 0
                              ? <>#{d.tickets.slice(0,5).join(", #")}{d.tickets.length>5?"…":""}</>
                              : <>#{d.ticket}</>
                            }
                            {d.vip && <span className="badge" style={{marginLeft:6}}>VIP</span>}
                            {d.qtdTickets && <span className="small" style={{marginLeft:6}}>{(d.vip? d.qtdTickets*4 : d.qtdTickets)} no total</span>}
                          </td>
                          <td>R$ {Number(d.valor).toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                          <td>{d.idUsuario}</td>
                          <td>{d.comprovanteUrl ? <button className="btn" onClick={()=>setModalUrl(d.comprovanteUrl!)}>ver</button> : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </section>
      )}

      {/* INDICADORES — restaurado */}
      {tab==="indicadores" && (
        <section className="grid" style={{gap:16}}>
          <div className="card">
            <h3 style={{marginTop:0}}>Filtrar Indicadores</h3>
            <div className="grid" style={{gridTemplateColumns:"1fr 1fr", gap:12}}>
              <div><label>Período</label>
                <select className="input" value={periodo} onChange={e=>setPeriodo(e.target.value as any)}>
                  <option>Diário</option><option>Semanal</option><option>Mensal</option>
                </select></div>
              <div><label>Data de referência</label><input className="input" type="date" value={ind.data||""} onChange={e=>setInd((v:any)=>({...v, data:e.target.value}))} /></div>
            </div>
            <div className="small" style={{marginTop:8}}>Exibindo: {range.label}</div>
          </div>

          <div className="card">
            <h3 style={{marginTop:0}}>Preencher Indicadores do Dia</h3>
            <div className="grid" style={{gridTemplateColumns:"1fr 1fr 1fr", gap:12}}>
              <div><label>Leads Alcançados</label><input className="input" value={ind.leads} onChange={e=>setInd((v:any)=>({...v, leads:+e.target.value||0}))} /></div>
              <div><label>VIP</label><input className="input" value={ind.vip} onChange={e=>setInd((v:any)=>({...v, vip:+e.target.value||0}))} /></div>
              <div><label>Treinamento 7x1</label><input className="input" value={ind.treino7x1} onChange={e=>setInd((v:any)=>({...v, treino7x1:+e.target.value||0}))} /></div>
              <div><label>Mentoria</label><input className="input" value={ind.mentoria} onChange={e=>setInd((v:any)=>({...v, mentoria:+e.target.value||0}))} /></div>
              <div><label>Grupo Exclusivo</label><input className="input" value={ind.grupoExclusivo} onChange={e=>setInd((v:any)=>({...v, grupoExclusivo:+e.target.value||0}))} /></div>
              <div><label>5 Estratégias</label><input className="input" value={ind.estrategias} onChange={e=>setInd((v:any)=>({...v, estrategias:+e.target.value||0}))} /></div>
              <div><label>Kirvano</label><input className="input" value={ind.kirvano} onChange={e=>setInd((v:any)=>({...v, kirvano:+e.target.value||0}))} /></div>
            </div>
            <div className="flex" style={{marginTop:12}}>
              <button className="primary" onClick={salvarIndicadores}>Salvar Indicadores</button>
            </div>
          </div>

          <div className="card">
            <h3 style={{marginTop:0}}>Indicadores Registrados ({range.label})</h3>
            <div className="small" style={{marginBottom:8}}>
              Totais — Leads: {listaIndicadores.reduce((s,i)=>s+i.leads,0)} · VIP: {listaIndicadores.reduce((s,i)=>s+i.vip,0)}
              · 7x1: {listaIndicadores.reduce((s,i)=>s+i.treino7x1,0)} · Mentoria: {listaIndicadores.reduce((s,i)=>s+i.mentoria,0)}
              · Grupo: {listaIndicadores.reduce((s,i)=>s+i.grupoExclusivo,0)} · 5E: {listaIndicadores.reduce((s,i)=>s+i.estrategias,0)}
              · Kirvano: {listaIndicadores.reduce((s,i)=>s+i.kirvano,0)}
            </div>
            <table>
              <thead><tr>
                <th>Data</th><th>Leads</th><th>VIP</th><th>7x1</th><th>Mentoria</th><th>Grupo</th><th>5E</th><th>Kirvano</th>
              </tr></thead>
              <tbody>
                {listaIndicadores.length===0 && (<tr><td colSpan={8} className="small">Nenhum indicador registrado para este período.</td></tr>)}
                {listaIndicadores.map(i=>(
                  <tr key={i.id}>
                    <td>{i.data}</td><td>{i.leads}</td><td>{i.vip}</td><td>{i.treino7x1}</td><td>{i.mentoria}</td><td>{i.grupoExclusivo}</td><td>{i.estrategias}</td><td>{i.kirvano}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal do comprovante: imagem ou PDF */}
      {modalUrl && (
        <div className="modal" onClick={()=>setModalUrl(null)}>
          <div className="box" onClick={e=>e.stopPropagation()}>
            <div className="flex" style={{justifyContent:"space-between"}}>
              <div className="small">Comprovante</div>
              <button className="warn" onClick={()=>setModalUrl(null)}>Fechar</button>
            </div>
            {(modalUrl.startsWith("data:application/pdf") || modalUrl.toLowerCase().endsWith(".pdf")) ? (
              <embed src={modalUrl} type="application/pdf" style={{width:"100%", height:"70vh", marginTop:8, border:"none"}} />
            ) : (
              <img src={modalUrl} alt="Comprovante" style={{maxWidth:"100%", height:"auto", marginTop:8}} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
