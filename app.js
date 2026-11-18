"use strict";
/* ================= datas ================= */
const P = s => { const [y,m,d] = s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); };
const F = dt => dt.toISOString().slice(0,10);
const add = (s,n) => F(new Date(P(s).getTime() + n*864e5));
const dow = s => P(s).getUTCDay();
const WD = ["dom","seg","ter","qua","qui","sex","sáb"];
const WDL = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const br = s => s.slice(8,10)+"/"+s.slice(5,7);
const brY = s => br(s)+"/"+s.slice(0,4);
const todayISO = () => { const n = new Date(); return F(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
const diff = (a,b) => Math.round((P(b)-P(a))/864e5);

function easter(y){ // algoritmo de Meeus/Jones/Butcher
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
  h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
  mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
  return F(new Date(Date.UTC(y,mo-1,da)));
}
// Calendários: "tjms-cg" (TJMS, comarca de Campo Grande), "tjms" (TJMS, outras comarcas), "nacional"
let holCache = {};
function holidays(y){
  if (holCache[y]) return holCache[y];
  const perfil = state.settings.perfil || "tjms-cg", tjms = perfil.startsWith("tjms");
  const e = easter(y), h = {};
  const fx = (md,n,t="feriado") => h[y+"-"+md] = {n,t};
  fx("01-01","Confraternização Universal"); fx("04-21","Tiradentes"); fx("05-01","Dia do Trabalho");
  fx("09-07","Independência"); fx("10-12","N. Sra. Aparecida"); fx("11-02","Finados");
  fx("11-15","Proclamação da República"); fx("11-20","Consciência Negra"); fx("12-08","Dia da Justiça");
  fx("12-25","Natal");
  h[add(e,-48)] = {n:"Carnaval",t:"feriado"}; h[add(e,-47)] = {n:"Carnaval",t:"feriado"};
  h[add(e,-46)] = tjms ? {n:"Quarta-feira de Cinzas (sem expediente no TJMS)",t:"feriado"}
                       : {n:"Quarta-feira de Cinzas (expediente reduzido)",t:"reduzido"};
  if (!tjms) h[add(e,-4)] = {n:"Quarta-feira Santa",t:"feriado"};
  h[add(e,-3)] = {n:"Quinta-feira Santa",t:"feriado"};
  h[add(e,-2)] = {n:"Sexta-feira Santa",t:"feriado"}; h[add(e,60)] = {n:"Corpus Christi",t:"feriado"};
  if (tjms){
    for (let d=1; d<=6; d++) fx("01-0"+d,"Feriado forense TJMS (Lei 3.056/2005)");
    for (let d=20; d<=31; d++) if (d!==25) fx("12-"+d,"Feriado forense TJMS (Lei 3.056/2005)");
    fx("08-11","Instituição dos Cursos Jurídicos (TJMS)");
  }
  if (perfil==="tjms-cg") fx("08-26","Aniversário de Campo Grande (sem expediente na comarca)");
  return holCache[y] = h;
}
const DEFAULT_LOCAIS = `2026-10-30 Dia do Servidor Público (TJMS, Portaria 983/2025)
PF 2026-04-20 Ponto facultativo TJMS
PF 2026-06-05 Ponto facultativo TJMS
PF 2026-08-10 Ponto facultativo TJMS
PF 2026-12-07 Ponto facultativo TJMS`;
let customDays = {};
function parseCustom(txt){
  const out = {};
  (txt||"").split(/\n/).forEach(line => {
    const m = line.trim().match(/^(PF\s+)?(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/i);
    if (!m) return;
    const pf = !!m[1];
    let d = m[2]; const end = m[3] || m[2]; let guard = 0;
    while (d <= end && guard++ < 400){ out[d] = {n:m[4]||(pf?"Ponto facultativo":"Sem expediente"),t:pf?"pf":"feriado"}; d = add(d,1); }
  });
  return out;
}
// motivo de não ser dia útil (null = dia útil normal)
// semRecesso: réu preso, Maria da Penha e medidas urgentes não se suspendem no recesso (CPP art. 798-A)
function dayInfo(s, semRecesso){
  const w = dow(s);
  const mo = +s.slice(5,7), da = +s.slice(8,10);
  if (!semRecesso && ((mo===12 && da>=20) || (mo===1 && da<=20))) return {n:"Recesso forense",t:"recesso"};
  if (customDays[s]) return customDays[s];
  const h = holidays(+s.slice(0,4))[s];
  if (w===0||w===6) return {n: w===0?"Domingo":"Sábado", t:"fds"};
  return h || null;
}
// Ponto facultativo ("pf") é tratado como dia útil por segurança: o prazo nunca fica mais longo por causa dele.
const countsUtil = (s, sr) => { const i = dayInfo(s, sr); return !i || i.t==="reduzido" || i.t==="pf"; }; // conta no meio do prazo
const fullUtil  = (s, sr) => { const i = dayInfo(s, sr); return !i || i.t==="pf"; };                      // pode ser início / fim
const nextFull = (s, sr) => { let d = add(s,1); while(!fullUtil(d, sr)) d = add(d,1); return d; };

/* Cível (uteis): CPC arts. 219, 220 e 224; Lei 11.419/2006, art. 4º, §§3º e 4º.
   Criminal (corridos): CPP art. 798 — prazo contínuo, não se interrompe por fim de semana ou feriado;
   exclui o dia do começo e inclui o do vencimento (§1º); se terminar em dia sem expediente, prorroga
   para o dia útil seguinte (§3º). A contagem só começa em dia útil (Súmula 310 do STF: publicação na
   sexta, começa na segunda). Suspende de 20/12 a 20/01 (art. 798-A), salvo réu preso, Maria da Penha
   e medidas urgentes (semRecesso). */
function calcPrazo(disp, n, tipo, semRecesso){
  const sr = tipo==="corridos" && !!semRecesso;
  const pub = nextFull(disp, sr);
  const inicio = nextFull(pub, sr);
  const counted = [];
  let d = inicio, guard = 0;
  while (counted.length < n && guard++ < 2000){
    const info = dayInfo(d, sr);
    const ok = tipo==="corridos" ? !(info && info.t==="recesso") : countsUtil(d, sr);
    if (ok) counted.push(d);
    if (counted.length < n) d = add(d,1);
  }
  let fim = counted[counted.length-1], prorrogado = null;
  if (!fullUtil(fim, sr)){ prorrogado = dayInfo(fim, sr).n; fim = nextFull(fim, sr); }
  return {pub, inicio, counted, fim, prorrogado, semRecesso: sr};
}

/* ---- área do processo (cível x criminal), pela classe processual do DJEN ---- */
const RX_CRIM_CLASSE = /penal|criminal|inqu[eé]rito|circunstanciado|flagrante|pris[aã]o|habeas corpus|maria da penha|protetivas|sentido estrito|execu[cç][aã]o da pena|coisas apreendidas|liberdade provis[oó]ria|cautelares? (?:criminal|penal)|den[uú]ncia|queixa-crime|crime/i;
const RX_URGENTE = /r[ée]us? pres[oa]s?|pres[oa] preventiva|segregad|custodiad|maria da penha|11\.340|medidas? protetivas?/i;
function isCriminal(o){
  if (o.classe) return RX_CRIM_CLASSE.test(o.classe);
  // sem classe: usa o órgão só se for vara exclusivamente criminal
  return /criminal|j[uú]ri|execu[cç][oõ]es penais/i.test(o.orgao||"") && !/c[ií]vel|fam[ií]lia/i.test(o.orgao||"");
}
// tipo de contagem efetivo: o que a advogada escolheu, ou o detectado
function tipoDe(p){
  if (p.tipoManual || p.origemDados==="Manual") return p.tipo;
  return isCriminal(p) || (p.det && p.det.tipo==="corridos") ? "corridos" : "uteis";
}
function urgenteDe(p){
  if (typeof p.urgente === "boolean") return p.urgente;
  return RX_URGENTE.test((p.classe||"") + " " + (p.texto||""));
}

/* ================= detecção do prazo no texto ================= */
const EXT = {um:1,uma:1,dois:2,duas:2,"três":3,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,vinte:20,trinta:30,quarenta:40,sessenta:60,noventa:90};
function extToNum(w){
  const parts = w.toLowerCase().split(/\s+e\s+/); let t = 0;
  for (const p of parts){ if (!(p in EXT)) return null; t += EXT[p]; }
  return t;
}
const RX = /prazo\s+(?:comum\s+|legal\s+|sucessivo\s+|improrrog[aá]vel\s+)?de\s+(\d{1,3}|[a-zçêé]+(?:\s+e\s+[a-zçêé]+)?)\s*(?:\([^)]{1,40}\)\s*)?(dias?|horas?)(?:\s+(úteis|uteis|corridos))?/i;
const RX2 = /\b(?:em|no|dentro de)\s+(\d{1,3})\s*(?:\([^)]{1,40}\)\s*)?dias(?:\s+(úteis|uteis|corridos))?/i;
function detectPrazo(text){
  let m = text.match(RX), n = null, unit = "dias", kind = null;
  if (m){ n = /^\d+$/.test(m[1]) ? +m[1] : extToNum(m[1]); unit = m[2].toLowerCase(); kind = m[3]; }
  else if ((m = text.match(RX2))){ n = +m[1]; kind = m[2]; }
  if (!m || !n) return null;
  const s = Math.max(0, m.index-90), e = Math.min(text.length, m.index+m[0].length+90);
  return {
    dias: n, horas: unit.startsWith("hora"),
    tipo: kind && kind.toLowerCase()==="corridos" ? "corridos" : "uteis",
    trecho: {antes:(s>0?"…":"")+text.slice(s,m.index), achado:m[0], depois:text.slice(m.index+m[0].length,e)+(e<text.length?"…":"")}
  };
}

/* ================= estado ================= */
const KEY = "pautaPrazos.v1";
let state = {settings:{oab:"",uf:"MS",dias:15,padrao:"",perfil:"tjms-cg",feriados:DEFAULT_LOCAIS}, pubs:{}, demo:false};
function load(){
  try { const raw = localStorage.getItem(KEY); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch(e){}
  applyCalendar();
}
function applyCalendar(){ holCache = {}; customDays = parseCustom(state.settings.feriados); }
// Com o banco online ligado, os prazos não ficam copiados no localStorage (o cache do banco cuida do offline
// e é apagado ao sair). Sem banco, o aparelho é o único lugar onde os dados existem.
function saveLocal(){ if (window.SYNC_ON) return; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){ setStatus("Não consegui salvar no navegador: "+e.message); } }
// salva no aparelho e, se a sincronização estiver ligada, envia para o banco online
function save(){ saveLocal(); if (window.syncPush) window.syncPush(); }

function htmlToText(html){
  const doc = new DOMParser().parseFromString(html||"", "text/html");
  doc.querySelectorAll("style,script,head").forEach(n=>n.remove());
  doc.querySelectorAll("p,br,div,tr,section,li,h1,h2,h3").forEach(n=>n.append("\n"));
  return (doc.body ? doc.body.textContent : "").replace(/[ \t ]+/g," ").replace(/\n\s*\n+/g,"\n\n").trim();
}

function makePub(o){
  const det = detectPrazo(o.texto);
  const padrao = +state.settings.padrao || null;
  const criminal = isCriminal(o);
  return Object.assign({
    prazoDias: det && !det.horas ? det.dias : padrao,
    tipo: criminal || (det && det.tipo==="corridos") ? "corridos" : "uteis",
    criminal,
    origem: det && !det.horas ? "texto" : (padrao ? "padrao" : null),
    det, status: "aberto"
  }, o);
}

/* ================= API do DJEN (CNJ) ================= */
const API = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
// Lista de advogados acompanhados ({nome, oab, uf}); aceita o formato antigo de uma OAB só
function getAdvs(){
  const s = state.settings;
  if (Array.isArray(s.advs)) return s.advs.filter(a => a.oab && a.uf);
  return s.oab ? [{nome:"", oab:s.oab, uf:s.uf||"MS"}] : [];
}
const advLabel = a => `OAB/${a.uf.toUpperCase()} ${a.oab}` + (a.nome ? ` · ${a.nome}` : "");
async function fetchPubs(){
  const advs = getAdvs(), dias = state.settings.dias;
  if (!advs.length){ openConfig(); setStatus("Informe pelo menos uma OAB (número e UF) para buscar."); return; }
  const btn = document.getElementById("btnFetch"); btn.disabled = true;
  const fim = todayISO(), ini = add(fim, -Math.max(1, +dias||15));
  let total = 0, novos = 0, limitado = false;
  if (state.demo){ state.pubs = {}; state.demo = false; }
  const byChave = new Map(Object.values(state.pubs).map(p => [p.chave, p]));
  try {
    for (const adv of advs){
      const lab = advLabel(adv);
      let page = 1;
      while (page <= 20){
        setStatus(`Buscando no DJEN: ${lab}… página ${page}`);
        const url = `${API}?numeroOab=${encodeURIComponent(String(adv.oab).replace(/\D/g,""))}&ufOab=${encodeURIComponent(adv.uf.toUpperCase())}&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}&pagina=${page}&itensPorPagina=100`;
        const r = await fetch(url);
        if (r.status === 429){ limitado = true; break; }
        if (!r.ok) throw new Error("O serviço respondeu com erro "+r.status);
        const j = await r.json();
        const items = j.items || [];
        for (const it of items){
          total++;
          const texto = htmlToText(it.texto).slice(0, 20000);
          const chave = [it.numero_processo, it.data_disponibilizacao, it.tipoDocumento, texto.slice(0,300)].join("|");
          if ((state.settings.excluidas || []).includes(chaveCurta(chave))) continue; // excluída pela usuária
          const existing = byChave.get(chave) || state.pubs["djen-"+it.id];
          if (existing){
            existing.advs = existing.advs || [];
            if (!existing.advs.includes(lab)) existing.advs.push(lab);
            continue;
          }
          novos++;
          const p = state.pubs["djen-"+it.id] = makePub({
            id:"djen-"+it.id, chave, origemDados:"DJEN", advs:[lab],
            processo: it.numeroprocessocommascara || it.numero_processo,
            disp: it.data_disponibilizacao, tribunal: it.siglaTribunal, orgao: it.nomeOrgao,
            classe: it.nomeClasse, tipoDoc: it.tipoDocumento || it.tipoComunicacao, link: it.link, texto
          });
          byChave.set(chave, p);
        }
        if (items.length < 100) break;
        page++;
      }
      if (limitado) break;
    }
    save(); render();
    setStatus(limitado
      ? `O CNJ limitou as consultas por minuto. Trouxe ${novos} nova(s) até aqui; aguarde um minuto e busque de novo para completar.`
      : `Busca concluída (${advs.length} advogado${advs.length>1?"s":""}): ${total} comunicação(ões) de ${brY(ini)} a ${brY(fim)}, ${novos} nova(s). Última busca: ${new Date().toLocaleString("pt-BR")}.`);
  } catch(e){
    setStatus("");
    banner(`Não consegui falar com o DJEN (${esc(e.message)}). Verifique a internet e tente de novo.`, "err");
  } finally { btn.disabled = false; }
}

/* ================= exemplos ================= */
function loadDemo(){
  const t = todayISO();
  const ex = [
    {d:add(t,0), proc:"1001234-56.2026.8.12.0001", tipo:"DESPACHO/DECISÃO", orgao:"3ª Vara Cível do Foro Central", classe:"Procedimento Comum Cível",
     txt:"Vistos. Manifeste-se a parte autora sobre a contestação e documentos, no prazo de 15 (quinze) dias. Int."},
    {d:add(t,-8), proc:"0004567-89.2025.8.12.0001", tipo:"Intimação", orgao:"1ª Vara de Família e Sucessões", classe:"Divórcio Litigioso",
     txt:"Fica a parte requerente intimada para, no prazo de 5 (cinco) dias, recolher as custas de diligência do oficial de justiça."},
    {d:add(t,-3), proc:"4000348-34.2026.8.12.0001", tipo:"Ato ordinatório", orgao:"Juizado Especial Cível", classe:"Procedimento do Juizado Especial Cível",
     txt:"Nos termos do art. 152, VI, do CPC, fica a parte autora intimada a se manifestar em 10 dias sobre o laudo juntado."},
    {d:add(t,-1), proc:"1500260-87.2026.8.12.0001", tipo:"Intimação", orgao:"Vara Criminal", classe:"Ação Penal - Procedimento Ordinário",
     txt:"Intime-se a defesa para apresentar resposta à acusação, no prazo de 10 (dez) dias corridos, nos termos do art. 396 do CPP."},
    {d:add(t,-2), proc:"0000141-40.2025.8.12.0001", tipo:"Intimação", orgao:"2ª Vara Cível", classe:"Execução de Título Extrajudicial",
     txt:"Ciência às partes do retorno dos autos do Tribunal. Nada sendo requerido, arquivem-se."}
  ];
  state.pubs = {}; state.demo = true;
  ex.forEach((e,i) => { const id="demo-"+i; state.pubs[id] = makePub({id, chave:id, origemDados:"Exemplo", processo:e.proc, disp:e.d, tribunal:"TJMS", orgao:e.orgao, classe:e.classe, tipoDoc:e.tipo, link:"", texto:e.txt}); });
}

/* ================= interface ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s??"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function setStatus(t){ $("status").textContent = t; }
function banner(msg, kind){
  $("banner").innerHTML = msg ? `<div class="notice ${kind||""}"><span>${msg}</span>${kind==="demo"?'<button class="small" id="btnClearDemo">Limpar exemplos</button>':'<button class="small" id="btnCloseBanner">Fechar</button>'}</div>` : "";
  const c = $("btnClearDemo"); if (c) c.onclick = () => { state.pubs = {}; state.demo = false; save(); render(); };
  const x = $("btnCloseBanner"); if (x) x.onclick = () => banner("");
}
const weekStart = s => add(s, -((dow(s)+6)%7)); // segunda-feira

function enrich(p){
  const tipo = tipoDe(p), urgente = tipo==="corridos" && urgenteDe(p);
  const base = Object.assign({}, p, {tipo, urgente, criminalAuto: !p.tipoManual && isCriminal(p)});
  if (!p.prazoDias) return Object.assign(base, {calc:null});
  return Object.assign(base, {calc: calcPrazo(p.disp, +p.prazoDias, tipo, urgente)});
}

function render(){
  const t = todayISO(), ws = weekStart(t), nws = add(ws,7), nnws = add(ws,14);
  const s = state.settings;
  const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const local = (s.perfil||"tjms-cg")==="tjms-cg" ? "Campo Grande/MS, " : "";
  $("subline").innerHTML = `${local}${WDL[dow(t)]}, ${+t.slice(8,10)} de ${MES[+t.slice(5,7)-1]} de ${t.slice(0,4)}` +
    (getAdvs().length ? "<br>" + getAdvs().map(a => `<span class="oab">OAB/${esc(a.uf.toUpperCase())} ${esc(a.oab)}</span>`).join(" ") : "");
  // filtro por advogado (aparece com 2 ou mais OABs)
  const advsNow = getAdvs(), flt = $("fltAdv");
  flt.hidden = advsNow.length < 2;
  if (advsNow.length < 2) state.filtroAdv = "";
  flt.innerHTML = `<option value="">Todos os advogados</option>` + advsNow.map(a => { const l = advLabel(a); return `<option value="${esc(l)}" ${state.filtroAdv===l?"selected":""}>${esc(l)}</option>`; }).join("");
  if (state.demo) banner("Você está vendo <b>exemplos</b>. Abra Configurações, informe sua OAB e clique em Buscar publicações.", "demo");
  else if ($("banner").querySelector(".demo")) banner("");

  const vis = Object.values(state.pubs).filter(p => !state.filtroAdv || !p.advs || p.advs.includes(state.filtroAdv));
  const lixeira = vis.filter(p => p.excluido).sort((a,b) => String(b.excluido.em||"").localeCompare(String(a.excluido.em||"")));
  const all = vis.filter(p => !p.excluido).map(enrich);
  const open = all.filter(p => p.status==="aberto");
  const g = {late:[], week:[], next:[], later:[], nodue:[], done:[]};
  open.forEach(p => {
    if (!p.calc) g.nodue.push(p);
    else if (p.calc.fim < t) g.late.push(p);
    else if (p.calc.fim < nws) g.week.push(p);
    else if (p.calc.fim < nnws) g.next.push(p);
    else g.later.push(p);
  });
  all.filter(p => p.status!=="aberto").forEach(p => g.done.push(p));
  const byDue = (a,b) => (a.calc?.fim||"9").localeCompare(b.calc?.fim||"9") || a.disp.localeCompare(b.disp);
  Object.values(g).forEach(a => a.sort(byDue));
  g.nodue.sort((a,b)=>b.disp.localeCompare(a.disp));

  const hoje = open.filter(p => p.calc && p.calc.fim===t).length;
  $("summary").innerHTML = [
    ["danger", g.late.length + hoje, "vencidos ou vencendo hoje", "#g-late"],
    ["warn", g.week.length, "vencem nesta semana", "#g-week"],
    ["", g.next.length, "vencem na próxima semana", "#g-next"],
    ["", g.nodue.length, "sem prazo definido", "#g-nodue"]
  ].map(([c,n,l,h]) => `<a class="sum ${n?c:""}" href="${h}"><b>${n}</b><span>${l}</span></a>`).join("");

  // faixa de 14 dias
  const perDay = {}; open.forEach(p => { if (p.calc) (perDay[p.calc.fim] ||= []).push(p); });
  let strip = `<h2>Pauta das próximas duas semanas</h2><div class="weeks">`;
  [["Esta semana",ws],["Próxima semana",nws]].forEach(([lab,start]) => {
    strip += `<div class="wk-label">${lab} · ${br(start)} a ${br(add(start,6))}</div>`;
    for (let i=0;i<7;i++){
      const d = add(start,i), info = dayInfo(d), n = (perDay[d]||[]).length;
      const why = info && info.t!=="fds" ? `<span class="why">${esc(info.n)}</span>` : "";
      strip += `<div class="day ${d===t?"today":""} ${info&&info.t!=="pf"?"off":""}" title="${esc(info?info.n:"Dia útil")}"><span class="d">${WD[dow(d)]} ${br(d)}</span>${why}${n?`<span class="n ${d<=add(t,1)?"hot":""}">${n} prazo${n>1?"s":""}</span>`:""}</div>`;
    }
  });
  $("strip").innerHTML = strip + "</div>";

  const section = (id, title, arr, emptyMsg) => `<section class="group" id="${id}"><h2>${title} <small>${arr.length} ${arr.length===1?"publicação":"publicações"}</small></h2>${arr.length ? arr.map(card).join("") : `<div class="empty">${emptyMsg}</div>`}</section>`;
  $("lists").innerHTML =
    (g.late.length ? section("g-late","Vencidos e não marcados como cumpridos", g.late, "") : "") +
    section("g-week", `Esta semana · até ${br(add(ws,6))}`, g.week, "Nenhum prazo vence nesta semana.") +
    section("g-next", `Próxima semana · ${br(nws)} a ${br(add(nws,6))}`, g.next, "Nenhum prazo vence na próxima semana.") +
    section("g-later", "Mais adiante", g.later, "Nada por enquanto.") +
    section("g-nodue", "Sem prazo definido · confira e informe o prazo", g.nodue, "Todas as publicações têm prazo definido.") +
    (g.done.length ? section("g-done","Cumpridos e arquivados", g.done, "") : "") +
    (lixeira.length ? `<section class="group" id="g-lixo"><h2>Lixeira <small>${lixeira.length} ${lixeira.length===1?"publicação":"publicações"} · dá para restaurar</small></h2>` +
      lixeira.map(p => `<article class="card done"><div class="due"><div class="stamp"><span class="lbl">Excluída</span><span class="dt">${p.excluido.em ? esc(new Date(p.excluido.em).toLocaleDateString("pt-BR").slice(0,5)) : ""}</span><span class="left">${esc(p.excluido.por||"")}</span></div></div>
        <div class="body"><div class="proc"><span class="autos">Autos nº</span>${esc(p.processo)}</div><div class="meta">${esc(p.tipoDoc)} · ${esc(p.classe||"")}</div>
        <div class="ctrl"><button class="small" data-act="restaurar" data-id="${esc(p.id)}">Restaurar</button><button class="small" data-act="hist" data-id="${esc(p.id)}">Histórico</button></div>
        <div class="hist" id="hs-${esc(p.id)}" hidden></div></div></article>`).join("") + `</section>` : "");
}

function card(p){
  const t = todayISO(), c = p.calc;
  let cls = "", dueHtml;
  if (p.status!=="aberto"){ cls = "done"; }
  if (!c){ cls += " nodue"; dueHtml = `<span class="lbl">Disponibilizado</span><span class="dt">${br(p.disp)}</span><span class="wd">${WDL[dow(p.disp)]}</span><span class="left">defina o prazo</span>`; }
  else {
    const left = diff(t, c.fim);
    if (p.status==="aberto"){ if (left < 0) cls += " late"; else if (left === 0) cls += " today"; else if (left <= 2) cls += " soon"; }
    const leftTxt = p.status==="cumprido" ? "cumprido" : p.status==="arquivado" ? "arquivado" : left<0 ? `venceu há ${-left} dia${left<-1?"s":""}` : left===0 ? "vence hoje" : left===1 ? "vence amanhã" : `faltam ${left} dias`;
    const lbl = p.status!=="aberto" ? "Prazo" : left<=0 ? "Prazo fatal" : "Vencimento";
    dueHtml = `<span class="lbl">${lbl}</span><span class="dt">${br(c.fim)}</span><span class="wd">${WDL[dow(c.fim)]}</span><span class="left">${leftTxt}</span>`;
  }
  const origem = p.origem==="texto" ? "prazo lido do texto, confira" : p.origem==="padrao" ? "prazo padrão, confira" : p.origem==="manual" ? "prazo informado por você" : "";
  const quote = p.det ? `<div class="quote">${esc(p.det.trecho.antes)}<mark>${esc(p.det.trecho.achado)}</mark>${esc(p.det.trecho.depois)}${p.det.horas?" <b>(prazo em horas: confira manualmente)</b>":""}</div>`
                      : `<div class="quote">${esc(p.texto.slice(0,260))}${p.texto.length>260?"…":""}</div>`;
  const tl = c ? `<div class="timeline" id="tl-${p.id}" hidden>
      <div class="steps"><span>Disponibilizado <b>${WD[dow(p.disp)]} ${br(p.disp)}</b></span><span>Publicado <b>${WD[dow(c.pub)]} ${br(c.pub)}</b></span><span>1º dia <b>${WD[dow(c.inicio)]} ${br(c.inicio)}</b></span><span>Vence <b>${WD[dow(c.fim)]} ${br(c.fim)}</b></span></div>
      <div class="cal">${calRange(c)}</div>
      ${p.tipo==="corridos" ? `<div class="hint">Contagem criminal (CPP art. 798): conta sábados, domingos e feriados; começa no primeiro dia útil após a publicação (Súmula 310/STF)${c.semRecesso ? "; réu preso ou urgente, corre também no recesso (art. 798-A)" : "; suspensa de 20/12 a 20/01 (art. 798-A)"}.</div>` : ""}
      ${c.prorrogado ? `<div class="hint">O último dia caiu em "${esc(c.prorrogado)}" e foi prorrogado para o próximo dia útil.</div>` : ""}
    </div>` : "";
  return `<article class="card ${cls}">
    <div class="due"><div class="stamp">${dueHtml}</div></div>
    <div class="body">
      <div class="proc"><span class="autos">Autos nº</span>${esc(p.processo)}</div>
      <div class="meta">${esc(p.tipoDoc)} · ${esc(p.classe||"")} · ${esc(p.orgao||"")} ${p.tribunal?"· "+esc(p.tribunal):""}</div>
      <div class="tags">${p.origemDados==="Exemplo"?'<span class="tag ex">exemplo</span>':""}${getAdvs().length>1 && p.advs ? p.advs.map(l=>`<span class="tag">${esc(l)}</span>`).join("") : ""}${origem?`<span class="tag">${origem}</span>`:""}${p.tipo==="corridos"?`<span class="tag">${p.criminalAuto?"processo criminal · dias corridos (CPP art. 798)":"criminal · dias corridos"}</span>`:""}${p.urgente?'<span class="tag">réu preso / urgente: corre no recesso</span>':""}</div>
      ${quote}
      <div class="ctrl">
        <label for="d-${p.id}">Prazo</label>
        <input type="number" min="1" max="365" id="d-${p.id}" value="${p.prazoDias||""}" data-act="dias" data-id="${p.id}" placeholder="dias">
        <select id="t-${p.id}" data-act="tipo" data-id="${p.id}" aria-label="Área e tipo de contagem">
          <option value="uteis" ${p.tipo!=="corridos"?"selected":""}>Cível · dias úteis</option>
          <option value="corridos" ${p.tipo==="corridos"?"selected":""}>Criminal · dias corridos</option>
        </select>
        ${p.tipo==="corridos"?`<label class="chk"><input type="checkbox" id="u-${p.id}" data-act="urgente" data-id="${p.id}" ${p.urgente?"checked":""}> Réu preso / urgente</label>`:""}
        ${c?`<button class="small" data-act="tl" data-id="${p.id}">Ver contagem</button>`:""}
        <button class="small" data-act="txt" data-id="${p.id}">Ver texto da publicação</button>
        ${linkSeguro(p.link)?`<a class="btn small" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">Abrir no tribunal</a>`:""}
        ${window.syncAPI?`<button class="small" data-act="hist" data-id="${p.id}">Histórico</button>`:""}
        ${p.status==="aberto"
          ? `<button class="small" data-act="cumprido" data-id="${p.id}">Marcar cumprido</button><button class="small" data-act="arquivar" data-id="${p.id}">Sem prazo / arquivar</button>`
          : `<button class="small" data-act="reabrir" data-id="${p.id}">Reabrir</button>`}
        ${confirmDel===p.id
          ? `<span class="delask">${window.SYNC_ON ? "Mandar para a lixeira (para todas)?" : "Excluir de vez?"}</span><button class="small danger" data-act="delok" data-id="${p.id}">Sim, excluir</button><button class="small" data-act="delno" data-id="${p.id}">Cancelar</button>`
          : `<button class="small" data-act="del" data-id="${p.id}">Excluir</button>`}
      </div>
      ${tl}
      <div class="hist" id="hs-${p.id}" hidden></div>
      <div class="fulltext" id="tx-${p.id}" hidden>${esc(p.texto)}</div>
    </div>
  </article>`;
}
function calRange(c){
  const set = new Map(c.counted.map((d,i)=>[d,i+1]));
  let out = "", d = c.pub, guard = 0;
  while (d <= c.fim && guard++ < 400){
    const k = set.get(d), info = dayInfo(d);
    const title = info ? info.n : (k ? `${k}º dia` : "");
    out += `<span class="${k?"c":""} ${d===c.fim?"end":""}" title="${esc(title)}">${WD[dow(d)]} ${br(d)}${k?`<i>${k}</i>`:""}</span>`;
    d = add(d,1);
  }
  return out;
}

let confirmDel = null;
// só links https para fora (nada de javascript:, data: etc.)
function linkSeguro(u){ try { return !!u && new URL(u).protocol === "https:"; } catch(e){ return false; } }

// histórico de alterações (vem do banco online; só aparece com login)
const NOMES_CAMPO = {status:"situação", prazoDias:"prazo (dias)", tipo:"contagem", urgente:"réu preso/urgente", excluido:"lixeira", processo:"processo", disp:"disponibilização",
  advs:"advogados", dias:"dias de busca", padrao:"prazo padrão", perfil:"calendário", feriados:"feriados locais", excluidas:"excluídas"};
const fmtValor = v => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? (v.em ? "sim" : JSON.stringify(v).slice(0,80)) : String(v).slice(0,80);
async function mostraHistorico(alvo, el){
  if (!el) return;
  if (!el.hidden){ el.hidden = true; return; }
  el.hidden = false; el.textContent = "Carregando histórico…";
  try {
    const evs = await window.syncAPI.historico(alvo);
    if (!evs.length){ el.textContent = "Nenhuma alteração registrada ainda."; return; }
    el.innerHTML = evs.map(ev => {
      const mud = Object.keys(Object.assign({}, ev.antes||{}, ev.depois||{}))
        .filter(k => JSON.stringify((ev.antes||{})[k]) !== JSON.stringify((ev.depois||{})[k]))
        .map(k => `${esc(NOMES_CAMPO[k]||k)}: ${esc(fmtValor((ev.antes||{})[k]))} → ${esc(fmtValor((ev.depois||{})[k]))}`);
      return `<div class="ev"><b>${esc(ev.em ? ev.em.toLocaleString("pt-BR") : "agora")}</b> · ${esc(ev.por)} · ${esc(ev.acao)}${alvo ? "" : " · " + esc(ev.processo || "configurações")}
        ${mud.length ? `<small>${mud.join(" · ")}</small>` : ""}</div>`;
    }).join("");
  } catch(e){ el.textContent = "Não consegui carregar o histórico (verifique a conexão)."; }
}
// resumo curto e estável da "chave" de uma publicação (para a lista de excluídas não ficar grande)
function chaveCurta(s){ let h1 = 5381, h2 = 52711; for (let i = 0; i < s.length; i++){ const ch = s.charCodeAt(i); h1 = (h1 * 33) ^ ch; h2 = (h2 * 33) ^ ch; } return (h1>>>0).toString(36) + (h2>>>0).toString(36) + s.length.toString(36); }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName==="INPUT" || b.tagName==="SELECT") return;
  const id = b.dataset.id, p = state.pubs[id];
  if (!p) return;
  if (b.dataset.act==="tl"){ const el=$("tl-"+id); el.hidden=!el.hidden; return; }
  if (b.dataset.act==="txt"){ const el=$("tx-"+id); el.hidden=!el.hidden; return; }
  if (b.dataset.act==="del"){ confirmDel = id; render(); return; }
  if (b.dataset.act==="delno"){ confirmDel = null; render(); return; }
  if (b.dataset.act==="delok"){
    // guarda a "marca" da publicação para ela não voltar na próxima busca no DJEN
    const ex = state.settings.excluidas = (state.settings.excluidas || []);
    const k = chaveCurta(p.chave || id); if (!ex.includes(k)) ex.push(k);
    if (ex.length > 3000) ex.splice(0, ex.length - 3000);
    // com o banco online: vai para a lixeira (recuperável). Sem banco: apaga deste aparelho.
    if (window.SYNC_ON) p.excluido = {em: new Date().toISOString(), por: window.syncAPI ? window.syncAPI.email() : ""};
    else delete state.pubs[id];
    confirmDel = null;
    save(); render(); setStatus(`Publicação ${p.processo} ${window.SYNC_ON ? "enviada para a lixeira" : "excluída"}.`); return;
  }
  if (b.dataset.act==="restaurar"){ delete p.excluido; save(); render(); setStatus(`Publicação ${p.processo} restaurada.`); return; }
  if (b.dataset.act==="hist"){ mostraHistorico(id, $("hs-"+id)); return; }
  if (b.dataset.act==="cumprido") p.status="cumprido";
  if (b.dataset.act==="arquivar") p.status="arquivado";
  if (b.dataset.act==="reabrir") p.status="aberto";
  save(); render();
});
document.addEventListener("change", e => {
  const el = e.target; if (!el.dataset || !el.dataset.act) return;
  const p = state.pubs[el.dataset.id]; if (!p) return;
  if (el.dataset.act==="dias"){ p.prazoDias = +el.value || null; p.origem = p.prazoDias ? "manual" : null; }
  if (el.dataset.act==="tipo"){ p.tipo = el.value; p.tipoManual = true; }
  if (el.dataset.act==="urgente"){ p.urgente = el.checked; }
  save(); render();
});

let advRowSeq = 0;
function advRow(a){
  const i = advRowSeq++;
  const div = document.createElement("div"); div.className = "advrow";
  div.innerHTML = `<input class="advNome" id="advNome-${i}" placeholder="Nome (opcional)" aria-label="Nome do advogado" value="${esc(a.nome||"")}">
    <input class="advOab" id="advOab-${i}" inputmode="numeric" placeholder="Nº da OAB" aria-label="Número da OAB" value="${esc(a.oab||"")}">
    <input class="advUf" id="advUf-${i}" maxlength="2" placeholder="UF" aria-label="UF da OAB" value="${esc(a.uf||"MS")}">
    <button type="button" class="small advDel">Remover</button>`;
  div.querySelector(".advDel").onclick = () => { div.remove(); if (!$("advList").children.length) $("advList").append(advRow({})); };
  return div;
}
$("btnAddAdv").onclick = () => { const r = advRow({}); $("advList").append(r); r.querySelector(".advNome").focus(); };

// lista legível de todos os dias sem expediente programados no ano
function holidayList(y){
  const out = []; let d = `${y}-01-01`;
  while (d <= `${y}-12-31`){
    const i = dayInfo(d);
    if (i && i.t!=="fds" && i.t!=="recesso") out.push({d, ...i, local: !!customDays[d]});
    d = add(d,1);
  }
  return out;
}
function renderHolidays(){
  const y = +todayISO().slice(0,4);
  const block = yy => `<h4>${yy}</h4><ul>${holidayList(yy).map(h => `<li><b>${br(h.d)}</b> ${WD[dow(h.d)]} · ${esc(h.n)}${h.t==="pf"?" (conta como dia útil)":""}${h.local?' <span class="src">(adicionado por você)</span>':""}</li>`).join("")}<li><b>20/12 a 20/01</b> · Recesso forense, prazos suspensos (CPC art. 220)</li></ul>`;
  $("holList").innerHTML = block(y) + block(y+1);
}
function openConfig(){
  const s = state.settings;
  $("advList").innerHTML = "";
  const advs = getAdvs();
  (advs.length ? advs : [{}]).forEach(a => $("advList").append(advRow(a)));
  $("cfgDias").value = s.dias||15;
  $("cfgPadrao").value = s.padrao||""; $("cfgFeriados").value = s.feriados||""; $("cfgPerfil").value = s.perfil||"tjms-cg";
  renderHolidays();
  $("dlgConfig").showModal();
}
// a lista de feriados acompanha as mudanças feitas na própria janela
["cfgPerfil","cfgFeriados"].forEach(id => $(id).addEventListener("change", () => {
  const prev = {perfil:state.settings.perfil, feriados:state.settings.feriados};
  state.settings.perfil = $("cfgPerfil").value; state.settings.feriados = $("cfgFeriados").value;
  applyCalendar(); renderHolidays();
  Object.assign(state.settings, prev); applyCalendar();
}));
$("btnConfig").onclick = openConfig;
$("dlgConfig").addEventListener("close", () => {
  if ($("dlgConfig").returnValue!=="ok") return;
  const advs = [...$("advList").querySelectorAll(".advrow")].map(r => ({
    nome: r.querySelector(".advNome").value.trim(),
    oab: r.querySelector(".advOab").value.replace(/\D/g,""),
    uf: r.querySelector(".advUf").value.trim().toUpperCase()
  })).filter(a => a.oab && a.uf);
  Object.assign(state.settings, {advs, dias:+$("cfgDias").value||15, padrao:$("cfgPadrao").value.trim(), feriados:$("cfgFeriados").value});
  delete state.settings.oab;
  state.settings.perfil = $("cfgPerfil").value;
  applyCalendar();
  save(); render(); setStatus("Configurações salvas.");
});
$("fltAdv").addEventListener("change", e => { state.filtroAdv = e.target.value; save(); render(); });
$("btnFetch").onclick = fetchPubs;
$("btnManual").onclick = () => { $("formManual").reset(); $("manData").value = todayISO(); $("dlgManual").showModal(); };
$("dlgManual").addEventListener("close", () => {
  if ($("dlgManual").returnValue!=="ok") return;
  if (state.demo){ state.pubs = {}; state.demo = false; banner(""); }
  const id = "man-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)), texto = $("manTexto").value.trim().slice(0, 20000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test($("manData").value)) { setStatus("Data inválida."); return; }
  state.pubs[id] = {id, chave:id, origemDados:"Manual", processo:$("manProc").value.trim().slice(0, 120), disp:$("manData").value, tribunal:"", orgao:"", classe:"", tipoDoc:"Lançamento manual", link:"", texto, det:detectPrazo(texto), prazoDias:+$("manDias").value, tipo:$("manTipo").value, origem:"manual", status:"aberto"};
  save(); render();
});
$("btnExport").onclick = async () => {
  // com login: cópia completa do escritório (inclui histórico); contém dados sigilosos
  let dados = state;
  if (window.syncAPI){
    try { dados = await window.syncAPI.copiaSeguranca(); }
    catch(e){ setStatus("Não consegui gerar a cópia (verifique a conexão)."); return; }
  }
  const blob = new Blob([JSON.stringify(dados,null,1)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `pauta-prazos-${todayISO()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus("Cópia baixada. Ela contém dados de processos: guarde em local protegido e não envie por e-mail ou WhatsApp.");
};
$("btnHistGeral").onclick = () => mostraHistorico(null, $("histGeral"));
$("fileImport").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { state = JSON.parse(await f.text()); applyCalendar(); save(); $("dlgConfig").close(); render(); setStatus("Backup importado."); }
  catch(err){ setStatus("Arquivo de backup inválido."); }
};

load();
if (!Object.keys(state.pubs).length && !getAdvs().length){ loadDemo(); }
render();
