import {
  supabase,
  requireSession,
  hasPermission,
  money
} from "./supabase.js";

const auth = await requireSession("cash.view");
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = selector => document.querySelector(selector);
const isAdmin = profile.role === "admin";

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#cash-user").textContent =
  profile.full_name || profile.username || "Usuario";

$("#cash-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

let shift = null;

const canOpen =
  isAdmin || await hasPermission(profile, "cash.open");

const canMove =
  isAdmin ||
  await hasPermission(profile, "cash.income") ||
  await hasPermission(profile, "cash.withdraw");

const canClose =
  isAdmin || await hasPermission(profile, "cash.close");

const canReconcile =
  isAdmin || await hasPermission(profile, "cash.reconcile");

function message(id, text, ok = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = text;
  element.className =
    `cash-message ${ok ? "cash-positive" : "cash-negative"}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-BO");
}

function formatUser(name, id) {
  if (name && String(name).trim()) {
    return String(name).trim();
  }

  return id ? "Usuario sin nombre" : "No registrado";
}

function setFormPermissions() {
  $("#cash-open-form")
    .querySelectorAll("input, button")
    .forEach(element => {
      element.disabled = !canOpen || Boolean(shift);
    });

  $("#cash-movement-form")
    .querySelectorAll("input, select, button")
    .forEach(element => {
      element.disabled = !canMove || !shift;
    });

  $("#cash-close-form")
    .querySelectorAll("input, textarea, button")
    .forEach(element => {
      element.disabled =
        !(canClose || canReconcile) || !shift;
    });

  $("#cash-open-btn").textContent =
    shift ? "Caja abierta" : "Abrir caja";

  $("#cash-open-btn").disabled =
    !canOpen || Boolean(shift);

  const expectedCard =
    $("#cash-expected")?.closest(".cash-card");

  if (expectedCard) {
    expectedCard.hidden = !isAdmin;
  }

  const closuresSection =
    $("#cash-closures")?.closest("section");

  if (closuresSection) {
    closuresSection.hidden = !isAdmin;
  }
}

async function loadShift() {
  let query = supabase
    .from("cash_shifts")
    .select(
      "id,cash_register_id,opened_by,opened_at,opening_amount,status,notes"
    )
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1);


  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  shift = data || null;

  $("#cash-status-title").textContent = shift
    ? `Caja abierta desde ${formatDate(shift.opened_at)}`
    : "Caja cerrada";

  $("#cash-opening").textContent =
    money(Number(shift?.opening_amount ?? 0));

  setFormPermissions();
}

async function loadSalesTotals() {
  if (!shift) {
    $("#cash-sales").textContent = money(0);
    $("#cash-qr").textContent = money(0);

    if (isAdmin) {
      $("#cash-expected").textContent = money(0);
    }

    return;
  }

  const [
    { data: sales, error: salesError },
    { data: movements, error: movementsError }
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("total,payment_method,status")
      .eq("shift_id", shift.id)
      .eq("status", "completed"),

    supabase
      .from("cash_movements")
      .select("movement_type,payment_method,amount")
      .eq("shift_id", shift.id)
  ]);

  if (salesError) throw salesError;
  if (movementsError) throw movementsError;

  const completedSales = sales || [];
  const cashMovements = movements || [];

  const cashSales = completedSales
    .filter(sale =>
      String(sale.payment_method || "").toLowerCase() === "efectivo"
    )
    .reduce(
      (total, sale) => total + Number(sale.total || 0),
      0
    );

  const qrSales = completedSales
    .filter(sale =>
      String(sale.payment_method || "").toLowerCase() === "qr"
    )
    .reduce(
      (total, sale) => total + Number(sale.total || 0),
      0
    );

  $("#cash-sales").textContent = money(cashSales);
  $("#cash-qr").textContent = money(qrSales);

  if (isAdmin) {
    const cashIncome = cashMovements
      .filter(movement =>
        movement.payment_method === "efectivo" &&
        movement.movement_type === "income"
      )
      .reduce(
        (total, movement) => total + Number(movement.amount || 0),
        0
      );

    const cashWithdrawals = cashMovements
      .filter(movement =>
        movement.payment_method === "efectivo" &&
        movement.movement_type === "withdrawal"
      )
      .reduce(
        (total, movement) => total + Number(movement.amount || 0),
        0
      );

    const expectedCash =
      Number(shift.opening_amount || 0) +
      cashSales +
      cashIncome -
      cashWithdrawals;

    $("#cash-expected").textContent = money(expectedCash);
  }
}

async function loadMovements() {
  const body = $("#cash-movements");

  if (!shift) {
    body.innerHTML =
      '<tr><td colspan="5">No hay una caja abierta.</td></tr>';
    return;
  }

  const { data, error } = await supabase
    .from("cash_movements")
    .select(
      "created_at,movement_type,payment_method,amount,note"
    )
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const movements = data || [];

  body.innerHTML = movements.length
    ? movements.map(movement => `
        <tr>
          <td>${escapeHtml(formatDate(movement.created_at))}</td>
          <td>${escapeHtml(movement.movement_type)}</td>
          <td>${escapeHtml(movement.payment_method || "—")}</td>
          <td>${escapeHtml(money(movement.amount))}</td>
          <td>${escapeHtml(movement.note || "—")}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="5">Todavía no hay movimientos.</td></tr>';
}

async function loadClosures() {
  const body = $("#cash-closures");
  if (!body) return;

  if (!isAdmin) {
    body.innerHTML =
      '<tr><td colspan="8">Historial reservado para administración.</td></tr>';
    return;
  }

  const { data, error } = await supabase
    .from("admin_cash_closures")
    .select(`
      opened_by,
      opened_by_name,
      opened_at,
      opening_amount,
      closed_by,
      closed_by_name,
      closed_at,
      expected_cash,
      counted_cash,
      difference,
      status
    `)
    .order("closed_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  body.innerHTML = data?.length
    ? data.map(closure => `
        <tr>
          <td>${escapeHtml(formatDate(closure.opened_at))}</td>
          <td>${escapeHtml(formatUser(
            closure.opened_by_name,
            closure.opened_by
          ))}</td>
          <td>${escapeHtml(money(closure.opening_amount))}</td>
          <td>${escapeHtml(formatDate(closure.closed_at))}</td>
          <td>${escapeHtml(formatUser(
            closure.closed_by_name,
            closure.closed_by
          ))}</td>
          <td>${escapeHtml(money(closure.expected_cash))}</td>
          <td>${escapeHtml(money(closure.counted_cash))}</td>
          <td>${escapeHtml(money(closure.difference))}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="8">Todavía no hay cierres registrados.</td></tr>';
}

async function refresh() {
  try {
    await loadShift();

    await Promise.all([
      loadSalesTotals(),
      loadMovements(),
      loadClosures()
    ]);
  } catch (error) {
    console.error("Error actualizando caja:", error);

    message(
      "#cash-movement-message",
      `Error al cargar caja: ${error.message}`
    );
  }
}

// APERTURA DE CAJA
$("#cash-open-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!canOpen) {
    return message(
      "#cash-movement-message",
      "No tienes permiso para abrir caja."
    );
  }

  if (shift) {
    return message(
      "#cash-movement-message",
      "Ya tienes un turno abierto."
    );
  }

  const amount = Number($("#opening-amount").value);
  const note = $("#opening-note").value.trim();

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    Math.round(amount * 100) !== amount * 100
  ) {
    return message(
      "#cash-movement-message",
      "El fondo inicial debe ser válido y tener como máximo dos decimales."
    );
  }

  const button = $("#cash-open-btn");
  button.disabled = true;

  try {
    const { error } = await supabase.rpc("open_cash_shift", {
      p_opening_amount: amount,
      p_note: note || null
    });

    if (error) throw error;

    $("#opening-amount").value = "";
    $("#opening-note").value = "";

    message(
      "#cash-movement-message",
      "Caja abierta correctamente.",
      true
    );

    await refresh();
  } catch (error) {
    console.error("Error abriendo caja:", error);

    message(
      "#cash-movement-message",
      `No se pudo abrir la caja: ${error.message}`
    );
  } finally {
    button.disabled = false;
  }
});

// MOVIMIENTOS DE CAJA
$("#cash-movement-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!canMove) {
    return message(
      "#cash-movement-message",
      "No tienes permiso para registrar movimientos."
    );
  }

  if (!shift) {
    return message(
      "#cash-movement-message",
      "Primero debes abrir tu turno."
    );
  }

  const type = $("#movement-type").value;
  const amount = Number($("#movement-amount").value);
  const method = $("#movement-method").value;
  const note = $("#movement-note").value.trim();

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    Math.round(amount * 100) !== amount * 100
  ) {
    return message(
      "#cash-movement-message",
      "El monto debe ser mayor que cero y tener como máximo dos decimales."
    );
  }

  if (!note) {
    return message(
      "#cash-movement-message",
      "Indica el motivo del movimiento."
    );
  }

  if (
    type === "income" &&
    !isAdmin &&
    !await hasPermission(profile, "cash.income")
  ) {
    return message(
      "#cash-movement-message",
      "No tienes permiso para registrar ingresos."
    );
  }

  if (
    type === "withdrawal" &&
    !isAdmin &&
    !await hasPermission(profile, "cash.withdraw")
  ) {
    return message(
      "#cash-movement-message",
      "No tienes permiso para registrar retiros."
    );
  }

  const { error } = await supabase
    .from("cash_movements")
    .insert({
      shift_id: shift.id,
      movement_type: type,
      amount,
      payment_method: method,
      note,
      created_by: profile.id
    });

  if (error) {
    return message(
      "#cash-movement-message",
      `No se pudo registrar: ${error.message}`
    );
  }

  $("#movement-amount").value = "";
  $("#movement-note").value = "";

  message(
    "#cash-movement-message",
    "Movimiento registrado correctamente.",
    true
  );

  await refresh();
});

// CIERRE Y ARQUEO
$("#cash-close-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!canClose && !canReconcile) {
    return message(
      "#cash-close-message",
      "No tienes permiso para cerrar caja."
    );
  }

  if (!shift) {
    return message(
      "#cash-close-message",
      "No hay un turno abierto."
    );
  }

  const counted = Number($("#counted-cash").value);
  const note = $("#close-note").value.trim();

  if (
    !Number.isFinite(counted) ||
    counted < 0 ||
    Math.round(counted * 100) !== counted * 100
  ) {
    return message(
      "#cash-close-message",
      "Introduce un importe válido, con un máximo de dos decimales."
    );
  }

  if (!confirm(
    `Vas a declarar ${money(counted)} como efectivo contado.\n\n` +
    "Supabase registrará el arqueo y cerrará el turno.\n\n" +
    "¿Deseas continuar?"
  )) return;

  const button = $("#cash-close-btn");
  if (button) button.disabled = true;

  try {
    const { error } = await supabase.rpc("close_cash_shift", {
      p_shift_id: shift.id,
      p_counted_cash: counted,
      p_note: note || null
    });

    if (error) throw error;

    $("#counted-cash").value = "";
    $("#close-note").value = "";

    message(
      "#cash-close-message",
      "Efectivo declarado y cierre registrados correctamente.",
      true
    );

    await refresh();
  } catch (error) {
    console.error("Error cerrando caja:", error);

    message(
      "#cash-close-message",
      `No se pudo cerrar la caja: ${error.message}`
    );
  } finally {
    if (button) button.disabled = false;
  }
});

$("#cash-refresh").addEventListener("click", refresh);

await refresh();
