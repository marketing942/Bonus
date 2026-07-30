#!/usr/bin/env node
/* =========================================================
   Validador de tracking — GTM server-side + PixelX
   Referência: TRACKING.md

   Roda o checklist da §11 contra um site e imprime o resultado ponto a ponto.
   Sem dependências: leitura de arquivo + regex.

   USO
     node validar-tracking.js <pasta-do-site> [identificador-do-painel]

     node validar-tracking.js .
     node validar-tracking.js ../aniversario-captura eiBtTROiAlNexbHXklSc

   Sem o identificador, ele é inferido do id do <form> ou do botão.

   SAÍDA
     Código 0 = tudo OK. Código 1 = há falha (serve para CI/pre-deploy).

   POR QUE ISTO EXISTE
     Cada item aqui corresponde a um defeito que já zerou ou inflou o Lead em
     produção. Nenhum deles gera erro no console: o site parece funcionar, o
     pageview chega, e a conversão simplesmente não acontece. A única forma
     barata de pegar é comparar mecanicamente com o que funciona.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";
let idPainel = process.argv[3] || null;

const htmlPath = path.join(dir, "index.html");
const jsPath = path.join(dir, "script.js");

if (!fs.existsSync(htmlPath)) {
  console.error(`ERRO: ${htmlPath} não encontrado.`);
  process.exit(1);
}

const htmlRaw = fs.readFileSync(htmlPath, "utf8");
const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf8") : "";

/* Comentários HTML fora: um comentário que cite id="..." contaria como
   ocorrência real e acusaria id duplicado que não existe. */
const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, "");

/* Remove comentários do JS: sem isso, uma linha como
   "// NÃO chamar form.reset()" vira falso-positivo. */
const jsCode = js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/* ---------- helpers ---------- */

const attrs = (tag) => {
  const o = {};
  for (const [, k, v] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[k] = v;
  return o;
};

const formTag = (html.match(/<form[^>]*>/g) || []).find((t) =>
  /class="[^"]*form|name="lead_form"/.test(t)
) || "";

const formBlock =
  (html.match(/<form[^>]*>[\s\S]*?<\/form>/g) || []).find((b) =>
    /type="submit"/.test(b)
  ) || "";

const inputs = (formBlock.match(/<input[^>]*>/g) || []).map(attrs);
const btnTag = (formBlock.match(/<button[^>]*type="submit"[^>]*>/) || [""])[0];
const btn = attrs(btnTag);
const fa = attrs(formTag);

