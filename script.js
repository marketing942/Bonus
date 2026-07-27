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

/* =========================================================
   Emissor de Lead — via dataLayer (ver TRACKING.md §8.7)

   ⚠ ESTE PUSH SOZINHO NÃO ENTREGA O LEAD NO META.
   Verificado nesta página: o evento chega ao GTM e para ali. A ponte para o
   Meta é a PixelX, e ela só encaminha a conversão quando existe REGRA DE
   CONVERSÃO cadastrada no painel PARA ESTE SITE. Sem a regra, não importa
   como o evento é produzido (clique, submit ou send_event) — o Meta não vê.

   O id `IPEyzyfmJhKQEYIXAlZH` no botão é o mesmo que funciona na landing PMPE,
   e aqui não dispara. Isso prova que a regra é por SITE no painel, não global
   por id.

   Portanto, para completar o serviço:
   1. Painel PixelX  → cadastrar este site e criar a regra de conversão (Lead).
   2. GTM (opcional) → gatilho de Evento personalizado `lead_submit`, se quiser
      acionar tags do container por este push.

   ⚠ Com a regra do painel ativa E um gatilho no GTM, haverá DOIS emissores e o
   Lead duplica. Escolha um dos dois (§5).
   ========================================================= */

/* E.164 brasileiro: +55 + DDD + número. Meta e Google casam telefone por
   E.164 — sem o país, "81999674123" vira "+81..." (Japão) e o match falha.
   Só remove o 55 inicial quando sobra número demais: o DDD 55 existe. */
function toE164(v) {
  let d = String(v || "").trim().replace(/^\+\s*55\s*/, "").replace(/\D/g, "");

  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  return d ? `+55${d}` : "";
}

/* Guarda de idempotência: duplo clique ou reenvio não geram Lead duplicado. */
let leadEnviado = false;

function dispararLead({ nome, email, telefone }) {
  if (leadEnviado) return;
  leadEnviado = true;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event:       "lead_submit",
    lead_origem: "captura_manychat_pmpe",
    lead_name:   nome || "",
    lead_email:  (email || "").trim().toLowerCase(),
    lead_phone:  toE164(telefone)
  });
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

    dispararLead(payload);

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
