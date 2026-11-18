/* ================= sincronização online (Firebase) =================
   Login (Firebase Authentication) + banco (Cloud Firestore).
   A segurança de verdade está nas regras do Firestore (firestore.rules):
   este arquivo só organiza a interface e as gravações.

   A configuração abaixo é pública por natureza (identifica o projeto, não dá acesso).
   Restrinja a chave por domínio no Google Cloud Console (ver SEGURANCA.md). */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDb_IlyrnVgtTaEErGupE3Apy1_3WW2wZo",
  authDomain: "pauta-de-prazos.firebaseapp.com",
  projectId: "pauta-de-prazos",
  storageBucket: "pauta-de-prazos.firebasestorage.app",
  messagingSenderId: "11001205820",
  appId: "1:11001205820:web:4c073b17b089636f6b9f39"
};
const SDK = "https://www.gstatic.com/firebasejs/12.6.0/";
// Sessão: sai sozinha depois deste tempo sem uso do painel neste aparelho.
const INATIVIDADE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const ULTIMO_USO_KEY = "pautaPrazos.ultimoUso";

if (FIREBASE_CONFIG){
  window.SYNC_ON = true;
  startSync().catch(e => banner("Não consegui iniciar a sincronização: " + esc(e.message), "err"));
}

async function startSync(){
  const [{initializeApp}, A, F] = await Promise.all([
    import(SDK+"firebase-app.js"), import(SDK+"firebase-auth.js"), import(SDK+"firebase-firestore.js")
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, {localCache: F.persistentLocalCache({tabManager: F.persistentMultipleTabManager()})}); }
  catch(e){ db = F.getFirestore(app); }
  const OFFICE = F.doc(db, "escritorio", "principal");
  const PUBS = F.collection(db, "escritorio", "principal", "pubs");
  const AUD = F.collection(db, "escritorio", "principal", "auditoria");

  // com o banco online não se importa arquivo; a exportação vira "cópia de segurança"
  $("lblImport").hidden = true;
  $("btnExport").textContent = "Baixar cópia de segurança";
  $("btnHistGeral").hidden = false;

  const SKEYS = ["advs","dias","padrao","perfil","feriados","excluidas"];
  const pickSettings = s => Object.fromEntries(SKEYS.map(k => [k, s[k] ?? null]));
  // campos que entram no histórico quando mudam
  const CAMPOS_AUD = ["status","prazoDias","tipo","urgente","excluido","processo","disp"];

  let unsubs = [], gotSettings = false, gotPubs = false, ready = false, userEmail = "";
  // o que está no servidor (para saber o que mudou e qual a versão atual)
  let remoto = {settings:null, settingsVersao:0, pubs:{}};
  const syncInfo = $("syncInfo");
  const showSync = (txt) => { syncInfo.hidden = !txt; syncInfo.textContent = txt || ""; };

  /* ---------- gravação: cada alteração vai com versão + registro de auditoria, no mesmo lote ---------- */
  const semMeta = o => { const c = Object.assign({}, o); delete c.versao; delete c.atualizadoPor; return c; };
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pega = (o, campos) => o ? Object.fromEntries(campos.filter(k => o[k] !== undefined).map(k => [k, o[k]])) : null;

  function acaoDe(antes, depois){
    if (!antes) return depois.origemDados === "DJEN" ? "importou do DJEN" : "criou";
    if (!antes.excluido && depois.excluido) return "excluiu (lixeira)";
    if (antes.excluido && !depois.excluido) return "restaurou da lixeira";
    if (antes.status !== depois.status) return depois.status === "cumprido" ? "marcou cumprido" : depois.status === "arquivado" ? "arquivou" : "reabriu";
    return "alterou";
  }

  let fila = Promise.resolve();
  window.syncPush = () => { fila = fila.then(pushAgora).catch(() => {}); return fila; };

  async function pushAgora(){
    if (!ready || state.demo) return;
    const tarefas = [];

    // configurações
    const st = pickSettings(state.settings);
    if (!igual(st, remoto.settings)){
      const versao = remoto.settingsVersao + 1;
      const antes = remoto.settings, depois = st;
      const mud = Object.keys(depois).filter(k => !igual(antes && antes[k], depois[k]));
      tarefas.push({
        nome: "configurações",
        alvo: "config", versao,
        doc: OFFICE, dados: Object.assign({}, st, {versao, atualizadoPor: userEmail}),
        aud: {acao: "alterou configurações", processo: "", antes: pega(antes, mud), depois: pega(depois, mud)},
        aplica: () => { remoto.settings = st; remoto.settingsVersao = versao; }
      });
    }
    // publicações (sem exclusão definitiva: o site só manda para a lixeira)
    for (const [id, p] of Object.entries(state.pubs)){
      const atual = semMeta(p), r = remoto.pubs[id];
      if (r && igual(atual, r.dados)) continue;
      const versao = (r ? r.versao : 0) + 1;
      const antes = r ? r.dados : null;
      tarefas.push({
        nome: "processo " + (p.processo || id),
        alvo: id, versao,
        doc: F.doc(PUBS, id), dados: Object.assign({}, atual, {versao, atualizadoPor: userEmail}),
        aud: {acao: acaoDe(antes, atual), processo: String(p.processo || "").slice(0,120),
              antes: pega(antes, CAMPOS_AUD), depois: pega(atual, CAMPOS_AUD)},
        aplica: () => { remoto.pubs[id] = {dados: atual, versao}; }
      });
    }
    if (!tarefas.length) return;

    // até ~200 alterações por lote (cada uma = registro + auditoria)
    const conflitos = [], falhas = [];
    for (let i = 0; i < tarefas.length; i += 200){
      const grupo = tarefas.slice(i, i+200);
      const b = F.writeBatch(db);
      grupo.forEach(t => {
        b.set(t.doc, limpa(t.dados));
        b.set(F.doc(AUD, t.alvo + "__v" + t.versao), registroAud(t));
        t.aplica(); // otimista; se o servidor recusar, o snapshot devolve o valor certo
      });
      try { await b.commit(); }
      catch(e){
        if (e && e.code === "permission-denied" && grupo.length === 1) conflitos.push(grupo[0].nome);
        else if (e && e.code === "permission-denied") {
          // lote com várias: tenta uma por uma para achar a que conflitou
          for (const t of grupo){
            const b1 = F.writeBatch(db);
            b1.set(t.doc, limpa(t.dados));
            b1.set(F.doc(AUD, t.alvo + "__v" + t.versao), registroAud(t));
            try { await b1.commit(); } catch(e2){ (e2.code === "permission-denied" ? conflitos : falhas).push(t.nome); }
          }
        }
        else falhas.push(traduz(e));
        await recarregar();
      }
    }
    if (conflitos.length) banner("Não salvei a alteração em " + esc(conflitos.slice(0,3).join(", ")) + (conflitos.length > 3 ? " e outros" : "") +
      ": outra pessoa alterou ao mesmo tempo ou a gravação foi recusada. A tela já mostra a versão atual; confira e refaça se for preciso.", "err");
    else if (falhas.length) showSync("Não consegui salvar online: " + falhas[0]);
  }
  // remove undefined (o Firestore não aceita) mantendo null
  const limpa = o => JSON.parse(JSON.stringify(o, (k, v) => v === undefined ? null : v), (k, v) => v);
  // registro de auditoria: a hora do servidor (serverTimestamp) entra DEPOIS da limpeza,
  // senão a limpeza (JSON) destrói o marcador e as regras recusam a gravação
  const registroAud = t => Object.assign(
    limpa(Object.assign({}, t.aud, {alvo: t.alvo, versao: t.versao, por: userEmail, uid: auth.currentUser.uid})),
    {em: F.serverTimestamp()}
  );
  async function recarregar(){
    try {
      const [s, ps] = await Promise.all([F.getDocFromServer(OFFICE), F.getDocsFromServer(PUBS)]);
      aplicaSettings(s); aplicaPubs(ps); render();
    } catch(e){ /* sem conexão: o snapshot corrige depois */ }
  }

  function aplicaSettings(snap){
    if (!snap.exists()) { remoto.settings = null; remoto.settingsVersao = 0; return; }
    const d = snap.data();
    SKEYS.forEach(k => { if (d[k] !== null && d[k] !== undefined) state.settings[k] = d[k]; });
    delete state.settings.oab;
    remoto.settings = pickSettings(state.settings);
    remoto.settingsVersao = d.versao || 0;
    applyCalendar();
  }
  function aplicaPubs(snap){
    const pubs = {}, rem = {};
    snap.forEach(doc => {
      const d = doc.data(), dados = semMeta(d);
      pubs[doc.id] = Object.assign({}, dados, {versao: d.versao || 0, atualizadoPor: d.atualizadoPor || ""});
      rem[doc.id] = {dados, versao: d.versao || 0};
    });
    state.pubs = pubs; state.demo = false; remoto.pubs = rem;
  }

  function maybeReady(){
    if (ready || !gotSettings || !gotPubs) return;
    ready = true;
    window.syncPush().then(() => {
      // com o banco online, não guarda cópia dos prazos solta no navegador
      try { localStorage.removeItem(KEY); } catch(e){}
    });
  }

  function subscribe(){
    const localAntes = (!state.demo && Object.keys(state.pubs).length) ? state.pubs : null;
    unsubs.push(F.onSnapshot(OFFICE, {includeMetadataChanges:true}, snap => {
      aplicaSettings(snap);
      gotSettings = true; render(); maybeReady();
      showSync(snap.metadata.fromCache ? "Sem internet no momento: as mudanças são enviadas quando a conexão voltar." : "Sincronizado com o escritório.");
    }, err => semAcesso(err)));

    unsubs.push(F.onSnapshot(PUBS, snap => {
      const primeira = !gotPubs;
      gotPubs = true;
      aplicaPubs(snap);
      // primeiro uso: banco vazio e este aparelho já tinha prazos guardados → envia
      if (primeira && !snap.size && localAntes) state.pubs = Object.assign({}, localAntes);
      render(); maybeReady();
    }, err => semAcesso(err)));
  }

  function semAcesso(err){
    if (err && err.code === "permission-denied"){
      showSync("");
      banner("Sua conta entrou, mas ainda não foi liberada para ver os prazos do escritório. Peça ao administrador para cadastrá-la como membro.", "err");
    } else showSync("Sem acesso aos dados do escritório: " + traduz(err));
  }

  function traduz(e){
    const c = (e && e.code) || "";
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email") || c.includes("user-disabled")) return "e-mail ou senha incorretos.";
    if (c.includes("too-many-requests")) return "muitas tentativas. Espere alguns minutos e tente de novo.";
    if (c.includes("network") || c.includes("unavailable")) return "sem conexão com a internet.";
    if (c.includes("permission-denied")) return "acesso negado.";
    return "erro inesperado. Tente de novo em instantes.";
  }

  /* ---------- histórico (auditoria) para a interface ---------- */
  window.syncAPI = {
    async historico(alvo){
      const q = alvo
        ? F.query(AUD, F.where("alvo", "==", alvo), F.limit(200))
        : F.query(AUD, F.orderBy("em", "desc"), F.limit(150));
      const s = await F.getDocs(q);
      const out = [];
      s.forEach(d => { const x = d.data(); out.push(Object.assign({}, x, {em: x.em && x.em.toDate ? x.em.toDate() : null})); });
      out.sort((a,b) => (b.em||0) - (a.em||0));
      return out;
    },
    async copiaSeguranca(){
      const hist = await this.historico(null);
      return {geradoEm: new Date().toISOString(), por: userEmail, configuracoes: pickSettings(state.settings),
              publicacoes: state.pubs, historicoRecente: hist};
    },
    email: () => userEmail
  };

  /* ---------- login, confirmação de e-mail, sessão ---------- */
  const dlg = $("dlgLogin");
  dlg.addEventListener("cancel", ev => ev.preventDefault()); // não fecha com Esc enquanto não entrar
  const msg = t => { $("loginMsg").textContent = t; };
  const modo = m => { // "login" | "verificar"
    $("loginCampos").hidden = m !== "login";
    $("verifCampos").hidden = m !== "verificar";
  };

  $("formLogin").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!$("loginCampos").hidden){
      msg("Entrando…"); $("btnLogin").disabled = true;
      try {
        await A.setPersistence(auth, $("loginCompart").checked ? A.browserSessionPersistence : A.browserLocalPersistence);
        await A.signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginSenha").value);
        $("loginSenha").value = ""; msg("");
      }
      catch(e){ msg("Não foi possível entrar: " + traduz(e)); }
      finally { $("btnLogin").disabled = false; }
    }
  });
  $("btnReset").onclick = async () => {
    const email = $("loginEmail").value.trim();
    if (!email){ msg("Digite o seu e-mail acima e clique de novo em Esqueci a senha."); return; }
    // mensagem igual exista ou não a conta (não revela quem está cadastrado)
    try { await A.sendPasswordResetEmail(auth, email); } catch(e){ if (String(e.code).includes("too-many-requests")) { msg("Muitas tentativas. Espere alguns minutos."); return; } }
    msg("Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por pouco tempo e só uma vez. Confira também o spam.");
  };
  $("btnEnviarVerif").onclick = async () => {
    try { await A.sendEmailVerification(auth.currentUser); msg("Enviamos o link de confirmação para " + auth.currentUser.email + ". Abra o e-mail, clique no link e depois em \"Já confirmei\"."); }
    catch(e){ msg("Não foi possível enviar: " + traduz(e)); }
  };
  $("btnJaVerif").onclick = async () => {
    try {
      await auth.currentUser.reload();
      if (!auth.currentUser.emailVerified){ msg("Ainda não aparece como confirmado. Clique no link do e-mail e tente de novo."); return; }
      await auth.currentUser.getIdToken(true);
      entrar(auth.currentUser);
    } catch(e){ msg("Não foi possível conferir: " + traduz(e)); }
  };
  $("btnSairVerif").onclick = () => sair();

  async function sair(){
    try { $("dlgConfig").close(); } catch(e){}
    unsubs.forEach(u => u()); unsubs = [];
    try { await A.signOut(auth); } catch(e){}
    // apaga do aparelho tudo o que foi baixado (cache do banco e cópias locais)
    try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch(e){}
    try { localStorage.removeItem(KEY); localStorage.removeItem(ULTIMO_USO_KEY); } catch(e){}
    location.reload();
  }
  $("btnLogout").onclick = sair;

  // marca uso (no máximo uma vez por minuto) para a expiração por inatividade
  let ultimaMarca = 0;
  const marcaUso = () => { const n = Date.now(); if (n - ultimaMarca > 60000){ ultimaMarca = n; try { localStorage.setItem(ULTIMO_USO_KEY, String(n)); } catch(e){} } };
  ["click","keydown","touchstart"].forEach(ev => document.addEventListener(ev, marcaUso, {passive:true}));

  function entrar(user){
    userEmail = user.email;
    if (dlg.open) dlg.close();
    $("acctInfo").hidden = false; $("acctInfo").textContent = "Conectada como " + user.email;
    $("btnLogout").hidden = false;
    showSync("Conectando ao escritório…");
    marcaUso();
    subscribe();
  }

  A.onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    gotSettings = gotPubs = ready = false; remoto = {settings:null, settingsVersao:0, pubs:{}};
    if (user){
      let ultimo = 0; try { ultimo = +localStorage.getItem(ULTIMO_USO_KEY) || 0; } catch(e){}
      if (ultimo && Date.now() - ultimo > INATIVIDADE_MAX_MS){ sair(); return; }
      if (!user.emailVerified){
        userEmail = user.email;
        modo("verificar");
        msg("Para proteger os dados, confirme o seu e-mail (" + user.email + ") antes do primeiro acesso.");
        if (!dlg.open) dlg.showModal();
        return;
      }
      entrar(user);
    } else {
      userEmail = "";
      $("acctInfo").hidden = true; $("btnLogout").hidden = true;
      showSync("");
      modo("login");
      if (!dlg.open) dlg.showModal();
    }
  });
}