const campo = (id) => inputs.find((a) => a.id === id) || {};
const loaders = html.match(/<script>\(function\(w,d,s,l\)/g) || [];

/* Infere o identificador do painel: um id que não seja um dos nomes canônicos
   é, por eliminação, o identificador opaco do painel. */
const CANONICOS = new Set([
  "lead_name", "lead_email", "lead_phone", "lead_submit", "form-success",
]);
if (!idPainel) {
  const candidatos = [fa.id, btn.id].filter((x) => x && !CANONICOS.has(x));
  idPainel = candidatos[0] || null;
}

/* ---------- checagens ---------- */

const checks = [];
const add = (grupo, nome, ok, dica) => checks.push({ grupo, nome, ok: !!ok, dica });

/* §6.0 — nomenclatura canônica */
add("NOMENCLATURA", 'form name="lead_form"', fa.name === "lead_form",
  `encontrado: name="${fa.name || "(ausente)"}"`);
add("NOMENCLATURA", 'lead_name + name="name"', campo("lead_name").name === "name",
  `encontrado: name="${campo("lead_name").name || "(campo ausente)"}"`);
add("NOMENCLATURA", 'lead_email + name="email"', campo("lead_email").name === "email",
  `encontrado: name="${campo("lead_email").name || "(campo ausente)"}"`);
add("NOMENCLATURA", 'lead_phone + name="phone"', campo("lead_phone").name === "phone",
  `encontrado: name="${campo("lead_phone").name || "(campo ausente)"}"`);
add("NOMENCLATURA", "pxa_mask_phone no telefone",
  (campo("lead_phone").class || "").includes("pxa_mask_phone"),
  "sem a classe a PixelX não aplica a máscara");
add("NOMENCLATURA", 'button id="lead_submit"', btn.id === "lead_submit",
  `encontrado: id="${btn.id || "(sem id)"}"`);
add("NOMENCLATURA", "data-error-for canônicos",
  ["name", "email", "phone"].every((k) => formBlock.includes(`data-error-for="${k}"`)),
  "devem ser name/email/phone — não nome/telefone");

/* IDENTIFICADOR DO PAINEL — o ponto que zerou o aniversario-captura */
add("IDENTIFICADOR", "identificador encontrado", !!idPainel,
  "nenhum id opaco no <form> nem no <button>");
if (idPainel) {
  const comoId = fa.id === idPainel || btn.id === idPainel;
  const comoClasse =
    (fa.class || "").split(/\s+/).includes(idPainel) ||
    (btn.class || "").split(/\s+/).includes(idPainel);

  add("IDENTIFICADOR", `"${idPainel}" é um id (não classe)`, comoId && !comoClasse,
    comoClasse
      ? "está como CLASSE — a regra do painel procura o id. #x e .x são seletores diferentes"
      : "");
  add("IDENTIFICADOR", "único na página",
    (html.match(new RegExp(`id="${idPainel}"`, "g")) || []).length === 1, "");
  add("IDENTIFICADOR", "estático (não alterado em runtime)",
    !new RegExp(`classList\\.(add|remove|toggle)\\([^)]*${idPainel}`).test(jsCode) &&
    !/classList\.toggle\(\s*PIXELX_(CLASS|ID)/.test(jsCode),
    "se o identificador entra/sai do DOM, a PixelX pode nunca vinculá-lo");
}

/* §3 — container */
add("CONTAINER", "exatamente 1 loader do GTM", loaders.length === 1,
  `encontrados: ${loaders.length}${loaders.length > 1 ? " — cada evento conta em dobro" : ""}`);
add("CONTAINER", "loader dentro do <head>",
  loaders.length > 0 && html.indexOf("</head>") > html.search(/<script>\(function\(w,d,s,l\)/), "");
add("CONTAINER", "sem loader direto da PixelX", !html.includes("/remote?url="),
  "loader direto + tag no GTM = PixelX carregada 2x");
add("CONTAINER", "noscript sem espaço no id", !html.includes("?id= "), "");

/* §7 / §11-C — JavaScript */
if (js) {
  add("JAVASCRIPT", "valida telefone por dígitos",
    js.includes("replace(/^\\+\\s*55\\s*/"),
    "contar caracteres deixa passar número incompleto (+55 soma 2 dígitos)");
  add("JAVASCRIPT", "sem form.reset() antes do redirect", !jsCode.includes(".reset()"),
    "a PixelX lê os campos no blur; reset grava valores vazios");
  add("JAVASCRIPT", "redirect com espera",
    /setTimeout\([\s\S]{0,160}?location\.href/.test(jsCode),
    "navegar na hora cancela a requisição assíncrona da conversão");
  add("JAVASCRIPT", "barreira de submit em fase de captura",
    /document\.addEventListener\(\s*\n?\s*['"]submit['"]/.test(jsCode), "");
  /* Exige o PADRÃO da barreira (valida + preventDefault), não um listener de
     clique qualquer: modais e menus têm cliques que não são barreira. */
  add("JAVASCRIPT", "barreira de clique em fase de captura",
    /addEventListener\(\s*\n?\s*['"]click['"][\s\S]{0,300}?validate\(\)[\s\S]{0,160}?preventDefault/.test(jsCode),
    "esperado: click em captura que chama validate() e dá preventDefault se inválido");
  add("JAVASCRIPT", "emissor único (sem send_event/fbq no site)",
    !/\bsend_event\(|\bfbq\(/.test(jsCode),
    "se o painel também dispara, o Lead duplica");
  /* Um push de Lead no dataLayer é emissor tanto quanto send_event: se houver
     acionador no GTM para ele E a regra do painel, o Lead conta duas vezes. */
  add("JAVASCRIPT", "sem push de Lead no dataLayer",
    !/dataLayer\.push\(\s*\{[^}]*event\s*:\s*["'][^"']*lead/i.test(jsCode),
    "push de lead no dataLayer é um segundo emissor (§4/§5)");

  /* consistência JS ↔ HTML */
  const idsHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const idsJs = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  const faltando = idsJs.filter((i) => !idsHtml.has(i));
  add("CONSISTÊNCIA", "todo getElementById existe no HTML", faltando.length === 0,
    faltando.length ? `ausentes: ${faltando.join(", ")}` : "");

  const chavesJs = new Set([...js.matchAll(/(?:set|clear)Error\("([^"]+)"/g)].map((m) => m[1]));
  const chavesHtml = new Set([...html.matchAll(/data-error-for="([^"]+)"/g)].map((m) => m[1]));
  const orfas = [...chavesJs].filter((k) => !chavesHtml.has(k));
  add("CONSISTÊNCIA", "chaves de erro casam com data-error-for", orfas.length === 0,
    orfas.length ? `sem span: ${orfas.join(", ")}` : "");

  add("CONSISTÊNCIA", "sem acesso nomeado form.<campo>",
    !/\bform\.(nome|name|email|phone|telefone)\b/.test(jsCode),
    "form.name colide com HTMLFormElement.name — use getElementById");
}

/* labels */
const fors = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
const idsAll = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const orfaos = fors.filter((f) => !idsAll.has(f));
add("CONSISTÊNCIA", "labels for= resolvem", orfaos.length === 0,
  orfaos.length ? `órfãos: ${orfaos.join(", ")}` : "");

/* ---------- saída ---------- */

console.log(`\nValidação de tracking — ${path.resolve(dir)}`);
console.log(`Identificador do painel: ${idPainel || "(não identificado)"}\n`);

let grupoAtual = "";
let falhas = 0;

for (const c of checks) {
  if (c.grupo !== grupoAtual) {
    grupoAtual = c.grupo;
    console.log(`  ${grupoAtual}`);
  }
  const marca = c.ok ? "  ok  " : "  FALHA";
  console.log(`  ${marca}  ${c.nome}${!c.ok && c.dica ? `\n            → ${c.dica}` : ""}`);
  if (!c.ok) falhas++;
}

console.log(
  falhas === 0
    ? `\n${checks.length} verificações, nenhuma falha.\n`
    : `\n${falhas} de ${checks.length} verificações falharam.\n`
);

process.exit(falhas === 0 ? 0 : 1);
