# Âge des Conquêtes

Petit jeu de stratégie en temps réel (façon Age of Empires II), en un seul
fichier HTML/JS/Canvas autonome — aucune dépendance, aucun build.

## Jouer

Ouvrez [`index.html`](index.html) dans un navigateur (ou servez le dossier
avec n'importe quel serveur statique). Le jeu tourne aussi bien en local
qu'hébergé sur GitHub Pages.

## Modes de jeu

Le mode se choisit sur l'écran-titre, en plus de la difficulté.

- **Survie** — le mode historique : des vagues d'assaut arrivent des bords de
  la carte, en survivre 20 donne la victoire. Des points d'intérêt (filons
  d'or inépuisables gardés par une garnison) récompensent l'offensive.
- **Conquête** — un seigneur rival joue avec les mêmes règles que vous : sa
  propre caisse de ressources, ses villageois qui récoltent réellement sur les
  gisements, ses chantiers, ses montées d'âge et ses armées. Aucune vague, et
  une seule condition de victoire de chaque côté : raser le Centre Ville
  adverse. Détruire ses fermes affame vraiment sa production, tuer ses
  villageois ralentit vraiment ses chantiers.

## Contenu

- Récolte de ressources (bois, pierre, or, nourriture), construction de
  bâtiments, entraînement d'unités, montée en âge, recherches.
- Portails, murs, tours, château fort, atelier de siège, avant-poste...
- Brouillard de guerre façon AoE2 (zones inexplorées entièrement noires,
  zones explorées mais hors champ de vision en brouillard translucide).
- Bilan chiffré en fin de partie (guerre, empire, récolte) affiché aussi bien
  sur la victoire que sur la défaite.
- 22 succès persistants (stockés en local), consultables depuis l'écran-titre
  et le menu pause, avec bandeau de déblocage en cours de partie.

Tout le rendu (bâtiments, unités, icônes) est généré en pixel art par code,
directement en `<canvas>`.

## Sauvegarde cloud (connexion Google)

Optionnelle et désactivée par défaut : sans configuration, le jeu utilise
uniquement le stockage local (`localStorage`, ou `window.storage` dans
Claude Canvas) comme avant. Une fois activée, la sauvegarde manuelle et
l'auto-sauvegarde suivent le compte Google du joueur plutôt que l'appareil
(fichier caché dans son propre Drive, dossier `appData` — invisible dans son
Drive normal, illisible par toute autre application).

**Déjà configuré** pour `https://automateam.fr` (projet Google Cloud
`age-des-conquetes`, API Drive activée, écran de consentement en statut
*Test*, `GOOGLE_CLIENT_ID` déjà renseigné dans `index.html`). Tant que
l'appli reste en *Test*, seuls les comptes Google ajoutés comme
« utilisateurs test » peuvent se connecter (jusqu'à 100, sans passer par la
vérification Google) — ajouter quelqu'un : Google Cloud Console → projet
*age-des-conquetes* → **Google Auth Platform → Audience → Add users**.

Pour re-configurer ailleurs (autre domaine, autre projet) :

1. [console.cloud.google.com](https://console.cloud.google.com/) → créer/
   choisir un projet.
2. **APIs et services → Bibliothèque** → activer *Google Drive API*.
3. **Google Auth Platform → Audience** → type *Externe* + utilisateurs test.
4. **Google Auth Platform → Clients → Créer un client** → type *Application
   Web* → dans *Origines JavaScript autorisées*, l'URL exacte d'hébergement
   — et `http://localhost:PORT` pour tester en local (un `file://` direct ne
   fonctionne **pas** avec la connexion Google, un serveur statique est
   nécessaire).
5. Copier l'*ID client* (`xxxx.apps.googleusercontent.com` — ce n'est pas un
   secret) dans `index.html`, constante `GOOGLE_CLIENT_ID` (section
   « CONNEXION GOOGLE » du script).

Le bouton ☁️ *Connexion Google* (écran-titre et menu pause) reste caché tant
que `GOOGLE_CLIENT_ID` garde sa valeur par défaut. La connexion n'est pas
persistée entre deux rechargements de page (pas de backend) : le joueur
reclique une fois par session de navigateur.
