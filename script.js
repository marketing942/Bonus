/* =========================================================
   CPPEM — Captura ManyChat/PMPE
   Formulário → Google Sheets → retorno à DM do Instagram

   Estrutura espelhada do captura-cppem (que funciona). Os identificadores do
   formulário, os nomes dos campos e as barreiras de submit são IGUAIS aos de
   lá — a única diferença de propósito é o destino: aqui grava no Sheets e
   devolve o visitante para a caixa de mensagens do Instagram.

   Quem dispara o Lead é a regra do painel da PixelX, vinculada ao formulário
   #IPEyzyfmJhKQEYIXAlZH. Este arquivo NÃO emite conversão — ele só precisa
   não atrapalhar: sem preventDefault no clique válido, sem stopPropagation
   quando válido, e sem sair da página antes da PixelX enviar.
   ========================================================= */

/* Todos os projetos gravam na MESMA aba (LEADS) da planilha. O ?aba= não
   escolhe mais a aba de destino: ele identifica QUEM enviou, e vira a coluna
   "Origem" lá. */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec?aba=PMPE";

/* ---------- UTMs ----------
   As UTMs só existem na URL do PRIMEIRO acesso. Se a pessoa recarrega, volta
   pelo histórico, ou o link do anúncio cai numa página que redireciona, o
   ?utm_source= já não está mais lá na hora do submit — e o lead chegava na
   planilha sem origem nenhuma. Por isso gravamos assim que a página carrega e
   lemos do storage no envio (first touch). O try/catch cobre navegador com
   storage bloqueado (aba anônima, ITP), onde o comportamento volta a ser o
   antigo em vez de quebrar o formulário. */
const UTM_CAMPOS = ["utm_source", "utm_campaign"];

(function guardarUTMs() {
  UTM_CAMPOS.forEach((chave) => {
    const valor = qs.get(chave);
    if (!valor) return;

    try {
      sessionStorage.setItem(chave, valor);
    } catch (e) {
      /* storage indisponível: segue sem persistir */
    }
  });
})();

function utm(chave) {
  const daUrl = new URLSearchParams(window.location.search).get(chave);
  if (daUrl) return daUrl;

  try {
    return sessionStorage.getItem(chave) || "";
  } catch (e) {
    return "";
  }
}

/* Link de retorno à caixa de mensagens do Instagram.
   Esta página é acessada por um link enviado no PV do usuário, ou seja, o fluxo
   do ManyChat já foi disparado lá na DM. Não há ?ref= a acrescentar — o retorno
   serve só para levar a pessoa de volta à conversa. */
const INSTAGRAM_URL = "https://www.instagram.com/direct/inbox/";

/* Janela de segurança antes de redirecionar, contada a partir do CLIQUE.
   O handler da PixelX roda no submit, mas a requisição dela é assíncrona (com
   debounce de ~1500 ms). Navegar antes disso cancela a requisição e o Lead se
   perde — principalmente no mobile. */
const LEAD_SAFETY_MS = 2500;

/* --- Elementos (ids iguais aos do captura-cppem) --- */
const form = document.getElementById("IPEyzyfmJhKQEYIXAlZH");
const nomeInput = document.getElementById("lead_name");
const emailInput = document.getElementById("lead_email");
const telefoneInput = document.getElementById("lead_phone");
const submitBtn = document.getElementById("lead_submit");

/* --- Validação ---
   A chave do erro é o valor de data-error-for (= atributo name do campo). --- */
function setError(errorKey, input, msg) {
  const errorEl = document.querySelector(`[data-error-for="${errorKey}"]`);

  if (input) input.classList.add("is-invalid");
  if (errorEl) errorEl.textContent = msg;
}

