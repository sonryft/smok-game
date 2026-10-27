import { supabase, requireSession, money } from "./supabase.js";

const auth = await requireSession();
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = (selector) => document.querySelector(selector);
const form = $("#product-form");
const rowsEl = $("#inventory-rows");

let products = [];
const isAdmin = profile.role === "admin";

let canCreate = isAdmin;
let canEdit = isAdmin;

if (!isAdmin) {
  const [createResult, editResult] = await Promise.all([
    supabase.rpc("has_permission", {
      permission_key: "inventory.create_product"
    }),
    supabase.rpc("has_permission", {
      permission_key: "inventory.edit_product"
    })
  ]);

  canCreate = !createResult.error && createResult.data === true;
  canEdit = !editResult.error && editResult.data === true;
}

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#inventory-user").textContent =
  profile.full_name || profile.username || "Usuario";

$("#inventory-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function say(element, message, success = false) {
  if (!element) return;
  element.textContent = message;
  element.className = `message ${success ? "ok" : "error"}`;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function loadProducts() {
  rowsEl.innerHTML =
    '<tr><td colspan="8" class="empty">Cargando inventario…</td></tr>';

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    products = [];
    rowsEl.innerHTML =
      '<tr><td colspan="8" class="empty">No se pudo cargar el inventario.</td></tr>';

    say($("#list-message"), error.message);
    updateStats();
    return;
  }

  products = data || [];
  renderProducts();
  updateStats();
}

function updateStats() {
  const activeProducts = products.filter(
    (product) => product.is_active !== false
  );

  $("#stat-products").textContent = String(activeProducts.length);

  $("#stat-units").textContent = String(
    activeProducts.reduce(
      (total, product) => total + numeric(product.stock),
      0
    )
  );

  $("#stat-low").textContent = String(
    activeProducts.filter(
      (product) =>
        numeric(product.stock) <=
        numeric(product.stock_minimum ?? product.min_stock ?? 3)
    ).length
  );
}

function renderProducts() {
  const search = $("#inventory-search")
    .value
    .trim()
    .toLocaleLowerCase();

  const filteredProducts = products.filter((product) => {
    const searchableText = [
      product.name,
      product.sku,
      product.category
    ]
      .map((value) => String(value ?? "").toLocaleLowerCase())
      .join(" ");

    return searchableText.includes(search);
  });

  if (!filteredProducts.length) {
    rowsEl.innerHTML =
      '<tr><td colspan="8" class="empty">No hay productos que coincidan con la búsqueda.</td></tr>';
    return;
  }

  rowsEl.innerHTML = filteredProducts.map((product) => {
    const stock = numeric(product.stock);
    const minimum = numeric(
      product.stock_minimum ?? product.min_stock ?? 3
    );

    const status =
      product.is_active === false
        ? "Inactivo"
        : stock <= 0
          ? "Agotado"
          : stock <= minimum
            ? "Stock bajo"
            : "Disponible";

    const statusClass =
      product.is_active === false || stock <= 0
        ? "stock-out"
        : stock <= minimum
          ? "stock-low"
          : "";

    const actions = [
      canEdit
        ? `<button type="button" class="row-btn" data-edit="${esc(product.id)}">Editar</button>`
        : "",
      canEdit
        ? `<button type="button" class="row-btn" data-stock="${esc(product.id)}">Ajustar stock</button>`
        : ""
    ].filter(Boolean).join(" ") || "Solo lectura";

    return `
      <tr>
        <td><strong>${esc(product.name)}</strong></td>
        <td>${esc(product.sku || "—")}</td>
        <td>${esc(product.category || "—")}</td>
        <td>${esc(money(product.cost_price ?? product.purchase_price ?? 0))}</td>
        <td>${esc(money(product.sale_price ?? 0))}</td>
        <td>${stock}</td>
        <td><span class="stock-pill ${statusClass}">${status}</span></td>
        <td>${actions}</td>
      </tr>
    `;
  }).join("");

  rowsEl.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => beginEdit(button.dataset.edit));
  });

  rowsEl.querySelectorAll("[data-stock]").forEach((button) => {
    button.addEventListener("click", () => adjustStock(button.dataset.stock));
  });
}

