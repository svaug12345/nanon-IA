// =====================================================================
//  Nanon Claude IA — serveur relais (Cloudflare Worker)
// ---------------------------------------------------------------------
//  Pourquoi ce relais ? La page web est publique : si la clé API y était,
//  n'importe qui pourrait la lire (clic droit > code source) et vider
//  le crédit. Ici, la clé reste cachée côté Cloudflare.
//
//  Ce que fait le relais, dans l'ordre :
//   1. vérifie que la demande vient bien de baiji.fr (CORS) ;
//   2. vérifie le mot de passe de l'appli ;
//   3. choisit LUI-MÊME le modèle et les consignes selon le mode
//      (Nanon ne peut donc pas les modifier depuis son téléphone) ;
//   4. transmet la conversation à l'API Claude et renvoie la réponse.
//
//  Variables à créer dans Cloudflare (Settings > Variables and Secrets) :
//   - ANTHROPIC_API_KEY : ta clé API (type « Secret »)
//   - APP_PASSWORD      : le mot de passe que tu donnes à Nanon (« Secret »)
// =====================================================================

const VERSION = "1.3.1"; // 1.2.0 : défis + coach ; 1.3.0 : streaming ; 1.3.1 : messages clairs si mot de passe absent/faux

// Modes qui peuvent répondre « en direct » (mot à mot). Les autres (quiz, créer, coach)
// ont besoin de la réponse complète pour être découpée, donc pas de streaming.
const MODES_EN_DIRECT = ["devoirs", "photo", "discussion"];

// Seuls ces sites ont le droit d'appeler le relais.
const ORIGINES_AUTORISEES = ["https://baiji.fr", "https://www.baiji.fr"];

// Modèle par mode : Sonnet (plus fiable) pour le scolaire,
// Haiku (beaucoup moins cher) pour la discussion → le crédit dure plus longtemps.
const MODELES = {
  devoirs: "claude-sonnet-5-5",
  photo: "claude-sonnet-5-5",
  quiz: "claude-sonnet-5-5",
  creer: "claude-sonnet-5-5", // le code demande le modèle le plus fiable
  coach: "claude-sonnet-5-5", // relit le code modifié par Nanon
  discussion: "claude-haiku-5-5",
};

// Longueur maximale d'une réponse (en « tokens », ~¾ de mot chacun).
// Plafonner = éviter qu'une seule réponse coûte cher.
// « creer » a besoin de plus de place : un petit jeu complet fait vite 4 000 à 6 000 tokens.
const MAX_TOKENS = { devoirs: 1500, photo: 1500, quiz: 3000, creer: 8000, coach: 900, discussion: 1000 };

// ---------------------------------------------------------------------
//  Consignes (« system prompt ») communes à tous les modes
// ---------------------------------------------------------------------
const CONSIGNES_COMMUNES = `
Tu es l'assistant personnel de Nanon, une élève de 14 ans. C'est son papa qui a créé cette appli pour elle.
Règles qui s'appliquent toujours :
- Réponds en français, avec un ton chaleureux, simple et encourageant, adapté à une ado de 14 ans. Tutoie-la.
- Fais des réponses courtes et lisibles sur un téléphone : petits paragraphes, listes si utile.
- N'utilise jamais LaTeX. Écris les maths en texte simple : x², √, ×, ÷, ≤, fractions sous la forme a/b.
- Reste adapté à son âge : pas de contenu violent, sexuel, dangereux ou choquant, même si on te le demande.
- Ne lui demande jamais d'informations personnelles (adresse, école, mots de passe…).
- Si elle parle de quelque chose d'inquiétant (harcèlement, grosse tristesse, mal-être, danger), réponds avec douceur,
  prends-la au sérieux et encourage-la à en parler à ses parents ou à un adulte de confiance. Tu peux citer le 3018
  (harcèlement et cyberharcèlement, gratuit) et le 3114 (si elle va très mal).
- Si tu n'es pas sûr d'une information, dis-le honnêtement.
`;

