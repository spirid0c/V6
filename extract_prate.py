"""
extract_prate.py — Extraction de PRATEsfc (kpds5=59) depuis les archives IsoGSM
==================================================================================
Calque exactement sur extract_summer_v2.py et extract_winter_v2.py.

Parametre:
  PRATEsfc : kpds5=59  -> Precipitation rate [kg/m2/s]

Sortie:
  jpbz_201707_prate1_91frames.bin   (192x94x91 float32 LE = 6,569,472 bytes)
  jpbz_1_2018_prate1_91frames.bin   (192x94x91 float32 LE = 6,569,472 bytes)

IMPORTANT : Les valeurs sont en kg/m2/s.
  Pour les afficher en mm/jour dans le shader, le multiplier x86400 est applique
  dans main.js (updateFrame), pas ici. Le .bin contient les valeurs brutes.
"""

import sys
import os
import subprocess
import numpy as np

# Force UTF-8 sur console Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# ===========================================================================
# PARAMETRES GRILLE (identiques a extract_summer_v2.py)
# ===========================================================================
GRID_XDEF       = 192
GRID_YDEF       = 94
GRID_TDEF       = 91
UNDEF_VAL       = 9.999e+20
BYTES_PER_FRAME = GRID_XDEF * GRID_YDEF * 4
EXPECTED_BYTES  = GRID_TDEF * BYTES_PER_FRAME   # 6,569,472 bytes

WGRIB_EXE       = "wgrib.exe"

# Les deux saisons a extraire
DATASETS = [
    {
        "name":   "jpbz_201707",
        "dir":    r"IsoGSM_Project\jpbz_201707",
        "output": "jpbz_201707_prate1_91frames.bin",
        "label":  "Summer 2017"
    },
    {
        "name":   "jpbz_1_2018",
        "dir":    r"IsoGSM_Project\jpbz_1_2018",
        "output": "jpbz_1_2018_prate1_91frames.bin",
        "label":  "Winter 2018"
    }
]

# ===========================================================================
# UTILITAIRES
# ===========================================================================

def get_filename_for_fh(ds_dir, fh):
    """Retourne le chemin exact pour une heure de prevision."""
    path_zero  = os.path.join(ds_dir, "flx.ft00")
    path_plain = os.path.join(ds_dir, f"flx.ft{fh}")
    if fh == 0:
        if os.path.exists(path_zero):
            return os.path.join(ds_dir, "flx.ft00")
        elif os.path.exists(path_plain):
            return os.path.join(ds_dir, "flx.ft0")
        else:
            return None
    return path_plain if os.path.exists(path_plain) else None


def find_prate_record(filepath):
    """Trouve le numero de record GRIB pour PRATEsfc (kpds5=59)."""
    try:
        out = subprocess.check_output(
            [WGRIB_EXE, filepath, "-s"],
            text=True, errors="replace", stderr=subprocess.DEVNULL
        )
    except subprocess.CalledProcessError:
        return None

    for line in out.strip().split("\n"):
        # On cherche kpds5=59 OU le nom PRATE au niveau surface (lev=1)
        if ":kpds5=59:" in line or (":PRATE:" in line and ":sfc:" in line):
            rec = line.split(":")[0].strip()
            return rec
    return None