function resetForm() {
  form.reset();

  $("#product-id").value = "";
  $("#product-cost").value = "0";
  $("#product-stock").value = "0";
  $("#product-minimum").value = "3";

  $("#form-title").textContent = canCreate
    ? "Agregar producto"
    : "Inventario (edición limitada)";

  $("#save-product").textContent = "Guardar producto";
  $("#cancel-edit").hidden = true;
  $("#product-stock").readOnly = false;
  $("#product-stock").title = "";
  $("#save-product").hidden = !canCreate;

  applyFormPermissions();
}

function applyFormPermissions() {
  const fieldIds = [
    "#product-name",
    "#product-sku",
    "#product-category",
    "#product-cost",
    "#product-price",
    "#product-stock",
    "#product-minimum"
  ];

  fieldIds.forEach((selector) => {
    const element = $(selector);
    if (element) element.disabled = !canCreate && !canEdit;
  });

  $("#save-product").hidden = !canCreate && !canEdit;
}

function beginEdit(id) {
  if (!canEdit) {
    say($("#form-message"), "No tienes permiso para editar productos.");
    return;
  }

  const product = products.find(
    (item) => String(item.id) === String(id)
  );

  if (!product) return;

  $("#product-id").value = product.id;
  $("#product-name").value = product.name || "";
  $("#product-sku").value = product.sku || "";
  $("#product-category").value = product.category || "";
  $("#product-cost").value =
    product.cost_price ?? product.purchase_price ?? 0;
  $("#product-price").value = product.sale_price ?? 0;
  $("#product-stock").value = product.stock ?? 0;
  $("#product-minimum").value =
    product.stock_minimum ?? product.min_stock ?? 3;

  $("#product-stock").readOnly = true;
  $("#product-stock").title =
    "Para cambiar existencias, utiliza Ajustar stock.";

  $("#form-title").textContent = "Editar producto";
  $("#save-product").textContent = "Guardar cambios";
  $("#save-product").hidden = false;
  $("#cancel-edit").hidden = false;

  form.querySelectorAll("input").forEach((element) => {
    if (element.id !== "product-id") element.disabled = false;
  });

  say(
    $("#form-message"),
    "El stock se conserva al editar. Utiliza Ajustar stock para registrar entradas y salidas.",
    true
  );

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Los cambios de stock se realizan en Supabase mediante una función
// que actualiza las existencias y registra el movimiento conjuntamente.
async function adjustStock(id) {
  if (!canEdit) {
    say($("#list-message"), "No tienes permiso para ajustar el stock.");
    return;
  }

  const product = products.find(
    (item) => String(item.id) === String(id)
  );

  if (!product) return;

  const raw = window.prompt(
    `Producto: ${product.name}\n` +
    `Stock actual: ${product.stock}\n\n` +
    "Introduce el ajuste con signo:\n" +
    "+5 para entrada de 5 unidades\n" +
    "-2 para salida de 2 unidades",
    "+1"
  );

  if (raw === null) return;

  const delta = Number(raw.trim());

  if (!Number.isSafeInteger(delta) || delta === 0) {
    say($("#list-message"), "Introduce un número entero distinto de cero.");
    return;
  }

  if (numeric(product.stock) + delta < 0) {
    say($("#list-message"), "El stock no puede quedar por debajo de cero.");
    return;
  }

  const note = window.prompt(
    "Indica el motivo del ajuste de stock:"
  );

  if (note === null) return;

  if (!note.trim()) {
    say($("#list-message"), "El motivo del ajuste es obligatorio.");
    return;
  }

  const button = rowsEl.querySelector(
    `[data-stock="${CSS.escape(String(id))}"]`
  );

  if (button) button.disabled = true;

  try {
    const { data, error } = await supabase.rpc(
      "adjust_inventory_stock",
      {
        p_product_id: id,
        p_quantity_change: delta,
        p_note: note.trim()
      }
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    say(
      $("#list-message"),
      `Stock actualizado: ${product.name} ` +
      `(${result.stock_before} → ${result.stock_after}). Movimiento registrado.`,
      true
    );

    await loadProducts();
  } catch (error) {
    console.error("Error al ajustar inventario:", error);
    say(
      $("#list-message"),
      `No se pudo ajustar el stock: ${error.message}`
    );
  } finally {
    if (button) button.disabled = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = $("#product-id").value.trim();
  const isEditing = Boolean(id);

  if (isEditing && !canEdit) {
    say($("#form-message"), "No tienes permiso para editar productos.");
    return;
  }

  if (!isEditing && !canCreate) {
    say($("#form-message"), "No tienes permiso para agregar productos.");
    return;
  }

  const name = $("#product-name").value.trim();
  const sku = $("#product-sku").value.trim() || null;
  const category = $("#product-category").value.trim() || null;

  const cost = Number($("#product-cost").value);
  const price = Number($("#product-price").value);
  const stock = Number($("#product-stock").value);
  const minimum = Number($("#product-minimum").value);

  if (!name) {
    return say($("#form-message"), "El nombre del producto es obligatorio.");
  }

  if (!Number.isFinite(cost) || cost < 0) {
    return say($("#form-message"), "El precio de compra no puede ser negativo.");
  }

  if (!Number.isFinite(price) || price <= 0) {
    return say($("#form-message"), "El precio de venta debe ser mayor que cero.");
  }

  if (!isEditing && (!Number.isSafeInteger(stock) || stock < 0)) {
    return say($("#form-message"), "El stock debe ser un entero igual o mayor que cero.");
  }

  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    return say($("#form-message"), "El stock mínimo debe ser un entero igual o mayor que cero.");
  }

  if (
    sku &&
    products.some(
      (product) =>
        String(product.sku || "").toLocaleLowerCase() === sku.toLocaleLowerCase() &&
        String(product.id) !== id
    )
  ) {
    return say($("#form-message"), "Ya existe un producto con ese código / SKU.");
  }

  const button = $("#save-product");
  button.disabled = true;
  button.textContent = "Guardando…";

  try {
    const existing = isEditing
      ? products.find((product) => String(product.id) === id)
      : null;

    const payload = {
      name,
      sku,
      sale_price: price,
      is_active: existing?.is_active ?? true
    };

    if (!isEditing) {
      payload.stock = stock;
      // Guardar quién creó el producto.
      payload.created_by = auth.session.user.id;
    }

    if (products.some((product) => "category" in product) || !products.length) {
      payload.category = category;
    }

    if (products.some((product) => "cost_price" in product)) {
      payload.cost_price = cost;
    } else if (products.some((product) => "purchase_price" in product)) {
      payload.purchase_price = cost;
    }

    if (products.some((product) => "stock_minimum" in product)) {
      payload.stock_minimum = minimum;
    } else if (products.some((product) => "min_stock" in product)) {
      payload.min_stock = minimum;
    }

    let result;

    if (isEditing) {
      result = await supabase
        .from("products")
        .update(payload)
        .eq("id", id);
    } else {
      result = await supabase
        .from("products")
        .insert(payload);
    }

    if (result.error) throw result.error;

    say(
      $("#form-message"),
      isEditing
        ? "Producto actualizado correctamente."
        : "Producto registrado correctamente con su responsable.",
      true
    );

    resetForm();
    await loadProducts();
  } catch (error) {
    console.error("Error al guardar producto:", error);
    say($("#form-message"), error?.message || "No se pudo guardar el producto.");
  } finally {
    button.disabled = false;
    button.textContent = $("#product-id").value
      ? "Guardar cambios"
      : "Guardar producto";
  }
});

$("#cancel-edit").addEventListener("click", () => {
  resetForm();
  $("#form-message").textContent = "";
});

$("#inventory-search").addEventListener("input", renderProducts);

if (!canCreate && !canEdit) {
  $("#form-title").textContent = "Inventario (solo lectura)";
  $("#save-product").hidden = true;

  form.querySelectorAll("input, button").forEach((element) => {
    if (element.id !== "inventory-logout") element.disabled = true;
  });
} else if (!canCreate && canEdit) {
  $("#form-title").textContent = "Inventario (edición limitada)";
  $("#save-product").hidden = true;
}

await loadProducts();
