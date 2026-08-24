'use strict';
const crypto = require('node:crypto');
const db = require('./db');

const now = () => Date.now();
const uid = () => crypto.randomUUID();

function parseSession(row) {
  if (!row) return null;
  return {
    ...row,
    config: JSON.parse(row.config || '{}'),
    tags: row.tags ? row.tags.split(',').filter(Boolean) : []
  };
}

function parseFolder(row) {
  if (!row) return null;
  return { ...row, expanded: !!row.expanded };
}

/**
 * Roda `fn` dentro de uma única transação.
 *
 * Isso não é um detalhe de estilo: no motor WASM cada commit custa um fsync
 * (~120 ms). Gravar 500 sessões uma a uma leva mais de um minuto; as mesmas
 * 500 dentro de uma transação levam ~250 ms. Todo laço de escrita passa aqui.
 */
function tx(fn) {
  return db.get().transaction(fn)();
}

// ---------------------------------------------------------------- pastas ---
const folders = {
  list() {
    return db.get()
      .prepare('SELECT * FROM folders ORDER BY sort_order, name COLLATE NOCASE')
      .all()
      .map(parseFolder);
  },

  find(id) {
    return parseFolder(db.get().prepare('SELECT * FROM folders WHERE id = ?').get(id));
  },

  create({ id, name, parentId = null, color = null, icon = null, sortOrder = null }) {
    const t = now();
    const newId = id || uid();
    const order = sortOrder ?? nextOrder('folders', 'parent_id', parentId);
    db.get().prepare(
      `INSERT INTO folders (id, parent_id, name, sort_order, color, icon, expanded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(newId, parentId, name, order, color, icon, t, t);
    return folders.find(newId);
  },

  update(id, patch) {
    const cur = folders.find(id);
    if (!cur) throw new Error(`Pasta ${id} não encontrada`);
    if (patch.parentId !== undefined && wouldCycle(id, patch.parentId)) {
      throw new Error('Não é possível mover uma pasta para dentro dela mesma');
    }
    db.get().prepare(
      `UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, color = ?, icon = ?,
                          expanded = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.name ?? cur.name,
      patch.parentId !== undefined ? patch.parentId : cur.parent_id,
      patch.sortOrder ?? cur.sort_order,
      patch.color !== undefined ? patch.color : cur.color,
      patch.icon !== undefined ? patch.icon : cur.icon,
      patch.expanded !== undefined ? (patch.expanded ? 1 : 0) : (cur.expanded ? 1 : 0),
      now(), id
    );
    return folders.find(id);
  },

  /** Remove a pasta. Subpastas caem em cascata; sessões sobem para a raiz. */
  remove(id, { deleteSessions = false } = {}) {
    const d = db.get();
    d.transaction(() => {
      if (deleteSessions) {
        const ids = descendants(id);
        const ph = ids.map(() => '?').join(',');
        d.prepare(`DELETE FROM secrets WHERE owner_kind = 'session' AND owner_id IN
                   (SELECT id FROM sessions WHERE folder_id IN (${ph}))`).run(...ids);
        d.prepare(`DELETE FROM sessions WHERE folder_id IN (${ph})`).run(...ids);
      }
      d.prepare('DELETE FROM folders WHERE id = ?').run(id);
    })();
  },

  reorder(items) {
    const d = db.get();
    const stmt = d.prepare('UPDATE folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?');
    d.transaction(() => {
      const t = now();
      for (const it of items) {
        if (wouldCycle(it.id, it.parentId ?? null)) continue;
        stmt.run(it.parentId ?? null, it.sortOrder, t, it.id);
      }
    })();
  }
};

function descendants(rootId) {
  return db.get().prepare(
    `WITH RECURSIVE tree(id) AS (
       SELECT ? UNION ALL
       SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
     ) SELECT id FROM tree`
  ).all(rootId).map((r) => r.id);
}

function wouldCycle(folderId, newParentId) {
  if (!newParentId) return false;
  if (folderId === newParentId) return true;
  return descendants(folderId).includes(newParentId);
}

function nextOrder(table, col, value) {
  const sql = value === null
    ? `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${col} IS NULL`
    : `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${col} = ?`;
  const stmt = db.get().prepare(sql);
  return (value === null ? stmt.get() : stmt.get(value)).n;
}