// Consignes propres à chaque mode.
const CONSIGNES_MODE = {
  devoirs: `
MODE AIDE AUX DEVOIRS. Ton but : qu'elle comprenne et réussisse PAR ELLE-MÊME.
- Ne donne pas directement la réponse finale d'un exercice noté. Demande-lui d'abord ce qu'elle a compris ou essayé.
- Guide-la étape par étape avec des questions et des indices, une étape à la fois.
- Si elle bloque après plusieurs essais, montre la méthode sur un exemple SIMILAIRE (autres nombres, autre phrase), puis laisse-la refaire le sien.
- Quand elle propose une réponse, vérifie-la : félicite ce qui est juste, explique gentiment l'erreur sinon.
- Pour une rédaction ou un texte, aide-la à trouver des idées et à structurer, mais ne l'écris pas à sa place.
- Pour une simple question de cours (« c'est quoi une métaphore ? »), tu peux expliquer directement avec un exemple.`,

  photo: `
MODE PHOTO D'EXERCICE. Nanon t'envoie une photo de son cahier, de son manuel ou d'une fiche.
- Commence par dire en une ou deux lignes ce que tu lis (matière + consigne), pour vérifier que tu as bien lu.
- Si la photo est floue ou coupée, demande-lui de la reprendre.
- Ensuite, applique la même méthode que pour l'aide aux devoirs : guide-la avec des questions et des indices,
  ne donne pas directement les réponses finales, vérifie ce qu'elle propose.`,

  quiz: `
MODE RÉVISIONS. Nanon te donne une leçon (texte ou photo). Tu fabriques une fiche de révision et un quiz.
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, de cette forme exacte :
{
  "titre": "titre court de la leçon",
  "fiche": ["point clé 1", "point clé 2", "... (5 à 8 points courts à retenir)"],
  "questions": [
    {"question": "…", "choix": ["…", "…", "…", "…"], "bonne": 0, "explication": "pourquoi c'est la bonne réponse, en une ou deux phrases"}
  ]
}
- Fais 8 questions, avec exactement 4 choix chacune. "bonne" est l'index (0 à 3) de la bonne réponse ; varie sa position.
- Les questions portent uniquement sur le contenu de la leçon fournie, du plus facile au plus difficile.
- Si le contenu n'est pas une leçon exploitable, renvoie {"erreur": "explication courte"}.`,

  creer: `
MODE CRÉER. Nanon apprend à créer des choses avec l'IA : jeux, animations, outils, petites pages web.
Ton rôle : coder pour elle ET lui apprendre à bien utiliser l'IA, pour lui donner envie de tester et d'inventer.

Réponds TOUJOURS dans ce format exact :
TITRE: (titre court du projet, 2 à 5 mots)
(2 ou 3 phrases simples : ce que tu as fait ou changé)
💡 Astuce IA : (une astuce courte et concrète pour mieux utiliser l'IA, liée à SA demande : ce qui était bien formulé,
ou ce qu'elle pourrait préciser la prochaine fois. Varie les astuces d'une fois à l'autre.)
🚀 Idée : (une amélioration amusante qu'elle pourrait demander ensuite)
🎯 À toi de jouer : (un petit défi qu'elle fera ELLE-MÊME en modifiant le code, sans l'IA. Dis-lui quoi changer et
où regarder (nom de la variable ou commentaire à chercher), mais pas la solution exacte. Adapte la difficulté à son niveau,
indiqué dans sa demande : niveau 0-2 = changer une valeur (couleur, vitesse, texte) ; 3-5 = modifier une condition ou
un calcul ; 6+ = ajouter quelques lignes (nouvelle fonction, nouveau bouton).)
\`\`\`html
(le document HTML COMPLET)
\`\`\`

Règles pour le code :
- Un seul fichier HTML autonome, avec le CSS et le JavaScript dedans. Aucune bibliothèque externe, aucune requête réseau,
  aucune image externe : dessine avec CSS, SVG, canvas ou emojis. Pour les sons, utilise la Web Audio API.
- Le résultat s'affiche dans un cadre sécurisé sur un téléphone : mise en page adaptée au mobile, commandes TACTILES
  (boutons à l'écran, pas seulement le clavier). N'utilise PAS localStorage, cookies, alert(), prompt() ni confirm() : ils sont bloqués.
- Si on te donne le code actuel, renvoie le fichier COMPLET modifié, en gardant tout ce qui fonctionne déjà.
- Code clair, avec des commentaires courts en français, pour qu'elle puisse apprendre en le lisant.
  Regroupe en haut du script les réglages faciles à modifier (couleurs, vitesse, textes), avec un commentaire
  « RÉGLAGES : tu peux changer ces valeurs ! ».
- Si elle demande d'expliquer le code, mets l'explication (aussi longue que nécessaire, simple) avant le bloc de code.
- Si sa demande est floue, fais une première version simple qui marche, et propose des précisions dans l'Idée.
- Contenu adapté à son âge : pas de violence réaliste, rien de dangereux ni de méchant envers une vraie personne.
- Si elle t'envoie la photo d'un dessin ou d'un schéma, inspire-t'en pour le projet.`,

  coach: `
MODE COACH DE CODE. Nanon a modifié elle-même le code de son projet pour relever un défi. Tu reçois le défi,
le code d'avant et son code modifié. Ton rôle : l'aider à apprendre, PAS faire à sa place.
Commence ta réponse par une seule ligne : « RÉUSSI » si le défi est relevé et que le code marche, sinon « PAS ENCORE ».
Puis, en 3 à 6 phrases courtes :
- Si RÉUSSI : félicite-la précisément (ce qu'elle a bien compris), explique en une phrase pourquoi ça marche,
  et propose un mini défi bonus un peu plus dur.
- Si PAS ENCORE : dis ce qui est déjà bien, puis donne UN indice pour avancer (où chercher, quelle notion).
  Ne donne pas la ligne corrigée. Si elle a cassé quelque chose (erreur de syntaxe, accolade oubliée…), aide-la à le trouver.
Ne renvoie jamais le fichier complet.`,

  discussion: `
MODE DISCUSSION LIBRE. Discute de tout ce qui l'intéresse : curiosités, idées, histoires, conseils d'organisation,
langues, culture, projets créatifs… Sois curieux et sympa, pose-lui des questions en retour.
Nanon apprend aussi à utiliser l'IA :
- Si elle te demande comment marche l'IA, explique simplement, y compris ses limites : tu peux te tromper avec assurance,
  tu n'as pas accès à internet ici et tes connaissances s'arrêtent à une date, tu ne te souviens pas des autres conversations.
- Si elle te demande quelque chose de récent ou de très précis que tu ne peux pas savoir, dis-le clairement plutôt que d'inventer,
  et encourage-la à vérifier dans une vraie source.
- Si elle te demande de l'aider à mieux formuler une demande pour une IA, aide-la : précision, contexte, exemple, étapes.
- Si elle te donne un rôle (personnage historique, prof d'anglais…), joue le jeu tout en restant exact sur les faits.
Si elle te demande de faire un devoir à sa place, propose plutôt de l'aider à le faire (onglet Devoirs).`,
};

