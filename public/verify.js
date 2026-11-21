// Страница, которую открывает охранник/библиотекарь, отсканировав QR студбилета.
(async () => {
  const out = document.getElementById('out');
  const token = location.hash.slice(1);
  const show = (ok, title, text) => {
    out.replaceChildren();
    const badge = document.createElement('div');
    badge.className = `tile-ic ${ok ? 'ok' : 'danger'}`;
    badge.style.cssText = 'width:64px;height:64px;font-size:30px;font-weight:800';
    badge.textContent = ok ? '✓' : '✕';
    const h = document.createElement('h1'); h.textContent = title;
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = text;
    const note = document.createElement('p'); note.className = 'tiny faint'; note.textContent = 'Концепт для конкурса. Данные вымышлены.';
    out.append(badge, h, p, note);
  };
  if (!/^\d+\.\d+\.[\w-]{22}$/.test(token)) return show(false, 'Неверный код', 'QR-код повреждён или не относится к студбилету.');
  try {
    const r = await (await fetch(`/api/verify/${token}`)).json();
    if (r.valid) show(true, r.name, `${r.group} · ${r.faculty}. Студбилет действителен.`);
    else show(false, 'Код недействителен', 'Срок действия QR истёк (5 минут) или код подделан. Попросите обновить QR в кабинете.');
  } catch { show(false, 'Нет связи', 'Не удалось проверить код. Повторите попытку.'); }
})();
