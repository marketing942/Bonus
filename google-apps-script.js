/* =========================================================
   CPPEM — Backend único de captura (Google Apps Script)

   Uma implantação recebe os leads de todos os sites e roteia por origem:

     aba CPPEM        captura-cppem, pmpe, captura-manychat-pmpe,
                      mentoria-individual, presencial-em-casa,
                      supletivo-filiado-cppem
     aba UNICIVE_Novo captura-unicive
     aba COLEGIO_Novo captura-colegio
     aba Venda_Direta operacao-alvorada, apostila, site-cppem /qg e o
                      modal de WhatsApp — venda direta, fora do funil
     aba IGNORADOS    só o que o script não reconheceu. Deve viver VAZIA:
                      linha aqui é sinal de configuração quebrada

   Quem manda para onde é o ORIGENS + ABA_POR_ORIGEM, logo abaixo.

   A escrita é feita POR NOME DE COLUNA, lendo o cabeçalho da aba — nunca por
   posição fixa. É o que permite conviver com a coluna VENDEDOR, preenchida à
   mão: o script só escreve nas colunas que conhece, e qualquer coluna que ele
   não conheça fica intocada. Mudar a ordem das colunas na planilha também não
   quebra nada.

   Como publicar:
   1) Planilha → Extensões → Apps Script → cole ESTE arquivo inteiro
      (substituindo o Codigo.gs antigo) e salve.
   2) Implantar → Gerenciar implantações → editar a implantação atual
      → Versão: Nova versão → Implantar. A URL /exec não muda.
   3) Rodar `conferirPlanilha` — NÃO altera nada, só mostra no log em qual
      coluna cada campo vai cair. Confira antes de seguir.
   4) Rodar `prepararAba` — formata as colunas de texto (mata o #ERROR! do
      telefone) e congela o cabeçalho. Não mexe em valor nenhum.
   5) Opcional: `migrarAbasParaCPPEM` traz o histórico das outras abas.
   ========================================================= */

/* ---------- CONFIGURAÇÃO ---------- */

const ABA_DESTINO = "CPPEM";

/* Origens que NÃO vão para a aba padrão. Quem não estiver aqui cai na
   ABA_DESTINO. A aba é criada no primeiro lead, já no padrão de colunas
   daqui — as abas "UNICIVE" e "COLEGIO" antigas têm outro layout e ficam
   intocadas, por isso o sufixo _Novo. */
const ABA_POR_ORIGEM = {
  UNICIVE:   "UNICIVE_Novo",
  COLEGIO:   "COLEGIO_Novo",

  // Venda direta: leads que ficam fora do funil principal de propósito.
  QG:        "Venda_Direta",   // site-cppem  /qg
  WHATSAPP:  "Venda_Direta",   // site-cppem  modal de WhatsApp
  OPERACAO:  "Venda_Direta",   // operacao-alvorada
  APOSTILA:  "Venda_Direta"    // apostila
};

/* Rede de segurança, e SÓ isso: aqui cai o que o script NÃO reconheceu.

   Antes esta aba acumulava dois casos opostos — a venda direta, que é uma
   DECISÃO, e o ?aba= errado, que é um ACIDENTE. Misturados, o acidente ficava
   invisível: a aba sempre tinha conteúdo legítimo, então ninguém percebia que
   havia site quebrado ali dentro. Foi exatamente assim que os leads do
   Presencial em casa e do Supletivo ficaram caindo aqui sem ninguém notar.

   Separadas, a regra fica legível: esta aba deve viver VAZIA. Linha aqui é
   sinal de configuração quebrada, não de lead a trabalhar. */
const ABA_DESCONHECIDOS = "IGNORADOS";

const FUSO = "America/Recife";

/* Quais abas o `migrarAbasParaCPPEM` deve trazer. Lista VAZIA = todas.

   Migrar uma de cada vez é mais seguro: você confere o resultado antes de ir
   para a próxima. Edite esta linha, salve, e rode a função. */
const ABAS_PARA_MIGRAR = ["MarkTeste"];

/* Campos que o script sabe preencher. `titulos` são os nomes de cabeçalho
   aceitos (minúsculos, sem depender de acento na comparação). O primeiro é o
   usado ao criar uma aba do zero. */ 
