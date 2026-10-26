import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
export const usernameToEmail = username => `${String(username).trim().toLowerCase()}@login.smokgame.invalid`;
export const money = value => new Intl.NumberFormat("es-BO",{style:"currency",currency:"BOB"}).format(Number(value||0));
export async function requireSession(requiredPermission=null) {
  const {data:{session}} = await supabase.auth.getSession();
  if (!session) { location.replace("login.html"); return null; }
  const {data:profile,error} = await supabase.from("profiles").select("id,username,full_name,role,is_active").eq("id",session.user.id).single();
  if (error || !profile || !profile.is_active) { await supabase.auth.signOut(); location.replace("login.html"); return null; }
  if (requiredPermission && profile.role !== "admin") {
    const {data:allowed} = await supabase.rpc("has_permission", {permission_key: requiredPermission});
    if (!allowed) { location.replace("app.html"); return null; }
  }
  return {session,profile};
}
export async function hasPermission(profile, permission) {
  if (profile.role === "admin") return true;
  const {data,error} = await supabase.rpc("has_permission", {permission_key:permission});
  return !error && data === true;
}
