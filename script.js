/* =========================================================
   CPPEM — Formulário → Google Sheets + redirect Instagram (ManyChat)
   ========================================================= */

const SHEET_URL = "https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec?aba=MANYCHAT";

/* Link de retorno à caixa de mensagens do Instagram.
   Esta página é acessada por um link enviado no PV do usuário, ou seja, o fluxo
   do ManyChat já foi disparado lá na DM. Aqui não há ?ref= a acrescentar — o
   retorno serve só para levar a pessoa de volta à conversa. */
const INSTAGRAM_URL = "https://www.instagram.com/direct/inbox/";

/* =========================================================
   Janela de segurança antes de redirecionar

   O clique no botão #IPEyzyfmJhKQEYIXAlZH aciona DOIS consumidores, e eles têm
   resistência DIFERENTE ao unload da página:

   · GTM   — envia por sendBeacon/pixel de imagem, que SOBREVIVE à navegação.
   · PixelX— envia por requisição assíncrona, com debounce de ~1500 ms a partir
             do clique. Se a página sair antes disso, a requisição é CANCELADA.

   É exatamente essa diferença que produz o sintoma "o Lead chega no GTM mas não
   chega no Meta": não é configuração de painel, é a página saindo cedo demais.
   O código anterior navegava no mesmo tick do clique, então a PixelX nunca
   chegava a enviar.

   A contagem é feita a partir do CLIQUE, não do fim do fetch do Sheets — senão
   a margem depende da latência da planilha e, num fetch rápido, o redirect cai
   em cima do debounce. 2500 ms deixa ~1000 ms de folga sobre os 1500 da PixelX. */
const LEAD_SAFETY_MS = 2500;

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

/* §7.7 — conta DÍGITOS, não caracteres. O "+55" da máscara é texto FIXO: ele
   aparece na tela desde o primeiro caractere digitado e somaria 2 dígitos,
   fazendo um número incompleto passar por um teste ingênuo de "11 dígitos".
   Por isso o prefixo é removido pelo "+" literal antes de contar — remover
   pelos dígitos seria ambíguo, já que o DDD 55 existe (Santa Maria/RS).

   Isto NÃO é preciosismo de UX: um telefone incompleto faz o phone_valid() da
   PixelX rejeitar o lead, e a conversão não chega ao Meta. É o mesmo eixo do
   defeito da classe pxa_mask_phone ausente. */
const isPhone = (v) => {
  const d = v.trim().replace(/^\+\s*55\s*/, "").replace(/\D/g, "");

  return d.length === 11 && d[2] === "9";
};

function validate() {
  let ok = true;
  const nome  = document.getElementById("nome").value.trim();
  const email = document.getElementById("email").value.trim();
  const tel   = telefoneInput.value.trim();

  ["nome","email","telefone"].forEach(clearError);

  if (nome.length < 2) { setError("nome",     "Informe seu nome completo.");  ok = false; }
  if (!isEmail(email)) { setError("email",    "Informe um e-mail válido.");   ok = false; }
  if (!isPhone(tel))   { setError("telefone", "Informe seu WhatsApp com DDD — ex: (81) 90000-0000."); ok = false; }

  return ok;
}

/* --- Envio ---
   Quem dispara o Lead é o CLIQUE no botão #IPEyzyfmJhKQEYIXAlZH, consumido
   pela PixelX e pelo GTM. Este handler não emite conversão nenhuma — ele só
   precisa NÃO atrapalhar: sem preventDefault no clique (§7.4), sem
   stopPropagation, e sem sair da página antes da PixelX enviar. */
document.getElementById("lead-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;

  /* Marca o instante do clique. O debounce da PixelX conta a partir daqui,
     então é daqui que a janela de segurança precisa ser medida. */
  const tClique = Date.now();

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

    /* Redireciona na mesma aba (sem popup), descontando o tempo que o fetch do
       Sheets já consumiu. Se a planilha demorou 800 ms, só faltam 1700 — o que
       importa é o total desde o CLIQUE, não desde agora. */
    const restante = Math.max(0, LEAD_SAFETY_MS - (Date.now() - tClique));

    setTimeout(() => {
      window.location.href = INSTAGRAM_URL;
    }, restante);

  } catch (err) {
    setError("telefone", "Erro ao enviar. Tente novamente.");

    /* Só reabilita em caso de erro. Reabilitar no sucesso deixaria o botão
       clicável durante a espera do redirecionamento, e cada clique novo
       dispararia a regra de conversão de novo — Lead duplicado. */
    btn.disabled    = false;
    btn.textContent = "QUERO RECEBER O MATERIAL";
  }
});
