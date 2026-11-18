// Testes das regras do Firestore no EMULADOR (nunca contra produção).
// Requisitos: Java 21+ e Node 18+.
// Rodar (dentro de tests/regras):
//   npm install
//   npx firebase emulators:exec --only firestore --project demo-pauta "node --test regras.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs } from "firebase/firestore";

let env;
const MEMBRO = { uid: "uid-mariana", email: "mariana@exemplo.test", email_verified: true };
const NAO_MEMBRO = { uid: "uid-estranho", email: "estranho@exemplo.test", email_verified: true };
const NAO_VERIFICADO = { uid: "uid-nv", email: "nv@exemplo.test", email_verified: false };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pauta",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "membros/uid-mariana"), { email: MEMBRO.email });
    await setDoc(doc(db, "membros/uid-nv"), { email: NAO_VERIFICADO.email });
    await setDoc(doc(db, "escritorio/principal/pubs/djen-1"), pub({ versao: 1, atualizadoPor: MEMBRO.email }));
  });
});

const pub = (extra = {}) => Object.assign({
  id: "djen-1", processo: "0000001-00.2026.8.12.0001", disp: "2026-11-18", status: "aberto",
  tipo: "uteis", prazoDias: 5, texto: "teste", link: "https://exemplo.test/doc"
}, extra);
const dbDe = u => u ? env.authenticatedContext(u.uid, { email: u.email, email_verified: u.email_verified }).firestore() : env.unauthenticatedContext().firestore();

function gravaComAuditoria(db, user, id, dados, versao){
  const b = writeBatch(db);
  b.set(doc(db, "escritorio/principal/pubs/" + id), Object.assign({}, dados, { versao, atualizadoPor: user.email }));
  b.set(doc(db, `escritorio/principal/auditoria/${id}__v${versao}`), {
    acao: "alterou", alvo: id, versao, processo: dados.processo, antes: {}, depois: {},
    por: user.email, uid: user.uid, em: serverTimestamp()
  });
  return b.commit();
}

test("sem login: não lê nem grava", async () => {
  const db = dbDe(null);
  await assertFails(getDoc(doc(db, "escritorio/principal/pubs/djen-1")));
  await assertFails(setDoc(doc(db, "escritorio/principal/pubs/x"), pub({ id: "x" })));
});

test("logado mas não é membro: não lê nada", async () => {
  await assertFails(getDoc(doc(dbDe(NAO_MEMBRO), "escritorio/principal/pubs/djen-1")));
  await assertFails(getDocs(collection(dbDe(NAO_MEMBRO), "escritorio/principal/auditoria")));
});

test("membro com e-mail não confirmado: bloqueado", async () => {
  await assertFails(getDoc(doc(dbDe(NAO_VERIFICADO), "escritorio/principal/pubs/djen-1")));
});

test("ninguém se cadastra como membro pelo site (elevação de privilégio)", async () => {
  await assertFails(setDoc(doc(dbDe(NAO_MEMBRO), "membros/uid-estranho"), { email: NAO_MEMBRO.email }));
});

test("membro lê e altera com versão + auditoria no mesmo lote", async () => {
  const db = dbDe(MEMBRO);
  await assertSucceeds(getDoc(doc(db, "escritorio/principal/pubs/djen-1")));
  await assertSucceeds(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ status: "cumprido" }), 2));
});

test("alteração sem registro de auditoria é recusada", async () => {
  const db = dbDe(MEMBRO);
  await assertFails(setDoc(doc(db, "escritorio/principal/pubs/djen-1"), pub({ versao: 2, atualizadoPor: MEMBRO.email })));
});

test("versão desatualizada (duas pessoas ao mesmo tempo) é recusada", async () => {
  const db = dbDe(MEMBRO);
  await assertFails(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ status: "cumprido" }), 1));
  await assertFails(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ status: "cumprido" }), 5));
});

test("não dá para assinar em nome de outra pessoa", async () => {
  const db = dbDe(MEMBRO);
  const b = writeBatch(db);
  b.set(doc(db, "escritorio/principal/pubs/djen-1"), pub({ versao: 2, atualizadoPor: "outra@exemplo.test" }));
  b.set(doc(db, "escritorio/principal/auditoria/djen-1__v2"), { acao: "alterou", alvo: "djen-1", versao: 2, por: "outra@exemplo.test", uid: MEMBRO.uid, em: serverTimestamp() });
  await assertFails(b.commit());
});

test("exclusão definitiva é proibida (só lixeira)", async () => {
  await assertFails(deleteDoc(doc(dbDe(MEMBRO), "escritorio/principal/pubs/djen-1")));
});

