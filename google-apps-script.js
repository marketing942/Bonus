/* =========================================================
   CPPEM — Backend único de captura (Google Apps Script)

   Todos os projetos gravam na MESMA aba: CPPEM.

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

/* Rede de segurança: origem desconhecida ou bloqueada não é descartada — cai
   aqui, para nada se perder por um ?aba= errado num site novo. */
const ABA_IGNORADOS = "IGNORADOS";

const FUSO = "America/Recife";

/* Quais abas o `migrarAbasParaCPPEM` deve trazer. Lista VAZIA = todas.

   Migrar uma de cada vez é mais seguro: você confere o resultado antes de ir
   para a próxima. Edite esta linha, salve, e rode a função. */
const ABAS_PARA_MIGRAR = ["MarkTeste"];

/* Campos que o script sabe preencher. `titulos` são os nomes de cabeçalho
   aceitos (minúsculos, sem depender de acento na comparação). O primeiro é o
   usado ao criar uma aba do zero. */ 
const CAMPOS = [
  { chave: "data",         titulos: ["data e hora", "data"],                                  formato: "dd/MM/yyyy HH:mm:ss" },
  { chave: "origem",       titulos: ["origem"],                                               formato: "@" },
  { chave: "nome",         titulos: ["nome"],                                                 formato: "@" },
  { chave: "email",        titulos: ["email", "e-mail"],                                      formato: "@" },
  { chave: "telefone",     titulos: ["telefone", "whatsapp", "celular"],                      formato: "@" },
  { chave: "url",          titulos: ["pagina url", "página url", "pagina", "página", "url"],  formato: "@" },
  { chave: "utm_source",   titulos: ["utm source", "utm_source"],                             formato: "@" },
  { chave: "utm_campaign", titulos: ["utm campaign", "utm_campaign"],                         formato: "@" }
];

/* Quem pode gravar na aba principal. Chave = o que chega em ?aba= (ou
   ?origem=); valor = o rótulo da coluna Origem, se a aba tiver essa coluna.

   Quem NÃO está aqui vai para a aba IGNORADOS — é assim que a Operação
   Alvorada (venda direta, planilha própria via n8n) fica fora daqui. */
const ORIGENS = {
  CPPEM:                "CPPEM",
  CAPTURA:              "CPPEM",
  CAPTURA_COMUNIDADE:   "CPPEM",
  UNICIVE:              "UNICIVE",
  UNICIVE_COMUNIDADE:   "UNICIVE",
  PMPE:                 "PMPE",
  PMPE_COMUNIDADE:      "PMPE",
  MANYCHAT:             "PMPE",
  MANYCHAT_ANTIGO:      "PMPE",
  COLEGIO:              "COLEGIO",
  APOSTILA:             "APOSTILA",
  APOSTILA_PMPE:        "APOSTILA",
  APOSTILA_COMUNIDADE:  "APOSTILA"
};

/* Dedução pela URL, para quando o ?aba= vier errado ou faltar.

   Ancorado no host EXATO de propósito: o padrão antigo era /cppem/i, que casa
   com qualquer subdomínio — foi ele que fez os leads de apostila.cppem.com.br
   e operacaoalvorada.cppem.com.br entrarem rotulados como CPPEM. */
const DOMINIOS = [
  { teste: /\/\/contato\.unicive\.cppem\.com\.br/i, chave: "UNICIVE" },
  { teste: /\/\/pmpe\.cppem\.com\.br/i,             chave: "PMPE" },
  { teste: /\/\/colegio[a-z0-9.-]*\.cppem\.com\.br/i, chave: "COLEGIO" },
  { teste: /\/\/apostila\.cppem\.com\.br/i,         chave: "APOSTILA" },
  { teste: /\/\/contato\.cppem\.com\.br/i,          chave: "CPPEM" },
  { teste: /\/\/operacaoalvorada\.cppem\.com\.br/i, chave: "OPERACAO" }
];

/* ---------- ENTRADA ---------- */