const CAMPOS = [
  { chave: "data",         titulo: "Data e Hora",  largura: 160, titulos: ["data e hora", "data"],                                  formato: "dd/MM/yyyy HH:mm:ss" },
  { chave: "origem",       titulo: "Origem",       largura: 120, titulos: ["origem"],                                               formato: "@" },
  { chave: "nome",         titulo: "Nome",         largura: 220, titulos: ["nome"],                                                 formato: "@" },
  { chave: "email",        titulo: "Email",        largura: 250, titulos: ["email", "e-mail"],                                      formato: "@" },
  { chave: "telefone",     titulo: "Telefone",     largura: 180, titulos: ["telefone", "whatsapp", "celular"],                      formato: "@" },
  { chave: "url",          titulo: "Pagina URL",   largura: 320, titulos: ["pagina url", "página url", "pagina", "página", "url"],  formato: "@" },
  { chave: "utm_source",   titulo: "UTM Source",   largura: 150, titulos: ["utm source", "utm_source"],                             formato: "@" },
  { chave: "utm_campaign", titulo: "UTM Campaign", largura: 220, titulos: ["utm campaign", "utm_campaign"],                         formato: "@" }
];

/* Colunas criadas junto com uma aba nova mas que o script NUNCA escreve — são
   do time. Ficam depois das colunas de dados. */
const COLUNAS_MANUAIS = ["VENDEDOR"];

/* Quem pode gravar. Chave = o que chega em ?aba= (ou ?origem=); valor = o
   rótulo da coluna Origem, que também é o que decide a aba (ver
   ABA_POR_ORIGEM).

   Os cinco projetos que compartilham a aba CPPEM usam o mesmo rótulo de
   propósito: assim nenhum site precisa trocar o ?aba= dele. O que diferencia
   um do outro na planilha é a Página URL.

   Quem NÃO está aqui vai para a aba IGNORADOS, que é rede de segurança e não
   destino — ver ABA_DESCONHECIDOS. */
const ORIGENS = {
  // → aba CPPEM
  CPPEM:               "CPPEM",   // captura-cppem  (contato.cppem.com.br)
  CAPTURA:             "CPPEM",   // apelido histórico do captura-cppem
  CAPTURA_COMUNIDADE:  "CPPEM",   // exit popup do captura-cppem
  PMPE:                "CPPEM",   // pmpe           (pmpe.cppem.com.br)
  PMPE_COMUNIDADE:     "CPPEM",   // exit popup do pmpe
  MANYCHAT:            "CPPEM",   // captura-manychat-pmpe
  MANYCHAT_ANTIGO:     "CPPEM",   // aba antiga do manychat
  INDIVIDUAL:          "CPPEM",   // mentoria-individual     (individual.cppem.com.br)
  CASA:                "CPPEM",   // presencial-em-casa      (presencialemcasa.cppem.com.br)
  SUPLETIVO:           "CPPEM",   // supletivo-filiado-cppem
  TURMAS:              "CPPEM",   // site-cppem              (cppem.com.br/turmas)

  // → aba UNICIVE_Novo
  UNICIVE:             "UNICIVE", // captura-unicive (contato.unicive.cppem.com.br)
  UNICIVE_COMUNIDADE:  "UNICIVE", // exit popup do captura-unicive

  // → aba COLEGIO_Novo
  COLEGIO:             "COLEGIO", // captura-colegio

  // → aba Venda_Direta
  QG:                  "QG",        // site-cppem /qg
  WHATSAPP:            "WHATSAPP",  // site-cppem, modal de WhatsApp
  OPERACAO:            "OPERACAO",  // operacao-alvorada
  OPERACAO_COMUNIDADE: "OPERACAO",  // exit popup da alvorada
  APOSTILA:            "APOSTILA",  // apostila
  APOSTILA_PMPE:       "APOSTILA",
  APOSTILA_COMUNIDADE: "APOSTILA"
};

/* Dedução pela URL, para quando o ?aba= vier errado ou faltar.

   Ancorado no host EXATO de propósito: o padrão antigo era /cppem/i, que casa
   com qualquer subdomínio — foi ele que fez os leads de apostila.cppem.com.br
   e operacaoalvorada.cppem.com.br entrarem rotulados como CPPEM.

   As duas primeiras olham o CAMINHO, não só o host: /qg e /turmas dividem o
   mesmo cppem.com.br e vão para abas diferentes, então o host sozinho não
   resolve. Por isso vêm antes — a primeira regra que casar decide, e
   `cppem.com.br` casaria com as duas. */
