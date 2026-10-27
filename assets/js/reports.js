import { supabase, requireSession, money } from "./supabase.js";

// ========================================
// AUTENTICACIÓN
// ========================================

const auth = await requireSession("reports.view");

if (!auth) {
  throw new Error("Sesión requerida");
}

const { profile } = auth;
const $ = (selector) => document.querySelector(selector);

// ========================================
// ELEMENTOS DEL DOM
// ========================================

const fromEl = $("#date-from");
const toEl = $("#date-to");
const messageEl = $("#report-message");
const exportBtn = $("#export-sales");
const applyBtn = $("#apply-filter");

let salesCache = [];
let busy = false;

// ========================================
// INICIALIZACIÓN VISUAL
// ========================================

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#current-user").textContent =
  profile.full_name || profile.username || "Usuario";

$("#logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

// ========================================
// FUNCIONES AUXILIARES
// ========================================

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function paymentLabel(method) {
  const value = String(method || "").toLowerCase();

  if (value === "efectivo") return "Efectivo";
  if (value === "qr") return "QR";

  return value || "Otro";
}

function dateLabel(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-BO");
}

function setMessage(message, isError = false) {
  if (!messageEl) return;

  messageEl.textContent = message;
  messageEl.classList.toggle("report-error", isError);
}

function showRows(selector, rows, columns, emptyMessage) {
  const tbody = $(selector);

  if (!tbody) {
    console.error(`No se encontró el elemento ${selector}`);
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${columns}" class="report-empty">
          ${escapeHtml(emptyMessage)}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.join("");
}

function localDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDateRange() {
  const from = fromEl.value;
  const to = toEl.value;

  if (!from || !to) {
    throw new Error("Selecciona las fechas inicial y final.");
  }

  if (from > to) {
    throw new Error(
      "La fecha inicial no puede ser posterior a la fecha final."
    );
  }

  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);

  // Incluye todo el día final.
  end.setDate(end.getDate() + 1);

  return {
    from: start.toISOString(),
    to: end.toISOString()
  };
}

// ========================================
// CONSULTAR VENTAS
// ========================================

async function loadSales(range) {
  const { data, error } = await supabase
    .from("sales")
    .select("id,created_at,total,payment_method,status")
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `No se pudieron cargar las ventas: ${error.message}`
    );
  }

  return (data || []).filter(
    (sale) =>
      String(sale.status || "").toLowerCase() === "completed"
  );
}

// ========================================
// CONSULTAR INVENTARIO
// ========================================

async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id,name,stock,min_stock,is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(
      `No se pudo cargar el inventario: ${error.message}`
    );
  }

  return data || [];
}

// ========================================
// HISTORIAL DE CIERRES
// ========================================

async function loadClosures(range) {
  // Solo administración puede consultar los importes del arqueo.
  if (profile.role !== "admin") {
    return [];
  }

  // Usamos la vista administrativa, no la tabla protegida.
  const { data, error } = await supabase
    .from("admin_cash_closures")
    .select(
      "opened_at,closed_at,expected_cash,counted_cash,difference,status"
    )
    .gte("closed_at", range.from)
    .lt("closed_at", range.to)
    .order("closed_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(
      `No se pudo cargar el historial de cierres: ${error.message}`
    );
  }

  return data || [];
}

// ========================================
// RESUMEN DE VENTAS
// ========================================

function renderSales(sales) {
  const total = sales.reduce(
    (sum, sale) => sum + numeric(sale.total),
    0
  );

  const cash = sales
    .filter(
      (sale) =>
        String(sale.payment_method || "").toLowerCase() === "efectivo"
    )
    .reduce((sum, sale) => sum + numeric(sale.total), 0);

  const qr = sales
    .filter(
      (sale) =>
        String(sale.payment_method || "").toLowerCase() === "qr"
    )
    .reduce((sum, sale) => sum + numeric(sale.total), 0);

  $("#total-sales").textContent = money(total);
  $("#sales-count").textContent = String(sales.length);
  $("#cash-sales").textContent = money(cash);
  $("#qr-sales").textContent = money(qr);
}

// ========================================
// INVENTARIO Y STOCK BAJO
// ========================================

function renderProducts(products) {
  $("#product-count").textContent = String(products.length);

  const lowStock = products.filter(
    (product) =>
      numeric(product.stock) <= numeric(product.min_stock)
  );

  $("#low-stock-count").textContent = String(lowStock.length);

  showRows(
    "#low-stock",
    lowStock.map(
      (product) => `
        <tr>
          <td>${escapeHtml(product.name)}</td>
          <td>${numeric(product.stock)}</td>
          <td>${numeric(product.min_stock)}</td>
        </tr>
      `
    ),
    3,
    "No hay productos con stock bajo."
  );
}

// ========================================
// PRODUCTOS MÁS VENDIDOS
// ========================================

