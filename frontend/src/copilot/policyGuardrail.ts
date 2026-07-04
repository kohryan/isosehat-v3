export type SqlValidation = {
  ok: boolean;
  errors: string[];
  normalized_sql: string;
  referenced_objects: string[];
};

const DISALLOWED = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "CREATE",
  "ALTER",
  "GRANT",
  "REVOKE",
  "TRUNCATE",
  "CALL",
  "EXPORT",
  "LOAD",
  "BEGIN",
  "COMMIT",
  "ROLLBACK"
];

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, "\n").trim();
}

function hasMultipleStatements(sql: string): boolean {
  const stripped = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const parts = stripped.split(";").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1;
}

function extractBackticked(sql: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function extractBareDatasetTables(sql: string): string[] {
  const out = new Set<string>();
  const re = /(?:FROM|JOIN)\s+([A-Za-z0-9_\-]+)\.([A-Za-z0-9_]+)(?:\s|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.add(`${m[1]}.${m[2]}`);
  }
  return [...out];
}

function isSelectOrWith(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return s.startsWith("SELECT") || s.startsWith("WITH");
}

function validateObjectAllowList(objectId: string, projectId: string, dataset: string): boolean {
  const o = objectId.replace(/\s+/g, "");
  const parts = o.split(".");
  if (parts.length === 3) {
    const [p, d, t] = parts;
    if (p !== projectId) return false;
    if (d !== dataset) return false;
    return t.startsWith("v_");
  }
  if (parts.length === 2) {
    const [d, t] = parts;
    if (d !== dataset) return false;
    return t.startsWith("v_");
  }
  return false;
}

export function validatePolicySql(sql: string, projectId: string, dataset: string): SqlValidation {
  const normalized_sql = normalizeSql(sql);
  const errors: string[] = [];

  if (!normalized_sql) {
    return { ok: false, errors: ["SQL kosong."], normalized_sql, referenced_objects: [] };
  }

  if (!isSelectOrWith(normalized_sql)) {
    errors.push("Hanya boleh query SELECT/CTE (WITH ... SELECT).");
  }

  const up = normalized_sql.toUpperCase();
  for (const kw of DISALLOWED) {
    if (up.includes(kw)) errors.push(`Keyword terlarang terdeteksi: ${kw}`);
  }

  if (hasMultipleStatements(normalized_sql)) {
    errors.push("Multi-statement tidak diizinkan.");
  }

  const backticked = extractBackticked(normalized_sql);
  const bare = extractBareDatasetTables(normalized_sql);
  const referenced_objects = [...new Set([...backticked, ...bare])];

  if (!referenced_objects.length) {
    errors.push("Tidak menemukan referensi objek. Gunakan backticks: `project.dataset.v_view`.");
  }

  for (const obj of referenced_objects) {
    if (!validateObjectAllowList(obj, projectId, dataset)) {
      errors.push(`Objek tidak diizinkan (harus view v_* dalam dataset): ${obj}`);
    }
  }

  const limitMatch = normalized_sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (!limitMatch) {
    errors.push("Wajib pakai LIMIT (maks 200 untuk UI).");
  } else {
    const n = Number(limitMatch[1]);
    if (!Number.isFinite(n) || n <= 0) errors.push("LIMIT harus angka > 0.");
    if (n > 200) errors.push("LIMIT terlalu besar untuk UI (maks 200).");
  }

  return { ok: errors.length === 0, errors, normalized_sql, referenced_objects };
}