const DOMINIOS = [
  { teste: /\/\/(www\.)?cppem\.com\.br\/qg/i,           chave: "QG" },
  { teste: /\/\/(www\.)?cppem\.com\.br\/turmas/i,       chave: "TURMAS" },

  { teste: /\/\/contato\.unicive\.cppem\.com\.br/i,     chave: "UNICIVE" },
  { teste: /\/\/pmpe\.cppem\.com\.br/i,                 chave: "PMPE" },
  { teste: /\/\/colegio[a-z0-9.-]*\.cppem\.com\.br/i,   chave: "COLEGIO" },
  { teste: /\/\/contato\.cppem\.com\.br/i,              chave: "CPPEM" },
  { teste: /\/\/individual\.cppem\.com\.br/i,           chave: "INDIVIDUAL" },
  { teste: /\/\/presencialemcasa\.cppem\.com\.br/i,     chave: "CASA" },

  /* O supletivo ainda aparece pelo domínio da Vercel em alguns links (é para
     lá que o captura-unicive manda quem não tem Ensino Médio), então os dois
     endereços contam. */
  { teste: /\/\/supletivo[a-z0-9.-]*\.cppem\.com\.br/i, chave: "SUPLETIVO" },
  { teste: /\/\/cppem-supletivo-filiado\.vercel\.app/i, chave: "SUPLETIVO" },

  // Venda direta:
  { teste: /\/\/apostila\.cppem\.com\.br/i,             chave: "APOSTILA" },
  { teste: /\/\/operacaoalvorada\.cppem\.com\.br/i,     chave: "OPERACAO" }
];

/* A campanha também identifica a origem, e às vezes é o único sinal: o mesmo
   anúncio pode apontar para uma landing genérica. "bau_unicive" em qualquer
   variação cai aqui. Comparado contra a UTM Campaign e contra a URL inteira,
   porque a campanha costuma aparecer nas duas. */
const CAMPANHAS = [
  { teste: /unicive/i, chave: "UNICIVE" }
];

/* Origens em que o ?aba= é MAIS confiável que a URL, e por isso decide sozinho.

   Vale para o site-cppem: lá o parâmetro é montado no servidor a partir do
   campo `source` do formulário, então não tem como vir errado por
   copiar/colar — que é justamente o risco que fez a URL ter precedência para
   todo o resto.

   E aqui a URL seria ativamente ERRADA: /qg, /turmas e o modal de WhatsApp
   dividem o mesmo cppem.com.br, e o modal abre em qualquer página. Um lead do
   modal aberto em /turmas seria lido como lead de /turmas se a URL mandasse. */
const ORIGENS_CONFIAVEIS = ["QG", "TURMAS", "WHATSAPP"];

/* ---------- ENTRADA ---------- */

function doPost(e) {
  /* O editor do Apps Script deixa `doPost` pré-selecionado no menu de execução,
     por ser a primeira função do arquivo. Clicar em "Executar" sem trocar roda
     ISTO, sem requisição nenhuma — e antes disso gravava uma linha vazia numa
     aba, parecendo que "nada aconteceu". */
  if (!e || !e.postData) {
    Logger.log(
      "doPost só roda por requisição do site. Para tarefas manuais, escolha no " +
      "menu: conferirPlanilha, prepararAba ou migrarAbasParaCPPEM."
    );
    return json({ status: "erro", mensagem: "sem requisição" });
  }

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const dados = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const params = (e && e.parameter) || {};
    const lead = montarLead(dados, params);
    const planilha = obterAba(lead.aba);

    escreverLead(planilha, lead.valores);

    return json({
      status: lead.permitida ? "ok" : "ignorado",
      aba: planilha.getName(),
      origem: lead.valores.origem
    });

  } catch (err) {
    return json({ status: "erro", mensagem: err.message });

  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput(
    "CPPEM Sheets — funcionando (abas: " + abasDeDestino().join(", ") + ")."
  );
}

/* ---------- MONTAGEM DO LEAD ---------- */

/* Aceita os nomes de campo de TODOS os fronts. O captura-unicive manda
   name/phone; os outros mandam nome/telefone, e alguns mandam `pagina` em vez
   de `pagina_url`. O backend entende os dois dialetos para não depender de os
   sites serem atualizados no mesmo dia. */