async function renderTopProducts(sales) {
  if (!sales.length) {
    showRows(
      "#top-products",
      [],
      3,
      "No hay ventas en este período."
    );
    return;
  }

  const totals = new Map();
  const saleIds = sales.map((sale) => sale.id);

  // Consultar detalles en grupos de 100 ventas.
  for (let index = 0; index < saleIds.length; index += 100) {
    const batch = saleIds.slice(index, index + 100);

    const { data, error } = await supabase
      .from("sale_items")
      .select("*")
      .in("sale_id", batch);

    if (error) {
      throw new Error(
        `No se pudieron cargar los detalles de venta: ${error.message}`
      );
    }

    for (const item of data || []) {
      const productId = String(item.product_id);
      const quantity = numeric(item.quantity);

      const unitPrice = numeric(
        item.unit_price ?? item.sale_price ?? item.price
      );

      const current = totals.get(productId) || {
        id: productId,
        quantity: 0,
        total: 0
      };

      current.quantity += quantity;
      current.total += quantity * unitPrice;

      totals.set(productId, current);
    }
  }

  const productIds = [...totals.keys()];
  let productNames = new Map();

  if (productIds.length) {
    const { data, error } = await supabase
      .from("products")
      .select("id,name")
      .in("id", productIds);

    if (error) {
      throw new Error(
        `No se pudieron consultar los nombres de productos: ${error.message}`
      );
    }

    productNames = new Map(
      (data || []).map((product) => [
        String(product.id),
        product.name
      ])
    );
  }

  const top = [...totals.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  showRows(
    "#top-products",
    top.map(
      (item) => `
        <tr>
          <td>${escapeHtml(
            productNames.get(item.id) || "Producto eliminado"
          )}</td>
          <td>${item.quantity}</td>
          <td>${escapeHtml(money(item.total))}</td>
        </tr>
      `
    ),
    3,
    "No hay productos vendidos en este período."
  );
}

// ========================================
// MOSTRAR HISTORIAL DE CIERRES
// ========================================

function renderClosures(closures) {
  showRows(
    "#cash-closures",
    closures.map(
      (shift) => `
        <tr>
          <td>${escapeHtml(dateLabel(shift.opened_at))}</td>
          <td>${escapeHtml(dateLabel(shift.closed_at))}</td>
          <td>${escapeHtml(money(shift.expected_cash))}</td>
          <td>${escapeHtml(money(shift.counted_cash))}</td>
          <td>${escapeHtml(money(shift.difference))}</td>
        </tr>
      `
    ),
    5,
    profile.role === "admin"
      ? "No hay cierres registrados en este período."
      : "El historial de arqueos está reservado para administración."
  );
}

// ========================================
// CARGAR REPORTE
// ========================================

async function loadReport() {
  if (busy) return;

  busy = true;
  applyBtn.disabled = true;
  exportBtn.disabled = true;

  setMessage("Consultando datos de Supabase…");

  try {
    const range = getDateRange();

    const [sales, products, closures] = await Promise.all([
      loadSales(range),
      loadProducts(),
      loadClosures(range)
    ]);

    salesCache = sales;

    renderSales(sales);
    renderProducts(products);
    renderClosures(closures);

    await renderTopProducts(sales);

    setMessage(
      `Reporte actualizado correctamente: ${sales.length} ventas y ${products.length} productos activos.`
    );

    exportBtn.disabled = sales.length === 0;
  } catch (error) {
    console.error("Error al cargar reportes:", error);

    setMessage(
      error.message || "No se pudo cargar el reporte.",
      true
    );
  } finally {
    busy = false;
    applyBtn.disabled = false;
  }
}

// ========================================
// EXPORTAR VENTAS A CSV
// ========================================

function exportSalesCsv() {
  if (!salesCache.length) {
    setMessage("No hay ventas para exportar.", true);
    return;
  }

  const rows = [
    ["Fecha", "ID de venta", "Método de pago", "Total Bs", "Estado"],

    ...salesCache.map((sale) => [
      sale.created_at
        ? new Date(sale.created_at).toLocaleString("es-BO")
        : "",
      sale.id,
      paymentLabel(sale.payment_method),
      numeric(sale.total).toFixed(2),
      sale.status || ""
    ])
  ];

  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value ?? "").replace(/"/g, '""')}"`
          )
          .join(",")
      )
      .join("\r\n");

  const blob = new Blob(
    [csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `smok-game-reporte-${fromEl.value}-${toEl.value}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ========================================
// INICIALIZACIÓN
// ========================================

const today = new Date();

const firstDay = new Date(
  today.getFullYear(),
  today.getMonth(),
  1
);

fromEl.value = localDateInput(firstDay);
toEl.value = localDateInput(today);

applyBtn.addEventListener("click", loadReport);
exportBtn.addEventListener("click", exportSalesCsv);

await loadReport();
