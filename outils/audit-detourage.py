# -*- coding: utf-8 -*-
"""Audite les planches DEJA livrees (assets/**/*.webp) pour du blanc opaque
resultant d'un detourage manque -- typiquement des POCHES DE FOND FERMEES
(un trou du sujet, jamais atteint par le flood fill des bords) qui restent
un voile blanc opaque en jeu, par-dessus le sol.

    python outils/audit-detourage.py [assets]

Reproduit EXACTEMENT ce que le jeu fait au chargement (computeStripBgTrimmed,
js/05-sprites.js) : la planche livree est redimensionnee a la resolution de
travail du jeu (TRIM_W_BLD=512 pour assets/batiments, TRIM_W_UNIT=320 pour
assets/unites, 320 pour assets/ressources et assets/effets), puis un flood
fill 4-connexe (r,g,b>230, ecarts inter-canaux<12) part des BORDS de cette
image de travail. Les pixels blancs jamais atteints -- parce qu'enclaves par
le sujet -- restent opaques a l'ecran, quel que soit l'alpha deja present
dans le fichier livre. C'est cette simulation-la qui decide si un defaut
est REELLEMENT visible en partie, pas un simple comptage de pixels blancs
dans le fichier : beaucoup de petits artefacts d'anticrenelage (1-3 px a
pleine resolution) se diluent sous le seuil de blanc en redimensionnant et
ne se voient jamais en jeu -- d'ou le filtre par fraction de la boite du
sujet plutot que par nombre de pixels bruts.

Deux mesures, sur les pixels OPAQUES uniquement :
  - poches : composantes connexes quasi-blanches qui NE TOUCHENT PAS le bord
    de la boite du sujet detoure ;
  - coeur blanc : part de quasi-blanc dans le tiers central de cette boite
    (memes bornes que le "sujet trop blanc" de detourer-planche.py).

Deux faux positifs CONNUS, a ne pas "corriger" avec comble-poches-livrees.py :
assets/ressources/relique.webp (halo magique bleu pale autour du vase,
volontaire) et assets/ressources/banc_poissons.webp (ecume/reflets clairs
du dessin, aucune poche detectee -- juste un coeur pale).
"""
import sys, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage

TRIM_W = {'batiments': 512, 'unites': 320, 'ressources': 320, 'effets': 320}
CONN4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
CONN8 = np.ones((3, 3), bool)


def runtime_trim(img_rgba, W):
    """Simule computeStripBgTrimmed : redimensionne a W de large comme
    drawImage(img,0,0,W,H) dans le jeu, puis flood fill 4-connexe depuis les
    bords -- SANS combler les poches internes, exactement comme le jeu."""
    w0, h0 = img_rgba.size
    H = max(1, round(W * h0 / w0))
    im = img_rgba.resize((W, H), Image.BILINEAR)
    a = np.array(im)
    r = a[:, :, 0].astype(np.int16); g = a[:, :, 1].astype(np.int16); b = a[:, :, 2].astype(np.int16)
    bgcand = (r > 230) & (g > 230) & (b > 230) & (np.abs(r - g) < 12) & (np.abs(g - b) < 12)

    lab, n = ndimage.label(bgcand, structure=CONN4)
    border_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    reached = np.isin(lab, sorted(border_ids)) if border_ids else np.zeros_like(bgcand)

    alpha = a[:, :, 3].copy()
    alpha[reached] = 0
    out = a.copy(); out[:, :, 3] = alpha
    return out


def audit(path, W):
    src = Image.open(path).convert('RGBA')
    out = runtime_trim(src, W)
    alpha = out[:, :, 3]
    opaque = alpha >= 128
    if not opaque.any():
        return None
    ys, xs = np.nonzero(opaque)
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    bh, bw = by1 - by0 + 1, bx1 - bx0 + 1

    r = out[:, :, 0].astype(np.int16); g = out[:, :, 1].astype(np.int16); b = out[:, :, 2].astype(np.int16)
    white = (r > 230) & (g > 230) & (b > 230) & (np.abs(r - g) < 12) & (np.abs(g - b) < 12) & opaque

    lab, n = ndimage.label(white, structure=CONN8)
    pockets = []
    if n:
        sizes = ndimage.sum_labels(np.ones_like(lab, float), lab, range(1, n + 1))
        objs = ndimage.find_objects(lab)
        for i in range(1, n + 1):
            sy, sx = objs[i - 1]
            touches_edge = (sy.start <= by0 or sy.stop - 1 >= by1 or sx.start <= bx0 or sx.stop - 1 >= bx1)
            frac = sizes[i - 1] / (bw * bh) * 100
            if frac >= 0.1 and not touches_edge:
                pockets.append((frac, int(sx.start), int(sy.start)))
    pockets.sort(reverse=True)

    core = white[by0 + int(bh * .35):by0 + int(bh * .75),
                 bx0 + int(bw * .25):bx0 + int(bw * .75)]
    core_frac = core.mean() * 100 if core.size else 0.0
    total_white = white.sum() / max(1, opaque.sum()) * 100
    return dict(core=core_frac, pockets=pockets, total=total_white)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else 'assets'
    files = sorted(glob.glob(os.path.join(root, '**', '*.webp'), recursive=True)) + \
            sorted(glob.glob(os.path.join(root, '**', '*.png'), recursive=True))
    flagged = []
    for f in files:
        folder = os.path.basename(os.path.dirname(f))
        r = audit(f, TRIM_W.get(folder, 512))
        if r and (r['core'] > 2.0 or r['pockets']):
            flagged.append((f, r))
    flagged.sort(key=lambda t: -(t[1]['core'] + sum(p[0] for p in t[1]['pockets'])))
    print(f"{len(files)} planches, {len(flagged)} signalees\n")
    for f, r in flagged:
        poc = ', '.join('%.1f%%@(%d,%d)' % p for p in r['pockets'][:4]) or '-'
        print('%-55s coeur_blanc=%5.2f%%  poches=%s  (blanc_opaque_total=%.1f%%)'
              % (os.path.relpath(f, root), r['core'], poc, r['total']))


if __name__ == '__main__':
    main()
