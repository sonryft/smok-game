import {
  supabase,
  requireSession,
  hasPermission,
  money
} from "./supabase.js";

const auth = await requireSession();
if (!auth) throw new Error("Sesión requerida");

const { profile } = auth;
const $ = (selector) => document.querySelector(selector);

document.documentElement.dataset.theme =
  localStorage.getItem("smok-theme") || "carbon";

$("#current-user").textContent = profile.full_name || profile.username;

$("#logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("login.html");
});

const sections = ["dashboard", "cash", "inventory", "reports", "settings"];

function showSection(name) {
  if (!sections.includes(name)) name = "dashboard";

  document.querySelectorAll(".content-section").forEach((el) => {
    el.classList.add("hidden");
  });

  const section = $(`#section-${name}`);
  if (section) section.classList.remove("hidden");

  $("#page-title").textContent = {
    dashboard: "Resumen",
    cash: "Caja y arqueo",
    inventory: "Inventario",
    reports: "Reportes",
    settings: "Configuración"
  }[name];

  document.querySelectorAll("#main-nav a,[data-section='settings']")
    .forEach((a) => {
      a.classList.toggle("active", a.dataset.section === name);
    });
}

document.querySelectorAll(
  "#main-nav a[href*='#'],.sidebar-bottom a[href*='#']"
).forEach((a) => {
  a.addEventListener("click", (e) => {
    const name = a.dataset.section;
    if (!name || name === "sales") return;

    e.preventDefault();
    history.replaceState(null, "", `#${name}`);
    showSection(name);
  });
});

showSection(location.hash.slice(1) || "dashboard");

const isAdmin = profile.role === "admin";

if (!isAdmin) {
  const settingsLink = $("[data-section='settings']");
  if (settingsLink) settingsLink.classList.add("hidden");

  for (const [section, permission] of [
    ["cash", "cash.view"],
    ["inventory", "inventory.view"],
    ["reports", "reports.view"]
  ]) {
    if (!await hasPermission(profile, permission)) {
      const link = $(`[data-section="${section}"]`);
      if (link) link.classList.add("hidden");
    }
  }

  if (!await hasPermission(profile, "dashboard.view")) {
    const link = $('[data-section="dashboard"]');
    if (link) link.classList.add("hidden");
  }
}

