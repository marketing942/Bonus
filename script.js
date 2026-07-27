/* =========================================================
   CPPEM — Formulário → Google Sheets + redirect Instagram (ManyChat)
   ========================================================= */

const SHEET_URL = "https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec?aba=MANYCHAT";

/* Link de retorno à caixa de mensagens do Instagram.
   Esta página é acessada por um link enviado no PV do usuário, ou seja, o fluxo
   do ManyChat já foi disparado lá na DM. Aqui não há ?ref= a acrescentar — o
   retorno serve só para levar a pessoa de volta à conversa. */
const INSTAGRAM_URL = "https://www.instagram.com/direct/inbox/";

/* Tempo antes de redirecionar. A conversão é disparada por uma regra do painel
   vinculada ao id do botão, e a requisição dela é assíncrona (debounce de
   1500 ms na PixelX). Navegar antes disso cancela a requisição e o Lead se
   perde — principalmente no mobile. Abaixo de ~1s começa a perder evento. */
const REDIRECT_DELAY_MS = 1500;

/* --- Campo de WhatsApp (entrada livre, sem máscara) --- */
const telefoneInput = document.getElementById("telefone");

/* --- Validação --- */
function setError(id, msg) {
  document.getElementById(id).classList.add("is-invalid");
  document.querySelector(`[data-error-for="${id}"]`).textContent = msg;
}
function clearError(id) {
  document.getElementById(id).classList.remove("is-invalid");
  document.querySelector(`[data-error-for="${id}"]`).textContent = "";
}
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function validate() {
  let ok = true;
  const nome  = document.getElementById("nome").value.trim();
  const email = document.getElementById("email").value.trim();
  const tel   = telefoneInput.value.trim();

  ["nome","email","telefone"].forEach(clearError);

  if (nome.length < 2) { setError("nome",     "Informe seu nome completo.");  ok = false; }
  if (!isEmail(email)) { setError("email",    "Informe um e-mail válido.");   ok = false; }
  if (tel.length === 0) { setError("telefone", "Informe seu WhatsApp.");      ok = false; }

  return ok;
}

/* --- Envio --- */
document.getElementById("lead-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled    = true;
  btn.textContent = "ENVIANDO...";

  const payload = {
    nome:     document.getElementById("nome").value.trim(),
    email:    document.getElementById("email").value.trim(),
    telefone: telefoneInput.value.trim(),
  };

  try {
    await fetch(SHEET_URL, {
      method:  "POST",
      mode:    "no-cors",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    /* NÃO chamar reset() aqui: a PixelX lê os campos no blur, e limpar o
       formulário antes de ela concluir faz gravar valores vazios. O visitante
       sai da página logo em seguida de qualquer forma. */

    // Mostra mensagem de sucesso
    const successEl = document.getElementById("form-success");
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: "smooth", block: "center" });

    // Redireciona na mesma aba (sem popup), dando tempo à conversão
    setTimeout(() => {
      window.location.href = INSTAGRAM_URL;
    }, REDIRECT_DELAY_MS);

  } catch (err) {
    setError("telefone", "Erro ao enviar. Tente novamente.");

    /* Só reabilita em caso de erro. Reabilitar no sucesso deixaria o botão
       clicável durante a espera do redirecionamento, e cada clique novo
       dispararia a regra de conversão de novo — Lead duplicado. */
    btn.disabled    = false;
    btn.textContent = "QUERO RECEBER O MATERIAL";
  }
});