function montarLead(dados, params) {
  const chave = normalizarChave(
    params.aba || params.origem || dados.aba || dados.origem || ""
  );

  const url = pegar(dados, ["pagina_url", "pagina", "page_url", "url"]);
  const campanha = pegar(dados, ["utm_campaign", "utmCampaign"]);
  const chaveFinal = resolverOrigem(chave, url, campanha);
  const origem = ORIGENS[chaveFinal] || "";

  return {
    permitida: origem !== "",
    aba: origem ? abaDaOrigem(origem) : ABA_DESCONHECIDOS,
    valores: {
      data: new Date(),
      origem: origem || chaveFinal || "DESCONHECIDA",
      nome: pegar(dados, ["nome", "name", "nome_completo"]),
      email: pegar(dados, ["email", "e-mail", "mail"]),
      telefone: telefoneTexto(pegar(dados, ["telefone", "phone", "whatsapp", "celular", "phone_e164"])),
      url: url,
      utm_source: pegar(dados, ["utm_source", "utmSource"]),
      utm_campaign: campanha
    }
  };
}

/* Decide de quem é o lead, nesta ordem:

   0. Origem declarada por um servidor de confiança (site-cppem), que não tem
      como vir errada e cuja URL seria ambígua — ver ORIGENS_CONFIAVEIS.
   1. URL de site BLOQUEADO manda no resto. Sem isso, um `||` deixava o ?aba=
      resgatar o que a URL tinha acabado de barrar — foi assim que um lead de
      operacaoalvorada.cppem.com.br entrou rotulado como CPPEM.
   2. A campanha, que identifica sozinha ("bau_unicive" é lead da UniCV mesmo
      que o anúncio caia numa landing genérica).
   3. A URL reconhecida.
   4. O ?aba=, que é só o que o site diz de si mesmo — o sinal mais fraco,
      porque sobrevive a copiar/colar de um projeto para outro. */
function resolverOrigem(chaveDoSite, url, campanha) {
  // 0. Origem declarada pelo servidor (site-cppem): mais confiável que a URL.
  if (ORIGENS_CONFIAVEIS.indexOf(chaveDoSite) >= 0) return chaveDoSite;

  const porUrl = deduzirPorUrl(url);
  if (porUrl && !ORIGENS[porUrl]) return porUrl;

  const porCampanha = deduzirPorCampanha(campanha) || deduzirPorCampanha(url);
  if (porCampanha) return porCampanha;

  return porUrl || chaveDoSite;
}

/* Para onde vai o lead depois de identificado. */
function abaDaOrigem(origem) {
  return ABA_POR_ORIGEM[origem] || ABA_DESTINO;
}

/* Todas as abas que recebem lead — a padrão mais as desviadas. */
function abasDeDestino() {
  const abas = [ABA_DESTINO];

  Object.keys(ABA_POR_ORIGEM).forEach(function (origem) {
    if (abas.indexOf(ABA_POR_ORIGEM[origem]) === -1) abas.push(ABA_POR_ORIGEM[origem]);
  });

  return abas;
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

function deduzirPorCampanha(texto) {
  if (!texto) return "";

  for (let i = 0; i < CAMPANHAS.length; i++) {
    if (CAMPANHAS[i].teste.test(texto)) return CAMPANHAS[i].chave;
  }

  return "";
}

/* O telefone chega da máscara da PixelX como "+55 81 9 9996-7415". O "+" no
   começo faz o Sheets interpretar a célula como fórmula — é a origem dos
   #ERROR! que já existem na planilha. Duas travas:
   1) a célula recebe formato de texto ANTES do valor (ver `escreverLead`);
   2) o número é normalizado sem o "+" inicial, então continua legível mesmo
      se alguém limpar a formatação da coluna à mão. */
function telefoneTexto(valor) {
  if (!valor) return "";

  const digitos = String(valor).replace(/\D/g, "");
  if (!digitos) return "";

  const br = digitos.replace(/^0+/, "").replace(/^55/, "");

  if (br.length === 10 || br.length === 11) {
    const ddd = br.slice(0, 2);
    const resto = br.slice(2);
    const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
    const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);

    return "55 " + ddd + " " + meio + "-" + fim;
  }

  return digitos;
}

/* ---------- COLUNAS (o coração da coisa) ---------- */

/* Descobre em que coluna cada campo mora, lendo o cabeçalho da aba.
   Devolve { chave: indice0 }. Campo sem coluna correspondente fica de fora e
   simplesmente não é escrito — é o caso de "origem" na aba CPPEM hoje. */
function mapaColunas(planilha) {
  const largura = Math.max(planilha.getLastColumn(), 1);
  const cabecalho = planilha
    .getRange(1, 1, 1, largura)
    .getValues()[0]
    .map(function (t) { return normalizarTitulo(t); });

  const mapa = {};

  CAMPOS.forEach(function (campo) {
    for (let i = 0; i < campo.titulos.length; i++) {
      const pos = cabecalho.indexOf(normalizarTitulo(campo.titulos[i]));
      if (pos >= 0) {
        mapa[campo.chave] = pos;
        return;
      }
    }
  });

  return mapa;
}

