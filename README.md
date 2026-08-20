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
- **2 rivaux** — deux seigneurs IA, hostiles à vous ET entre eux. Le dernier
  Centre Ville debout l'emporte.
- **2v1 Coop** — vous et un allié (via le *1v1 en ligne*, voir plus bas)
  affrontez ensemble un seul seigneur IA, à la difficulté choisie sur
  l'écran-titre. Lancé seul, ce mode se joue comme la Conquête.

## Contenu

- Récolte de ressources (bois, pierre, or, nourriture), construction de
  bâtiments, entraînement d'unités, montée en âge, recherches.
- Portails, murs, tours, château fort, atelier de siège, avant-poste...
- Brouillard de guerre façon AoE2 (zones inexplorées entièrement noires,
  zones explorées mais hors champ de vision en brouillard translucide).
- Bilan chiffré en fin de partie (guerre, empire, récolte) affiché aussi bien
  sur la victoire que sur la défaite.
- 22 succès persistants (locaux, ou synchronisés sur Google Drive une fois
  connecté — voir *Sauvegarde cloud*), consultables depuis l'écran-titre et
  le menu pause, avec bandeau de déblocage en cours de partie.
- Groupes de contrôle : `Ctrl+1..9` assigne la sélection courante, `1..9` la
  rappelle, un second appui rapide sur le même chiffre recentre la caméra
  dessus (fiable au clavier AZERTY comme QWERTY).

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

## Multijoueur 1v1 en ligne (Firebase)

Optionnel et **désactivé par défaut** : sans configuration, le bouton
👥 *1v1 en ligne* explique qu'il n'est pas configuré et tout le reste du jeu
fonctionne exactement comme avant (le module réseau n'appelle même pas le CDN
Firebase tant qu'il n'est pas configuré).

L'architecture est *hôte autoritaire* : celui qui crée la partie fait tourner
la simulation, l'autre lui envoie des ordres et reçoit l'état. Firebase sert
uniquement à l'authentification, au salon et à la mise en relation ; la partie
elle-même passe en **WebRTC pair-à-pair**, avec repli sur un relais Firebase
si le pair-à-pair échoue.

### Configuration

1. [console.firebase.google.com](https://console.firebase.google.com/) →
   ajouter Firebase au projet Google Cloud existant (`age-des-conquetes`).
2. **Realtime Database → Créer une base** (choisir une région proche, ex.
   `europe-west1`), démarrer en mode verrouillé.
3. **Authentication → Sign-in method** → activer le fournisseur **Google**.
4. **Authentication → Settings → Domaines autorisés** → ajouter le domaine
   d'hébergement (`automateam.fr`) ; `localhost` y est déjà par défaut.
5. **Paramètres du projet → Vos applications → Web** → copier l'objet de
   configuration dans `index.html`, constante `FIREBASE_CONFIG` (tout en bas,
   bloc « TRANSPORT MULTIJOUEUR »). Ces valeurs sont **publiques** : la
   sécurité repose entièrement sur les règles ci-dessous, appliquées côté
   serveur.

### Règles de sécurité Realtime Database

À coller dans **Realtime Database → Règles**. Elles garantissent qu'un joueur
ne peut lire ni écrire que dans les salons dont il fait partie.

```json
{
  "rules": {
    "parties": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('hote/uid').val() === auth.uid || newData.child('invite/uid').val() === auth.uid || data.child('invite/uid').val() === auth.uid)",
        ".validate": "newData.hasChildren(['hote','etat'])"
      }
    },
    "signal": {
      "$code": {
        ".read":  "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        ".write": "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        "ice": {
          "$role": {
            "$id": { ".validate": "newData.hasChild('candidate') && newData.child('candidate').val().length < 512" }
          }
        }
      }
    },
    "relais": {
      "$code": {
        ".read":  "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        ".write": "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        "$dest": {
          "$id": { ".validate": "newData.hasChild('charge')" }
        }
      }
    },
    "presence": {
      "$code": {
        ".read": "auth != null",
        "$uid": { ".write": "auth != null && auth.uid === $uid" }
      }
    },
    "classement": {
      "survie": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 9999"
        }
      },
      "conquete": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 36000"
        }
      }
    }
  }
}
```

**Codes de partie.** Cinq caractères sans ambiguïté visuelle (ni `0`/`O`, ni
`1`/`I`/`L`), soit ~28 millions de combinaisons. C'est devinable par force
brute si beaucoup de salons coexistent : le salon passe donc à `plein` dès
l'arrivée du second joueur, expire au bout de 2 h, et ne contient aucune
information sensible. L'hôte le supprime en partant (`onDisconnect`).

**Reconnexion.** Une coupure de lien (wifi, onglet en arrière-plan) laisse
3 minutes pour revenir avant que l'hôte ne bascule le camp absent en IA. Si
c'est votre PROPRE page qui recharge ou plante, un bouton apparaît à
l'écran-titre pendant 15 minutes pour rejoindre le même salon et resynchroniser
l'état courant avec l'hôte (toujours actif, lui, puisque sa simulation n'a
jamais quitté la mémoire) — limité au rôle client, l'hôte étant seul dépositaire
de l'état autoritatif.

**Classement en ligne.** Léger et optionnel, réutilise la même connexion
Firebase que le multijoueur (bouton 🥇 *Classement* sur l'écran-titre) : une
seule entrée par joueur et par catégorie (sa MEILLEURE valeur, pas un
historique) — meilleure vague atteinte en Survie, victoire la plus rapide
dans les autres modes. Envoyé automatiquement en fin de partie si connecté ;
échoue silencieusement sinon (comme le reste du multijoueur). Les règles
`classement/…` ci-dessus valident le type et bornent la valeur envoyée
(0-9999 vagues, 0-36000 s) — une protection minimale, pas une preuve
d'intégrité : un client signé peut toujours mentir dans cette fourchette,
il n'y a pas de serveur de jeu faisant autorité pour la partie solo.

### NAT et TURN

Les serveurs STUN publics suffisent dans environ 75-85 % des cas. Derrière un
NAT symétrique (4G, certains réseaux d'entreprise), le pair-à-pair échoue et
il faudrait un serveur **TURN**, que Firebase ne fournit pas. Le jeu bascule
alors automatiquement sur un **relais Firebase** : fonctionnel, mais latence
150-400 ms et écritures facturées — d'où une cadence réduite et des envois
groupés. Un bandeau prévient le joueur. Pour un vrai confort en 4G, ajouter un
service TURN (Twilio, Metered, ou un `coturn` auto-hébergé) dans
`ICE_SERVERS`.

### Comptes Google : deux connexions distinctes

La sauvegarde Drive utilise Google Identity Services, le multijoueur utilise
Firebase Auth. Ce sont deux mécanismes séparés, et le joueur peut donc voir
deux demandes de consentement s'il utilise les deux fonctions. C'est
volontaire : ne pas toucher à la sauvegarde qui fonctionne. Les unifier
(un seul `signInWithPopup` demandant aussi le scope `drive.appdata`) est
possible plus tard.
