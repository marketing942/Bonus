/* =========================================================
   CPPEM — Backend único de captura (Google Apps Script)
   Todos os projetos (CPPEM, UNICIVE, PMPE, COLEGIO, ...) gravam
   na MESMA aba. A identificação de quem enviou vem na coluna "Origem".

   Como publicar:
   1) Planilha → Extensões → Apps Script → cole ESTE arquivo inteiro
      (substituindo o Codigo.gs antigo) e salve.
   2) Implantar → Gerenciar implantações → editar a implantação atual
      → Versão: Nova versão → Implantar.
      (Editar a implantação EXISTENTE mantém a mesma URL /exec, então
       nenhum site precisa mudar de endereço.)
   3) Executar uma vez a função `configurarPlanilha` (autoriza e cria a aba).
   4) Opcional: executar `migrarAbasAntigasParaLEADS` para trazer o
      histórico das abas antigas para a aba LEADS.
   ========================================================= */

/* ---------- CONFIGURAÇÃO ---------- */

const ABA_DESTINO = "MarkTeste"; // aba única de destino (todas as origens gravam aqui)
const FUSO = "America/Recife";

/* Colunas da aba única. A ordem daqui manda em tudo (cabeçalho, escrita e
   migração) — para acrescentar um campo, basta incluir aqui e no
   `montarLinha`. */
const COLUNAS = [
  { titulo: "Data e Hora",  largura: 160, formato: "dd/MM/yyyy HH:mm:ss" },
  { titulo: "Origem",       largura: 120, formato: "@" },
  { titulo: "Nome",         largura: 220, formato: "@" },
  { titulo: "Email",        largura: 250, formato: "@" },
  { titulo: "Telefone",     largura: 180, formato: "@" },
  { titulo: "Pagina URL",   largura: 320, formato: "@" },
  { titulo: "UTM Source",   largura: 150, formato: "@" },
  { titulo: "UTM Campaign", largura: 220, formato: "@" }
];

/* De onde veio o lead: chave = o que chega em ?aba= (ou ?origem=) na URL do
   /exec, valor = o que aparece na coluna "Origem". Mantive os nomes antigos
   das abas como chave para que NENHUM site quebre enquanto os fronts não
   forem atualizados — CAPTURA e MANYCHAT são apelidos históricos de CPPEM e
   PMPE, e os "_COMUNIDADE" (exit popup) contam como a própria unidade. */
const ORIGENS = {
  CPPEM:              "CPPEM",
  CAPTURA:            "CPPEM",
  CAPTURA_COMUNIDADE: "CPPEM",
  UNICIVE:            "UNICIVE",
  UNICIVE_COMUNIDADE: "UNICIVE",
  PMPE:               "PMPE",
  MANYCHAT:           "PMPE",
  COLEGIO:            "COLEGIO",
  FARDA:              "FARDA",
  SUPLETIVO:          "SUPLETIVO",
  CASA:               "CASA"
};

/* Rede de segurança: se um site esquecer o ?aba= e o payload não trouxer
   origem, tenta deduzir pelo domínio da página. */
const DOMINIOS = [
  { teste: /unicv|unicive/i,         chave: "UNICIVE" },
  { teste: /colegio/i,               chave: "COLEGIO" },
  { teste: /pmpe|manychat/i,         chave: "PMPE" },
  { teste: /contato\.cppem|cppem/i,  chave: "CPPEM" }
];

/* ---------- ENTRADA ---------- */

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const dados = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const params = (e && e.parameter) || {};

    const planilha = obterAba();
    const linha = montarLinha(dados, params);

    escreverLinha(planilha, linha);

    return json({ status: "ok", aba: ABA_DESTINO, origem: linha[1] });

  } catch (err) {
    return json({ status: "erro", mensagem: err.message });

  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput(
    "CPPEM Sheets — funcionando (aba única: " + ABA_DESTINO + ")."
  );
}

/* ---------- MONTAGEM DA LINHA ---------- */

/* Aceita os nomes de campo de TODOS os fronts atuais. O captura-unicive manda
   name/phone; os outros mandam nome/telefone e `pagina` em vez de
   `pagina_url`. Em vez de exigir que os quatro sites mudem no mesmo dia, o
   backend entende os dois dialetos. */
function montarLinha(dados, params) {
  const chave = normalizarChave(
    params.aba || params.origem || dados.aba || dados.origem || ""
  );

  const paginaUrl = pegar(dados, ["pagina_url", "pagina", "page_url", "url"]);

  const origem =
    ORIGENS[chave] ||
    ORIGENS[deduzirPorUrl(paginaUrl)] ||
    chave ||
    "DESCONHECIDA";

  return [
    new Date(),
    origem,
    pegar(dados, ["nome", "name", "nome_completo"]),
    pegar(dados, ["email", "e-mail", "mail"]),
    telefoneTexto(pegar(dados, ["telefone", "phone", "whatsapp", "celular", "phone_e164"])),
    paginaUrl,
    pegar(dados, ["utm_source", "utmSource"]),
    pegar(dados, ["utm_campaign", "utmCampaign"])
  ];
}

