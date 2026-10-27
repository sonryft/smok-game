import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const permissionKeys = new Set([
  "dashboard.view",
  "sales.create",
  "sales.view_own",
  "sales.view_all",
  "sales.view_cost",
  "sales.view_profit",
  "sales.discount",
  "sales.returns",
  "sales.void",
  "inventory.view",
  "inventory.create_product",
  "inventory.edit_product",
  "inventory.change_price",
  "inventory.view_cost",
  "inventory.stock_in",
  "inventory.adjust",
  "inventory.movements",
  "inventory.delete_product",
  "cash.view",
  "cash.open",
  "cash.income",
  "cash.withdraw",
  "cash.movements",
  "cash.close",
  "cash.reconcile",
  "cash.view_closures",
  "cash.approve_difference",
  "reports.daily",
  "reports.sales",
  "reports.by_user",
  "reports.inventory",
  "reports.cash",
  "reports.export",
]);

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido." }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anon || !service) {
    console.error("Falta configurar una variable de entorno de Supabase.");
    return json({ error: "La función no está configurada correctamente." }, 500);
  }

  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return json({ error: "Sesión requerida." }, 401);
  }

  const userClient = createClient(url, anon, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return json({ error: "Sesión inválida." }, 401);
  }

  const adminClient = createClient(url, service);

  const { data: adminProfile, error: adminError } = await adminClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (
    adminError ||
    adminProfile?.role !== "admin" ||
    !adminProfile.is_active
  ) {
    return json({
      error: "Solo un administrador activo puede gestionar usuarios.",
    }, 403);
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }

  const action = String(body.action || "create");

  const permissions: string[] = Array.isArray(body.permissions)
    ? body.permissions.filter(
        (permission): permission is string =>
          typeof permission === "string",
      )
    : [];

  if (
    Array.isArray(body.permissions) &&
    permissions.length !== body.permissions.length
  ) {
    return json({ error: "La lista de permisos no es válida." }, 400);
  }

  if (permissions.some((permission) => !permissionKeys.has(permission))) {
    return json({ error: "La lista contiene permisos no válidos." }, 400);
  }

  // Activar o desactivar un trabajador.
  if (action === "set-active") {
    const userId = String(body.user_id || "");

    if (!userId) {
      return json({ error: "No se especificó el usuario." }, 400);
    }

    const active = body.is_active === true;

    const { data: target, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      return json({ error: "No se pudo verificar el usuario." }, 500);
    }

    if (!target || target.role === "admin") {
      return json({ error: "No se puede modificar esta cuenta." }, 400);
    }

    const { error } = await adminClient
      .from("profiles")
      .update({ is_active: active })
      .eq("id", userId);

    if (error) {
      console.error("Error al cambiar estado:", error);
      return json({ error: "No se pudo actualizar el estado del usuario." }, 500);
    }

    const { error: auditError } = await adminClient.from("audit_log").insert({
      actor_id: user.id,
      action: active ? "user.activated" : "user.deactivated",
      entity_type: "profile",
      entity_id: userId,
    });

    if (auditError) {
      console.error("No se pudo registrar el cambio de estado:", auditError);
    }

    return json({ ok: true, is_active: active });
  }

  // Actualizar permisos de un trabajador usando la función SQL existente.
  if (action === "update-permissions") {
    const userId = String(body.user_id || "");

    if (!userId) {
      return json({ error: "No se especificó el usuario." }, 400);
    }

    const { data: target, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      console.error("Error al verificar el usuario:", targetError);
      return json({ error: "No se pudo verificar el usuario." }, 500);
    }

    if (!target || target.role === "admin") {
      return json({ error: "No se puede modificar esta cuenta." }, 400);
    }

    const { error: permissionError } = await adminClient.rpc(
      "admin_update_user_permissions",
      {
        p_user_id: userId,
        p_permissions: [...new Set(permissions)],
      },
    );

    if (permissionError) {
      console.error("Error al actualizar permisos:", permissionError);

      return json({
        error: `No se pudieron guardar los permisos: ${permissionError.message}`,
      }, 500);
    }

    return json({
      ok: true,
      message: "Permisos actualizados correctamente.",
    });
  }

  // Crear un nuevo trabajador.
  if (action !== "create") {
    return json({ error: "Acción no reconocida." }, 400);
  }

  const username = String(body.username || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const password = String(body.password || "");

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json({
      error:
        "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.",
    }, 400);
  }

  if (!fullName) {
    return json({ error: "El nombre completo es obligatorio." }, 400);
  }

  if (password.length < 10) {
    return json({
      error: "La contraseña debe tener al menos 10 caracteres.",
    }, 400);
  }

  const email = `${username}@login.smokgame.invalid`;

  const {
    data: created,
    error: createError,
  } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      full_name: fullName,
    },
  });

  if (createError || !created.user) {
    console.error("Error al crear usuario:", createError);

    const message = createError?.message || "";

    return json({
      error: message.includes("already been registered")
        ? "Ese nombre de usuario ya existe."
        : message || "No se pudo crear el usuario.",
    }, 400);
  }

  const { error: profileError } = await adminClient
    .from("profiles")
    .insert({
      id: created.user.id,
      username,
      full_name: fullName,
      role: "worker",
      is_active: true,
    });

  if (profileError) {
    console.error("Error al crear perfil:", profileError);
    await adminClient.auth.admin.deleteUser(created.user.id);

    return json({
      error: "No se pudo crear el perfil del trabajador.",
    }, 500);
  }

  if (permissions.length > 0) {
    const rows = [...new Set(permissions)].map((permission_key) => ({
      user_id: created.user.id,
      permission_key,
    }));

    const { error: permissionError } = await adminClient
      .from("user_permissions")
      .insert(rows);

    if (permissionError) {
      console.error("Error al asignar permisos:", permissionError);
      await adminClient.auth.admin.deleteUser(created.user.id);

      return json({
        error: "No se pudieron asignar los permisos iniciales.",
      }, 500);
    }
  }

  const { error: auditError } = await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "user.created",
    entity_type: "profile",
    entity_id: created.user.id,
    details: { username, permissions: [...new Set(permissions)] },
  });

  if (auditError) {
    console.error("No se pudo registrar la creación en auditoría:", auditError);
  }

  return json({
    ok: true,
    user_id: created.user.id,
    username,
  }, 201);
});
