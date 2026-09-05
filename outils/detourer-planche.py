# -*- coding: utf-8 -*-
"""Détoure une planche générée (fond blanc) et l'écrit au gabarit du jeu.

    python outils/detourer-planche.py <source.jpg> <destination.webp> <gabarit>

`gabarit` vaut `bld` (640×960, bâtiments), `bld_wide` (640×427, les deux
seuls types 2×1 — Camp Forestier et Camp Minier) ou `unit` (400×600 ; 400×267
pour une unité de PROFIL comme le Bélier, le Trébuchet, la Barque ou la
Roulotte). Ajouter `pockets` en quatrième argument vide les poches de fond
fermées — presque toujours ce qu'on veut, voir plus bas.

C'est l'outil qui a produit les 24 planches gitanos du 2026-09-05. Il refait
EXACTEMENT le test de fond du jeu (`computeStripBgTrimmed`, js/05-sprites.js :
`r,g,b > 230` et écarts inter-canaux < 12, flood fill 8-connexe depuis les
bords), pour que la planche livrée soit déjà détourée et que le recadrage du
jeu devienne déterministe.

Trois précautions, chacune payée par un défaut réel — voir `assets/README.md` :

  - **détourer à PLEINE résolution, puis reboucher le fond par la couleur du
    sujet la plus proche AVANT de réduire.** Sans ce rebouchage, le
    rééchantillonnage fait baver le blanc du fond dans le contour et laisse un
    liséré clair tout autour de la planche ;
  - **jeter les mouchetures opaques avant de calculer la boîte de recadrage.**
    Une planche générée en porte des dizaines (artefacts de compression dans
    la marge) : invisibles, mais elles gonflent la boîte et font dessiner le
    bâtiment plus petit ;
  - **mesurer les deux pièges connus** et les afficher : « sujet trop blanc »
    (part de pixels-fond au cœur du SUJET — et non du canevas, qu'une planche
    générée laisse très margé) et « poches fermées » (composantes de fond que
    le flood fill des bords n'atteint pas, et qui resteraient en voile blanc
    opaque en jeu).

Ce dossier `outils/` est de l'outillage d'atelier : contrairement au jeu et à
ses tests, il a des dépendances (Pillow, NumPy, SciPy). Rien de ce qui tourne
dans le navigateur n'en dépend.
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage

CONN8 = np.ones((3, 3), bool)


def bg_mask(a):
    r = a[:, :, 0].astype(np.int16)
    g = a[:, :, 1].astype(np.int16)
    b = a[:, :, 2].astype(np.int16)
    return (r > 230) & (g > 230) & (b > 230) & (np.abs(r - g) < 12) & (np.abs(g - b) < 12)


def process(src, dst, W, Hcap, fill_pockets=False):
    im = Image.open(src).convert('RGB')
    a = np.array(im)
    H0, W0 = a.shape[:2]

    mask = bg_mask(a)
    lab, n = ndimage.label(mask, structure=CONN8)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    reached = np.isin(lab, sorted(border)) if border else np.zeros_like(mask)

    poc = []
    if n:
        sizes = ndimage.sum_labels(np.ones_like(lab, float), lab, range(1, n + 1))
        objs = ndimage.find_objects(lab)
        for i in range(1, n + 1):
            if i in border:
                continue
            f = sizes[i - 1] / (W0 * H0) * 100
            if f >= 0.2:
                sy, sx = objs[i - 1]
                poc.append((f, sx.start / W0 * 100, sy.start / H0 * 100))
    poc.sort(reverse=True)

    alpha = np.where(reached, 0, 255).astype(np.uint8)
    if fill_pockets:
        alpha[mask & ~reached] = 0

    # mouchetures : une composante opaque minuscule et isolee (un pixel de
    # signature, un artefact de compression dans la marge) ne se voit pas mais
    # gonfle la boite de recadrage, et fait donc dessiner le batiment plus
    # petit qu'il ne devrait — c'est le defaut decrit dans assets/README.md.
    slab, sn = ndimage.label(alpha > 0, structure=CONN8)
    dropped = 0
    if sn > 1:
        ssz = ndimage.sum_labels(np.ones_like(slab, float), slab, range(1, sn + 1))
        small = [i + 1 for i, v in enumerate(ssz) if v / (W0 * H0) < 0.0002]
        if small:
            dropped = len(small)
            alpha[np.isin(slab, small)] = 0

    # mesure « trop blanc » AU COEUR DU SUJET
    ys, xs = np.nonzero(alpha)
    if len(ys):
        by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    else:
        by0, by1, bx0, bx1 = 0, H0 - 1, 0, W0 - 1
    bh, bw = by1 - by0 + 1, bx1 - bx0 + 1
    core = mask[by0 + int(bh * .35):by0 + int(bh * .75),
                bx0 + int(bw * .25):bx0 + int(bw * .75)].mean() * 100

    # rebouchage du fond par la couleur opaque la plus proche, avant reduction
    idx = ndimage.distance_transform_edt(alpha == 0, return_distances=False, return_indices=True)
    filled = a[idx[0], idx[1]]

    pad = int(round(max(bw, bh) * 0.02))
    x0, y0 = max(0, bx0 - pad), max(0, by0 - pad)
    x1, y1 = min(W0, bx1 + 1 + pad), min(H0, by1 + 1 + pad)
    rgba = np.dstack([filled, alpha])[y0:y1, x0:x1]
    img = Image.fromarray(rgba, 'RGBA')

    w, h = img.size
    s = min(W / w, Hcap / h)
    img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)

    out = np.array(img)
    out[:, :, 3][out[:, :, 3] < 8] = 0          # miettes d'alpha -> vrai vide
    img = Image.fromarray(out, 'RGBA')
    img.save(dst, 'WEBP', quality=88, method=6)

    flag = '   <<< TROP BLANC' if core > 5 else ''
    print('%-32s %-9s coeur_blanc=%5.2f%%  poches=%s%s'
          % (os.path.basename(dst), '%dx%d' % img.size, core,
             ('-' if not poc else ', '.join('%.2f%%@%d/%d' % p for p in poc[:3]))
             + ('' if not dropped else '  mouchetures=%d' % dropped), flag))
    return core, poc


if __name__ == '__main__':
    src, dst, kind = sys.argv[1], sys.argv[2], sys.argv[3]
    W, Hcap = {'bld': (640, 960), 'bld_wide': (640, 427), 'unit': (400, 600)}[kind]
    process(src, dst, W, Hcap, 'pockets' in sys.argv)