/* Compara títulos ignorando caixa, espaços extras e acento — "Página URL",
   "Pagina URL" e "PÁGINA  URL" são a mesma coluna. */
function normalizarTitulo(t) {
  return String(t)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira os acentos separados pelo NFD
    .replace(/\s+/g, " ");
}

/* ---------- ESCRITA ---------- */

/* Escreve SÓ nas colunas conhecidas — nem sequer encosta nas outras.

   A versão anterior montava a linha inteira e preenchia com "" o que não
   conhecia. Numa linha nova isso é inofensivo... até o dia em que alguém puser
   um ARRAYFORMULA numa coluna: o "" gravado na célula quebraria o preenchimento
   automático dela. Escrevendo em blocos, VENDEDOR e qualquer coluna futura
   ficam literalmente intocadas. */
function escreverLead(planilha, valores) {
  const mapa = mapaColunas(planilha);
  const linha = planilha.getLastRow() + 1;

  blocosContiguos(mapa).forEach(function (bloco) {
    const largura = bloco.length;

    // Formato ANTES do valor: depois já é tarde, o Sheets converteu na escrita.
    bloco.forEach(function (campo, i) {
      planilha.getRange(linha, bloco.inicio + i + 1).setNumberFormat(campo.formato);
    });

    planilha
      .getRange(linha, bloco.inicio + 1, 1, largura)
      .setValues([bloco.map(function (campo) { return valores[campo.chave]; })]);
  });
}

/* Agrupa as colunas conhecidas em faixas vizinhas, para escrever de uma vez em
   vez de célula por célula. No layout atual da aba CPPEM (A..G seguidas, com
   VENDEDOR em H) isso dá um bloco só. */
function blocosContiguos(mapa) {
  const usados = CAMPOS
    .filter(function (c) { return mapa[c.chave] !== undefined; })
    .sort(function (a, b) { return mapa[a.chave] - mapa[b.chave]; });

  const blocos = [];

  usados.forEach(function (campo) {
    const col = mapa[campo.chave];
    const ultimo = blocos[blocos.length - 1];

    if (ultimo && mapa[ultimo[ultimo.length - 1].chave] === col - 1) {
      ultimo.push(campo);
    } else {
      const novo = [campo];
      novo.inicio = col;
      blocos.push(novo);
    }
  });

  return blocos;
}

function obterAba(nome) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let planilha = ss.getSheetByName(nome);

  if (!planilha) {
    planilha = ss.insertSheet(nome);
    criarCabecalho(planilha);
  } else if (planilha.getLastRow() === 0) {
    criarCabecalho(planilha);
  }

  return planilha;
}

/* Só roda em aba nova/vazia. A aba CPPEM já existe e tem cabeçalho próprio —
   este código nunca vai reescrevê-lo. */
function criarCabecalho(planilha) {
  const titulos = CAMPOS.map(function (c) { return c.titulo; }).concat(COLUNAS_MANUAIS);

  const h = planilha.getRange(1, 1, 1, titulos.length);
  h.setValues([titulos]);
  h.setFontWeight("bold");
  h.setBackground("#00E63C");
  h.setFontColor("#0A0A0A");

  CAMPOS.forEach(function (c, i) {
    planilha.setColumnWidth(i + 1, c.largura);
    planilha
      .getRange(2, i + 1, Math.max(planilha.getMaxRows() - 1, 1), 1)
      .setNumberFormat(c.formato);
  });

  // As manuais em cinza, para ficar claro que não vêm do site.
  COLUNAS_MANUAIS.forEach(function (_, i) {
    const col = CAMPOS.length + i + 1;
    planilha.setColumnWidth(col, 160);
    planilha.getRange(1, col).setBackground("#3A3A3A").setFontColor("#FFFFFF");
  });

  planilha.setFrozenRows(1);
}

/* ---------- DIAGNÓSTICO (rodar à mão; não altera nada) ---------- */

function conferirPlanilha() {
  abasDeDestino().forEach(function (nome) { conferirAba(nome); });

  Logger.log("");
  Logger.log("Roteamento: %s", Object.keys(ABA_POR_ORIGEM).map(function (o) {
    return o + " -> " + ABA_POR_ORIGEM[o];
  }).join(" | ") + " | demais -> " + ABA_DESTINO);
}