function pegar(obj, chaves) {
  for (let i = 0; i < chaves.length; i++) {
    const v = obj[chaves[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function normalizarChave(v) {
  return String(v || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function deduzirPorUrl(url) {
  if (!url) return "";

  for (let i = 0; i < DOMINIOS.length; i++) {
    if (DOMINIOS[i].teste.test(url)) return DOMINIOS[i].chave;
  }

  return "";
}

/* O telefone chega da máscara da PixelX como "+55 81 9 9996-7415". O "+" no
   começo faz o Sheets tentar interpretar a célula como fórmula — daí o
   #ERROR!. Duas travas contra isso:
   1) a coluna inteira é formatada como texto ("@") em `configurarAba`, e a
      linha nova recebe o formato ANTES de receber o valor (`escreverLinha`);
   2) aqui o número é normalizado para um formato estável e sem "+" inicial —
      então, mesmo que alguém apague a formatação da coluna à mão, o valor
      continua sendo texto simples e legível. */
function telefoneTexto(valor) {
  if (!valor) return "";

  const digitos = String(valor).replace(/\D/g, "");
  if (!digitos) return "";

  // 55 + DDD + 8 ou 9 dígitos → "55 81 99996-7415"
  const br = digitos.replace(/^0+/, "").replace(/^55/, "");

  if (br.length === 10 || br.length === 11) {
    const ddd = br.slice(0, 2);
    const resto = br.slice(2);
    const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
    const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);

    return "55 " + ddd + " " + meio + "-" + fim;
  }

  return digitos; // fora do padrão: guarda cru, mas sem "+"
}

/* ---------- ESCRITA ---------- */

/* Não usa appendRow de propósito: o formato precisa estar aplicado ANTES do
   valor entrar, senão o Sheets já converte "+55..." em fórmula na escrita. */
function escreverLinha(planilha, valores) {
  const linha = Math.max(planilha.getLastRow(), 1) + 1;
  const range = planilha.getRange(linha, 1, 1, COLUNAS.length);

  range.setNumberFormats([COLUNAS.map(function (c) { return c.formato; })]);
  range.setValues([valores]);
}

function obterAba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let planilha = ss.getSheetByName(ABA_DESTINO);

  if (!planilha) {
    planilha = ss.insertSheet(ABA_DESTINO);
    configurarAba(planilha);
  } else if (planilha.getLastRow() === 0) {
    configurarAba(planilha);
  }

  return planilha;
}

/* ---------- SETUP (rodar à mão, uma vez) ---------- */

function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(FUSO);
  configurarAba(obterAba());
}

function configurarAba(planilha) {
  const titulos = COLUNAS.map(function (c) { return c.titulo; });

  const h = planilha.getRange(1, 1, 1, titulos.length);
  h.setValues([titulos]);
  h.setFontWeight("bold");
  h.setBackground("#00E63C");
  h.setFontColor("#0A0A0A");

  COLUNAS.forEach(function (c, i) {
    planilha.setColumnWidth(i + 1, c.largura);

    // Formata a coluna inteira, não só o cabeçalho: assim a digitação manual
    // de um telefone também fica protegida do "+" virar fórmula.
    planilha
      .getRange(2, i + 1, Math.max(planilha.getMaxRows() - 1, 1), 1)
      .setNumberFormat(c.formato);
  });

  planilha.setFrozenRows(1);
}

/* ---------- MIGRAÇÃO DO HISTÓRICO (rodar à mão, uma vez) ---------- */

/* Lê as abas antigas, casa as colunas pelo NOME do cabeçalho (as abas não
   tinham todas o mesmo layout) e joga tudo na aba LEADS, com Origem/Página
   preenchidas a partir do nome da aba. As abas antigas NÃO são apagadas —
   confira o resultado e remova à mão depois. */
function migrarAbasAntigasParaLEADS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const destino = obterAba();
  const linhas = [];

  ss.getSheets().forEach(function (aba) {
    const nome = aba.getName();
    if (nome === ABA_DESTINO) return;
    if (aba.getLastRow() < 2) return;

    const origem = ORIGENS[normalizarChave(nome)] || normalizarChave(nome);

    const tabela = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
    const cab = tabela[0].map(function (t) { return String(t).trim().toLowerCase(); });

    const idx = function (nomes) {
      for (let i = 0; i < nomes.length; i++) {
        const p = cab.indexOf(nomes[i]);
        if (p >= 0) return p;
      }
      return -1;
    };

    const cData = idx(["data e hora", "data", "data_envio"]);
    const cNome = idx(["nome", "name"]);
    const cMail = idx(["e-mail", "email"]);
    const cTel  = idx(["telefone", "phone", "whatsapp"]);
    const cUrl  = idx(["página url", "pagina url", "pagina_url", "página", "pagina"]);
    const cSrc  = idx(["utm source", "utm_source"]);
    const cCamp = idx(["utm campaign", "utm_campaign"]);

    const val = function (linha, c) { return c >= 0 ? String(linha[c] || "").trim() : ""; };

    for (let i = 1; i < tabela.length; i++) {
      const l = tabela[i];
      if (!l.join("").trim()) continue;

      linhas.push([
        cData >= 0 ? (l[cData] instanceof Date ? l[cData] : parsarData(l[cData])) : "",
        origem,
        val(l, cNome),
        val(l, cMail),
        telefoneTexto(val(l, cTel)),
        val(l, cUrl),
        val(l, cSrc),
        val(l, cCamp)
      ]);
    }
  });

  if (!linhas.length) return;

  // Ordena por data para o histórico consolidado fazer sentido na leitura.
  linhas.sort(function (a, b) {
    const ta = a[0] instanceof Date ? a[0].getTime() : 0;
    const tb = b[0] instanceof Date ? b[0].getTime() : 0;
    return ta - tb;
  });

  const inicio = Math.max(destino.getLastRow(), 1) + 1;
  const range = destino.getRange(inicio, 1, linhas.length, COLUNAS.length);
  const formatos = COLUNAS.map(function (c) { return c.formato; });

  range.setNumberFormats(linhas.map(function () { return formatos; }));
  range.setValues(linhas);
}

/* As abas antigas gravavam a data como TEXTO "dd/MM/yyyy HH:mm:ss". */
function parsarData(v) {
  const m = String(v || "").match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return String(v || "");

  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

/* ---------- utilitário ---------- */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