// ---------------------------------------------------------------------
//  Petites fonctions utilitaires
// ---------------------------------------------------------------------

// En-têtes CORS : autorisent la page baiji.fr à lire nos réponses.
function enTetesCors(origine) {
  return {
    "Access-Control-Allow-Origin": ORIGINES_AUTORISEES.includes(origine) ? origine : ORIGINES_AUTORISEES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
    "Access-Control-Max-Age": "86400",
  };
}

// Renvoie un objet JavaScript sous forme de réponse JSON.
function json(objet, statut, cors) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

// Vérifie qu'un message a une forme acceptable (texte ou images uniquement).
// On refuse tout le reste pour qu'on ne puisse rien glisser d'inattendu.
const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
function messageValide(m) {
  if (!m || (m.role !== "user" && m.role !== "assistant")) return false;
  // 80 000 caractères max par texte : assez pour renvoyer le code d'un projet « Créer ».
  if (typeof m.content === "string") return m.content.length > 0 && m.content.length < 80000;
  if (!Array.isArray(m.content) || m.content.length === 0) return false;
  return m.content.every((bloc) => {
    if (bloc.type === "text") return typeof bloc.text === "string" && bloc.text.length < 80000;
    if (bloc.type === "image")
      return bloc.source?.type === "base64" && TYPES_IMAGE.includes(bloc.source.media_type);
    return false;
  });
}