def extract_record(filepath, record_num, tmp_path):
    """
    Extrait un record GRIB1 en IEEE 754 Big-Endian via wgrib.
    Retourne np.ndarray float32 shape (GRID_YDEF, GRID_XDEF).
    UNDEF (9.999E+20) -> 0.0
    """
    try:
        subprocess.check_call(
            [WGRIB_EXE, filepath, "-d", record_num, "-nh", "-ieee", "-o", tmp_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        raw = np.fromfile(tmp_path, dtype=">f4").astype(np.float32)

        if len(raw) != GRID_XDEF * GRID_YDEF:
            print(f"      [ERR] Taille: {len(raw)} pts, attendu {GRID_XDEF * GRID_YDEF}")
            return None

        # Masquer UNDEF -> 0.0
        raw = np.where(raw > UNDEF_VAL * 0.5, 0.0, raw)
        return raw.reshape(GRID_YDEF, GRID_XDEF)

    except Exception as e:
        print(f"      [ERR] Record {record_num}: {e}")
        return None
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


# ===========================================================================
# EXTRACTION D'UNE SAISON
# ===========================================================================

def extract_season(ds):
    print()
    print("=" * 65)
    print(f" EXTRACTION {ds['name']} — {ds['label']}")
    print("=" * 65)
    print(f" Source : {ds['dir']}")
    print(f" Output : {ds['output']}")
    print()

    if not os.path.isdir(ds["dir"]):
        print(f"[FATAL] Dossier absent: {ds['dir']}")
        return False

    prate_frames  = []
    blank_frame   = np.zeros((GRID_YDEF, GRID_XDEF), dtype=np.float32)
    success_count = 0
    gap_count     = 0

    for t_idx in range(GRID_TDEF):
        t_label = t_idx + 1
        fh      = t_idx * 24

        fpath = get_filename_for_fh(ds["dir"], fh)
        fname = os.path.basename(fpath) if fpath else f"flx.ft{fh}"
        label = f"T={t_label:02d}/91  fh={fh:5d}h  {fname:<14}  "

        if fpath is None:
            print(label + "ABSENT -> zeros (GAP)")
            prate_frames.append(blank_frame.copy())
            gap_count += 1
            continue

        rec_prate = find_prate_record(fpath)

        if rec_prate is None:
            print(label + "PRATE introuvable -> zeros")
            prate_frames.append(blank_frame.copy())
            gap_count += 1
            continue

        tmp = f"_tmp_prate_{fh}.bin"
        vp  = extract_record(fpath, rec_prate, tmp)

        if vp is None:
            print(label + "EXTRACTION ECHOUEE -> zeros")
            prate_frames.append(blank_frame.copy())
            gap_count += 1
            continue

        success_count += 1
        # Affiche la valeur max en mm/jour (x86400) pour verif
        print(label + f"OK  max={vp.max():.2e} kg/m2/s  ({vp.max()*86400:.2f} mm/day)")
        prate_frames.append(vp)

    # Assemblage
    print()
    print(" ASSEMBLAGE...")
    p_stack = np.stack(prate_frames, axis=0).astype(np.float32)
    print(f" Shape : {p_stack.shape}  ({p_stack.nbytes:,} bytes)")
    print(f" Frames reussies : {success_count}/{GRID_TDEF}")
    print(f" Frames vides    : {gap_count}/{GRID_TDEF}")

    if p_stack.nbytes != EXPECTED_BYTES:
        print(f"[ERREUR CRITIQUE] Taille attendue {EXPECTED_BYTES:,} bytes, obtenu {p_stack.nbytes:,}")
        return False

    # Sauvegarde en float32 Little-Endian (meme convention que les autres .bin)
    p_stack.tofile(ds["output"])
    print(f" [OK] {ds['output']}  ({os.path.getsize(ds['output']):,} bytes)")

    # Verification rapide
    non_zero = p_stack[p_stack > 0]
    if len(non_zero) > 0:
        print(f" Max global : {p_stack.max():.2e} kg/m2/s  ({p_stack.max()*86400:.2f} mm/day)")
        print(f" Min (>0)   : {non_zero.min():.2e} kg/m2/s  ({non_zero.min()*86400:.4f} mm/day)")
    else:
        print(" [ATTENTION] Toutes les valeurs sont nulles ! Verifier kpds5=59 dans les .ft")

    return True


# ===========================================================================
# PROGRAMME PRINCIPAL
# ===========================================================================

def main():
    print("=" * 65)
    print(" EXTRACTION PRATEsfc (kpds5=59) — Toutes saisons")
    print("=" * 65)

    if not os.path.exists(WGRIB_EXE):
        print(f"[FATAL] {WGRIB_EXE} introuvable. Placez wgrib.exe dans le meme dossier.")
        sys.exit(1)

    results = []
    for ds in DATASETS:
        ok = extract_season(ds)
        results.append((ds["output"], ok))

    print()
    print("=" * 65)
    print(" RESUME FINAL")
    print("=" * 65)
    for output, ok in results:
        status = "[OK]     " if ok else "[ECHEC]  "
        print(f" {status} {output}")

    print()
    print(" Etape suivante : rechargez la page dans votre navigateur.")
    print(" Le mode 'Rain (PRECIP)' utilisera automatiquement ces fichiers .bin")
    print("=" * 65)


if __name__ == "__main__":
    main()