function conferirAba(nomeAba) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);

  Logger.log("");

  if (!planilha) {
    Logger.log('Aba "%s": ainda não existe — será criada no padrão no primeiro lead.', nomeAba);
    return;
  }

  const largura = planilha.getLastColumn();
  const cabecalho = planilha.getRange(1, 1, 1, largura).getValues()[0];
  const mapa = mapaColunas(planilha);

  Logger.log('Aba "%s": %s linhas, %s colunas', nomeAba, planilha.getLastRow(), largura);
  Logger.log("Cabeçalho: %s", cabecalho.join(" | "));

  CAMPOS.forEach(function (campo) {
    const col = mapa[campo.chave];
    Logger.log(
      "  %s -> %s",
      campo.chave,
      col === undefined
        ? "SEM COLUNA (não será preenchido)"
        : "coluna " + letraColuna(col + 1) + ' ("' + cabecalho[col] + '")'
    );
  });

  const naoTocadas = [];
  cabecalho.forEach(function (t, i) {
    const usada = Object.keys(mapa).some(function (k) { return mapa[k] === i; });
    if (!usada && String(t).trim()) naoTocadas.push(t);
  });

  Logger.log("Colunas que o script NÃO toca: %s", naoTocadas.join(", ") || "(nenhuma)");
}

function letraColuna(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - r) / 26);
  }
  return s;
}

/* ---------- PREPARO (rodar à mão, uma vez) ---------- */

/* Formata as colunas conhecidas e congela o cabeçalho. Não escreve nem apaga
   valor nenhum — só formato. Isso é o que impede novos #ERROR! no telefone,
   inclusive em digitação manual. */
function prepararAba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(FUSO);

  abasDeDestino().forEach(function (nome) {
    const planilha = ss.getSheetByName(nome);

    if (!planilha) {
      Logger.log('Aba "%s": ainda não existe, nada a formatar.', nome);
      return;
    }

    const mapa = mapaColunas(planilha);
    const linhas = Math.max(planilha.getMaxRows() - 1, 1);

    CAMPOS.forEach(function (campo) {
      const col = mapa[campo.chave];
      if (col === undefined) return;
      planilha.getRange(2, col + 1, linhas, 1).setNumberFormat(campo.formato);
    });

    planilha.setFrozenRows(1);
    Logger.log("Formatos aplicados na aba %s.", nome);
  });
}

/* Opcional: cria a coluna Origem como B, empurrando o resto para a direita
   (VENDEDOR incluída — os dados andam junto com a coluna, nada desalinha).
   Depois disso, todo lead novo já entra com a origem preenchida, e o
   `migrarAbasParaCPPEM` também preenche a das linhas migradas. */
function adicionarColunaOrigem() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DESTINO);
  if (!planilha) throw new Error('Aba "' + ABA_DESTINO + '" não existe.');

  if (mapaColunas(planilha).origem !== undefined) {
    Logger.log("A coluna Origem já existe. Nada a fazer.");
    return;
  }

  planilha.insertColumnAfter(1);

  const c = planilha.getRange(1, 2);
  c.setValue("Origem");
  c.setFontWeight("bold");
  c.setBackground("#00E63C");
  c.setFontColor("#0A0A0A");

  planilha.setColumnWidth(2, 120);
  planilha.getRange(2, 2, Math.max(planilha.getMaxRows() - 1, 1), 1).setNumberFormat("@");

  Logger.log("Coluna Origem criada. Rode preencherOrigemPelaUrl para completar o histórico.");
}

/* Preenche a coluna Origem das linhas antigas deduzindo pela URL. Só escreve
   onde está vazio — não sobrescreve nada que já tenha valor. */
function preencherOrigemPelaUrl() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DESTINO);
  const mapa = mapaColunas(planilha);

  if (mapa.origem === undefined) throw new Error("A aba não tem coluna Origem. Rode adicionarColunaOrigem antes.");
  if (mapa.url === undefined) throw new Error("A aba não tem coluna de URL.");

  const total = planilha.getLastRow() - 1;
  if (total < 1) return;

  const origens = planilha.getRange(2, mapa.origem + 1, total, 1).getValues();
  const urls = planilha.getRange(2, mapa.url + 1, total, 1).getValues();

  let preenchidas = 0;

  for (let i = 0; i < total; i++) {
    if (String(origens[i][0]).trim() !== "") continue;

    const chave = deduzirPorUrl(String(urls[i][0]));
    const origem = ORIGENS[chave] || chave;

    if (origem) {
      origens[i][0] = origem;
      preenchidas++;
    }
  }

  planilha.getRange(2, mapa.origem + 1, total, 1).setValues(origens);
  Logger.log("Origem preenchida em %s linhas.", preenchidas);
}

