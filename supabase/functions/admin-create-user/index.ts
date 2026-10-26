import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const permissionKeys = new Set([
"dashboard.view","sales.create","sales.view_own","sales.view_all","sales.view_cost","sales.view_profit","sales.discount","sales.returns","sales.void",
"inventory.view","inventory.create_product","inventory.edit_product","inventory.change_price","inventory.view_cost","inventory.stock_in","inventory.adjust","inventory.movements","inventory.delete_product",
"cash.view","cash.open","cash.income","cash.withdraw","cash.movements","cash.close","cash.reconcile","cash.view_closures","cash.approve_difference",
"reports.daily","reports.sales","reports.by_user","reports.inventory","reports.cash","reports.export"
]);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...corsHeaders,"Content-Type":"application/json"}});
  if (req.method !== "POST") return json({error:"Método no permitido."},405);
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader=req.headers.get("Authorization");
  if(!authHeader) return json({error:"Sesión requerida."},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user) return json({error:"Sesión inválida."},401);
  const adminClient=createClient(url,service);
  const {data:adminProfile,error:adminError}=await adminClient.from("profiles").select("role,is_active").eq("id",user.id).single();
  if(adminError||adminProfile?.role!=="admin"||!adminProfile.is_active) return json({error:"Solo el administrador puede crear usuarios."},403);
  let body;
  try { body=await req.json(); } catch { return json({error:"Solicitud inválida."},400); }
  const action=String(body.action||"create");
  if(action==="set-active"){
    const userId=String(body.user_id||"");
    const active=body.is_active===true;
    const {data:target}=await adminClient.from("profiles").select("id,role").eq("id",userId).single();
    if(!target||target.role==="admin") return json({error:"No se puede modificar esta cuenta."},400);
    const {error}=await adminClient.from("profiles").update({is_active:active}).eq("id",userId);
    if(error)return json({error:"No se pudo actualizar el estado."},500);
    await adminClient.from("audit_log").insert({actor_id:user.id,action:active?"user.activated":"user.deactivated",entity_type:"profile",entity_id:userId});
    return json({ok:true});
  }
  const permissions=Array.isArray(body.permissions)?body.permissions:[];
  if(action==="update-permissions"){
    const userId=String(body.user_id||"");
    const {data:target}=await adminClient.from("profiles").select("id,role").eq("id",userId).single();
    if(!target||target.role==="admin") return json({error:"No se puede modificar esta cuenta."},400);
    if(permissions.some((p:string)=>!permissionKeys.has(p))) return json({error:"La lista contiene permisos no válidos."},400);
    const {error:deleteError}=await adminClient.from("user_permissions").delete().eq("user_id",userId);
    if(deleteError)return json({error:"No se pudieron actualizar los permisos."},500);
    if(permissions.length){
      const {error:insertError}=await adminClient.from("user_permissions").insert(permissions.map((permission_key:string)=>({user_id:userId,permission_key})));
      if(insertError)return json({error:"No se pudieron guardar los permisos."},500);
    }
    await adminClient.from("audit_log").insert({actor_id:user.id,action:"user.permissions_updated",entity_type:"profile",entity_id:userId,details:{permissions}});
    return json({ok:true});
  }
  const username=String(body.username||"").trim().toLowerCase(), fullName=String(body.full_name||"").trim(), password=String(body.password||"");
  if(!/^[a-z0-9._-]{3,32}$/.test(username)) return json({error:"El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo."},400);
  if(!fullName) return json({error:"El nombre completo es obligatorio."},400);
  if(password.length<10) return json({error:"La contraseña debe tener al menos 10 caracteres."},400);
  if(permissions.some((p:string)=>!permissionKeys.has(p))) return json({error:"La lista contiene permisos no válidos."},400);
  const email=`${username}@login.smokgame.invalid`;
  const {data:created,error:createError}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username,full_name:fullName}});
  if(createError) return json({error:createError.message.includes("already been registered")?"Ese nombre de usuario ya existe.":createError.message},400);
  const {error:profileError}=await adminClient.from("profiles").insert({id:created.user.id,username,full_name:fullName,role:"worker",is_active:true});
  if(profileError){await adminClient.auth.admin.deleteUser(created.user.id);return json({error:"No se pudo crear el perfil del trabajador."},500);}
  if(permissions.length){
    const rows=permissions.map((permission_key:string)=>({user_id:created.user.id,permission_key}));
    const {error:permError}=await adminClient.from("user_permissions").insert(rows);
    if(permError){await adminClient.auth.admin.deleteUser(created.user.id);return json({error:"No se pudieron asignar los permisos."},500);}
  }
  await adminClient.from("audit_log").insert({actor_id:user.id,action:"user.created",entity_type:"profile",entity_id:created.user.id,details:{username,permissions}});
  return json({ok:true,user_id:created.user.id,username});
});
