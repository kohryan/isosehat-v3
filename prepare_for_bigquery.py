"""
Konversi semua data Jatim menjadi CSV siap-load ke BigQuery.
Geometri (titik, polygon) dikonversi ke kolom WKT (Well-Known Text) string,
supaya nanti gampang di-cast jadi tipe GEOGRAPHY pakai ST_GEOGFROMTEXT() di BigQuery.

Input (folder ini):
  - jawa-timur.geojson   : boundary provinsi (1 polygon, format [[[lon,lat],...]])
  - jawa-timur.csv       : grid populasi (lon,lat,densitas) tanpa header
  - jawa-timur.json      : faskes Aplicares + isochrone
  - faskes_master_jatim.csv, fasilitas_pendukung_jatim.csv : dari cleaning sebelumnya

Output (folder ./bq_ready):
  - boundary_provinsi.csv     : 1 baris, kolom wkt (POLYGON)
  - population_grid.csv       : lon, lat, densitas, wkt (POINT)
  - faskes_isochrone.csv      : nama, tipe, wkt (POLYGON) -- hanya yg punya isochrone
  - faskes_aplicares.csv      : semua faskes Aplicares sbg titik, dengan flag isochrone
  - faskes_master_jatim.csv, fasilitas_pendukung_jatim.csv : disalin apa adanya
    (sudah berbentuk tabel lat/lon biasa, tidak perlu WKT -- cukup ST_GEOGPOINT
    saat query/load di BigQuery)
"""

import csv
import json
import shutil
from pathlib import Path

OUT = Path("bq_ready")
OUT.mkdir(exist_ok=True)


def ring_to_wkt_polygon(ring):
    """ring: list of [lon, lat] -> WKT POLYGON string. Auto-tutup ring kalau belum tertutup."""
    coords = list(ring)
    if coords[0] != coords[-1]:
        coords = coords + [coords[0]]
    pts = ", ".join(f"{lon} {lat}" for lon, lat in coords)
    return f"POLYGON(({pts}))"


def isochrone_to_wkt_polygon(isochrone):
    """isochrone di jawa-timur.json formatnya [lat, lon] per titik -- kebalikan dari WKT (lon lat)."""
    coords = [[lat, lon] for lat, lon in isochrone]  # placeholder, dibalik di bawah
    pts = []
    ring = list(isochrone)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    for lat, lon in ring:
        pts.append(f"{lon} {lat}")
    return f"POLYGON(({', '.join(pts)}))"


# ----------------------------------------------------------------------
# 1. Boundary provinsi (geojson -> WKT polygon)
# ----------------------------------------------------------------------

def convert_boundary():
    with open("jawa-timur.geojson", encoding="utf-8") as f:
        data = json.load(f)
    ring = data[0]  # list [[lon,lat], ...]
    wkt = ring_to_wkt_polygon(ring)
    with open(OUT / "boundary_provinsi.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["nama", "wkt"])
        writer.writerow(["Jawa Timur", wkt])
    print(f"[boundary_provinsi] 1 polygon, {len(ring)} titik ring")


# ----------------------------------------------------------------------
# 2. Grid populasi (csv lon,lat,value -> tambah kolom wkt POINT)
# ----------------------------------------------------------------------

def convert_population_grid():
    n = 0
    with open("jawa-timur.csv", encoding="utf-8") as fin, \
         open(OUT / "population_grid.csv", "w", newline="", encoding="utf-8") as fout:
        writer = csv.writer(fout)
        writer.writerow(["lon", "lat", "densitas", "wkt"])
        for line in fin:
            lon, lat, val = line.strip().split(",")
            wkt = f"POINT({lon} {lat})"
            writer.writerow([lon, lat, val, wkt])
            n += 1
    print(f"[population_grid] {n} titik grid")


# ----------------------------------------------------------------------
# 3. Faskes Aplicares (jawa-timur.json) -> titik + isochrone terpisah
# ----------------------------------------------------------------------

TYPE_LABELS = {
    "0": "Puskesmas (kode 0)", "1": "Puskesmas (kode 1)",
    "2": "Puskesmas (kode 2)", "3": "Puskesmas (kode 3)",
    "B": "Klinik", "R": "Rumah Sakit", "S": "Klinik Utama/Spesialis",
    "A": "Apotek/IFRS", "U": "Praktik Dokter", "G": "Praktik Dokter Gigi",
    "J": "Praktik Bidan", "L": "Laboratorium", "Y": "Laboratorium Resmi",
    "O": "Optik", "X": "UTD PMI",
}


def convert_faskes_aplicares():
    with open("jawa-timur.json", encoding="utf-8") as f:
        data = json.load(f)

    n_points, n_iso = 0, 0
    with open(OUT / "faskes_aplicares.csv", "w", newline="", encoding="utf-8") as fp, \
         open(OUT / "faskes_isochrone.csv", "w", newline="", encoding="utf-8") as fi:
        wp = csv.writer(fp)
        wp.writerow(["id", "nama", "tipe_kode", "tipe_label", "lat", "lon", "wkt_point", "punya_isochrone"])
        wi = csv.writer(fi)
        wi.writerow(["id", "nama", "tipe_kode", "wkt_polygon"])

        for idx, row in enumerate(data):
            fid = f"aplicares_{idx}"
            nama = row.get("name")
            tipe = row.get("type")
            lat, lon = row.get("lat"), row.get("lng")
            has_iso = row.get("isochrone") is not None
            wkt_point = f"POINT({lon} {lat})" if lat is not None and lon is not None else None
            wp.writerow([fid, nama, tipe, TYPE_LABELS.get(tipe, "Tidak diketahui"), lat, lon, wkt_point, has_iso])
            n_points += 1
            if has_iso:
                wkt_poly = isochrone_to_wkt_polygon(row["isochrone"])
                wi.writerow([fid, nama, tipe, wkt_poly])
                n_iso += 1

    print(f"[faskes_aplicares] {n_points} titik faskes, {n_iso} punya polygon isochrone")


# ----------------------------------------------------------------------
# 4. Salin file yang sudah tabular (tidak perlu WKT, tinggal lat/lon biasa)
# ----------------------------------------------------------------------

def copy_tabular():
    for fname in ["faskes_master_jatim.csv", "fasilitas_pendukung_jatim.csv"]:
        src = Path(fname)
        if src.exists():
            shutil.copy(src, OUT / fname)
            print(f"[{fname}] disalin apa adanya (lat/lon biasa, cukup ST_GEOGPOINT saat load)")
        else:
            print(f"[{fname}] TIDAK DITEMUKAN, lewati")


def main():
    convert_boundary()
    convert_population_grid()
    convert_faskes_aplicares()
    copy_tabular()
    print(f"\nSemua file siap di: {OUT.resolve()}")


if __name__ == "__main__":
    main()