/* ---------- MIGRAÇÃO DAS OUTRAS ABAS (rodar à mão) ---------- */

/* Traz o histórico das outras abas para a aba CPPEM, casando as colunas pelo
   NOME do cabeçalho (as abas antigas têm layouts diferentes entre si).

   Regras:
   - a origem de cada linha sai da própria coluna Origem, se a aba tiver uma
     (é o caso da aba de teste); senão, do nome da aba;
   - a URL tem a última palavra, o que reclassifica o que estava errado;
   - linha de origem não permitida (Operação Alvorada, lixo de teste) é
     PULADA, não migrada — e contada no log;
   - a aba de origem NÃO é apagada. Depois de conferir, ela é renomeada para
     "MIGRADA_<nome>", o que também impede migrar duas vezes por engano. */
function migrarAbasParaCPPEM() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  /* Agrupado por aba de destino: os leads da UniCV vão para a UNICIVE_Novo, o
     resto para a CPPEM — a mesma regra que vale para os leads novos. */
  const porAba = {};
  let puladas = 0;

  /* Comparação tolerante: nome de aba costuma vir com espaço sobrando ou caixa
     diferente do que se digitou na lista. */
  const naLista = function (nome) {
    if (!ABAS_PARA_MIGRAR.length) return true;
    const alvo = String(nome).trim().toLowerCase();
    return ABAS_PARA_MIGRAR.some(function (n) {
      return String(n).trim().toLowerCase() === alvo;
    });
  };

  Logger.log("Abas encontradas: %s",
             ss.getSheets().map(function (a) { return '"' + a.getName() + '"'; }).join(", "));
  Logger.log("ABAS_PARA_MIGRAR: %s",
             ABAS_PARA_MIGRAR.length ? ABAS_PARA_MIGRAR.join(", ") : "(vazia = todas)");

  ss.getSheets().forEach(function (aba) {
    const nome = aba.getName();

    /* Cada aba diz por que ficou de fora. Sem isso, "não aconteceu nada" não
       tem como ser diagnosticado sem adivinhação. */
    // Aba de destino nunca é fonte — senão migraria para dentro de si mesma.
    if (abasDeDestino().indexOf(nome) >= 0 || nome === ABA_DESCONHECIDOS) {
      Logger.log('  "%s": pulada (é aba de destino ou a de ignorados).', nome);
      return;
    }
    if (/^MIGRADA_/i.test(nome)) {
      Logger.log('  "%s": pulada (já migrada antes).', nome);
      return;
    }
    if (!naLista(nome)) {
      Logger.log('  "%s": pulada (fora de ABAS_PARA_MIGRAR).', nome);
      return;
    }
    if (aba.getLastRow() < 2) {
      Logger.log('  "%s": pulada (sem linhas de dados).', nome);
      return;
    }

    const mapaOrigem = mapaColunas(aba);
    if (mapaOrigem.nome === undefined && mapaOrigem.email === undefined) {
      Logger.log('  "%s": pulada (cabeçalho sem Nome nem Email — não parece aba de leads).', nome);
      return;
    }

    const tabela = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
    const chaveDaAba = normalizarChave(nome);
    let migradasAqui = 0;

    for (let i = 1; i < tabela.length; i++) {
      const l = tabela[i];
      if (!l.join("").trim()) continue;

      const valor = function (chave) {
        const col = mapaOrigem[chave];
        return col === undefined ? "" : String(l[col] || "").trim();
      };

      const url = valor("url");
      const campanha = valor("utm_campaign");

      /* Mesma cadeia de sinais do lead novo. O ?aba= não existe aqui, então o
         lugar dele é ocupado pela coluna Origem da linha — e, faltando ela,
         pelo nome da aba. */
      const chaveFinal = resolverOrigem(
        normalizarChave(valor("origem")) || chaveDaAba, url, campanha
      );
      const origem = ORIGENS[chaveFinal] || "";

      if (!origem) {
        puladas++;
        continue;
      }

      const destino = abaDaOrigem(origem);
      if (!porAba[destino]) porAba[destino] = [];

      porAba[destino].push({
        data: converterData(mapaOrigem.data === undefined ? "" : l[mapaOrigem.data]),
        origem: origem,
        nome: valor("nome"),
        email: valor("email"),
        telefone: telefoneTexto(valor("telefone")),
        url: url,
        utm_source: valor("utm_source"),
        utm_campaign: campanha
      });

      migradasAqui++;
    }

    if (migradasAqui > 0) {
      aba.setName("MIGRADA_" + nome);
      Logger.log('  "%s": %s linhas migradas (aba renomeada para MIGRADA_%s).',
                 nome, migradasAqui, nome);
    } else {
      Logger.log('  "%s": nenhuma linha aproveitada — todas de origem não permitida.', nome);
    }
  });

  const destinos = Object.keys(porAba);

  if (!destinos.length) {
    Logger.log("RESULTADO: nada migrado. %s linhas puladas por origem não permitida.", puladas);
    return;
  }

  destinos.forEach(function (nomeDestino) {
    const destino = obterAba(nomeDestino);
    const mapaDestino = mapaColunas(destino);
    const linhas = porAba[nomeDestino];
    const inicio = destino.getLastRow() + 1;

    // Mesma regra do escreverLead: só as colunas conhecidas são tocadas.
    blocosContiguos(mapaDestino).forEach(function (bloco) {
      bloco.forEach(function (campo, i) {
        destino
          .getRange(inicio, bloco.inicio + i + 1, linhas.length, 1)
          .setNumberFormat(campo.formato);
      });

      destino
        .getRange(inicio, bloco.inicio + 1, linhas.length, bloco.length)
        .setValues(linhas.map(function (lead) {
          return bloco.map(function (campo) { return lead[campo.chave]; });
        }));
    });

    Logger.log("RESULTADO: %s linhas migradas para a aba %s.", linhas.length, nomeDestino);
  });

  Logger.log("RESULTADO: %s puladas (origem não permitida).", puladas);
}

