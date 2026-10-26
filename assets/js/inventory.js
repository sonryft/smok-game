async function adjustStock(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;

  const raw = window.prompt(
    `Producto: ${p.name}\nStock actual: ${p.stock}\n\nIntroduce el ajuste con signo:\n+5 para entrada de 5 unidades\n-2 para salida de 2 unidades`,
    "+1"
  );

  if (raw === null) return;

  const delta = Number(raw.trim());

  if (!Number.isInteger(delta) || delta === 0) {
    say($("#list-message"), "Escribe un número entero distinto de cero, por ejemplo +5 o -2.");
    return;
  }

  if (numeric(p.stock) + delta < 0) {
    say($("#list-message"), "El stock no puede quedar por debajo de cero.");
    return;
  }

  const buttons = rowsEl.querySelectorAll(`[data-stock="${CSS.escape(String(id))}"]`);
  buttons.forEach(button => button.disabled = true);

  try {
    const { data, error } = await supabase.rpc("adjust_inventory_stock", {
      p_product_id: p.id,
      p_delta: delta,
      p_note: `Ajuste manual de inventario: ${delta > 0 ? "entrada" : "salida"}`
    });

    if (error) throw error;

    const before = data.stock_before;
    const after = data.stock_after;

    say(
      $("#list-message"),
      `Stock actualizado: ${p.name} (${before} → ${after}). Movimiento registrado.`,
      true
    );

    await loadProducts();
  } catch (error) {
    say($("#list-message"), `No se pudo ajustar el stock: ${error.message}`);
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
}