// -------------------------------------------------------------- sessões ----
const sessions = {
  list() {
    return db.get()
      .prepare('SELECT * FROM sessions ORDER BY sort_order, name COLLATE NOCASE')
      .all()
      .map(parseSession);
  },

  find(id) {
    return parseSession(db.get().prepare('SELECT * FROM sessions WHERE id = ?').get(id));
  },

  count() {
    return db.get().prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  },

  recent(limit = 15) {
    return db.get()
      .prepare('SELECT * FROM sessions WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?')
      .all(limit)
      .map(parseSession);
  },

  search(term) {
    const q = `%${term}%`;
    return db.get().prepare(
      `SELECT * FROM sessions
       WHERE name LIKE ? OR tags LIKE ? OR config LIKE ?
       ORDER BY name COLLATE NOCASE LIMIT 200`
    ).all(q, q, q).map(parseSession);
  },

  create(input) {
    const t = now();
    const id = input.id || uid();
    const folderId = input.folderId ?? null;
    db.get().prepare(
      `INSERT INTO sessions
         (id, folder_id, name, type, sort_order, config, theme_id, color, icon, tags, notes,
          identity_id, use_count, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
    ).run(
      id, folderId, input.name, input.type,
      input.sortOrder ?? nextOrder('sessions', 'folder_id', folderId),
      JSON.stringify(input.config || {}),
      input.themeId ?? null, input.color ?? null, input.icon ?? null,
      (input.tags || []).join(','), input.notes || '',
      input.identityId ?? null, t, t
    );
    return sessions.find(id);
  },

  update(id, patch) {
    const cur = sessions.find(id);
    if (!cur) throw new Error(`Sessão ${id} não encontrada`);
    db.get().prepare(
      `UPDATE sessions SET folder_id = ?, name = ?, type = ?, sort_order = ?, config = ?,
                           theme_id = ?, color = ?, icon = ?, tags = ?, notes = ?,
                           identity_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.folderId !== undefined ? patch.folderId : cur.folder_id,
      patch.name ?? cur.name,
      patch.type ?? cur.type,
      patch.sortOrder ?? cur.sort_order,
      JSON.stringify(patch.config !== undefined ? patch.config : cur.config),
      patch.themeId !== undefined ? patch.themeId : cur.theme_id,
      patch.color !== undefined ? patch.color : cur.color,
      patch.icon !== undefined ? patch.icon : cur.icon,
      (patch.tags !== undefined ? patch.tags : cur.tags).join(','),
      patch.notes !== undefined ? patch.notes : cur.notes,
      patch.identityId !== undefined ? patch.identityId : cur.identity_id,
      now(), id
    );
    return sessions.find(id);
  },

  duplicate(id) {
    const cur = sessions.find(id);
    if (!cur) throw new Error(`Sessão ${id} não encontrada`);
    return sessions.create({
      folderId: cur.folder_id,
      name: `${cur.name} (copia)`,
      type: cur.type,
      config: cur.config,
      themeId: cur.theme_id,
      color: cur.color,
      icon: cur.icon,
      tags: cur.tags,
      notes: cur.notes,
      identityId: cur.identity_id
    });
  },

  remove(id) {
    const d = db.get();
    d.transaction(() => {
      d.prepare(`DELETE FROM secrets WHERE owner_kind = 'session' AND owner_id = ?`).run(id);
      d.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    })();
  },

  touch(id) {
    db.get()
      .prepare('UPDATE sessions SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
      .run(now(), id);
  },

  /** Reordena/move em lote - usado pelo drag & drop da árvore. */
  reorder(items) {
    const d = db.get();
    const stmt = d.prepare('UPDATE sessions SET folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?');
    d.transaction(() => {
      const t = now();
      for (const it of items) stmt.run(it.folderId ?? null, it.sortOrder, t, it.id);
    })();
  }
};

// ------------------------------------------------------------ identidades --
const identities = {
  list() {
    return db.get().prepare('SELECT * FROM identities ORDER BY name COLLATE NOCASE').all();
  },
  find(id) {
    return db.get().prepare('SELECT * FROM identities WHERE id = ?').get(id);
  },
  create(input) {
    const t = now();
    const id = input.id || uid();
    db.get().prepare(
      `INSERT INTO identities (id, name, username, auth_type, key_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.username || '', input.authType || 'password', input.keyPath || '', t, t);
    return identities.find(id);
  },
  update(id, patch) {
    const cur = identities.find(id);
    if (!cur) throw new Error(`Identidade ${id} não encontrada`);
    db.get().prepare(
      `UPDATE identities SET name = ?, username = ?, auth_type = ?, key_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.name ?? cur.name, patch.username ?? cur.username,
      patch.authType ?? cur.auth_type, patch.keyPath ?? cur.key_path, now(), id
    );
    return identities.find(id);
  },
  remove(id) {
    const d = db.get();
    d.transaction(() => {
      d.prepare(`DELETE FROM secrets WHERE owner_kind = 'identity' AND owner_id = ?`).run(id);
      d.prepare('DELETE FROM identities WHERE id = ?').run(id);
    })();
  }
};

// ------------------------------------------------------------ preferências -
const settings = {
  all() {
    const out = {};
    for (const r of db.get().prepare('SELECT key, value FROM settings').all()) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return out;
  },
  get(key, fallback = null) {
    const row = db.get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },
  set(key, value) {
    db.get().prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), now());
    return value;
  },
  merge(patch) {
    const d = db.get();
    d.transaction(() => {
      for (const [k, v] of Object.entries(patch)) settings.set(k, v);
    })();
    return settings.all();
  }
};

