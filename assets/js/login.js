import {supabase, usernameToEmail} from "./supabase.js";
const form=document.querySelector("#login-form"), errorBox=document.querySelector("#login-error");
const {data:{session}}=await supabase.auth.getSession();
if(session) location.replace("app.html");
form.addEventListener("submit",async e=>{
  e.preventDefault(); errorBox.textContent="";
  const username=form.username.value.trim().toLowerCase(), password=form.password.value;
  const {data,error}=await supabase.auth.signInWithPassword({email:usernameToEmail(username),password});
  if(error){errorBox.textContent="Usuario o contraseña incorrectos.";return;}
  const {data:profile,error:profileError}=await supabase.from("profiles").select("is_active").eq("id",data.user.id).single();
  if(profileError||!profile?.is_active){await supabase.auth.signOut();errorBox.textContent="La cuenta está desactivada o no tiene perfil configurado.";return;}
  location.replace("app.html");
});