function doPost(e) {
  /* O editor do Apps Script deixa `doPost` pré-selecionado no menu de execução,
     por ser a primeira função do arquivo. Clicar em "Executar" sem trocar roda
     ISTO, sem requisição nenhuma — e antes disso gravava uma linha vazia na aba
     IGNORADOS, parecendo que "nada aconteceu". */
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

    const planilha = lead.permitida
      ? obterAba(ABA_DESTINO)
      : obterAba(ABA_IGNORADOS);

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
    "CPPEM Sheets — funcionando (aba única: " + ABA_DESTINO + ")."
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

  /* A URL tem a última palavra sobre a origem: ela é o fato, o ?aba= é o que o
     site diz de si mesmo. É o que corrige um site novo copiado de outro que
     esqueceu de trocar o parâmetro.

     "Última palavra" precisa valer INCLUSIVE quando a URL aponta para um site
     bloqueado. Um encadeamento `ORIGENS[porUrl] || ORIGENS[chave]` deixava o
     ?aba= resgatar o que a URL tinha acabado de barrar — foi assim que um lead
     de operacaoalvorada.cppem.com.br entrou rotulado como CPPEM. Se a URL é
     reconhecida, ela decide sozinha; o ?aba= só vale quando a URL não diz
     nada. */
  const porUrl = deduzirPorUrl(url);
  const origem = porUrl ? (ORIGENS[porUrl] || "") : (ORIGENS[chave] || "");

  return {
    permitida: origem !== "",
    valores: {
      data: new Date(),
      origem: origem || porUrl || chave || "DESCONHECIDA",
      nome: pegar(dados, ["nome", "name", "nome_completo"]),
      email: pegar(dados, ["email", "e-mail", "mail"]),
      telefone: telefoneTexto(pegar(dados, ["telefone", "phone", "whatsapp", "celular", "phone_e164"])),
      url: url,
      utm_source: pegar(dados, ["utm_source", "utmSource"]),
      utm_campaign: pegar(dados, ["utm_campaign", "utmCampaign"])
    }
  };
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
  const titulos = CAMPOS.map(function (c) { return titulo(c.titulos[0]); });

  const h = planilha.getRange(1, 1, 1, titulos.length);
  h.setValues([titulos]);
  h.setFontWeight("bold");
  h.setBackground("#00E63C");
  h.setFontColor("#0A0A0A");

  planilha.setFrozenRows(1);
}

function titulo(t) {
  return t.replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
}

/* ---------- DIAGNÓSTICO (rodar à mão; não altera nada) ---------- */

function conferirPlanilha() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DESTINO);

  if (!planilha) {
    Logger.log('Aba "%s" não existe.', ABA_DESTINO);
    return;
  }

  const largura = planilha.getLastColumn();
  const cabecalho = planilha.getRange(1, 1, 1, largura).getValues()[0];
  const mapa = mapaColunas(planilha);

  Logger.log('Aba "%s": %s linhas, %s colunas', ABA_DESTINO, planilha.getLastRow(), largura);
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

  const planilha = ss.getSheetByName(ABA_DESTINO);
  if (!planilha) throw new Error('Aba "' + ABA_DESTINO + '" não existe.');

  const mapa = mapaColunas(planilha);
  const linhas = Math.max(planilha.getMaxRows() - 1, 1);

  CAMPOS.forEach(function (campo) {
    const col = mapa[campo.chave];
    if (col === undefined) return;
    planilha.getRange(2, col + 1, linhas, 1).setNumberFormat(campo.formato);
  });

  planilha.setFrozenRows(1);
  Logger.log("Formatos aplicados na aba %s.", ABA_DESTINO);
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
  const destino = obterAba(ABA_DESTINO);
  const mapaDestino = mapaColunas(destino);

  const novas = [];
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
    if (nome === ABA_DESTINO || nome === ABA_IGNORADOS) {
      Logger.log('  "%s": pulada (é a aba de destino ou a de ignorados).', nome);
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
      const porUrl = deduzirPorUrl(url);
      const daLinha = normalizarChave(valor("origem"));

      // Mesma regra do montarLead: URL reconhecida decide sozinha.
      const origem = porUrl
        ? (ORIGENS[porUrl] || "")
        : (ORIGENS[daLinha] || ORIGENS[chaveDaAba] || "");

      if (!origem) {
        puladas++;
        continue;
      }

      novas.push({
        data: converterData(mapaOrigem.data === undefined ? "" : l[mapaOrigem.data]),
        origem: origem,
        nome: valor("nome"),
        email: valor("email"),
        telefone: telefoneTexto(valor("telefone")),
        url: url,
        utm_source: valor("utm_source"),
        utm_campaign: valor("utm_campaign")
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

  if (!novas.length) {
    Logger.log("RESULTADO: nada migrado. %s linhas puladas por origem não permitida.", puladas);
    return;
  }

  const inicio = destino.getLastRow() + 1;

  // Mesma regra do escreverLead: só as colunas conhecidas são tocadas.
  blocosContiguos(mapaDestino).forEach(function (bloco) {
    bloco.forEach(function (campo, i) {
      destino
        .getRange(inicio, bloco.inicio + i + 1, novas.length, 1)
        .setNumberFormat(campo.formato);
    });

    destino
      .getRange(inicio, bloco.inicio + 1, novas.length, bloco.length)
      .setValues(novas.map(function (lead) {
        return bloco.map(function (campo) { return lead[campo.chave]; });
      }));
  });

  Logger.log("RESULTADO: %s linhas migradas para %s. %s puladas (origem não permitida).",
             novas.length, ABA_DESTINO, puladas);
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