// ------------------------------------------------------------------ temas --
function hydrateTheme(r) {
  return r ? { ...r, builtin: !!r.builtin, data: JSON.parse(r.data) } : null;
}

const themes = {
  list() {
    return db.get()
      .prepare('SELECT * FROM themes ORDER BY builtin DESC, name COLLATE NOCASE')
      .all()
      .map(hydrateTheme);
  },
  find(id) {
    return hydrateTheme(db.get().prepare('SELECT * FROM themes WHERE id = ?').get(id));
  },
  upsert({ id, name, data, builtin = false }) {
    const t = now();
    const themeId = id || uid();
    db.get().prepare(
      `INSERT INTO themes (id, name, builtin, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data,
                                     updated_at = excluded.updated_at`
    ).run(themeId, name, builtin ? 1 : 0, JSON.stringify(data), t, t);
    return themes.find(themeId);
  },
  remove(id) {
    db.get().prepare('DELETE FROM themes WHERE id = ? AND builtin = 0').run(id);
  }
};

// ------------------------------------------------------------- known hosts -
const knownHosts = {
  find(host, port, keyType) {
    return db.get()
      .prepare('SELECT * FROM known_hosts WHERE host = ? AND port = ? AND key_type = ?')
      .get(host, port, keyType);
  },
  save(host, port, keyType, fingerprint) {
    db.get().prepare(
      `INSERT INTO known_hosts (host, port, key_type, fingerprint, first_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host, port, key_type) DO UPDATE SET fingerprint = excluded.fingerprint`
    ).run(host, port, keyType, fingerprint, now());
  },
  list() {
    return db.get().prepare('SELECT * FROM known_hosts ORDER BY host').all();
  },
  remove(host, port, keyType) {
    db.get().prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND key_type = ?')
      .run(host, port, keyType);
  }
};

