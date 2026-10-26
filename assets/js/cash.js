import { supabase, requireSession, hasPermission, money } from "./supabase.js";

const auth = await requireSession("cash.view");
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = (s) => document.querySelector(s);
const isAdmin = profile.role === "admin";

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#cash-user").textContent = profile.full_name || profile.username || "Usuario";

$("#cash-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

let shift = null;
let movements = [];
let canOpen = isAdmin || await hasPermission(profile, "cash.open");
let canMove = isAdmin ||
  await hasPermission(profile, "cash.income") ||
  await hasPermission(profile, "cash.withdraw");
let canClose = isAdmin || await hasPermission(profile, "cash.close");
let canReconcile = isAdmin || await hasPermission(profile, "cash.reconcile");

function message(id, text, ok = false) {
  const el = $(id);
  el.textContent = text;
  el.className = `cash-message ${ok ? "cash-positive" : "cash-negative"}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setFormPermissions() {
  $("#cash-open-form").querySelectorAll("input,button").forEach(el => {
    el.disabled = !canOpen || Boolean(shift);
  });

  $("#cash-movement-form").querySelectorAll("input,select,button").forEach(el => {
    el.disabled = !canMove || !shift;
  });

  $("#cash-close-form").querySelectorAll("input,textarea,button").forEach(el => {
    el.disabled = !canClose || !shift;
  });

  $("#cash-open-btn").textContent = shift ? "Caja abierta" : "Abrir caja";
  $("#cash-open-btn").disabled = !canOpen || Boolean(shift);
}

async function loadShift() {
  const { data, error } = await supabase
    .from("cash_shifts")
    .select("*")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  shift = data || null;

  $("#cash-status-title").textContent = shift
    ? `Caja abierta desde ${new Date(shift.opened_at).toLocaleString("es-BO")}`
    : "Caja cerrada";

  $("#cash-opening").textContent = money(shift?.opening_amount || 0);
  $("#cash-expected").textContent = money(shift?.expected_cash || 0);

  setFormPermissions();
}

async function loadSalesTotals() {
  if (!shift) {
    $("#cash-sales").textContent = money(0);
    $("#cash-qr").textContent = money(0);
    $("#cash-expected").textContent = money(0);
    return;
  }

  const { data: sales, error } = await supabase
    .from("sales")
    .select("total,payment_method,status,created_at")
    .eq("status", "completed")
    .gte("created_at", shift.opened_at)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const completed = sales || [];
  const cashSales = completed
    .filter(s => s.payment_method === "efectivo")
    .reduce((sum, s) => sum + Number(s.total || 0), 0);

  const qrSales = completed
    .filter(s => s.payment_method === "qr")
    .reduce((sum, s) => sum + Number(s.total || 0), 0);

  $("#cash-sales").textContent = money(cashSales);
  $("#cash-qr").textContent = money(qrSales);

  const { data: rows, error: movementError } = await supabase
    .from("cash_movements")
    .select("movement_type,amount,payment_method")
    .eq("shift_id", shift.id);

  if (movementError) throw movementError;

  let expected = Number(shift.opening_amount || 0) + cashSales;

  for (const m of rows || []) {
    if (m.payment_method && m.payment_method !== "efectivo") continue;

    const amount = Number(m.amount || 0);
    const type = String(m.movement_type || "").toLowerCase();

    if (["income", "ingreso", "entrada"].includes(type)) {
      expected += amount;
    } else if (["withdrawal", "retiro", "salida", "expense", "gasto"].includes(type)) {
      expected -= amount;
    }
  }

  $("#cash-expected").textContent = money(expected);
}

async function loadMovements() {
  const body = $("#cash-movements");

  if (!shift) {
    body.innerHTML = '<tr><td colspan="5">No hay una caja abierta.</td></tr>';
    return;
  }

  const { data, error } = await supabase
    .from("cash_movements")
    .select("created_at,movement_type,payment_method,amount,note")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  movements = data || [];

  body.innerHTML = movements.length
    ? movements.map(m => `<tr>
        <td>${escapeHtml(new Date(m.created_at).toLocaleString("es-BO"))}</td>
        <td>${escapeHtml(m.movement_type)}</td>
        <td>${escapeHtml(m.payment_method || "—")}</td>
        <td>${escapeHtml(money(m.amount))}</td>
        <td>${escapeHtml(m.note || "—")}</td>
      </tr>`).join("")
    : '<tr><td colspan="5">Todavía no hay movimientos.</td></tr>';
}

async function loadClosures() {
  const body = $("#cash-closures");

  const { data, error } = await supabase
    .from("cash_shifts")
    .select("opened_at,closed_at,expected_cash,counted_cash,difference,status")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  body.innerHTML = data?.length
    ? data.map(c => `<tr>
        <td>${escapeHtml(new Date(c.opened_at).toLocaleString("es-BO"))}</td>
        <td>${escapeHtml(new Date(c.closed_at).toLocaleString("es-BO"))}</td>
        <td>${escapeHtml(money(c.expected_cash))}</td>
        <td>${escapeHtml(money(c.counted_cash))}</td>
        <td>${escapeHtml(money(c.difference))}</td>
        <td>${escapeHtml(c.status || "Cerrada")}</td>
      </tr>`).join("")
    : '<tr><td colspan="6">Todavía no hay cierres registrados.</td></tr>';
}

async function refresh() {
  try {
    await loadShift();
    await loadSalesTotals();
    await Promise.all([loadMovements(), loadClosures()]);
  } catch (error) {
    message("#cash-movement-message", `Error al cargar caja: ${error.message}`);
  }
}

$("#cash-open-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!canOpen) return message("#cash-movement-message", "No tienes permiso para abrir caja.");
  if (shift) return message("#cash-movement-message", "Ya existe una caja abierta.");

  const amount = Number($("#opening-amount").value);
  if (!Number.isFinite(amount) || amount < 0) {
    return message("#cash-movement-message", "El fondo inicial no puede ser negativo.");
  }

  const { data: register, error: registerError } = await supabase
    .from("cash_registers")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (registerError) return message("#cash-movement-message", registerError.message);
  if (!register) return message("#cash-movement-message", "No hay una caja activa configurada en cash_registers.");

  const { data: newShift, error } = await supabase
    .from("cash_shifts")
    .insert({
      cash_register_id: register.id,
      opened_by: profile.id,
      opening_amount: amount,
      status: "open",
      notes: $("#opening-note").value.trim() || null
    })
    .select("*")
    .single();

  if (error) return message("#cash-movement-message", `No se pudo abrir la caja: ${error.message}`);

  shift = newShift;
  $("#opening-note").value = "";
  message("#cash-movement-message", "Caja abierta correctamente.", true);
  await refresh();
});

$("#cash-movement-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!canMove) return message("#cash-movement-message", "No tienes permiso para registrar movimientos.");
  if (!shift) return message("#cash-movement-message", "Primero debes abrir la caja.");

  const type = $("#movement-type").value;
  const amount = Number($("#movement-amount").value);
  const method = $("#movement-method").value;
  const note = $("#movement-note").value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return message("#cash-movement-message", "El monto debe ser mayor que cero.");
  }
  if (!note) return message("#cash-movement-message", "Indica el motivo del movimiento.");
  if (type === "income" && !isAdmin && !await hasPermission(profile, "cash.income")) {
    return message("#cash-movement-message", "No tienes permiso para registrar ingresos.");
  }
  if (type === "withdrawal" && !isAdmin && !await hasPermission(profile, "cash.withdraw")) {
    return message("#cash-movement-message", "No tienes permiso para registrar retiros.");
  }

  const { error } = await supabase.from("cash_movements").insert({
    shift_id: shift.id,
    movement_type: type,
    amount,
    payment_method: method,
    note,
    created_by: profile.id
  });

  if (error) return message("#cash-movement-message", `No se pudo registrar: ${error.message}`);

  $("#movement-amount").value = "";
  $("#movement-note").value = "";
  message("#cash-movement-message", "Movimiento registrado correctamente.", true);
  await refresh();
});

$("#cash-close-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!canClose) return message("#cash-close-message", "No tienes permiso para cerrar caja.");
  if (!shift) return message("#cash-close-message", "No hay una caja abierta.");

  const counted = Number($("#counted-cash").value);
  if (!Number.isFinite(counted) || counted < 0) {
    return message("#cash-close-message", "El efectivo contado no puede ser negativo.");
  }

  await loadSalesTotals();

  const expectedText = $("#cash-expected").textContent;
  const expected = Number(expectedText.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  const difference = counted - expected;
  const note = $("#close-note").value.trim();

  const confirmText =
    `Efectivo esperado: ${money(expected)}\n` +
    `Efectivo contado: ${money(counted)}\n` +
    `Diferencia: ${money(difference)}\n\n` +
    "¿Confirmas el cierre?";

  if (!confirm(confirmText)) return;

  const { error } = await supabase
    .from("cash_shifts")
    .update({
      closed_by: profile.id,
      closed_at: new Date().toISOString(),
      expected_cash: expected,
      counted_cash: counted,
      difference,
      status: "closed",
      notes: [shift.notes, note].filter(Boolean).join("\n") || null
    })
    .eq("id", shift.id)
    .eq("status", "open");

  if (error) return message("#cash-close-message", `No se pudo cerrar la caja: ${error.message}`);

  $("#counted-cash").value = "";
  $("#close-note").value = "";
  message("#cash-close-message", "Arqueo y cierre registrados correctamente.", true);
  await refresh();
});

$("#cash-refresh").addEventListener("click", refresh);

await refresh();
