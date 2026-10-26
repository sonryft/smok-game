import {supabase,requireSession,hasPermission,money,usernameToEmail} from "./supabase.js";
const auth=await requireSession();
if(!auth) throw new Error("Sesión requerida");
const {profile}=auth;
document.documentElement.dataset.theme=localStorage.getItem("smok-theme")||"carbon";
document.querySelector("#current-user").textContent=profile.full_name||profile.username;
document.querySelector("#logout-btn").addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("login.html")});
const sections=["dashboard","cash","inventory","reports","settings"];
function showSection(name){
  if(!sections.includes(name)) name="dashboard";
  document.querySelectorAll(".content-section").forEach(el=>el.classList.add("hidden"));
  document.querySelector(`#section-${name}`).classList.remove("hidden");
  document.querySelector("#page-title").textContent=({dashboard:"Resumen",cash:"Caja y arqueo",inventory:"Inventario",reports:"Reportes",settings:"Configuración"})[name];
  document.querySelectorAll("#main-nav a,[data-section='settings']").forEach(a=>a.classList.toggle("active",a.dataset.section===name));
}
document.querySelectorAll("#main-nav a[href*='#'],.sidebar-bottom a[href*='#']").forEach(a=>a.addEventListener("click",e=>{
  const name=a.dataset.section;if(!name||name==="sales")return;e.preventDefault();history.replaceState(null,"",`#${name}`);showSection(name);
}));
showSection(location.hash.slice(1)||"dashboard");
const isAdmin=profile.role==="admin";
if(!isAdmin){
  document.querySelector("[data-section='settings']").classList.add("hidden");
  for(const [section,perm] of [["cash","cash.view"],["inventory","inventory.view"],["reports","reports.view"]]){
    if(!await hasPermission(profile,perm)) document.querySelector(`[data-section="${section}"]`).classList.add("hidden");
  }
  if(!await hasPermission(profile,"dashboard.view")) document.querySelector('[data-section="dashboard"]').classList.add("hidden");
}
async function loadDashboard(){
 const start=new Date();start.setHours(0,0,0,0);
 const {data:sales}=await supabase.from("sales").select("id,total,status,created_at").gte("created_at",start.toISOString()).eq("status","completed");
 const {count:products}=await supabase.from("products").select("*",{count:"exact",head:true}).eq("is_active",true);
 document.querySelector("#metric-sales").textContent=money((sales||[]).reduce((a,s)=>a+Number(s.total),0));
 document.querySelector("#metric-count").textContent=(sales||[]).length;
 document.querySelector("#metric-products").textContent=products||0;
 const {data:shift}=await supabase.from("cash_shifts").select("id,status").eq("status","open").limit(1).maybeSingle();
 document.querySelector("#metric-cash").textContent=shift?"Abierta":"Cerrada";
 const {data:recent}=await supabase.from("sales").select("id,total,payment_method,created_at").order("created_at",{ascending:false}).limit(5);
 document.querySelector("#recent-activity").innerHTML=recent?.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Venta</th><th>Pago</th><th>Total</th></tr></thead><tbody>${recent.map(s=>`<tr><td>${new Date(s.created_at).toLocaleString("es-BO")}</td><td>${String(s.id).slice(0,8)}</td><td>${s.payment_method}</td><td>${money(s.total)}</td></tr>`).join("")}</tbody></table></div>`:"Todavía no hay ventas registradas.";
}
await loadDashboard();
document.querySelectorAll(".theme-option").forEach(btn=>{btn.classList.toggle("selected",btn.dataset.theme===document.documentElement.dataset.theme);btn.addEventListener("click",()=>{localStorage.setItem("smok-theme",btn.dataset.theme);document.documentElement.dataset.theme=btn.dataset.theme;document.querySelectorAll(".theme-option").forEach(b=>b.classList.toggle("selected",b===btn));});});
const permLabels={
"sales.create":"Registrar ventas","sales.view_own":"Consultar ventas propias","sales.view_all":"Consultar todas las ventas","sales.view_cost":"Consultar costos","sales.view_profit":"Consultar ganancias","sales.discount":"Aplicar descuentos","sales.returns":"Gestionar devoluciones","sales.void":"Anular ventas",
"inventory.view":"Consultar inventario","inventory.create_product":"Crear productos","inventory.edit_product":"Editar productos","inventory.change_price":"Modificar precios","inventory.view_cost":"Consultar costos de inventario","inventory.stock_in":"Registrar entradas","inventory.adjust":"Ajustar existencias","inventory.movements":"Consultar movimientos","inventory.delete_product":"Eliminar productos",
"cash.view":"Consultar estado de caja","cash.open":"Abrir caja","cash.income":"Registrar ingresos","cash.withdraw":"Registrar retiros","cash.movements":"Consultar movimientos de caja","cash.close":"Registrar cierre de caja","cash.reconcile":"Realizar arqueo","cash.view_closures":"Consultar cierres anteriores","cash.approve_difference":"Autorizar diferencias",
"reports.daily":"Consultar resumen diario","reports.sales":"Consultar ventas por período","reports.by_user":"Consultar ventas por usuario","reports.inventory":"Consultar reportes de inventario","reports.cash":"Consultar reportes de caja","reports.export":"Exportar reportes","dashboard.view":"Consultar resumen"
};
const permissionList=document.querySelector("#permission-list");
permissionList.innerHTML=Object.entries(permLabels).map(([key,label])=>`<label class="permission-item"><input type="checkbox" name="permissions" value="${key}"><span>${label}</span></label>`).join("");
if(isAdmin){
 document.querySelector("#new-user-btn").addEventListener("click",()=>document.querySelector("#user-form-wrap").classList.remove("hidden"));
 document.querySelector("#cancel-user-btn").addEventListener("click",()=>resetUserForm());
 function resetUserForm(){const form=document.querySelector("#user-form");form.reset();delete form.dataset.editUserId;form.querySelector("h3").textContent="Nuevo trabajador";form.querySelector('[name="full_name"]').closest("label").classList.remove("hidden");form.querySelector('[name="username"]').closest("label").classList.remove("hidden");form.querySelector('[name="password"]').closest("label").classList.remove("hidden");form.querySelector('button[type="submit"]').textContent="Crear usuario";document.querySelector("#user-form-wrap").classList.add("hidden");}
 
 async function loadUsers(){
   const {data,error}=await supabase.from("profiles").select("id,username,full_name,role,is_active,created_at").order("created_at");
   const wrap=document.querySelector("#users-table-wrap");
   if(error){wrap.textContent="No se pudieron cargar los usuarios.";return;}
   wrap.innerHTML=`<table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${(data||[]).map(u=>`<tr><td>${escapeHtml(u.full_name||"")}</td><td>${escapeHtml(u.username||"")}</td><td>${u.role==="admin"?"Administrador":"Trabajador"}</td><td>${u.is_active?"Activo":"Inactivo"}</td><td>${u.role==="admin"?"—":`<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="secondary-btn compact" data-edit-user="${u.id}" data-name="${escapeHtml(u.full_name||"")}" data-username="${escapeHtml(u.username||"")}">Permisos</button><button class="secondary-btn compact" data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active?"Desactivar":"Activar"}</button></div>`}</td></tr>`).join("")}</tbody></table>`;
   wrap.querySelectorAll("[data-toggle-user]").forEach(btn=>btn.addEventListener("click",async()=>{const active=btn.dataset.active==="true";const {data:{session}}=await supabase.auth.getSession();const {SUPABASE_URL,SUPABASE_ANON_KEY}=await import("./config.js");const resp=await fetch(`${SUPABASE_URL}/functions/v1/admin-create-user`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SUPABASE_ANON_KEY},body:JSON.stringify({action:"set-active",user_id:btn.dataset.toggleUser,is_active:!active})});if(!resp.ok){alert("No se pudo actualizar el usuario.");return;}loadUsers();}));
   wrap.querySelectorAll("[data-edit-user]").forEach(btn=>btn.addEventListener("click",async()=>{
     const userId=btn.dataset.editUser;const {data:assigned}=await supabase.from("user_permissions").select("permission_key").eq("user_id",userId);
     document.querySelector("#user-form-wrap").classList.remove("hidden");
     const form=document.querySelector("#user-form");form.dataset.editUserId=userId;
     form.querySelector("h3").textContent=`Permisos: ${btn.dataset.name} (@${btn.dataset.username})`;
     form.querySelector('[name="full_name"]').closest("label").classList.add("hidden");
     form.querySelector('[name="username"]').closest("label").classList.add("hidden");
     form.querySelector('[name="password"]').closest("label").classList.add("hidden");
     form.querySelectorAll('input[name="permissions"]').forEach(cb=>cb.checked=(assigned||[]).some(p=>p.permission_key===cb.value));
     form.querySelector('button[type="submit"]').textContent="Guardar permisos";
   }));
 }
 function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
 document.querySelector("#user-form").addEventListener("submit",async e=>{
   e.preventDefault();const f=e.currentTarget,err=document.querySelector("#user-form-error");err.textContent="";
   const permissions=[...f.querySelectorAll('input[name="permissions"]:checked')].map(x=>x.value);
   const {data:{session}}=await supabase.auth.getSession();
   const {SUPABASE_URL,SUPABASE_ANON_KEY}=await import("./config.js");
   const editing=Boolean(f.dataset.editUserId);
   const payload=editing?{action:"update-permissions",user_id:f.dataset.editUserId,permissions}:{username:f.username.value.trim().toLowerCase(),full_name:f.full_name.value.trim(),password:f.password.value,permissions};
   const resp=await fetch(`${SUPABASE_URL}/functions/v1/admin-create-user`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SUPABASE_ANON_KEY},body:JSON.stringify(payload)});
   const result=await resp.json().catch(()=>({error:"Respuesta inválida del servidor."}));
   if(!resp.ok){err.textContent=result.error||"No se pudo guardar el usuario.";return;}
   resetUserForm();await loadUsers();alert(editing?"Permisos actualizados correctamente.":"Usuario creado correctamente.");
 });
 await loadUsers();
}else{
 document.querySelector("#users-panel").classList.add("hidden");
}
