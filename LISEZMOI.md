# L'Atelier de Nanon — v1.2.0

Une appli web pour Nanon (Devoirs, Photo d'exercice, Quiz de révision, Discussion) qui utilise les crédits API Claude inclus dans ton abonnement Max.

```
Téléphone de Nanon ──► baiji.fr/nanon/ (GitHub Pages, page publique, SANS clé)
                            │
                            ▼  mot de passe
                  Relais Cloudflare Worker (garde la clé API + les consignes)
                            │
                            ▼
                        API Claude (tes 100 $ / mois)
```

## 1. Clé API (Claude Console, ~5 min)
1. Sur claude.ai, dans un navigateur : **Paramètres > Facturation > API credits**, puis relie une organisation Console (si ce n'est pas déjà fait).
2. Sur platform.claude.com : **Settings > Workspaces > Create**, et nomme l'espace « Nanon ».
   Fixe une **limite de dépense** (par ex. 60 $/mois) pour garder du crédit pour tes autres projets.
3. Dans ce workspace : **API keys > Create key**. Copie la clé (elle commence par `sk-ant-…`). Elle ne s'affiche qu'une seule fois.

## 2. Relais Cloudflare (gratuit, ~10 min)
1. Crée un compte sur dash.cloudflare.com.
2. **Workers & Pages > Create > Create Worker**, puis nomme-le `atelier-nanon` et clique sur **Deploy**.
3. **Edit code** : efface tout, colle le contenu de `worker/worker.js`, puis clique sur **Deploy**.
4. **Settings > Variables and Secrets**, puis ajoute deux variables de type *Secret* :
   - `ANTHROPIC_API_KEY` = la clé de l'étape 1
   - `APP_PASSWORD` = le mot de passe que tu donneras à Nanon
5. Note l'adresse du Worker, par ex. `https://atelier-nanon.sebastien.workers.dev`.
   En l'ouvrant dans un navigateur, tu dois voir `{"ok":true,...}`.

## 3. La page sur baiji.fr (GitHub Pages)
1. Crée le dépôt `svaug12345/nanon`.
2. Envoie-y les fichiers du dossier `site/` (index.html, manifest.json, sw.js, icon-192.png, icon-512.png).
3. Dans `index.html`, remplace la ligne
   `const RELAIS = "https://atelier-nanon.TON-SOUS-DOMAINE.workers.dev";`
   par l'adresse de ton Worker.
4. **Settings > Pages** : Source = branche `main`, dossier `/ (root)`.
   L'appli est alors en ligne sur **https://baiji.fr/nanon/**

## 4. Sur le téléphone de Nanon
Ouvre baiji.fr/nanon/, tape le mot de passe, puis menu ⋮ > **Ajouter à l'écran d'accueil**.

## Ce qui est déjà prévu pour faire durer le crédit
- Sonnet pour le scolaire et Haiku (bien moins cher) pour la discussion.
- Les photos sont réduites dans le téléphone avant l'envoi, et seule la plus récente est renvoyée à Claude.
- Seuls les 20 derniers messages sont envoyés, et chaque réponse est plafonnée.
- Quand le crédit est épuisé, l'appli affiche un message gentil. Tu n'es jamais facturé en plus, sauf si tu as acheté des crédits ou activé l'auto-reload.

## Sécurité
- La clé n'est jamais dans la page : seul le Worker la connaît.
- Les consignes (âge, pas de réponses toutes faites, orientation vers un adulte ou le 3018/3114 si besoin) sont imposées par le Worker. Nanon ne peut pas les modifier.
- Les conversations sont enregistrées seulement sur son téléphone (sans les photos).

## Mettre à jour
À chaque modification, augmente `VERSION` dans `index.html` et `CACHE` dans `sw.js`, pour que le téléphone recharge la nouvelle version.
