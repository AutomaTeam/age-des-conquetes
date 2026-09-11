# -*- coding: utf-8 -*-
"""Comble, sur une planche DEJA livree (assets/**/*.webp), les poches de
fond fermees qu'audit-detourage.py a signalees -- sans repasser par la
planche source (perdue une fois la planche detouree). C'est ce que
`detourer-planche.py --pockets` aurait fait a la source ; ici on l'applique
directement au fichier final, en ne touchant QUE les pixels deja identifies
comme poche : meme test de fond (r,g,b>230, ecarts<12) et meme connexite 8
que l'outil de detourage, mais a la PLEINE resolution du fichier (pas la
resolution de travail reduite d'audit-detourage.py -- inutile ici, la seule
chose qui compte est de ne combler que des poches assez GRANDES pour avoir
ete signalees par l'audit, via le meme seuil `MIN_FRAC`).

    python outils/comble-poches-livrees.py [--dry] assets/batiments/mur_mongols.webp [...]

`--dry` liste ce qui serait change sans rien ecrire. `--min=0.02` abaisse le
seuil de taille (voir plus bas) pour une planche repetee a l'ecran.

Un pixel deja transparent (alpha<128) compte comme fond deja correctement
detoure -- on ne touche donc jamais le contour legitime du sujet, seulement
les composantes qui n'y touchent nulle part ET ne touchent pas non plus le
cadre de l'image (une poche ouverte sur un bord jamais recadre, cas de
mur.webp/portail.webp avant leur passage complet par detourer-planche.py).

Ne PAS lancer sur assets/ressources/relique.webp (halo magique volontaire)
ni assets/ressources/banc_poissons.webp (aucune poche, juste un dessin
clair) -- audit-detourage.py les signale mais ce sont des faux positifs
connus, pas des poches.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

CONN8 = np.ones((3, 3), bool)

# % de la boite du sujet -- meme seuil qu'audit-detourage.py, pour ne combler
# que les poches assez grandes pour survivre a la reduction d'echelle du jeu
# (TRIM_W_*) et donc reellement VISIBLES en partie. En dessous, ce sont des
# artefacts d'anticrenelage (un reflet, un lisere) qui font partie du dessin.
MIN_FRAC = 0.1


def fix(path, dry=False, min_frac=MIN_FRAC):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    alpha = a[:, :, 3]
    opaque = alpha >= 128
    if not opaque.any():
        return 0
    ys, xs = np.nonzero(opaque)
    bbox_area = (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)

    r = a[:, :, 0].astype(np.int16); g = a[:, :, 1].astype(np.int16); b = a[:, :, 2].astype(np.int16)
    white = (r > 230) & (g > 230) & (b > 230) & (np.abs(r - g) < 12) & (np.abs(g - b) < 12)
    candidate = white & opaque
    if not candidate.any():
        return 0

    lab, n = ndimage.label(candidate, structure=CONN8)
    # "fond deja atteint" = touche une case deja transparente (le contour
    # legitime, deja bien detoure) -- on dilate donc chaque composante d'un
    # pixel et on regarde si elle mord sur du transparent existant.
    dil = ndimage.binary_dilation(~opaque, structure=CONN8)
    touches_bg = set(np.unique(lab[dil & (lab > 0)])) - {0}
    # une composante qui touche le cadre de l'image entiere (planche jamais
    # recadree) compte aussi comme fond.
    edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg_ids = touches_bg | edge_ids

    sizes = ndimage.sum_labels(np.ones_like(lab, float), lab, range(1, n + 1)) if n else np.array([])
    keep = [i + 1 for i, v in enumerate(sizes)
            if (i + 1) not in bg_ids and v / bbox_area * 100 >= min_frac]
    pocket_mask = np.isin(lab, keep) if keep else np.zeros_like(candidate)
    npix = int(pocket_mask.sum())
    if npix == 0:
        return 0
    if not dry:
        alpha2 = alpha.copy()
        alpha2[pocket_mask] = 0
        out = a.copy(); out[:, :, 3] = alpha2
        Image.fromarray(out, 'RGBA').save(path, 'WEBP', quality=88, method=6)
    return npix


if __name__ == '__main__':
    dry = '--dry' in sys.argv
    # --min=0.02 : seuil abaisse pour les planches REPETEES a l'ecran (arbre,
    # buisson : des centaines d'exemplaires sur une carte). Une poche de 0,03 %
    # de la boite passe inapercue sur un batiment unique, pas quand elle
    # clignote blanc entre les branches de chaque arbre de la foret. Voir le
    # passage du 2026-09-11 (arbre.webp, buisson_baies.webp).
    min_frac = MIN_FRAC
    for a in sys.argv[1:]:
        if a.startswith('--min='):
            min_frac = float(a[6:])
    paths = [p for p in sys.argv[1:] if not p.startswith('--')]
    total = 0
    for p in paths:
        n = fix(p, dry=dry, min_frac=min_frac)
        if n:
            total += 1
            print(('[dry] ' if dry else '') + '%-55s %d pixels de poche combles' % (p, n))
    print('%d fichier(s) modifie(s)' % total)
