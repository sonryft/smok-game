import { supabase, requireSession, money } from "./supabase.js";

const auth = await requireSession();
if (!auth) throw new Error("Sesión requerida");
const { profile } = auth;
const $ = (s) => document.querySelector(s);
const form = $("#product-form");
const rowsEl = $("#inventory-rows");
let products = [];
let canManage = profile.role === "admin";

document.documentElement.dataset.theme = localStorage.getItem("smok-theme") || "carbon";
$("#inventory-user").textContent = profile.full_name || profile.username || "Usuario";
$("#inventory-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function say(el, message, ok = false) {
  el.textContent = message;
  el.className = `message ${ok ? "ok" : "error"}`;
}
function numeric(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function loadProducts() {
  rowsEl.innerHTML = '<tr><td colspan="8" class="empty">Cargando inventario…</td></tr>';
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    products = [];
    rowsEl.innerHTML = '<tr><td colspan="8" class="empty">No se pudo cargar el inventario. Revisa los permisos de la tabla products.</td></tr>';
    say($("#list-message"), error.message);
    updateStats();
    return;
  }
  products = data || [];
  renderProducts();
  updateStats();
}

function updateStats() {
  const active = products.filter(p => p.is_active !== false);
  $("#stat-products").textContent = String(active.length);
  $("#stat-units").textContent = String(active.reduce((sum, p) => sum + numeric(p.stock), 0));
  $("#stat-low").textContent = String(active.filter(p => numeric(p.stock) <= numeric(p.stock_minimum ?? p.min_stock ?? 3)).length);
}

function renderProducts() {
  const q = $("#inventory-search").value.trim().toLocaleLowerCase();
  const filtered = products.filter(p => {
    const haystack = [p.name, p.sku, p.category].map(v => String(v ?? "").toLocaleLowerCase()).join(" ");
    return haystack.includes(q);
  });
  if (!filtered.length) {
    rowsEl.innerHTML = '<tr><td colspan="8" class="empty">No hay productos que coincidan con la búsqueda.</td></tr>';
    return;
  }
  rowsEl.innerHTML = filtered.map(p => {
    const stock = numeric(p.stock);
    const minimum = numeric(p.stock_minimum ?? p.min_stock ?? 3);
    const status = p.is_active === false ? "Inactivo" : stock <= 0 ? "Agotado" : stock <= minimum ? "Stock bajo" : "Disponible";
    const pill = p.is_active === false || stock <= 0 ? "stock-out" : stock <= minimum ? "stock-low" : "";
    const actions = canManage
      ? `<button class="row-btn" data-edit="${esc(p.id)}">Editar</button><button class="row-btn" data-stock="${esc(p.id)}">Ajustar stock</button>`
      : "Solo lectura";
    return `<tr>
      <td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku || "—")}</td><td>${esc(p.category || "—")}</td>
      <td>${esc(money(p.cost_price ?? p.purchase_price ?? 0))}</td><td>${esc(money(p.sale_price ?? 0))}</td>
      <td>${stock}</td><td><span class="stock-pill ${pill}">${status}</span></td><td>${actions}</td>
    </tr>`;
  }).join("");
  rowsEl.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => beginEdit(b.dataset.edit)));
  rowsEl.querySelectorAll("[data-stock]").forEach(b => b.addEventListener("click", () => adjustStock(b.dataset.stock)));
}

