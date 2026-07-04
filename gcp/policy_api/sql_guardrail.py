import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SqlValidation:
    ok: bool
    errors: list[str]
    normalized_sql: str
    referenced_objects: list[str]


DISALLOWED = [
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
    "ROLLBACK",
]


def normalize_sql(sql: str) -> str:
    return sql.replace("\r\n", "\n").strip()


def has_multiple_statements(sql: str) -> bool:
    stripped = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
    stripped = re.sub(r"/\*[\s\S]*?\*/", "", stripped)
    parts = [p.strip() for p in stripped.split(";") if p.strip()]
    return len(parts) > 1


def extract_backticked(sql: str) -> list[str]:
    return re.findall(r"`([^`]+)`", sql)


def extract_bare_dataset_tables(sql: str) -> list[str]:
    out = set()
    for m in re.finditer(r"(?:FROM|JOIN)\s+([A-Za-z0-9_\-]+)\.([A-Za-z0-9_]+)(?:\s|$)", sql, flags=re.IGNORECASE):
        out.add(f"{m.group(1)}.{m.group(2)}")
    return list(out)


def is_select_or_with(sql: str) -> bool:
    s = sql.strip().upper()
    return s.startswith("SELECT") or s.startswith("WITH")


def validate_object_allow_list(object_id: str, project_id: str, dataset: str) -> bool:
    o = re.sub(r"\s+", "", object_id)
    parts = o.split(".")
    if len(parts) == 3:
        p, d, t = parts
        if p != project_id:
            return False
        if d != dataset:
            return False
        return t.startswith("v_")
    if len(parts) == 2:
        d, t = parts
        if d != dataset:
            return False
        return t.startswith("v_")
    return False


def validate_policy_sql(sql: str, project_id: str, dataset: str, max_limit: int = 200) -> SqlValidation:
    normalized = normalize_sql(sql)
    errors: list[str] = []

    if not normalized:
        return SqlValidation(ok=False, errors=["SQL kosong."], normalized_sql=normalized, referenced_objects=[])

    if not is_select_or_with(normalized):
        errors.append("Hanya boleh query SELECT/CTE (WITH ... SELECT).")

    up = normalized.upper()
    for kw in DISALLOWED:
        if kw in up:
            errors.append(f"Keyword terlarang terdeteksi: {kw}")

    if has_multiple_statements(normalized):
        errors.append("Multi-statement tidak diizinkan.")

    backticked = extract_backticked(normalized)
    bare = extract_bare_dataset_tables(normalized)
    referenced_objects = sorted(set(backticked + bare))

    if not referenced_objects:
        errors.append("Tidak menemukan referensi objek. Gunakan backticks: `project.dataset.v_view`.")

    for obj in referenced_objects:
        if not validate_object_allow_list(obj, project_id, dataset):
            errors.append(f"Objek tidak diizinkan (harus view v_* dalam dataset): {obj}")

    m = re.search(r"\bLIMIT\s+(\d+)\b", normalized, flags=re.IGNORECASE)
    if not m:
        errors.append(f"Wajib pakai LIMIT (maks {max_limit} untuk UI).")
    else:
        n = int(m.group(1))
        if n <= 0:
            errors.append("LIMIT harus angka > 0.")
        if n > max_limit:
            errors.append(f"LIMIT terlalu besar untuk UI (maks {max_limit}).")

    return SqlValidation(ok=len(errors) == 0, errors=errors, normalized_sql=normalized, referenced_objects=referenced_objects)