function clearError(errorKey, input) {
  const errorEl = document.querySelector(`[data-error-for="${errorKey}"]`);

  if (input) input.classList.remove("is-invalid");
  if (errorEl) errorEl.textContent = "";
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* Conta DÍGITOS, não caracteres. O "+55" da máscara é texto FIXO: aparece na
   tela desde o primeiro caractere digitado e somaria 2 dígitos, fazendo um
   número incompleto passar por um teste ingênuo de "11 dígitos". Por isso o
   prefixo é removido pelo "+" literal antes de contar — remover pelos dígitos
   seria ambíguo, já que o DDD 55 existe (Santa Maria/RS). */
const isPhone = (v) => {
  const nacional = v.trim().replace(/^\+\s*55\s*/, "");
  const d = nacional.replace(/\D/g, "");

  return d.length === 11 && d[2] === "9";
};

function validate() {
  let ok = true;

  const nome = nomeInput?.value.trim() || "";
  const email = emailInput?.value.trim() || "";
  const tel = telefoneInput?.value.trim() || "";

  clearError("name", nomeInput);
  clearError("email", emailInput);
  clearError("phone", telefoneInput);

  if (nome.length < 2) {
    setError("name", nomeInput, "Informe seu nome completo.");
    ok = false;
  }

  if (!isEmail(email)) {
    setError("email", emailInput, "Informe um e-mail válido.");
    ok = false;
  }

  if (!isPhone(tel)) {
    setError("phone", telefoneInput, "Informe seu WhatsApp com DDD — ex: (81) 90000-0000.");
    ok = false;
  }

  return ok;
}

/* --- Envio --- */
async function enviar(tClique) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "ENVIANDO...";
  }

  const payload = {
    nome: nomeInput?.value.trim() || "",
    email: emailInput?.value.trim() || "",
    telefone: telefoneInput?.value.trim() || "",
    origem: "PMPE",
    pagina_url: window.location.href,
    utm_source: utm("utm_source"),
    utm_campaign: utm("utm_campaign")
  };

  try {
    await fetch(SHEET_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    /* NÃO chamar form.reset() aqui: a PixelX lê os campos no blur, e limpar o
       formulário antes de ela concluir faz gravar valores vazios. */

    const successEl = document.getElementById("form-success");

    if (successEl) {
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    /* Desconta o tempo que o fetch do Sheets já consumiu: o que importa é o
       total desde o clique, não desde agora. */
    const restante = Math.max(0, LEAD_SAFETY_MS - (Date.now() - tClique));

    setTimeout(() => {
      window.location.href = INSTAGRAM_URL;
    }, restante);

  } catch (err) {
    console.error("[Form] Erro ao enviar:", err);

    setError("phone", telefoneInput, "Erro ao enviar. Tente novamente.");

    /* Só reabilita em caso de erro. Reabilitar no sucesso deixaria o botão
       clicável durante a espera do redirecionamento, e cada clique novo
       dispararia a regra de conversão de novo. */
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "QUERO RECEBER O MATERIAL";
    }
  }
}

/* PRIMEIRA BARREIRA — no clique do botão, fase de captura.
   Se os dados forem inválidos, o preventDefault aqui cancela a ação padrão do
   botão, e o navegador NUNCA chega a disparar o evento "submit". É isso que
   impede a PixelX de registrar uma conversão incompleta. O Enter também passa
   por aqui: a submissão implícita dispara um click no botão de submit. */
submitBtn?.addEventListener(
  "click",
  (e) => {
    if (!validate()) e.preventDefault();
  },
  true
);

/* SEGUNDA BARREIRA — "submit" capturado no DOCUMENT, não no formulário.
   Um listener de captura no document roda SEMPRE antes de qualquer listener
   registrado no próprio <form>, independente de quem registrou primeiro — a
   PixelX registra o dela de dentro de um start() assíncrono, então não há
   outra forma de garantir a ordem.

   - Inválido -> stopImmediatePropagation(): o evento morre aqui e nunca chega
                 à PixelX.
   - Válido   -> deixamos propagar normalmente para ela registrar a conversão.
   Em ambos os casos o preventDefault impede o recarregamento da página. */
document.addEventListener(
  "submit",
  (e) => {
    if (e.target !== form) return;

    const tClique = Date.now();

    e.preventDefault();

    if (!validate()) {
      e.stopImmediatePropagation();
      return;
    }

    enviar(tClique);
  },
  true
);
