import { supabase, requireSession, money } from "./supabase.js";

const auth = await requireSession("sales.create");
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = (selector) => document.querySelector(selector);
const searchEl = $("#product-search");
const productList = $("#products-list");
const qtyEl = $("#quantity");
const paymentEl = $("#payment-method");
const receivedEl = $("#amount-received");
const historyEl = $("#sales-history");

let products = [];
let selectedProduct = null;
let salesHistory = [];

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#sales-user").textContent =
  profile.full_name || profile.username || "Usuario";

$("#sales-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

// Mantiene esta pantalla aislada del panel principal al usar Atrás.
history.replaceState({ salesOnly: true }, "", location.href);
history.pushState({ salesOnly: true }, "", location.href);

window.addEventListener("popstate", () => {
  history.pushState({ salesOnly: true }, "", location.href);
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function methodLabel(method) {
  const m = String(method || "").toLowerCase();

  return m === "qr"
    ? "QR"
    : m === "efectivo"
      ? "Efectivo"
      : m || "—";
}

function showMessage(message, type = "error") {
  const el = $("#sale-message");

  if (!el) return;

  el.textContent = message;
  el.className = `message ${type}`;
}

function updateSummary() {
  const quantity = Math.max(
    0,
    Number.parseInt(qtyEl.value || "0", 10) || 0
  );

  const total = selectedProduct
    ? Number(selectedProduct.sale_price || 0) * quantity
    : 0;

  $("#summary-product").textContent = selectedProduct?.name || "—";
  $("#summary-quantity").textContent = String(
    selectedProduct ? quantity : 0
  );
  $("#summary-payment").textContent = methodLabel(paymentEl.value);
  $("#summary-total").textContent = money(total);

  const cash = paymentEl.value === "efectivo";

  $("#cash-fields").classList.toggle("show", cash);
  $("#change-field").classList.toggle("show", cash);

  receivedEl.disabled = !cash;

  $("#payment-note").textContent = cash
    ? "Registra cuánto dinero recibiste para calcular el cambio."
    : "El pago por QR no se suma al efectivo físico de caja.";

  const received = Number(receivedEl.value || 0);

  $("#change-amount").value = money(
    Math.max(0, received - total)
  );
}

function renderProductOptions() {
  productList.innerHTML = products.map((p) => {
    const label = p.sku
      ? `${p.name} · ${p.sku}`
      : p.name;

    return `<option value="${escapeHtml(label)}"></option>`;
  }).join("");
}

function resolveProduct() {
  const value = searchEl.value.trim().toLocaleLowerCase();

  selectedProduct = products.find((p) => {
    const label = p.sku
      ? `${p.name} · ${p.sku}`
      : p.name;

    return [p.name, p.sku, label].some(
      (v) => String(v || "").toLocaleLowerCase() === value
    );
  }) || null;

  $("#product-hint").textContent = selectedProduct
    ? `Stock disponible: ${selectedProduct.stock}`
    : "Selecciona un producto válido de la lista.";

  $("#unit-price").value = selectedProduct
    ? money(selectedProduct.sale_price)
    : money(0);

  updateSummary();
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,sale_price,stock,is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Error cargando productos:", error);

    $("#product-hint").textContent =
      "No se pudieron cargar los productos. Revisa los permisos de acceso.";

    return;
  }

  products = (data || []).filter(
    (p) => Number(p.stock) > 0
  );

  renderProductOptions();
}

/* HISTORIAL: muestra los productos incluidos en cada venta. */
function renderHistory(rows) {
  if (!rows.length) {
    historyEl.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">
          Todavía no hay ventas registradas.
        </td>
      </tr>
    `;
    return;
  }

  historyEl.innerHTML = rows.map((sale) => {
    const date = sale.created_at
      ? new Date(sale.created_at).toLocaleString("es-BO")
      : "—";

    const id = String(
      sale.receipt_number ?? sale.id ?? ""
    ).slice(0, 12);

    const items = sale.sale_items || [];

    const details = items.length
      ? items.map((item) => {
          const name = item.product_name_snapshot || "Producto";
          const quantity = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const subtotal = Number(item.line_total || 0);

          return `
            <div class="sale-item-detail" style="margin-bottom:6px">
              <strong>${escapeHtml(name)}</strong>
              <div style="font-size:12px;opacity:.75">
                ${quantity} × ${escapeHtml(money(unitPrice))}
                = ${escapeHtml(money(subtotal))}
              </div>
            </div>
          `;
        }).join("")
      : '<span class="muted">Sin detalle disponible</span>';

    const status = String(sale.status || "completada");

    return `
      <tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(id || "—")}</td>
        <td>${details}</td>
        <td>${escapeHtml(methodLabel(sale.payment_method))}</td>
        <td>
          <strong>${escapeHtml(money(sale.total))}</strong>
          <br>
          <span class="status">${escapeHtml(status)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadHistory() {
  historyEl.innerHTML = `
    <tr>
      <td colspan="5" class="empty-row">Cargando ventas…</td>
    </tr>
  `;

  const { data, error } = await supabase
    .from("sales")
    .select(`
      id,
      created_at,
      total,
      payment_method,
      status,
      sale_items (
        product_name_snapshot,
        sku_snapshot,
        quantity,
        unit_price,
        line_total
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error cargando historial:", error);

    historyEl.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">
          No se pudo cargar el historial de ventas.
        </td>
      </tr>
    `;

    $("#history-message").textContent = error.message;
    return;
  }

  salesHistory = data || [];
  renderHistory(salesHistory);
}

/* EVENTOS DE LA INTERFAZ */
searchEl.addEventListener("input", resolveProduct);
searchEl.addEventListener("change", resolveProduct);
qtyEl.addEventListener("input", updateSummary);
paymentEl.addEventListener("change", updateSummary);
receivedEl.addEventListener("input", updateSummary);

$("#history-search").addEventListener("input", () => {
  const q = $("#history-search").value
    .trim()
    .toLocaleLowerCase();

  renderHistory(salesHistory.filter((sale) => {
    const saleFields = [
      sale.id,
      sale.receipt_number,
      sale.payment_method,
      sale.status,
      sale.total,
      sale.created_at
    ];

    const saleMatches = saleFields.some((value) =>
      String(value ?? "").toLocaleLowerCase().includes(q)
    );

    const itemMatches = (sale.sale_items || []).some((item) =>
      [
        item.product_name_snapshot,
        item.sku_snapshot,
        item.quantity,
        item.unit_price,
        item.line_total
      ].some((value) =>
        String(value ?? "").toLocaleLowerCase().includes(q)
      )
    );

    return saleMatches || itemMatches;
  }));
});

/* EXPORTACIÓN CSV: incluye los productos de cada venta. */
$("#export-csv").addEventListener("click", () => {
  if (!salesHistory.length) {
    $("#history-message").textContent =
      "No hay ventas para exportar.";
    return;
  }

  const rows = [
    [
      "Fecha",
      "N.º de venta",
      "Producto",
      "SKU",
      "Cantidad",
      "Precio unitario",
      "Subtotal",
      "Método de pago",
      "Total de venta",
      "Estado"
    ]
  ];

  salesHistory.forEach((sale) => {
    const date = sale.created_at
      ? new Date(sale.created_at).toLocaleString("es-BO")
      : "";

    const items = sale.sale_items || [];

    if (!items.length) {
      rows.push([
        date,
        sale.receipt_number ?? sale.id ?? "",
        "Sin detalle disponible",
        "",
        "",
        "",
        "",
        methodLabel(sale.payment_method),
        Number(sale.total || 0).toFixed(2),
        sale.status || "completada"
      ]);

      return;
    }

    items.forEach((item) => {
      rows.push([
        date,
        sale.receipt_number ?? sale.id ?? "",
        item.product_name_snapshot || "Producto",
        item.sku_snapshot || "",
        Number(item.quantity || 0),
        Number(item.unit_price || 0).toFixed(2),
        Number(item.line_total || 0).toFixed(2),
        methodLabel(sale.payment_method),
        Number(sale.total || 0).toFixed(2),
        sale.status || "completada"
      ]);
    });
  });

  const csv = "\uFEFF" + rows.map((row) =>
    row.map((value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`
    ).join(",")
  ).join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `smok-game-ventas-${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* REGISTRO DE VENTAS: se mantiene la función RPC existente. */
$("#complete-sale").addEventListener("click", async () => {
  if (!selectedProduct) {
    return showMessage("Selecciona un producto válido.");
  }

  const quantity = Number.parseInt(qtyEl.value || "0", 10);

  if (!Number.isInteger(quantity) || quantity < 1) {
    return showMessage("La cantidad debe ser al menos 1.");
  }

  if (quantity > Number(selectedProduct.stock)) {
    return showMessage("No hay existencias suficientes.");
  }

  const total =
    Number(selectedProduct.sale_price || 0) * quantity;

  const method = paymentEl.value;
  const received = Number(receivedEl.value || 0);

  if (method === "efectivo" && received < total) {
    return showMessage(
      "El importe recibido no alcanza el total."
    );
  }

  const button = $("#complete-sale");
  button.disabled = true;
  button.textContent = "Registrando…";

  try {
    const { data: shift, error: shiftError } = await supabase
      .from("cash_shifts")
      .select("id")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();

    if (shiftError) throw shiftError;

    if (!shift) {
      throw new Error(
        "No hay una caja abierta. Solicita al administrador que abra la caja."
      );
    }

    const payload = {
      p_items: [{
        product_id: selectedProduct.id,
        quantity
      }],
      p_payment_method: method,
      p_cash_received: method === "efectivo" ? received : null,
      p_shift_id: shift.id
    };

    const { error } = await supabase.rpc(
      "create_sale",
      payload
    );

    if (error) throw error;

    showMessage(
      `Venta registrada. Cambio: ${money(
        method === "efectivo" ? received - total : 0
      )}.`,
      "ok"
    );

    searchEl.value = "";
    qtyEl.value = "1";
    receivedEl.value = "";
    selectedProduct = null;

    $("#unit-price").value = money(0);

    await Promise.all([
      loadProducts(),
      loadHistory()
    ]);

    updateSummary();
  } catch (error) {
    console.error("Error registrando venta:", error);

    showMessage(
      error?.message || "No se pudo registrar la venta."
    );
  } finally {
    button.disabled = false;
    button.textContent = "Confirmar venta";
  }
});

await Promise.all([
  loadProducts(),
  loadHistory()
]);

updateSummary();