function resetForm() {
  form.reset();
  $("#product-id").value = "";
  $("#product-cost").value = "0";
  $("#product-stock").value = "0";
  $("#product-minimum").value = "3";
  $("#form-title").textContent = "Agregar producto";
  $("#save-product").textContent = "Guardar producto";
  $("#cancel-edit").hidden = true;
  $("#product-stock").readOnly = false;
  $("#product-stock").title = "";
}
function beginEdit(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  $("#product-id").value = p.id;
  $("#product-name").value = p.name || "";
  $("#product-sku").value = p.sku || "";
  $("#product-category").value = p.category || "";
  $("#product-cost").value = p.cost_price ?? p.purchase_price ?? 0;
  $("#product-price").value = p.sale_price ?? 0;
  $("#product-stock").value = p.stock ?? 0;
  $("#product-minimum").value = p.stock_minimum ?? p.min_stock ?? 3;
  // Do not alter stock through ordinary product editing. Use the stock adjustment action.
  $("#product-stock").readOnly = true;
  $("#product-stock").title = "Para cambiar existencias, utiliza Ajustar stock.";
  $("#form-title").textContent = "Editar producto";
  $("#save-product").textContent = "Guardar cambios";
  $("#cancel-edit").hidden = false;
  say($("#form-message"), "Al editar, el stock se conserva. Usa «Ajustar stock» para registrar una entrada o salida.", true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function adjustStock(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  const raw = window.prompt(
    `Producto: ${p.name}\nStock actual: ${p.stock}\n\nIntroduce el ajuste con signo:\n+5 para entrada de 5 unidades\n-2 para salida de 2 unidades`,
    "+1"
  );
  if (raw === null) return;
  const delta = Number(raw.trim());
  if (!Number.isInteger(delta) || delta === 0) {
    say($("#list-message"), "Escribe un número entero distinto de cero, por ejemplo +5 o -2.");
    return;
  }
  const nextStock = numeric(p.stock) + delta;
  if (nextStock < 0) {
    say($("#list-message"), "El stock no puede quedar por debajo de cero.");
    return;
  }
  // Uses the current products table only; no new table or database schema is created.
  const { error } = await supabase.from("products").update({ stock: nextStock }).eq("id", p.id);
  if (error) {
    say($("#list-message"), `No se pudo ajustar el stock: ${error.message}`);
    return;
  }
  say($("#list-message"), `Stock actualizado: ${p.name} (${p.stock} → ${nextStock}).`, true);
  await loadProducts();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canManage) return say($("#form-message"), "Solo el administrador puede modificar el inventario.");
  const id = $("#product-id").value.trim();
  const name = $("#product-name").value.trim();
  const sku = $("#product-sku").value.trim() || null;
  const category = $("#product-category").value.trim() || null;
  const cost = Number($("#product-cost").value);
  const price = Number($("#product-price").value);
  const stock = Number($("#product-stock").value);
  const minimum = Number($("#product-minimum").value);

  if (!name) return say($("#form-message"), "El nombre del producto es obligatorio.");
  if (!Number.isFinite(cost) || cost < 0) return say($("#form-message"), "El precio de compra no puede ser negativo.");
  if (!Number.isFinite(price) || price <= 0) return say($("#form-message"), "El precio de venta debe ser mayor que cero.");
  if (!Number.isInteger(stock) || stock < 0) return say($("#form-message"), "El stock debe ser un entero igual o mayor que cero.");
  if (!Number.isInteger(minimum) || minimum < 0) return say($("#form-message"), "El stock mínimo debe ser un entero igual o mayor que cero.");
  if (sku && products.some(p => String(p.sku || "").toLocaleLowerCase() === sku.toLocaleLowerCase() && String(p.id) !== id)) {
    return say($("#form-message"), "Ya existe un producto con ese código / SKU.");
  }

  const button = $("#save-product");
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    const existing = id ? products.find(p => String(p.id) === id) : null;
    // These are the existing product columns used by the app; optional columns are only
    // included if already present in the current row to avoid assuming a new schema.
    const payload = { name, sku, sale_price: price, stock, is_active: existing?.is_active ?? true };
    if (products.some(p => "category" in p) || !products.length) payload.category = category;
    if (products.some(p => "cost_price" in p)) payload.cost_price = cost;
    else if (products.some(p => "purchase_price" in p)) payload.purchase_price = cost;
    if (products.some(p => "stock_minimum" in p)) payload.stock_minimum = minimum;
    else if (products.some(p => "min_stock" in p)) payload.min_stock = minimum;

    let result;
    if (id) {
      // Preserve current stock during edit; stock is managed with the adjustment button.
      delete payload.stock;
      result = await supabase.from("products").update(payload).eq("id", id);
    } else {
      result = await supabase.from("products").insert(payload);
    }
    if (result.error) throw result.error;
    say($("#form-message"), id ? "Producto actualizado correctamente." : "Producto registrado correctamente.", true);
    resetForm();
    await loadProducts();
  } catch (error) {
    say($("#form-message"), error?.message || "No se pudo guardar el producto.");
  } finally {
    button.disabled = false;
    button.textContent = $("#product-id").value ? "Guardar cambios" : "Guardar producto";
  }
});

$("#cancel-edit").addEventListener("click", () => {
  resetForm();
  $("#form-message").textContent = "";
});
$("#inventory-search").addEventListener("input", renderProducts);

if (!canManage) {
  form.querySelectorAll("input,button").forEach(el => { if (el.id !== "inventory-logout") el.disabled = true; });
  $("#form-title").textContent = "Inventario (solo lectura)";
  $("#save-product").hidden = true;
}
await loadProducts();
