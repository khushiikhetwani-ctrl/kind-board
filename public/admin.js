const $ = (s) => document.querySelector(s);
let key = sessionStorage.getItem('kb_admin') || '';

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-admin-key': key, 'x-kindboard': '1' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function load() {
  const err = $('#err');
  err.hidden = true;
  try {
    const { items } = await api('GET', '/api/admin/flags');
    const list = $('#list');
    if (!items.length) return list.replaceChildren(el('p', 'hint', 'Nothing waiting and no reports. All clear.'));
    list.replaceChildren(...items.map((it) => {
      const card = el('article', `mod-item${it.hidden ? ' is-hidden' : ''}`);
      const meta = el('div', 'mod-meta');
      const status = it.pending ? 'waiting for approval' : it.hidden === 1 ? 'removed' : it.hidden === 2 ? 'deleted by author' : 'visible';
      const tags = [[it.type, false], [it.day, false], [status, it.pending || it.hidden === 1]];
      if (it.why) tags.push([`held because ${it.why}`, false]);
      if (it.kind === 'image' || it.kind === 'magnet') {
        tags.push([it.kind === 'magnet' ? 'hand-made magnet' : 'hand-made sticker', false]);
        tags.push([it.screen === 'safe' ? 'auto-check: looks safe' : it.screen === 'unsure' ? 'auto-check: unsure, look closely' : 'not auto-checked', it.screen === 'unsure']);
      }
      if (it.flags) tags.push([`${it.flags} report${it.flags === 1 ? '' : 's'}: ${it.reasons.join(', ')}`, true]);
      tags.push([`by ${it.author} · ${it.authorStrikes} strike(s)${it.authorBanned ? ' · paused' : ''}`, it.authorBanned]);
      for (const [t, bad] of tags) meta.append(el('span', `tag${bad ? ' bad' : ''}`, t));
      let body;
      if (it.text != null) body = el('p', 'mod-text', it.text);
      else if (it.kind === 'emoji') body = el('div', 'mod-emoji', it.content);
      else if (it.kind === 'line') body = el('div', 'mod-emoji', 'a drawn line');
      else if (it.kind === 'word') body = el('div', 'mod-emoji', it.content.startsWith('{') ? JSON.parse(it.content).t : it.content);
      else { body = el('img', 'mod-img'); body.src = it.content; body.alt = 'Flagged sticker'; }
      const actions = el('div', 'mod-actions');
      const act = (label, action, cls = '') => {
        const b = el('button', `btn sm ${cls}`, label);
        b.onclick = async () => { try { await api('POST', '/api/admin/resolve', { type: it.type, id: it.id, action }); load(); } catch (e) { alert(e.message); } };
        actions.append(b);
      };
      if (it.pending) {
        act('Approve', 'approve', 'primary');
        act('Decline', 'decline');
        act('Decline + strike', 'remove', 'danger');
      } else if (it.hidden === 0) {
        act('Keep it (dismiss reports)', 'dismiss');
        act('Remove + strike', 'remove', 'danger');
      } else if (it.hidden === 1) {
        act('Restore', 'restore');
      }
      card.append(meta, body, actions);
      return card;
    }));
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

$('#keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  key = $('#adminKey').value;
  sessionStorage.setItem('kb_admin', key);
  load();
});
if (key) load();
