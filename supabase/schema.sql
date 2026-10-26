-- Smok Game: esquema inicial exclusivo. Ejecutar en un proyecto Supabase NUEVO.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null,
  role text not null default 'worker' check (role in ('admin','worker')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.permission_catalog (
  permission_key text primary key,
  label text not null,
  category text not null
);
insert into public.permission_catalog(permission_key,label,category) values
('dashboard.view','Consultar resumen','dashboard'),
('sales.create','Registrar ventas','sales'),('sales.view_own','Consultar ventas propias','sales'),('sales.view_all','Consultar todas las ventas','sales'),('sales.view_cost','Consultar costos','sales'),('sales.view_profit','Consultar ganancias','sales'),('sales.discount','Aplicar descuentos','sales'),('sales.returns','Gestionar devoluciones','sales'),('sales.void','Anular ventas','sales'),
('inventory.view','Consultar inventario','inventory'),('inventory.create_product','Crear productos','inventory'),('inventory.edit_product','Editar productos','inventory'),('inventory.change_price','Modificar precios','inventory'),('inventory.view_cost','Consultar costos de inventario','inventory'),('inventory.stock_in','Registrar entradas','inventory'),('inventory.adjust','Ajustar existencias','inventory'),('inventory.movements','Consultar movimientos','inventory'),('inventory.delete_product','Eliminar productos','inventory'),
('cash.view','Consultar estado de caja','cash'),('cash.open','Abrir caja','cash'),('cash.income','Registrar ingresos','cash'),('cash.withdraw','Registrar retiros','cash'),('cash.movements','Consultar movimientos de caja','cash'),('cash.close','Registrar cierre de caja','cash'),('cash.reconcile','Realizar arqueo','cash'),('cash.view_closures','Consultar cierres anteriores','cash'),('cash.approve_difference','Autorizar diferencias','cash'),
('reports.daily','Consultar resumen diario','reports'),('reports.sales','Consultar ventas por período','reports'),('reports.by_user','Consultar ventas por usuario','reports'),('reports.inventory','Consultar reportes de inventario','reports'),('reports.cash','Consultar reportes de caja','reports'),('reports.export','Exportar reportes','reports')
on conflict(permission_key) do nothing;

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permission_catalog(permission_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,permission_key)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text,
  cost_price numeric(12,2) not null default 0 check(cost_price>=0),
  sale_price numeric(12,2) not null check(sale_price>=0),
  stock integer not null default 0 check(stock>=0),
  min_stock integer not null default 0 check(min_stock>=0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Caja principal',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.cash_registers(name) values('Caja principal') on conflict do nothing;

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers(id),
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_amount numeric(12,2) not null default 0 check(opening_amount>=0),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2),
  status text not null default 'open' check(status in ('open','closed')),
  notes text
);
create unique index if not exists one_open_shift_per_register on public.cash_shifts(cash_register_id) where status='open';

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint generated always as identity unique,
  created_by uuid not null references public.profiles(id),
  shift_id uuid not null references public.cash_shifts(id),
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  payment_method text not null check(payment_method in ('efectivo','qr','tarjeta','transferencia','otro')),
  cash_received numeric(12,2),
  change_amount numeric(12,2) not null default 0,
  status text not null default 'completed' check(status in ('completed','returned','voided')),
  created_at timestamptz not null default now()
);
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text,
  quantity integer not null check(quantity>0),
  unit_cost numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check(movement_type in ('stock_in','sale','adjustment','return','void')),
  quantity_change integer not null,
  stock_before integer not null,
  stock_after integer not null,
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cash_shifts(id),
  movement_type text not null check(movement_type in ('sale_cash','income','withdrawal','opening','closing_adjustment')),
  amount numeric(12,2) not null check(amount>=0),
  payment_method text not null default 'efectivo',
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  created_by uuid not null references public.profiles(id),
  amount numeric(12,2) not null check(amount>=0),
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and is_active=true $$;

create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path=public
as $$
 select coalesce(public.current_role()='admin',false)
 or exists(select 1 from public.user_permissions up join public.profiles p on p.id=up.user_id
           where up.user_id=auth.uid() and up.permission_key=$1 and p.is_active=true)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role()='admin',false) $$;

-- RLS: activada en todas las tablas operativas.
alter table public.profiles enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.user_permissions enable row level security;
alter table public.products enable row level security;
alter table public.cash_registers enable row level security;
alter table public.cash_shifts enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.cash_movements enable row level security;
alter table public.returns enable row level security;
alter table public.audit_log enable row level security;

