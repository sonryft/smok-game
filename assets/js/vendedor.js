import { supabase, requireSession } from "./supabase.js";

const auth = await requireSession();

if (!auth) {
  throw new Error("Sesión requerida");
}

const { profile } = auth;

// Esta página es exclusiva para trabajadores.
if (profile.role !== "worker") {
  location.replace("app.html");
  throw new Error("Esta interfaz es exclusiva para vendedores.");
}

const $ = (selector) => document.querySelector(selector);

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

// Datos del usuario.
const displayName = profile.full_name || profile.username || "Vendedor";

$("#seller-name").textContent = displayName;
$("#seller-welcome-name").textContent = displayName;
$("#seller-stat-user").textContent = profile.username || "Vendedor";
$("#seller-account-name").textContent = displayName;
$("#seller-account-username").textContent = profile.username || "—";
$("#seller-avatar").textContent = displayName.charAt(0).toUpperCase();

// Navegación entre secciones.
const titles = {
  inicio: "Inicio",
  caja: "Abrir caja",
  ventas: "Ventas",
  inventario: "Inventario",
  cierre: "Cerrar caja",
  arqueo: "Arqueo de caja",
  cuenta: "Mi cuenta"
};

function showSection(name) {
  document.querySelectorAll(".seller-section").forEach((section) => {
    section.hidden = section.id !== `section-${name}`;
  });

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.section === name
    );
  });

  $("#seller-page-title").textContent = titles[name] || "Inicio";
}

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => {
    showSection(button.dataset.section);
  });
});

// Mi cuenta se abre desde el área de usuario.
$("#seller-name").closest(".seller-user").style.cursor = "pointer";

$("#seller-name").closest(".seller-user").addEventListener("click", () => {
  showSection("cuenta");
});

// Cerrar sesión.
$("#seller-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

// Consultar el inventario disponible.
async function loadProductCount() {
  const { count, error } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  if (error) {
    $("#seller-stat-products").textContent = "—";
    return;
  }

  $("#seller-stat-products").textContent = String(count ?? 0);
}

// Consultar si existe una caja abierta.
// Si no se puede consultar, no asumimos que esté abierta.
async function loadCashStatus() {
  const status = $("#seller-cash-status");
  const stat = $("#seller-stat-cash");

  const { data, error } = await supabase
    .from("cash_shifts")
    .select("id")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (error) {
    status.textContent = "Estado no disponible";
    stat.textContent = "No disponible";
    return;
  }

  const isOpen = Boolean(data);

  status.textContent = isOpen ? "Caja abierta" : "Caja cerrada";
  stat.textContent = isOpen ? "Abierta" : "Cerrada";

  $("#seller-opening-amount").disabled = isOpen;
  $("#seller-open-btn").disabled = isOpen;

  if (isOpen) {
    $("#seller-open-btn").textContent = "Ya existe una caja abierta";
  }
}

// Navegación al arqueo desde el cierre.
$("#seller-go-arqueo").addEventListener("click", () => {
  showSection("arqueo");
});

// Apertura de caja pendiente de conectar a la función real.
$("#seller-open-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#seller-message");

  message.textContent =
    "La apertura de caja debe conectarse a la función de apertura existente en Supabase.";

  message.style.color = "#e5c27a";
});

await Promise.all([
  loadProductCount(),
  loadCashStatus()
]);

showSection("inicio");
