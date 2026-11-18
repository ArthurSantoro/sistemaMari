// Testes das regras de contagem de prazo e da detecção cível x criminal.
// Rodar:  node --test tests/
// Carrega só a parte "pura" do app.js (datas, feriados, cálculo, detecção), sem tela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const puro = src.split("/* ================= estado")[0];
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(puro + `
  var state = {settings:{perfil:"tjms-cg", feriados:DEFAULT_LOCAIS}};
  customDays = parseCustom(state.settings.feriados);
  this.api = {calcPrazo, isCriminal, urgenteDe, tipoDe, detectPrazo, dayInfo};
`, ctx);
const { calcPrazo, isCriminal, urgenteDe, tipoDe, detectPrazo } = ctx.api;
const fim = (...a) => calcPrazo(...a).fim;

test("cível: 5 dias úteis, disponibilizado qua 18/11/2026 (20/11 feriado) vence sex 27/11", () => {
  const r = calcPrazo("2026-11-18", 5, "uteis");
  assert.equal(r.pub, "2026-11-19");
  assert.equal(r.inicio, "2026-11-23");
  assert.equal(r.fim, "2026-11-27");
});

test("cível: atravessa o recesso (CPC art. 220) e o Carnaval/Cinzas do TJMS", () => {
  assert.equal(fim("2026-12-15", 15, "uteis"), "2027-02-11");
});

test("criminal: dias corridos (CPP 798), começa no 1º dia útil após a publicação", () => {
  const r = calcPrazo("2026-11-19", 10, "corridos");
  assert.equal(r.pub, "2026-11-23");
  assert.equal(r.inicio, "2026-11-24");
  assert.equal(r.fim, "2026-12-03");
});

test("criminal: publicação na sexta começa na segunda (Súmula 310/STF)", () => {
  const r = calcPrazo("2026-11-26", 5, "corridos");
  assert.equal(r.pub, "2026-11-27");
  assert.equal(r.inicio, "2026-11-30");
  assert.equal(r.fim, "2026-12-04");
});

test("criminal: termina no sábado → prorroga para segunda (CPP 798 §3º)", () => {
  const r = calcPrazo("2026-11-23", 4, "corridos");
  assert.equal(r.fim, "2026-11-30");
  assert.equal(r.prorrogado, "Sábado");
});

test("criminal: suspenso no recesso (CPP 798-A), mas réu preso corre e não vence em feriado forense", () => {
  assert.equal(fim("2026-12-14", 10, "corridos", false), "2027-01-26");
  assert.equal(fim("2026-12-14", 10, "corridos", true), "2027-01-07");
});

test("classe processual: criminal x cível (vara mista não engana)", () => {
  assert.equal(isCriminal({classe: "AÇÃO PENAL - PROCEDIMENTO ORDINÁRIO"}), true);
  assert.equal(isCriminal({classe: "Medidas Protetivas de Urgência (Lei Maria da Penha) Criminal"}), true);
  assert.equal(isCriminal({classe: "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL", orgao: "Vara do Juizado Especial Cível e Criminal"}), false);
  assert.equal(isCriminal({classe: "Execução Fiscal"}), false);
  assert.equal(isCriminal({classe: "", orgao: "Vara do Juizado Especial Cível e Criminal"}), false);
});

test("réu preso detectado no texto; escolha manual prevalece", () => {
  assert.equal(urgenteDe({classe: "Ação Penal", texto: "Intime-se a defesa do réu preso"}), true);
  assert.equal(urgenteDe({classe: "Ação Penal", texto: "Intime-se a defesa", urgente: false}), false);
  assert.equal(tipoDe({classe: "Ação Penal", tipoManual: true, tipo: "uteis"}), "uteis");
});

test("leitura do prazo no texto", () => {
  assert.equal(detectPrazo("no prazo de 15 (quinze) dias").dias, 15);
  assert.equal(detectPrazo("no prazo de quinze dias úteis").dias, 15);
  assert.equal(detectPrazo("prazo de 10 (dez) dias corridos").tipo, "corridos");
  assert.equal(detectPrazo("Arquivem-se."), null);
});