// -------------------------------------------------------------- snippets ---
const snippets = {
  list() {
    return db.get()
      .prepare('SELECT * FROM snippets ORDER BY category COLLATE NOCASE, sort_order, name COLLATE NOCASE')
      .all()
      .map((r) => ({ ...r, run: !!r.run }));
  },
  find(id) {
    const r = db.get().prepare('SELECT * FROM snippets WHERE id = ?').get(id);
    return r ? { ...r, run: !!r.run } : null;
  },
  create(input) {
    const t = now();
    const id = input.id || uid();
    db.get().prepare(
      `INSERT INTO snippets (id, name, content, category, shortcut, run, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.name, input.content, input.category || '', input.shortcut || '',
      input.run === false ? 0 : 1,
      input.sortOrder ?? nextOrder('snippets', 'category', input.category || ''),
      t, t
    );
    return snippets.find(id);
  },
  update(id, patch) {
    const cur = snippets.find(id);
    if (!cur) throw new Error(`Comando ${id} não encontrado`);
    db.get().prepare(
      `UPDATE snippets SET name = ?, content = ?, category = ?, shortcut = ?, run = ?,
                           sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.name ?? cur.name,
      patch.content ?? cur.content,
      patch.category !== undefined ? patch.category : cur.category,
      patch.shortcut !== undefined ? patch.shortcut : cur.shortcut,
      (patch.run !== undefined ? patch.run : cur.run) ? 1 : 0,
      patch.sortOrder ?? cur.sort_order,
      now(), id
    );
    return snippets.find(id);
  },
  remove(id) {
    db.get().prepare('DELETE FROM snippets WHERE id = ?').run(id);
  }
};

// ------------------------------------------------------------ automações ---
/**
 * Roteiros expect/send. `steps` fica como JSON no banco (mesma ideia do
 * `config` de sessão) e volta sempre como array para quem chama.
 */
function parseAutomation(row) {
  if (!row) return null;
  let steps;
  try { steps = JSON.parse(row.steps || '[]'); } catch { steps = []; }
  return { ...row, steps: Array.isArray(steps) ? steps : [] };
}

/** Normaliza um passo vindo da UI: só os campos previstos, com os padrões. */
function normalizeStep(step) {
  const s = step || {};
  return {
    expect: String(s.expect ?? ''),
    send: String(s.send ?? ''),
    sendEnter: s.sendEnter === false ? false : true,
    timeoutMs: Number(s.timeoutMs) > 0 ? Number(s.timeoutMs) : 8000
  };
}

const normalizeSteps = (steps) => (Array.isArray(steps) ? steps : []).map(normalizeStep);

const automations = {
  list() {
    return db.get()
      .prepare('SELECT * FROM automations ORDER BY category COLLATE NOCASE, sort_order, name COLLATE NOCASE')
      .all()
      .map(parseAutomation);
  },
  find(id) {
    return parseAutomation(db.get().prepare('SELECT * FROM automations WHERE id = ?').get(id));
  },
  create(input) {
    const t = now();
    const id = input.id || uid();
    db.get().prepare(
      `INSERT INTO automations (id, name, category, steps, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.name, input.category || '',
      JSON.stringify(normalizeSteps(input.steps)),
      input.sortOrder ?? nextOrder('automations', 'category', input.category || ''),
      t, t
    );
    return automations.find(id);
  },
  update(id, patch) {
    const cur = automations.find(id);
    if (!cur) throw new Error(`Automação ${id} não encontrada`);
    db.get().prepare(
      `UPDATE automations SET name = ?, category = ?, steps = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.name ?? cur.name,
      patch.category !== undefined ? patch.category : cur.category,
      JSON.stringify(normalizeSteps(patch.steps !== undefined ? patch.steps : cur.steps)),
      patch.sortOrder ?? cur.sort_order,
      now(), id
    );
    return automations.find(id);
  },
  remove(id) {
    db.get().prepare('DELETE FROM automations WHERE id = ?').run(id);
  }
};

// ------------------------------------------------------------------- log ---
const log = {
  open(entry) {
    const info = db.get().prepare(
      `INSERT INTO connection_log (session_id, name, type, target, started_at, status)
       VALUES (?, ?, ?, ?, ?, 'open')`
    ).run(entry.sessionId ?? null, entry.name, entry.type, entry.target, now());
    return info.lastInsertRowid;
  },
  close(rowId, status = 'closed', error = null) {
    if (!rowId) return;
    db.get().prepare('UPDATE connection_log SET ended_at = ?, status = ?, error = ? WHERE id = ?')
      .run(now(), status, error, rowId);
  },
  recent(limit = 200) {
    return db.get().prepare('SELECT * FROM connection_log ORDER BY started_at DESC LIMIT ?').all(limit);
  },
  clear() {
    db.get().prepare('DELETE FROM connection_log').run();
  }
};

module.exports = {
  folders, sessions, identities, settings, themes, knownHosts, snippets, automations, log,
  tx, uid, descendants
};