/* As abas antigas gravavam a data como TEXTO "dd/MM/yyyy HH:mm:ss". */
function converterData(v) {
  if (v instanceof Date) return v;

  const m = String(v || "").match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return String(v || "");

  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

/* ---------- LIMPEZA (rodar à mão) ---------- */

/* Tira da aba principal o que não deveria estar lá — leads da Operação
   Alvorada que entraram antes do bloqueio, linhas de teste, origem
   desconhecida.

   Nada é apagado: as linhas são COPIADAS para a aba REMOVIDOS antes de saírem
   daqui. Se algo for removido por engano, está lá para voltar. */
function arquivarNaoPermitidos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const planilha = ss.getSheetByName(ABA_DESTINO);
  if (!planilha) throw new Error('Aba "' + ABA_DESTINO + '" não existe.');

  const mapa = mapaColunas(planilha);
  const largura = Math.max(planilha.getLastColumn(), 1);
  const total = planilha.getLastRow() - 1;
  if (total < 1) return;

  const tabela = planilha.getRange(2, 1, total, largura).getValues();
  const remover = [];

  for (let i = 0; i < tabela.length; i++) {
    const l = tabela[i];
    if (!l.join("").trim()) continue;

    const valor = function (chave) {
      const col = mapa[chave];
      return col === undefined ? "" : String(l[col] || "").trim();
    };

    const porUrl = deduzirPorUrl(valor("url"));
    const daLinha = normalizarChave(valor("origem"));

    /* Sem coluna Origem e sem URL reconhecível não dá para afirmar que a linha
       é indevida — na dúvida, fica. Remover lead bom é pior que manter um
       ruim. */
    if (!porUrl && !daLinha) continue;

    if (!(ORIGENS[porUrl] || ORIGENS[daLinha])) {
      remover.push({ linha: i + 2, celulas: l });
    }
  }

  if (!remover.length) {
    Logger.log("Nada a arquivar.");
    return;
  }

  const arquivo = obterAba("REMOVIDOS");
  if (arquivo.getLastRow() === 0) {
    arquivo.getRange(1, 1, 1, largura)
      .setValues([planilha.getRange(1, 1, 1, largura).getValues()[0]])
      .setFontWeight("bold");
  }

  arquivo
    .getRange(arquivo.getLastRow() + 1, 1, remover.length, largura)
    .setValues(remover.map(function (r) { return r.celulas; }));

  // De baixo para cima: apagar de cima muda o número das linhas de baixo.
  remover
    .map(function (r) { return r.linha; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (n) { planilha.deleteRow(n); });

  Logger.log("%s linhas movidas para REMOVIDOS.", remover.length);
}

/* ---------- utilitário ---------- */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
