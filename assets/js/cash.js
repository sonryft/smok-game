import {
  supabase,
  requireSession,
  hasPermission,
  money
} from "./supabase.js";

const auth = await requireSession("cash.view");
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = (selector) => document.querySelector(selector);
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
let canOpen = isAdmin ||
  await hasPermission(profile, "cash.open");

let canMove = isAdmin ||
  await hasPermission(profile, "cash.income") ||
  await hasPermission(profile, "cash.withdraw");

let canClose = isAdmin ||
  await hasPermission(profile, "cash.close");

let canReconcile = isAdmin ||
  await hasPermission(profile, "cash.reconcile");

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
      element.disabled = !canClose || !shift;
    });

  $("#cash-open-btn").textContent =
    shift ? "Caja abierta" : "Abrir caja";

  $("#cash-open-btn").disabled =
    !canOpen || Boolean(shift);

  // La vista del vendedor no debe mostrar importes de arqueo.
  const expectedCard = $("#cash-expected")?.closest(".cash-card");
  if (expectedCard) {
    expectedCard.hidden = !isAdmin;
  }

  const closuresSection = $("#cash-closures")?.closest("section");
  if (closuresSection) {
    closuresSection.hidden = !isAdmin;
  }
}

async function loadShift() {
  /*
   * No utilizamos select("*").
   * Solicitamos únicamente campos necesarios para el turno abierto.
   *
   * IMPORTANTE: esto reduce los datos solicitados desde la interfaz,
   * pero la protección definitiva de las columnas debe configurarse
   * también en Supabase.
   */
  let query = supabase
    .from("cash_shifts")
    .select("id,cash_register_id,opened_by,opened_at,opening_amount,status,notes")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1);

  // Un vendedor solo busca su propio turno.
  if (!isAdmin) {
    query = query.eq("opened_by", profile.id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  shift = data || null;

  $("#cash-status-title").textContent = shift
    ? `Caja abierta desde ${new Date(shift.opened_at).toLocaleString("es-BO")}`
    : "Caja cerrada";

  $("#cash-opening").textContent =
    money(shift?.opening_amount || 0);

  const expectedElement = $("#cash-expected");
  if (expectedElement) {
    expectedElement.textContent = isAdmin
      ? "Consulta el arqueo al cerrar la caja"
      : "Reservado para administración";
  }

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

  /*
   * Se filtra por shift_id para evitar incluir ventas
   * de otros turnos.
   */
  const { data: sales, error } = await supabase
    .from("sales")
    .select("total,payment_method,status")
    .eq("shift_id", shift.id)
    .eq("status", "completed");

  if (error) throw error;

  const completed = sales || [];

  const cashSales = completed
    .filter(sale => sale.payment_method === "efectivo")
    .reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

  const qrSales = completed
    .filter(sale => sale.payment_method === "qr")
    .reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

  $("#cash-sales").textContent = money(cashSales);
  $("#cash-qr").textContent = money(qrSales);

  /*
   * No calculamos ni mostramos el efectivo esperado aquí.
   * El cálculo oficial se realiza en Supabase al cerrar.
   */
  if (isAdmin) {
    $("#cash-expected").textContent =
      "Se calcula al cerrar el turno";
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
    .select("created_at,movement_type,payment_method,amount,note")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const movements = data || [];

  body.innerHTML = movements.length
    ? movements.map(movement => `
        <tr>
          <td>${escapeHtml(
            new Date(movement.created_at).toLocaleString("es-BO")
          )}</td>
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

  // No solicitamos el historial confidencial al cargar la página
  // de un vendedor.
  if (!isAdmin) {
    body.innerHTML =
      '<tr><td colspan="6">Historial reservado para administración.</td></tr>';
    return;
  }

  const { data, error } = await supabase
    .from("cash_shifts")
    .select("opened_at,closed_at,expected_cash,counted_cash,difference,status")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  body.innerHTML = data?.length
    ? data.map(closure => `
        <tr>
          <td>${escapeHtml(
            new Date(closure.opened_at).toLocaleString("es-BO")
          )}</td>
          <td>${escapeHtml(
            new Date(closure.closed_at).toLocaleString("es-BO")
          )}</td>
          <td>${escapeHtml(money(closure.expected_cash))}</td>
          <td>${escapeHtml(money(closure.counted_cash))}</td>
          <td>${escapeHtml(money(closure.difference))}</td>
          <td>${escapeHtml(closure.status || "Cerrada")}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="6">Todavía no hay cierres registrados.</td></tr>';
}

async function refresh() {
  try {
    await loadShift();
    await loadSalesTotals();

    await Promise.all([
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
      "Ya existe un turno abierto para tu usuario."
    );
  }

  const amount = Number($("#opening-amount").value);

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isInteger(amount * 100)
  ) {
    return message(
      "#cash-movement-message",
      "El fondo inicial debe ser válido y tener como máximo dos decimales."
    );
  }

  const { data: register, error: registerError } = await supabase
    .from("cash_registers")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (registerError) {
    return message(
      "#cash-movement-message",
      registerError.message
    );
  }

  if (!register) {
    return message(
      "#cash-movement-message",
      "No hay una caja activa configurada."
    );
  }

  const { data: newShift, error } = await supabase
    .from("cash_shifts")
    .insert({
      cash_register_id: register.id,
      opened_by: profile.id,
      opening_amount: amount,
      status: "open",
      notes: $("#opening-note").value.trim() || null
    })
    .select("id,cash_register_id,opened_by,opened_at,opening_amount,status,notes")
    .single();

  if (error) {
    return message(
      "#cash-movement-message",
      `No se pudo abrir la caja: ${error.message}`
    );
  }

  shift = newShift;
  $("#opening-note").value = "";

  message(
    "#cash-movement-message",
    "Caja abierta correctamente.",
    true
  );

  await refresh();
});

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
    !Number.isInteger(amount * 100)
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
    !Number.isInteger(counted * 100)
  ) {
    return message(
      "#cash-close-message",
      "Introduce un importe válido, con un máximo de dos decimales."
    );
  }

  const confirmed = confirm(
    `Vas a declarar ${money(counted)} como efectivo contado.\n\n` +
    "Supabase registrará el arqueo y cerrará el turno.\n" +
    "No se mostrará la diferencia en esta pantalla.\n\n" +
    "¿Deseas continuar?"
  );

  if (!confirmed) return;

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
      "El efectivo declarado quedó registrado y el turno se cerró correctamente.",
      true
    );

    await refresh();
  } catch (error) {
    console.error("Error al cerrar caja:", error);

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