async function loadDashboard() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const { data: sales } = await supabase
    .from("sales")
    .select("id,total,status,created_at")
    .gte("created_at", start.toISOString())
    .eq("status", "completed");

  const { count: products } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  $("#metric-sales").textContent = money(
    (sales || []).reduce((sum, sale) => sum + Number(sale.total), 0)
  );

  $("#metric-count").textContent = (sales || []).length;
  $("#metric-products").textContent = products || 0;

  const { data: shift } = await supabase
    .from("cash_shifts")
    .select("id,status")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  $("#metric-cash").textContent = shift ? "Abierta" : "Cerrada";

  const { data: recent } = await supabase
    .from("sales")
    .select("id,total,payment_method,created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  $("#recent-activity").innerHTML = recent?.length
    ? `<div class="table-wrap"><table>
        <thead><tr>
          <th>Fecha</th><th>Venta</th><th>Pago</th><th>Total</th>
        </tr></thead>
        <tbody>${recent.map((sale) => `
          <tr>
            <td>${new Date(sale.created_at).toLocaleString("es-BO")}</td>
            <td>${String(sale.id).slice(0, 8)}</td>
            <td>${escapeHtml(sale.payment_method)}</td>
            <td>${money(sale.total)}</td>
          </tr>
        `).join("")}</tbody>
      </table></div>`
    : "Todavía no hay ventas registradas.";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

await loadDashboard();

document.querySelectorAll(".theme-option").forEach((button) => {
  button.classList.toggle(
    "selected",
    button.dataset.theme === document.documentElement.dataset.theme
  );

  button.addEventListener("click", () => {
    localStorage.setItem("smok-theme", button.dataset.theme);
    document.documentElement.dataset.theme = button.dataset.theme;

    document.querySelectorAll(".theme-option").forEach((item) => {
      item.classList.toggle("selected", item === button);
    });
  });
});

const permLabels = {
  "sales.create": "Registrar ventas",
  "sales.view_own": "Consultar ventas propias",
  "sales.view_all": "Consultar todas las ventas",
  "sales.view_cost": "Consultar costos",
  "sales.view_profit": "Consultar ganancias",
  "sales.discount": "Aplicar descuentos",
  "sales.returns": "Gestionar devoluciones",
  "sales.void": "Anular ventas",
  "inventory.view": "Consultar inventario",
  "inventory.create_product": "Crear productos",
  "inventory.edit_product": "Editar productos",
  "inventory.change_price": "Modificar precios",
  "inventory.view_cost": "Consultar costos de inventario",
  "inventory.stock_in": "Registrar entradas",
  "inventory.adjust": "Ajustar existencias",
  "inventory.movements": "Consultar movimientos",
  "inventory.delete_product": "Eliminar productos",
  "cash.view": "Consultar estado de caja",
  "cash.open": "Abrir caja",
  "cash.income": "Registrar ingresos",
  "cash.withdraw": "Registrar retiros",
  "cash.movements": "Consultar movimientos de caja",
  "cash.close": "Registrar cierre de caja",
  "cash.reconcile": "Realizar arqueo",
  "cash.view_closures": "Consultar cierres anteriores",
  "cash.approve_difference": "Autorizar diferencias",
  "reports.daily": "Consultar resumen diario",
  "reports.sales": "Consultar ventas por período",
  "reports.by_user": "Consultar ventas por usuario",
  "reports.inventory": "Consultar reportes de inventario",
  "reports.cash": "Consultar reportes de caja",
  "reports.export": "Exportar reportes",
  "dashboard.view": "Consultar resumen"
};

const permissionList = $("#permission-list");

permissionList.innerHTML = Object.entries(permLabels)
  .map(([key, label]) => `
    <label class="permission-item">
      <input type="checkbox" name="permissions" value="${key}">
      <span>${label}</span>
    </label>
  `)
  .join("");

if (isAdmin) {
  const form = $("#user-form");
  const formWrap = $("#user-form-wrap");
  const formError = $("#user-form-error");
  const submitButton = form.querySelector('button[type="submit"]');

  const fields = ["full_name", "username", "password"];

  function setCreationFieldsVisible(visible) {
    fields.forEach((name) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;

      const label = input.closest("label");
      if (label) label.classList.toggle("hidden", !visible);

      // Los campos ocultos no deben bloquear la edición de permisos.
      input.required = visible;

      if (!visible) {
        input.setCustomValidity("");
      }
    });
  }

  function resetUserForm() {
    form.reset();
    delete form.dataset.editUserId;

    form.querySelector("h3").textContent = "Nuevo trabajador";
    setCreationFieldsVisible(true);

    submitButton.textContent = "Crear usuario";
    submitButton.disabled = false;
    formError.textContent = "";
    formError.className = "";

    formWrap.classList.add("hidden");
  }

  $("#new-user-btn").addEventListener("click", () => {
    resetUserForm();
    formWrap.classList.remove("hidden");
  });

  $("#cancel-user-btn").addEventListener("click", resetUserForm);

  async function callAdminFunction(payload) {
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    }

    const { SUPABASE_URL, SUPABASE_ANON_KEY } =
      await import("./config.js");

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/admin-create-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error ||
        result.message ||
        `Error del servidor (${response.status}).`
      );
    }

    return result;
  }

  async function loadUsers() {
    const wrap = $("#users-table-wrap");
    wrap.textContent = "Cargando usuarios…";

    const { data, error } = await supabase
      .from("profiles")
      .select("id,username,full_name,role,is_active,created_at")
      .order("created_at");

    if (error) {
      wrap.textContent = `No se pudieron cargar los usuarios: ${error.message}`;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${(data || []).map((user) => `
            <tr>
              <td>${escapeHtml(user.full_name || "")}</td>
              <td>${escapeHtml(user.username || "")}</td>
              <td>${user.role === "admin" ? "Administrador" : "Trabajador"}</td>
              <td>${user.is_active ? "Activo" : "Inactivo"}</td>
              <td>
                ${user.role === "admin" ? "—" : `
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button
                      type="button"
                      class="secondary-btn compact"
                      data-edit-user="${user.id}"
                      data-name="${escapeHtml(user.full_name || "")}"
                      data-username="${escapeHtml(user.username || "")}"
                    >Permisos</button>
                    <button
                      type="button"
                      class="secondary-btn compact"
                      data-toggle-user="${user.id}"
                      data-active="${user.is_active}"
                    >${user.is_active ? "Desactivar" : "Activar"}</button>
                  </div>
                `}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll("[data-toggle-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;

        try {
          await callAdminFunction({
            action: "set-active",
            user_id: button.dataset.toggleUser,
            is_active: button.dataset.active !== "true"
          });

          await loadUsers();
        } catch (error) {
          alert(error.message || "No se pudo actualizar el usuario.");
          button.disabled = false;
        }
      });
    });

    wrap.querySelectorAll("[data-edit-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        formError.textContent = "";

        try {
          const userId = button.dataset.editUser;

          const { data: assigned, error } = await supabase
            .from("user_permissions")
            .select("permission_key")
            .eq("user_id", userId);

          if (error) {
            throw new Error(`No se pudieron leer los permisos: ${error.message}`);
          }

          form.reset();
          form.dataset.editUserId = userId;

          form.querySelector("h3").textContent =
            `Permisos: ${button.dataset.name} (@${button.dataset.username})`;

          setCreationFieldsVisible(false);

          form.querySelectorAll('input[name="permissions"]').forEach((checkbox) => {
            checkbox.checked = (assigned || []).some(
              (item) => item.permission_key === checkbox.value
            );
          });

          submitButton.textContent = "Guardar permisos";
          submitButton.disabled = false;
          formWrap.classList.remove("hidden");
        } catch (error) {
          alert(error.message || "No se pudieron cargar los permisos.");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";
    formError.className = "";

    // Evita que required/validación de campos ocultos bloquee el guardado.
    const editing = Boolean(form.dataset.editUserId);
    if (!editing && !form.reportValidity()) return;

    const permissions = [
      ...form.querySelectorAll('input[name="permissions"]:checked')
    ].map((checkbox) => checkbox.value);

    const payload = editing
      ? {
          action: "update-permissions",
          user_id: form.dataset.editUserId,
          permissions
        }
      : {
          username: form.username.value.trim().toLowerCase(),
          full_name: form.full_name.value.trim(),
          password: form.password.value,
          permissions
        };

    submitButton.disabled = true;
    submitButton.textContent = editing ? "Guardando permisos…" : "Creando usuario…";

    try {
      await callAdminFunction(payload);

      resetUserForm();
      await loadUsers();

      alert(
        editing
          ? "Permisos actualizados correctamente."
          : "Usuario creado correctamente."
      );
    } catch (error) {
      formError.textContent = error.message || "No se pudo guardar.";
      formError.className = "error";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = editing ? "Guardar permisos" : "Crear usuario";
    }
  });

  await loadUsers();
} else {
  $("#users-panel")?.classList.add("hidden");
}
