import { supabase, usernameToEmail } from "./supabase.js";

const form = document.querySelector("#login-form");
const errorBox = document.querySelector("#login-error");

// Obtener el perfil y comprobar que la cuenta esté activa.
async function getActiveProfile(userId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, is_active")
    .eq("id", userId)
    .single();

  if (error || !profile || !profile.is_active) {
    return null;
  }

  return profile;
}

// Redirigir según el rol del usuario.
function redirectByRole(profile) {
  if (profile.role === "admin") {
    location.replace("app.html");
    return;
  }

  if (profile.role === "worker") {
    location.replace("vendedor.html");
    return;
  }

  supabase.auth.signOut().then(() => {
    errorBox.textContent = "Tu cuenta no tiene un rol autorizado.";
  });
}

// Comprobar si ya existe una sesión.
const {
  data: { session }
} = await supabase.auth.getSession();

if (session) {
  const profile = await getActiveProfile(session.user.id);

  if (profile) {
    redirectByRole(profile);
  } else {
    await supabase.auth.signOut();
  }
}

// Procesar el inicio de sesión.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  errorBox.textContent = "";

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Ingresando…";

  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password
    });

    if (error) {
      errorBox.textContent = "Usuario o contraseña incorrectos.";
      return;
    }

    const profile = await getActiveProfile(data.user.id);

    if (!profile) {
      await supabase.auth.signOut();

      errorBox.textContent =
        "La cuenta está desactivada o no tiene un perfil configurado.";

      return;
    }

    if (profile.role !== "admin" && profile.role !== "worker") {
      await supabase.auth.signOut();

      errorBox.textContent =
        "Tu cuenta no tiene un rol autorizado.";

      return;
    }

    redirectByRole(profile);

  } catch (error) {
    console.error("Error al iniciar sesión:", error);

    errorBox.textContent =
      "No se pudo iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.";

  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Entrar";
  }
});