// ---------------------------------------------------------------------
//  Point d'entrée : Cloudflare appelle cette fonction à chaque requête
// ---------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const origine = request.headers.get("Origin") || "";
    const cors = enTetesCors(origine);

    // Le navigateur envoie d'abord une requête OPTIONS « puis-je ? » : on répond oui.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // Petite page de test si on ouvre l'adresse du relais dans un navigateur.
    if (request.method === "GET") return json({ ok: true, appli: "Nanon Claude IA", version: VERSION }, 200, cors);

    if (request.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405, cors);

    // 1. Provenance : seulement depuis baiji.fr
    if (!ORIGINES_AUTORISEES.includes(origine)) return json({ erreur: "Origine non autorisée" }, 403, cors);

    // 2. Mot de passe de l'appli
    //    D'abord : est-il bien configuré dans Cloudflare ? (sinon, message clair au lieu d'un refus en boucle)
    if (!env.APP_PASSWORD)
      return json({ erreur: "Configuration : le secret APP_PASSWORD n'existe pas dans Cloudflare." }, 500, cors);
    if (!env.ANTHROPIC_API_KEY)
      return json({ erreur: "Configuration : le secret ANTHROPIC_API_KEY n'existe pas dans Cloudflare." }, 500, cors);
    //    Puis on compare (en ignorant les espaces en trop au début et à la fin).
    if ((request.headers.get("X-App-Password") || "").trim() !== env.APP_PASSWORD.trim())
      return json({ erreur: "Mot de passe incorrect" }, 401, cors);

    // Taille maximale de la requête (~10 Mo, une photo compressée fait ~300 Ko)
    if (Number(request.headers.get("Content-Length") || 0) > 10_000_000)
      return json({ erreur: "Envoi trop lourd" }, 413, cors);

    // Lecture du corps envoyé par la page : { mode, messages }
    let corps;
    try {
      corps = await request.json();
    } catch {
      return json({ erreur: "Requête illisible" }, 400, cors);
    }
    const { mode, messages } = corps || {};
    // La page demande le direct ; on ne l'accepte que pour les modes prévus.
    const enDirect = corps?.stream === true && MODES_EN_DIRECT.includes(mode);

    // 3. Vérifications du contenu
    if (!MODELES[mode]) return json({ erreur: "Mode inconnu" }, 400, cors);
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40)
      return json({ erreur: "Conversation invalide" }, 400, cors);
    if (!messages.every(messageValide)) return json({ erreur: "Message invalide" }, 400, cors);

    // On ne garde que role + content (on ignore tout autre champ ajouté côté page).
    const propres = messages.map((m) => ({ role: m.role, content: m.content }));

    // 4. Appel à l'API Claude
    let reponse, donnees;
    try {
      reponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODELES[mode],
          max_tokens: MAX_TOKENS[mode],
          system: CONSIGNES_COMMUNES + CONSIGNES_MODE[mode], // imposé ici, jamais par la page
          messages: propres,
          stream: enDirect,               // true = l'API envoie la réponse morceau par morceau
        }),
      });
      // En direct et sans erreur : on fait passer le flux tel quel jusqu'au téléphone.
      if (enDirect && reponse.ok) {
        return new Response(reponse.body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...cors },
        });
      }
      donnees = await reponse.json();
    } catch {
      return json({ erreur: "Impossible de joindre Claude, réessaie dans un instant." }, 502, cors);
    }

    if (!reponse.ok) {
      // Message clair si le crédit du mois est épuisé.
      const msg = donnees?.error?.message || "Erreur de l'API";
      const epuise = /credit balance/i.test(msg);
      return json(
        { erreur: epuise ? "Le crédit du mois est épuisé, il revient au prochain renouvellement 🙂" : msg },
        reponse.status,
        cors
      );
    }

    // On rassemble les morceaux de texte de la réponse.
    const texte = (donnees.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return json({ texte, usage: donnees.usage }, 200, cors);
  },
};
