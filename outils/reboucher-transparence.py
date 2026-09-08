# -*- coding: utf-8 -*-
"""Reboucle le RGB caché sous les pixels DÉJÀ transparents d'une planche
livrée, en le remplaçant par la couleur du pixel opaque le plus proche —
exactement la première précaution de `detourer-planche.py` (« reboucher le
fond par la couleur du sujet la plus proche AVANT de réduire »), mais
appliquée après coup sur le fichier final plutôt qu'à la source.

    python outils/reboucher-transparence.py [--dry] assets/batiments/mur_byzantins.webp [...]

Pourquoi ça compte alors que ces pixels sont déjà invisibles : le jeu
NE FAIT PAS QUE LIRE l'alpha du fichier tel quel. Au chargement, il
redimensionne la planche à sa résolution de travail (`computeStripBgTrimmed`,
js/05-sprites.js) puis refait SON PROPRE détourage par flood fill à partir de
cette image réduite — et ce flood fill regarde la COULEUR de chaque pixel,
pas son alpha d'origine. Si le blanc d'origine est resté sous la
transparence, le rééchantillonnage (bilinéaire) le fait BAVER dans les
pixels opaques voisins lors de la réduction, qui deviennent alors assez
clairs pour être flood-fillés à leur tour — le sujet RÉTRÉCIT donc à
l'écran, parfois fortement : `mur_byzantins.webp` rendait sa Muraille à 94 px
de haut contre ~138 px pour son Portail pourtant tiré de la même enceinte —
un rebouchage manquant, pas une différence de composition.

Repérer les planches concernées : la RGB moyenne sous les pixels transparents
d'une planche bien rebouchée est proche de la couleur du sujet ; sous une
planche jamais rebouchée elle reste proche du blanc (>225 sur les 3 canaux).
Aucun effet visuel direct — ces pixels sont invisibles avant comme après —
seul le comportement du REDIMENSIONNEMENT change.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage


def fix(path, dry=False):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    alpha = a[:, :, 3]
    transp = alpha < 10
    if not transp.any():
        return None
    rgb = a[:, :, :3]
    pct_white_before = float(((rgb[transp] > 225).all(axis=1)).mean() * 100)
    if pct_white_before < 20:
        return None  # déjà rebouché (ou sujet naturellement clair) -- rien à faire

    idx = ndimage.distance_transform_edt(transp, return_distances=False, return_indices=True)
    filled = rgb[idx[0], idx[1]]
    if not dry:
        out = a.copy()
        out[:, :, :3] = filled
        Image.fromarray(out, 'RGBA').save(path, 'WEBP', quality=88, method=6)
    return pct_white_before


if __name__ == '__main__':
    dry = '--dry' in sys.argv
    paths = [p for p in sys.argv[1:] if not p.startswith('--')]
    total = 0
    for p in paths:
        pct = fix(p, dry=dry)
        if pct is not None:
            total += 1
            print(('[dry] ' if dry else '') + '%-55s %.1f%% de blanc sous transparence -> reboucheé' % (p, pct))
    print('%d fichier(s) modifie(s)' % total)
