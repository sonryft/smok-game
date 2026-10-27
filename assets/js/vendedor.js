import {
supabase,
requireSession,
hasPermission
} from “./supabase.js”;

const auth = await requireSession();

if (!auth) {
throw new Error(“Sesión requerida”);
}

const { profile } = auth;

if (profile.role !== “worker”) {
location.replace(“app.html”);
throw new Error(“Esta interfaz es exclusiva para vendedores.”);
}

const $ = selector => document.querySelector(selector);

document.documentElement.dataset.theme =
localStorage.getItem(“smok-theme”) || “carbon”;

const displayName = profile.full_name || profile.username || “Vendedor”;

$(”#seller-name”).textContent = displayName;
$(”#seller-welcome-name”).textContent = displayName;
$(”#seller-stat-user”).textContent = profile.username || “Vendedor”;
$(”#seller-account-name”).textContent = displayName;
$(”#seller-account-username”).textContent = profile.username || “—”;
$(”#seller-avatar”).textContent = displayName.charAt(0).toUpperCase();

const titles = {
inicio: “Inicio”,
caja: “Abrir caja”,
ventas: “Ventas”,
inventario: “Inventario”,
cierre: “Cerrar caja”,
arqueo: “Arqueo de caja”,
cuenta: “Mi cuenta”
};

function showSection(name) {
document.querySelectorAll(”.seller-section”).forEach(section => {
section.hidden = section.id !== section-${name};
});

document.querySelectorAll(”[data-section]”).forEach(button => {
button.classList.toggle(“active”, button.dataset.section === name);
});

$(”#seller-page-title”).textContent = titles[name] || “Inicio”;
}

document.querySelectorAll(”[data-section]”).forEach(button => {
button.addEventListener(“click”, () => showSection(button.dataset.section));
});

$(”#seller-name”).closest(”.seller-user”).style.cursor = “pointer”;

$(”#seller-name”).closest(”.seller-user”).addEventListener(“click”, () => {
showSection(“cuenta”);
});

$(”#seller-logout”).addEventListener(“click”, async () => {
await supabase.auth.signOut();
location.replace(“login.html”);
});

async function loadProductCount() {
const { count, error } = await supabase
.from(“products”)
.select(”*”, { count: “exact”, head: true })
.eq(“is_active”, true);

if (error) {
console.error(“Error cargando productos:”, error);
$(”#seller-stat-products”).textContent = “—”;
return;
}

$(”#seller-stat-products”).textContent = String(count ?? 0);
}

function showCashMessage(text, success = false) {
const element = $(”#seller-message”);
if (!element) return;

element.textContent = text;
element.style.color = success ? “#48d597” : “#ff8585”;
}

async function loadCashStatus() {
const status = $(”#seller-cash-status”);
const stat = $(”#seller-stat-cash”);
const amountInput = $(”#seller-opening-amount”);
const openButton = $(”#seller-open-btn”);

const { data, error } = await supabase
.from(“cash_shifts”)
.select(“id,opened_by,opening_amount,opened_at”)
.eq(“status”, “open”)
.order(“opened_at”, { ascending: false })
.limit(1)
.maybeSingle();

if (error) {
console.error(“Error consultando caja:”, error);
status.textContent = “Estado no disponible”;
stat.textContent = “No disponible”;
amountInput.disabled = true;
openButton.disabled = true;
return;
}

const isOpen = Boolean(data);

status.textContent = isOpen ? “Caja abierta” : “Caja cerrada”;
stat.textContent = isOpen ? “Abierta” : “Cerrada”;

amountInput.disabled = isOpen;
openButton.disabled = isOpen;

openButton.textContent = isOpen
? “Ya existe una caja abierta”
: “Abrir caja”;

if (isOpen && data.opened_by !== profile.id) {
showCashMessage(
“Ya existe una caja abierta por otro usuario. No puedes abrir otra.”
);
} else if (isOpen) {
showCashMessage(“Tu caja está abierta.”, true);
}
}

$(”#seller-go-arqueo”).addEventListener(“click”, () => {
showSection(“arqueo”);
});

// Apertura de caja existente.
$(”#seller-open-form”).addEventListener(“submit”, async event => {
event.preventDefault();

const button = $(”#seller-open-btn”);

if (!await hasPermission(profile, “cash.open”)) {
showCashMessage(“No tienes permiso para abrir caja.”);
return;
}

const amount = Number($(”#seller-opening-amount”).value);

if (
!Number.isFinite(amount) ||
amount < 0 ||
amount > 9999999999.99 ||
Math.round(amount * 100) !== amount * 100
) {
showCashMessage(“Introduce un fondo inicial válido, con un máximo de dos decimales.”);
return;
}

button.disabled = true;
button.textContent = “Abriendo caja…”;

try {
const { data, error } = await supabase.rpc(“open_cash_shift”, {
p_opening_amount: amount,
p_note: null

if (error) throw error;
if (!data) throw new Error("Supabase no devolvió el identificador del turno abierto.");

showCashMessage("Caja abierta correctamente. Ya puedes comenzar a trabajar.", true);
await loadCashStatus();

} catch (error) {
console.error(“Error abriendo caja:”, error);
showCashMessage(No se pudo abrir la caja: ${error.message});
button.disabled = false;
button.textContent = “Abrir caja”;
}
});

// Cierre de caja: efectivo contado y QR declarado.
const closeForm = $(”#seller-close-form”);

if (closeForm) {
closeForm.addEventListener(“submit”, async event => {
event.preventDefault();
const button = $("#seller-close-btn");
const countedCash = Number($("#seller-counted-cash").value);
const qrDeclared = Number($("#seller-qr-declared").value);
const note = $("#seller-close-note").value.trim();

const validAmount = value =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 9999999999.99 &&
  Math.round(value * 100) === value * 100;

if (!validAmount(countedCash) || !validAmount(qrDeclared)) {
  showCashMessage("Introduce importes válidos, con un máximo de dos decimales.");
  return;
}

const canClose =
  profile.role === "admin" ||
  await hasPermission(profile, "cash.close") ||
  await hasPermission(profile, "cash.reconcile");

if (!canClose) {
  showCashMessage("No tienes permiso para cerrar la caja.");
  return;
}

button.disabled = true;
button.textContent = "Cerrando caja…";

try {
  const { data: shift, error: shiftError } = await supabase
    .from("cash_shifts")
    .select("id,opened_by,status")
    .eq("status", "open")
    .eq("opened_by", profile.id)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shiftError) throw shiftError;
  if (!shift) throw new Error("No tienes una caja abierta para cerrar.");

  const { error: closeError } = await supabase.rpc("close_cash_shift", {
    p_shift_id: shift.id,
    p_counted_cash: countedCash,
    p_note: note || null,
    p_qr_declared: qrDeclared
  });

  if (closeError) throw closeError;

  showCashMessage("Caja cerrada correctamente.", true);
  closeForm.reset();
  await loadCashStatus();
  showSection("inicio");
} catch (error) {
  console.error("Error cerrando caja:", error);
  showCashMessage(`No se pudo cerrar la caja: ${error.message}`);
} finally {
  button.disabled = false;
  button.textContent = "Confirmar arqueo y cerrar caja";
}
  });
}

await Promise.all([
loadProductCount(),
loadCashStatus()
]);

showSection(“inicio”);