create policy "profiles read self or admin" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy "admin update profiles" on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "authenticated read permission catalog" on public.permission_catalog for select to authenticated using(true);
create policy "admin manage user permissions" on public.user_permissions for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "products read with permission" on public.products for select to authenticated using(public.is_admin() or public.has_permission('inventory.view') or public.has_permission('sales.create'));
create policy "products insert permission" on public.products for insert to authenticated with check(public.is_admin() or public.has_permission('inventory.create_product'));
create policy "products update permission" on public.products for update to authenticated using(public.is_admin() or public.has_permission('inventory.edit_product') or public.has_permission('inventory.adjust') or public.has_permission('inventory.stock_in')) with check(public.is_admin() or public.has_permission('inventory.edit_product') or public.has_permission('inventory.adjust') or public.has_permission('inventory.stock_in'));
create policy "products delete admin" on public.products for delete to authenticated using(public.is_admin());
create policy "register read authenticated" on public.cash_registers for select to authenticated using(public.is_admin() or public.has_permission('cash.view') or public.has_permission('cash.open') or public.has_permission('sales.create'));
create policy "register admin manage" on public.cash_registers for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "shifts read permission" on public.cash_shifts for select to authenticated using(public.is_admin() or public.has_permission('cash.view') or public.has_permission('cash.open') or public.has_permission('cash.close') or (opened_by=auth.uid() and public.has_permission('sales.create')));
create policy "shifts open permission" on public.cash_shifts for insert to authenticated with check(public.is_admin() or public.has_permission('cash.open'));
create policy "shifts close permission" on public.cash_shifts for update to authenticated using(public.is_admin() or public.has_permission('cash.close') or public.has_permission('cash.reconcile')) with check(public.is_admin() or public.has_permission('cash.close') or public.has_permission('cash.reconcile'));
create policy "sales read own or all" on public.sales for select to authenticated using(public.is_admin() or (created_by=auth.uid() and public.has_permission('sales.view_own')) or public.has_permission('sales.view_all') or public.has_permission('reports.sales') or public.has_permission('dashboard.view'));
create policy "sale items read authorized" on public.sale_items for select to authenticated using(public.is_admin() or exists(select 1 from public.sales s where s.id=sale_id and (s.created_by=auth.uid() or public.has_permission('sales.view_all') or public.has_permission('sales.view_own'))));
create policy "inventory movements read" on public.inventory_movements for select to authenticated using(public.is_admin() or public.has_permission('inventory.movements'));
create policy "cash movements read" on public.cash_movements for select to authenticated using(public.is_admin() or public.has_permission('cash.movements') or public.has_permission('cash.view'));
create policy "returns read" on public.returns for select to authenticated using(public.is_admin() or public.has_permission('sales.returns'));
create policy "audit admin read" on public.audit_log for select to authenticated using(public.is_admin());

-- Operaciones de venta atómicas: valida permisos, caja, stock y registra venta,
-- detalle, cambios de stock, movimientos de inventario y efectivo en una transacción.
create or replace function public.create_sale(p_items jsonb,p_payment_method text,p_cash_received numeric,p_shift_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare
 v_sale_id uuid; v_total numeric(12,2):=0; v_subtotal numeric(12,2):=0;
 v_item jsonb; v_product public.products%rowtype; v_qty integer; v_before integer;
 v_user uuid:=auth.uid(); v_cash numeric(12,2):=0; v_change numeric(12,2):=0;
begin
 if v_user is null or not public.has_permission('sales.create') then raise exception 'No tienes permiso para registrar ventas.'; end if;
 if p_payment_method not in ('efectivo','qr','tarjeta','transferencia','otro') then raise exception 'Método de pago no válido.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La venta no contiene productos.'; end if;
 perform 1 from public.cash_shifts where id=p_shift_id and status='open' for update;
 if not found then raise exception 'La caja no está abierta.'; end if;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_qty:=(v_item->>'quantity')::integer;
   if v_qty<=0 then raise exception 'Cantidad inválida.'; end if;
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid and is_active=true for update;
   if not found then raise exception 'Producto no disponible.'; end if;
   if v_product.stock<v_qty then raise exception 'Stock insuficiente para %.',v_product.name; end if;
   v_subtotal:=v_subtotal+v_product.sale_price*v_qty;
 end loop;
 v_total:=v_subtotal;
 if p_payment_method='efectivo' then
   if p_cash_received is null or p_cash_received<v_total then raise exception 'El efectivo recibido es insuficiente.'; end if;
   v_cash:=p_cash_received;v_change:=p_cash_received-v_total;
 end if;
 insert into public.sales(created_by,shift_id,subtotal,total,payment_method,cash_received,change_amount)
 values(v_user,p_shift_id,v_subtotal,v_total,p_payment_method,case when p_payment_method='efectivo' then p_cash_received else null end,v_change)
 returning id into v_sale_id;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_qty:=(v_item->>'quantity')::integer;
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid for update;
   v_before:=v_product.stock;
   insert into public.sale_items(sale_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_cost,unit_price,line_total)
   values(v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.cost_price,v_product.sale_price,v_product.sale_price*v_qty);
   update public.products set stock=stock-v_qty,updated_at=now() where id=v_product.id;
   insert into public.inventory_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_id,created_by)
   values(v_product.id,'sale',-v_qty,v_before,v_before-v_qty,v_sale_id,v_user);
 end loop;
 if p_payment_method='efectivo' then
   insert into public.cash_movements(shift_id,movement_type,amount,payment_method,reference_id,created_by)
   values(p_shift_id,'sale_cash',v_total,'efectivo',v_sale_id,v_user);
 end if;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
 values(v_user,'sale.created','sale',v_sale_id::text,jsonb_build_object('total',v_total,'payment_method',p_payment_method));
 return v_sale_id;
end $$;

grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.create_sale(jsonb,text,numeric,uuid) to authenticated;

-- No se crea ningún administrador por defecto. La primera cuenta se prepara
-- en Supabase Auth y luego se inserta su perfil de forma controlada.
