import {supabase,requireSession,hasPermission,money} from "./supabase.js";
const auth=await requireSession("sales.create");
if(!auth) throw new Error("Sesión requerida");
const {profile}=auth;
document.documentElement.dataset.theme=localStorage.getItem("smok-theme")||"carbon";
document.querySelector("#sales-user").textContent=profile.full_name||profile.username;
document.querySelector("#sales-logout").addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("login.html")});
// Aísla la pantalla de ventas: no contiene enlaces al panel y el botón Atrás no revela el dashboard.
history.replaceState({salesOnly:true},"",location.href);
history.pushState({salesOnly:true},"",location.href);
window.addEventListener("popstate",()=>{history.pushState({salesOnly:true},"",location.href);});
let products=[],cart=[];
const resultEl=document.querySelector("#product-results"),cartEl=document.querySelector("#cart-items"),searchEl=document.querySelector("#product-search");
const {data:productRows,error}=await supabase.from("products").select("id,name,sku,sale_price,stock,is_active").eq("is_active",true).order("name");
if(error) resultEl.innerHTML='<div class="empty-state">No se pudieron cargar productos. Revisa la conexión y los permisos.</div>';
else {products=productRows||[];renderProducts(products);}
function renderProducts(rows){resultEl.innerHTML=rows.length?rows.map(p=>`<button class="product-card" data-product="${p.id}" ${Number(p.stock)<=0?"disabled":""}><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.sku||"Sin código")} · Stock: ${p.stock}</span><b>${money(p.sale_price)}</b></button>`).join(""):'<div class="empty-state">No se encontraron productos disponibles.</div>';resultEl.querySelectorAll("[data-product]").forEach(b=>b.addEventListener("click",()=>addProduct(products.find(p=>p.id===b.dataset.product))));}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
searchEl.addEventListener("input",()=>{const q=searchEl.value.toLowerCase().trim();renderProducts(products.filter(p=>p.name.toLowerCase().includes(q)||(p.sku||"").toLowerCase().includes(q)));});
function addProduct(p){if(!p)return;const found=cart.find(x=>x.id===p.id);if(found){if(found.quantity>=p.stock)return showMessage("No hay existencias suficientes.");found.quantity++;}else cart.push({...p,quantity:1});renderCart();}
function renderCart(){cartEl.innerHTML=cart.length?cart.map(p=>`<div class="cart-item"><div><strong>${escapeHtml(p.name)}</strong><small>${money(p.sale_price)} por unidad</small><div class="quantity-controls"><button data-minus="${p.id}">−</button><span>${p.quantity}</span><button data-plus="${p.id}">+</button><button data-remove="${p.id}" title="Quitar">×</button></div></div><strong>${money(p.sale_price*p.quantity)}</strong></div>`).join(""):'<div class="empty-state">Aún no hay productos.</div>';
cartEl.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));cartEl.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));cartEl.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{cart=cart.filter(p=>p.id!==b.dataset.remove);renderCart();});updateTotal();}
function changeQty(id,delta){const p=cart.find(x=>x.id===id);if(!p)return;if(delta>0&&p.quantity>=p.stock)return showMessage("No hay existencias suficientes.");p.quantity+=delta;if(p.quantity<=0)cart=cart.filter(x=>x.id!==id);renderCart();}
function total(){return cart.reduce((a,p)=>a+Number(p.sale_price)*p.quantity,0)}
function updateTotal(){document.querySelector("#cart-total").textContent=money(total());const cash=Number(document.querySelector("#amount-received").value||0);document.querySelector("#change-amount").textContent=money(Math.max(0,cash-total()));const cashMethod=document.querySelector("#payment-method").value==="efectivo";document.querySelector("#amount-received").disabled=!cashMethod;document.querySelector("#received-label").classList.toggle("hidden",!cashMethod);}
document.querySelector("#payment-method").addEventListener("change",updateTotal);document.querySelector("#amount-received").addEventListener("input",updateTotal);document.querySelector("#clear-cart").addEventListener("click",()=>{cart=[];renderCart();showMessage("");});
function showMessage(s,ok=false){const el=document.querySelector("#sale-message");el.textContent=s;el.style.color=ok?"var(--good)":"var(--danger)";}
document.querySelector("#complete-sale").addEventListener("click",async()=>{
 if(!cart.length)return showMessage("Añade al menos un producto.");
 const totalValue=total(),method=document.querySelector("#payment-method").value,received=Number(document.querySelector("#amount-received").value||0);
 if(method==="efectivo"&&received<totalValue)return showMessage("El importe recibido no alcanza el total.");
 const btn=document.querySelector("#complete-sale");btn.disabled=true;btn.textContent="Registrando…";
 try{
   const {data:shift,error:shiftErr}=await supabase.from("cash_shifts").select("id").eq("status","open").limit(1).maybeSingle();
   if(shiftErr)throw shiftErr;
   if(!shift)throw new Error("No hay una caja abierta. Solicita al administrador que abra la caja.");
   const payload={p_items:cart.map(p=>({product_id:p.id,quantity:p.quantity})),p_payment_method:method,p_cash_received:method==="efectivo"?received:null,p_shift_id:shift.id};
   const {data,error}=await supabase.rpc("create_sale",payload);
   if(error)throw error;
   const change=method==="efectivo"?received-totalValue:0;
   showMessage(`Venta registrada correctamente. Cambio: ${money(change)}.`,true);
   cart=[];renderCart();searchEl.value="";renderProducts(products);
   const {data:updated}=await supabase.from("products").select("id,name,sku,sale_price,stock,is_active").eq("is_active",true).order("name");products=updated||[];renderProducts(products);
 }catch(e){showMessage(e.message||"No se pudo registrar la venta.");}
 finally{btn.disabled=false;btn.textContent="Confirmar venta";}
});
updateTotal();
