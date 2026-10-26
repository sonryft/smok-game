# Smok Game — aplicación inicial

Aplicación exclusiva para Smok Game. Frontend estático para GitHub Pages y backend Supabase.

## Incluye
- Pantalla de inicio con animación de logo (reemplazar `assets/logo.svg` por el logo definitivo).
- Inicio de sesión con nombre de usuario y contraseña, sin pedir correo al trabajador.
- Panel adaptable con Resumen, Ventas, Caja y arqueo, Inventario, Reportes, Configuración.
- Pantalla de ventas independiente (`sales.html`) sin menú administrativo.
- SQL inicial para perfiles, permisos, productos, ventas, caja, inventario, devoluciones y auditoría.
- Edge Function para que el administrador cree usuarios de forma segura.

## Antes de publicar
1. Crea un proyecto NUEVO en Supabase llamado `smok-game`.
2. En Supabase > SQL Editor, ejecuta `supabase/schema.sql`.
3. Configura los secretos de la Edge Function `admin-create-user`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (solo como secreto del servidor; nunca en el frontend).
4. Despliega la función `supabase/functions/admin-create-user`.
5. En `assets/js/config.js`, configura el Project URL y la anon/publishable key de Supabase.
6. En Supabase Auth, desactiva la confirmación por correo si el proyecto la tiene activada. Los trabajadores no necesitan correo real: la aplicación transforma sus nombres de usuario en identificadores internos `usuario@login.smokgame.invalid`.
7. Crea la primera cuenta administrativa de forma segura desde Supabase Auth (con un email interno siguiendo el formato anterior y contraseña segura), y añade su perfil en `profiles` con `role='admin'`. No publiques credenciales en el repositorio.
8. Publica el contenido del repositorio en GitHub Pages.

## Importante
- GitHub Pages es público: todo secreto del frontend es visible. Solo usa la clave anon/publishable.
- La seguridad real depende de RLS y de las funciones SQL; ocultar botones no es seguridad.
- El administrador crea cuentas mediante la Edge Function. La contraseña existente no se puede consultar en texto claro; solo se puede restablecer.
- La pantalla de ventas es una página separada y no incluye el menú del panel. La navegación atrás no debe revelar el panel: se protege con comprobación de sesión/permisos y redirección. El navegador no permite bloquear universalmente todos los controles de navegación, pero no se muestra el panel dentro de la pantalla de ventas.
- Este es el punto de partida del proyecto, no una aplicación de producción auditada. Prueba primero con datos ficticios antes de usar dinero real.