test("auditoria não pode ser alterada nem apagada", async () => {
  const db = dbDe(MEMBRO);
  await gravaComAuditoria(db, MEMBRO, "djen-1", pub({ status: "cumprido" }), 2);
  await assertFails(setDoc(doc(db, "escritorio/principal/auditoria/djen-1__v2"), { acao: "forjado" }));
  await assertFails(deleteDoc(doc(db, "escritorio/principal/auditoria/djen-1__v2")));
});

test("campos extras e link javascript: são recusados", async () => {
  const db = dbDe(MEMBRO);
  await assertFails(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ admin: true }), 2));
  await assertFails(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ link: "javascript:alert(1)" }), 2));
  await assertFails(gravaComAuditoria(db, MEMBRO, "djen-1", pub({ status: "qualquer" }), 2));
});

// ---- uso normal: formato exato que o painel grava (sync.js) não pode ser bloqueado ----
const pubCompleta = (extra = {}) => Object.assign({
  id: "djen-9", chave: "123|2026-11-18|Intimação|texto", origemDados: "DJEN", advs: ["OAB/MS 12345"],
  processo: "0000009-00.2026.8.12.0001", disp: "2026-11-18", tribunal: "TJMS", orgao: "1ª Vara Cível",
  classe: "Procedimento Comum Cível", tipoDoc: "Intimação", link: "https://esaj.tjms.jus.br/doc", texto: "prazo de 15 dias",
  prazoDias: 15, tipo: "uteis", criminal: false, origem: "texto",
  det: { dias: 15, horas: false, tipo: "uteis", trecho: { antes: "", achado: "prazo de 15 dias", depois: "" } },
  status: "aberto", tipoManual: null, urgente: null, excluido: null
}, extra);

test("painel: importa publicação nova do DJEN (versão 1)", async () => {
  await assertSucceeds(gravaComAuditoria(dbDe(MEMBRO), MEMBRO, "djen-9", pubCompleta(), 1));
});

test("painel: lançamento manual com campos vazios", async () => {
  const id = "man-0b7a2c1e-1111-4222-8333-944445555666";
  await assertSucceeds(gravaComAuditoria(dbDe(MEMBRO), MEMBRO, id, pubCompleta({
    id, chave: id, origemDados: "Manual", advs: null, tribunal: "", orgao: "", classe: "", tipoDoc: "Lançamento manual",
    link: "", det: null, origem: "manual", prazoDias: 10, tipo: "corridos"
  }), 1));
});

test("painel: documento antigo (sem versão) passa a ter versão 1", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "escritorio/principal/pubs/djen-9"), pubCompleta());
  });
  await assertSucceeds(gravaComAuditoria(dbDe(MEMBRO), MEMBRO, "djen-9", pubCompleta({ status: "cumprido" }), 1));
});

test("painel: manda para a lixeira e restaura", async () => {
  const db = dbDe(MEMBRO);
  await gravaComAuditoria(db, MEMBRO, "djen-9", pubCompleta(), 1);
  await assertSucceeds(gravaComAuditoria(db, MEMBRO, "djen-9", pubCompleta({ excluido: { em: "2026-11-18T20:00:00.000Z", por: MEMBRO.email } }), 2));
  await assertSucceeds(gravaComAuditoria(db, MEMBRO, "djen-9", pubCompleta(), 3));
});

test("painel: salva configurações (com auditoria) e recusa perfil inválido", async () => {
  const db = dbDe(MEMBRO);
  const cfg = (versao, extra = {}) => {
    const b = writeBatch(db);
    b.set(doc(db, "escritorio/principal"), Object.assign({
      advs: [{ nome: "Mariana", oab: "12345", uf: "MS" }], dias: 15, padrao: "", perfil: "tjms-cg",
      feriados: "2026-10-30 Dia do Servidor", excluidas: [], versao, atualizadoPor: MEMBRO.email
    }, extra));
    b.set(doc(db, `escritorio/principal/auditoria/config__v${versao}`), {
      acao: "alterou configurações", alvo: "config", versao, processo: "", antes: null, depois: { dias: 15 },
      por: MEMBRO.email, uid: MEMBRO.uid, em: serverTimestamp()
    });
    return b.commit();
  };
  await assertSucceeds(cfg(1));
  await assertSucceeds(cfg(2));
  await assertFails(cfg(3, { perfil: "qualquer" }));
});

test("membro lê o histórico; não membro não", async () => {
  await gravaComAuditoria(dbDe(MEMBRO), MEMBRO, "djen-1", pub({ status: "cumprido" }), 2);
  await assertSucceeds(getDocs(collection(dbDe(MEMBRO), "escritorio/principal/auditoria")));
  await assertFails(getDocs(collection(dbDe(NAO_MEMBRO), "escritorio/principal/auditoria")));
});

test("outros caminhos do banco: negados", async () => {
  await assertFails(setDoc(doc(dbDe(MEMBRO), "outra/colecao"), { x: 1 }));
  await assertFails(getDoc(doc(dbDe(MEMBRO), "escritorio/outro")));
});
