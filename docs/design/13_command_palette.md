# Tomosona — Refonte de la palette universelle

> Spécification fonctionnelle et UX source, versionnée à l'origine de la change OpenSpec `improve-command-palette` (voir `openspec/changes/improve-command-palette/`). Les artefacts de la change (spec delta, design, tasks) distillent ce document.

## Spécification fonctionnelle et UX

### 1. Objectif

Transformer la palette actuelle, principalement constituée d'une liste de commandes, en un **point d'entrée universel** permettant de :

- Retrouver et ouvrir une note.
- Rechercher une information dans les notes.
- Exécuter une commande.
- Créer une note.
- Accéder aux actions pertinentes selon le contexte.

**Principe fondamental :** l'utilisateur décrit ce qu'il cherche ou souhaite faire. Il n'a pas besoin de savoir dans quel menu se trouve la fonctionnalité.

La palette doit être utilisable intégralement au clavier, sans empêcher son utilisation à la souris.

---

### 2. État initial — Ouverture de la palette

Lorsque l'utilisateur ouvre la palette sans avoir encore saisi de texte, celle-ci présente les dernières notes consultées et quelques actions rapides.

```text
+--------------------------------------------------------------+
| Rechercher une note, un contenu, une action...                |
+--------------------------------------------------------------+
|                                                              |
| REPRENDRE                                                    |
|                                                              |
| > [Note] Créer des notes atomiques                    [Enter] |
|          Connaissances                                       |
|                                                              |
|   [Note] Journal du 31 octobre                               |
|          journal / 2026 / 10                                 |
|                                                              |
|   [Note] Roadmap de lancement                                |
|          Projets                                             |
|                                                              |
| ACTIONS RAPIDES                                              |
|                                                              |
|   [+] Créer une note                                 Cmd+N   |
|   [J] Ouvrir la note du jour                                 |
|   [*] Ouvrir les favoris                                     |
|                                                              |
+--------------------------------------------------------------+
| ↑↓ Naviguer    Enter Ouvrir    Esc Fermer    > Commandes     |
+--------------------------------------------------------------+
```

**Comportement attendu :**

- Le champ de recherche reçoit automatiquement le focus.
- Les trois dernières notes consultées sont affichées, de la plus récente à la plus ancienne.
- Les actions rapides sont accessibles sans saisie préalable.
- Le premier résultat est présélectionné.
- Les notes portent leur titre sans extension `.md`.
- Le dossier apparaît sous le titre pour faciliter leur identification.
- Si aucune note n'a encore été consultée, la palette affiche uniquement les actions de démarrage.
- Les notes favorites peuvent être proposées parmi les suggestions, sans créer de doublons.

**Règle importante :** l'état initial doit rester volontairement court. Il ne doit pas devenir un tableau de bord miniature.

---

### 3. Recherche d'une note par son titre

L'utilisateur saisit quelques lettres du titre.

Exemple : `zettel`

```text
+--------------------------------------------------------------+
| zettel                                                       |
+--------------------------------------------------------------+
|                                                              |
| NOTES                                                        |
|                                                              |
| > [Note] Méthode Zettelkasten                         [Enter] |
|          Connaissances                                       |
|                                                              |
|   [Note] Comprendre le Zettelkasten                           |
|          Exemples                                            |
|                                                              |
|   [Note] Notes atomiques et Zettelkasten                      |
|          Connaissances                                       |
|                                                              |
| DANS LE CONTENU                                              |
|                                                              |
|   [Note] Organiser ses connaissances                         |
|          "... inspirée de la méthode Zettelkasten..."         |
|                                                              |
+--------------------------------------------------------------+
| Enter Ouvrir   Cmd+Enter Nouvel onglet   Alt+Enter À droite  |
+--------------------------------------------------------------+
```

#### Règles de recherche

La recherche doit :

- Ignorer les différences entre majuscules et minuscules.
- Ignorer les accents lorsque cela facilite la correspondance.
- Reconnaître les mots partiels.
- Permettre une recherche avec plusieurs mots, quel que soit leur ordre.
- Tolérer des fautes simples de saisie.
- Donner davantage d'importance aux correspondances dans les titres qu'à celles trouvées dans le contenu.

Exemples de correspondances souhaitées :

| Saisie | Résultat attendu |
|---|---|
| `zettel` | Méthode Zettelkasten |
| `notes atom` | Créer des notes atomiques |
| `atom notes` | Créer des notes atomiques |
| `methode zettel` | Méthode Zettelkasten |
| `roadmap` | Roadmap de lancement |

#### Ouverture d'une note

- `Entrée` : ouvrir dans l'onglet courant.
- `Cmd+Entrée` : ouvrir dans un nouvel onglet.
- `Alt+Entrée` : ouvrir dans un panneau adjacent.
- Clic sur un résultat : ouvrir la note dans l'onglet courant.

La palette se ferme après ouverture, sauf dans le cas d'une action explicitement conçue pour effectuer plusieurs opérations successives.

Lorsque plusieurs notes portent le même titre, leur emplacement permet de les distinguer.

---

### 4. Recherche dans le contenu des notes

L'utilisateur recherche une expression qui apparaît dans le corps d'un document.

Exemple : `granularité fine`

```text
+--------------------------------------------------------------+
| granularité fine                                             |
+--------------------------------------------------------------+
|                                                              |
| DANS LE CONTENU                                              |
|                                                              |
| > [Note] Créer des notes atomiques                    [Enter] |
|          Connaissances > Pourquoi une seule idée ?           |
|          "La granularité fine favorise des liens             |
|           pertinents entre les notes..."                     |
|                                                              |
|   [Note] Méthode Zettelkasten                                 |
|          Connaissances > Principes fondamentaux              |
|          "Une granularité fine permet de réutiliser           |
|           plus facilement les connaissances..."             |
|                                                              |
|   [Note] Organiser ses connaissances                         |
|          "La granularité des notes joue un rôle..."           |
|                                                              |
+--------------------------------------------------------------+
| Enter Aller au passage          Esc Fermer                    |
+--------------------------------------------------------------+
```

#### Comportement attendu

Chaque résultat présente :

1. Le titre de la note.
2. Le dossier et, si possible, le titre de la section concernée.
3. Un court extrait contenant les termes recherchés.

**Lorsqu'un résultat est ouvert, l'utilisateur doit arriver directement sur le passage concerné.**

Le comportement est le suivant :

- Ouverture de la note.
- Défilement jusqu'au passage trouvé.
- Mise en évidence temporaire du texte correspondant.
- Conservation de la possibilité de modifier immédiatement le document.

Si une même note contient plusieurs passages correspondants, ils sont regroupés.

```text
[Note] Créer des notes atomiques
       3 passages trouvés

       > Pourquoi une seule idée ?
         "... la granularité fine favorise ..."

         Comment l'écrire
         "... choisir une granularité adaptée ..."

         Exemples
         "... maintenir une granularité cohérente ..."
```

L'utilisateur peut développer ou réduire les passages associés à une note.

**Règle :** ne pas saturer la liste de résultats avec de nombreuses occurrences provenant d'un seul fichier.

---

### 5. Recherche et exécution de commandes

L'utilisateur peut rechercher directement une fonctionnalité.

Exemple : `export`

```text
+--------------------------------------------------------------+
| export                                                       |
+--------------------------------------------------------------+
|                                                              |
| COMMANDES                                                    |
|                                                              |
| > [Action] Exporter la note en Word                   [Enter] |
|            Convertir la note active au format DOCX           |
|                                                              |
|   [Action] Exporter en PDF                                   |
|            Enregistrer une version PDF de la note            |
|                                                              |
|   [Action] Copier le contenu en Markdown                     |
|            Copier le texte source de la note                 |
|                                                              |
+--------------------------------------------------------------+
| Enter Exécuter      Esc Fermer                                |
+--------------------------------------------------------------+
```

Les commandes doivent être retrouvables à partir de plusieurs formulations courantes.

Exemples :

| Recherche | Commande proposée |
|---|---|
| `word` | Exporter la note en Word |
| `docx` | Exporter la note en Word |
| `convertir` | Exporter la note en Word |
| `renommer` | Renommer la note |
| `changer nom` | Renommer la note |
| `favoris` | Ajouter aux favoris / Ouvrir les favoris |
| `journal` | Ouvrir la note du jour |
| `historique` | Afficher l'historique de la note |

Les commandes comportent une description courte qui permet de comprendre leur effet avant de les exécuter.

Si une commande possède un raccourci clavier, celui-ci apparaît à droite.

#### Commandes indisponibles

Certaines commandes nécessitent un document ouvert.

Exemple :

```text
+--------------------------------------------------------------+
| renommer                                                     |
+--------------------------------------------------------------+
|                                                              |
| COMMANDES                                                    |
|                                                              |
|   [Action] Renommer la note                  [Indisponible]   |
|            Ouvrez une note pour la renommer                   |
|                                                              |
+--------------------------------------------------------------+
```

Une commande indisponible peut rester visible si elle correspond explicitement à la recherche, mais elle ne doit pas pouvoir être exécutée.

L'utilisateur doit comprendre pourquoi elle est indisponible.

---

### 6. Création d'une nouvelle note depuis la palette

Lorsqu'un utilisateur saisit un titre qui ne correspond à aucune note existante, la palette peut proposer d'en créer une.

Exemple :

```text
+--------------------------------------------------------------+
| Idées pour améliorer le moteur de recherche                  |
+--------------------------------------------------------------+
|                                                              |
| AUCUNE NOTE CORRESPONDANTE                                   |
|                                                              |
| > [+] Créer une note avec ce titre                    [Enter] |
|       Idées pour améliorer le moteur de recherche            |
|                                                              |
+--------------------------------------------------------------+
```

#### Comportement

Après validation :

1. Une nouvelle note est créée.
2. Le texte saisi devient son titre.
3. La note s'ouvre immédiatement.
4. Le curseur est placé dans le corps du document.
5. L'utilisateur peut commencer à écrire sans action supplémentaire.

Le dossier de destination est celui défini par défaut pour les nouvelles notes.

Si la palette est utilisée dans un contexte de création lié à un dossier, ce contexte peut déterminer le dossier de destination.

#### Cas où des notes correspondantes existent

L'action de création reste disponible, mais n'est pas privilégiée par rapport aux résultats pertinents.

```text
+--------------------------------------------------------------+
| moteur de recherche                                          |
+--------------------------------------------------------------+
|                                                              |
| NOTES                                                        |
|                                                              |
| > [Note] Fonctionnement du moteur de recherche               |
|   [Note] Amélioration de la recherche                         |
|                                                              |
| CRÉER                                                        |
|                                                              |
|   [+] Créer "moteur de recherche"                             |
|                                                              |
+--------------------------------------------------------------+
```

**Règle :** aucune note n'est créée automatiquement par une simple saisie. L'utilisateur valide explicitement l'action.

---

### 7. Les modes de recherche spécialisés

La palette dispose d'un mode universel par défaut, ainsi que de quelques filtres accessibles au clavier.

| Saisie | Comportement |
|---|---|
| `quelques mots` | Recherche universelle |
| `> quelques mots` | Commandes uniquement |
| `# quelques mots` | Contenu des notes uniquement |
| `? quelques mots` | Aide et raccourcis |

Ces préfixes sont facultatifs.

#### Exemple : recherche de commandes uniquement

```text
+--------------------------------------------------------------+
| > déplacer                                                   |
+--------------------------------------------------------------+
|                                                              |
| COMMANDES                                                    |
|                                                              |
| > [Action] Déplacer la note                                  |
|   [Action] Déplacer le bloc vers le haut                      |
|   [Action] Déplacer le bloc vers le bas                       |
|                                                              |
+--------------------------------------------------------------+
```

#### Exemple : recherche dans le contenu uniquement

```text
+--------------------------------------------------------------+
| # méthode de travail                                         |
+--------------------------------------------------------------+
|                                                              |
| PASSAGES TROUVÉS                                             |
|                                                              |
| > [Note] Organisation personnelle                            |
|          "... ma méthode de travail repose sur ..."          |
|                                                              |
|   [Note] Notes quotidiennes                                  |
|          "... adapter sa méthode de travail ..."             |
|                                                              |
+--------------------------------------------------------------+
```

#### Exemple : aide

```text
+--------------------------------------------------------------+
| ? liens                                                      |
+--------------------------------------------------------------+
|                                                              |
| AIDE ET RACCOURCIS                                           |
|                                                              |
| > Créer un lien entre deux notes                             |
|   Prévisualiser une note liée                                |
|   Comprendre les backlinks                                   |
|   Copier le lien d'une note                                  |
|                                                              |
+--------------------------------------------------------------+
```

L'aide peut ouvrir une page de documentation, une explication courte ou un guide existant dans Tomosona.

Le filtrage est réversible : supprimer le préfixe rétablit la recherche universelle.

---

### 8. Une palette sensible au contexte

La palette doit tenir compte de l'endroit où se trouve l'utilisateur et de ce qu'il est en train de faire.

Le but n'est pas de masquer toutes les autres commandes, mais de **mettre en avant celles qui correspondent au contexte courant**.

#### A. Aucun document ouvert

```text
+--------------------------------------------------------------+
| Rechercher...                                                |
+--------------------------------------------------------------+
|                                                              |
| ACTIONS SUGGÉRÉES                                            |
|                                                              |
| > [+] Créer une note                                         |
|   [J] Ouvrir le journal du jour                              |
|   [*] Ouvrir les favoris                                     |
|   [>] Parcourir les commandes                                |
|                                                              |
+--------------------------------------------------------------+
```

#### B. Une note est ouverte

```text
+--------------------------------------------------------------+
| Rechercher...                                                |
+--------------------------------------------------------------+
|                                                              |
| ACTIONS SUR LA NOTE                                          |
|                                                              |
| > [Action] Renommer la note                                  |
|   [Action] Déplacer la note                                  |
|   [Action] Copier le lien de la note                          |
|   [Action] Ajouter aux favoris                               |
|   [Action] Exporter en Word                                  |
|                                                              |
| AUTRES ACTIONS                                               |
|                                                              |
|   [+] Créer une note                                         |
|   [J] Ouvrir le journal du jour                              |
|                                                              |
+--------------------------------------------------------------+
```

Les actions proposées concernent la note active, sans obliger l'utilisateur à la sélectionner une nouvelle fois.

Les notes récentes restent disponibles en recherche. Elles n'ont pas besoin d'être affichées systématiquement dans chaque état contextuel.

#### C. Du texte est sélectionné

C'est un des comportements les plus intéressants.

L'utilisateur sélectionne un paragraphe et ouvre la palette.

```text
+--------------------------------------------------------------+
| Rechercher une action...                                     |
+--------------------------------------------------------------+
|                                                              |
| ACTIONS SUR LA SÉLECTION                                     |
|                                                              |
| > [+] Extraire en nouvelle note                              |
|   [L] Créer un lien vers une note                            |
|   [H] Transformer en titre                                   |
|   [B] Transformer en liste                                   |
|   [C] Copier en Markdown                                     |
|                                                              |
| AUTRES COMMANDES                                             |
|                                                              |
|   > Rechercher une commande...                               |
|                                                              |
+--------------------------------------------------------------+
```

**Exemple : « Extraire en nouvelle note »**

1. L'utilisateur sélectionne un paragraphe.
2. Il ouvre la palette.
3. Il choisit « Extraire en nouvelle note ».
4. Un titre lui est demandé, prérempli si un titre pertinent est directement disponible dans la sélection.
5. La nouvelle note est créée avec le contenu sélectionné.
6. Un lien vers cette note est ajouté dans le document d'origine.

Le comportement doit préciser si le passage d'origine est conservé ou remplacé. Par défaut, je recommande de le conserver, afin d'éviter une suppression inattendue.

Le titre peut être modifié avant création.

#### D. Un fichier est sélectionné dans l'explorateur

```text
+--------------------------------------------------------------+
| Rechercher...                                                |
+--------------------------------------------------------------+
|                                                              |
| ACTIONS SUR "Créer des notes atomiques"                       |
|                                                              |
| > [Action] Ouvrir                                            |
|   [Action] Renommer                                          |
|   [Action] Déplacer                                          |
|   [Action] Copier le lien                                     |
|   [Action] Ajouter aux favoris                               |
|   [Action] Supprimer                                         |
|                                                              |
+--------------------------------------------------------------+
```

Les actions concernent le fichier sélectionné dans l'explorateur, même si une autre note est ouverte dans l'éditeur.

Cette distinction doit rester cohérente et explicite.

#### E. L'utilisateur est dans le journal du jour

Les actions peuvent mettre en avant :

- Créer une tâche.
- Extraire une note à partir d'un passage.
- Insérer un modèle.
- Créer un lien vers une autre note.

Il ne s'agit pas d'un mode supplémentaire à sélectionner : la palette adapte simplement ses suggestions.

---

### 9. Règles de présentation des résultats mixtes

Une recherche universelle peut produire des notes, des passages et des commandes.

Exemple : `atomique`

```text
+--------------------------------------------------------------+
| atomique                                                     |
+--------------------------------------------------------------+
|                                                              |
| NOTES                                                        |
|                                                              |
| > [Note] Créer des notes atomiques                           |
|          Connaissances                                       |
|                                                              |
|   [Note] Principes des notes atomiques                       |
|          Méthodes                                            |
|                                                              |
| DANS LE CONTENU                                              |
|                                                              |
|   [Note] Gestion du temps                                    |
|          "... créer des unités atomiques de travail..."      |
|                                                              |
| CRÉER                                                        |
|                                                              |
|   [+] Créer "atomique"                                       |
|                                                              |
+--------------------------------------------------------------+
```

#### Principes de classement

Les résultats doivent être classés selon leur pertinence, notamment :

1. Correspondance exacte avec le titre.
2. Correspondance au début du titre.
3. Correspondance partielle avec le titre.
4. Correspondance dans le contenu.
5. Correspondance avec le nom ou les mots-clés d'une commande.

Des critères secondaires peuvent départager des résultats comparables :

- Note récemment consultée.
- Note favorite.
- Note souvent ouverte.
- Note appartenant au dossier courant.

Les résultats doivent conserver leur catégorie visible.

La palette affiche prioritairement un nombre limité de résultats, idéalement six à huit. Si davantage de résultats existent, l'utilisateur peut les parcourir ou ouvrir une vue de recherche complète.

**Éviter les doublons :** une même note ne doit pas apparaître plusieurs fois sans raison. Lorsqu'elle correspond à la fois par son titre et par son contenu, le résultat de titre est privilégié, tout en permettant d'accéder aux passages correspondants.

---

### 10. Navigation au clavier

La palette doit être entièrement utilisable sans souris.

| Touche | Action |
|---|---|
| `↑` / `↓` | Parcourir les résultats |
| `Entrée` | Ouvrir ou exécuter le résultat sélectionné |
| `Cmd+Entrée` | Ouvrir une note dans un nouvel onglet |
| `Alt+Entrée` | Ouvrir une note dans un panneau adjacent |
| `Esc` | Fermer la palette |
| `Cmd+A` | Sélectionner toute la recherche |
| `Retour arrière` | Modifier la saisie ou supprimer un préfixe |

#### Points d'entrée

| Raccourci proposé | Comportement |
|---|---|
| `Cmd+K` | Palette universelle |
| `Cmd+P` | Alias de la palette universelle |
| `Cmd+Shift+P` | Commandes uniquement |

Sur les plateformes concernées, `Ctrl` remplace `Cmd`.

Le raccourci `Cmd+Shift+P` déjà présent dans Tomosona est conservé.

`Cmd+P` ouvre la même palette universelle que `Cmd+K` : la recherche universelle couvre déjà les notes par titre, un filtre dédié n'apporterait rien de plus. `Cmd+Shift+P` ouvre la palette avec le filtre `>` (commandes).

Les raccourcis doivent rester cohérents avec ceux de l'éditeur, notamment si `Cmd+K` est déjà utilisé pour insérer un lien.

#### Conservation du focus

Quand l'utilisateur ouvre la palette depuis l'éditeur :

1. Sa position dans le document est conservée.
2. Son éventuelle sélection est conservée.
3. Il peut naviguer et lancer une commande.
4. Lorsqu'il ferme la palette sans action, le curseur revient exactement à son emplacement initial.

Une action qui modifie une sélection doit utiliser la sélection initiale, même si le focus est passé dans la palette.

---

### 11. Menus secondaires et actions complémentaires

Certains résultats peuvent offrir plusieurs actions.

Exemple :

```text
+--------------------------------------------------------------+
| zettel                                                       |
+--------------------------------------------------------------+
|                                                              |
| NOTES                                                        |
|                                                              |
| > [Note] Méthode Zettelkasten                                |
|          Connaissances                                       |
|                                                              |
|          Enter       Ouvrir                                  |
|          Cmd+Enter   Nouvel onglet                           |
|          Alt+Enter   Ouvrir à droite                          |
|          Tab         Plus d'actions                          |
|                                                              |
+--------------------------------------------------------------+
```

L'action principale reste toujours « Ouvrir ».

Les actions secondaires peuvent comprendre :

- Copier le lien de la note.
- Ajouter aux favoris.
- Ouvrir dans un nouvel onglet.
- Ouvrir dans un panneau adjacent.
- Afficher l'emplacement du fichier.

Ces options doivent rester secondaires pour ne pas ralentir le parcours principal.

---

### 12. États particuliers

#### A. Aucun résultat

```text
+--------------------------------------------------------------+
| xyzabc                                                       |
+--------------------------------------------------------------+
|                                                              |
| Aucun résultat pour "xyzabc"                                 |
|                                                              |
| > [+] Créer une note "xyzabc"                                |
|   [>] Rechercher dans les commandes                           |
|                                                              |
+--------------------------------------------------------------+
```

Un message clair indique qu'aucun résultat n'a été trouvé.

L'utilisateur peut créer une note, modifier sa recherche ou changer de filtre.

#### B. Commande nécessitant une confirmation

Pour une action destructive :

```text
+--------------------------------------------------------------+
| Supprimer "Créer des notes atomiques" ?                      |
+--------------------------------------------------------------+
|                                                              |
| Cette note sera déplacée dans la corbeille.                  |
|                                                              |
| > Annuler                                                    |
|   Confirmer la suppression                                   |
|                                                              |
+--------------------------------------------------------------+
```

La confirmation ne doit pas être demandée pour des actions ordinaires, mais doit protéger les opérations présentant un risque réel de perte de données.

#### C. Recherche en cours

La saisie reste possible pendant la recherche.

Les résultats disponibles apparaissent progressivement, sans obliger l'utilisateur à attendre l'ensemble des correspondances.

La sélection actuelle ne doit pas changer de façon inattendue lorsqu'un résultat supplémentaire arrive.

#### D. Retour dans la palette

Quand la palette est ouverte à nouveau :

- Le champ est vide par défaut.
- Les dernières notes apparaissent.
- Les actions récentes ou fréquentes peuvent être proposées.
- L'utilisateur ne doit pas retrouver une ancienne recherche sans l'avoir demandé.

#### E. Fenêtre ou écran étroit

Les informations secondaires peuvent être abrégées, mais le titre du résultat et l'action principale doivent rester accessibles.

La navigation au clavier doit rester identique.

---

### 13. La palette et les fonctionnalités Markdown

La palette ne doit pas remplacer les interactions naturelles de l'éditeur.

Chaque mécanisme a un rôle précis.

| Interaction | Rôle |
|---|---|
| `[[` | Rechercher et insérer un lien vers une note |
| `/` | Insérer ou transformer un bloc |
| Palette universelle | Rechercher, naviguer et exécuter des commandes globales |
| Menu contextuel | Agir directement sur un élément visible |
| Explorateur | Parcourir et organiser les fichiers |

Ces mécanismes peuvent proposer certaines actions communes, sans pour autant multiplier les interfaces identiques.

Par exemple, « Transformer en liste » peut être accessible depuis `/`, le menu de bloc et la palette. Le résultat doit être le même.

La palette doit devenir l'alternative rapide aux menus, pas une obligation pour effectuer les opérations courantes.

---

### 14. Personnalisation légère

Sans configuration complexe, la palette peut privilégier certaines habitudes.

Dans son état initial, elle peut présenter :

- Les dernières notes consultées.
- Les commandes récemment exécutées.
- Les commandes utilisées fréquemment.
- Les notes favorites.

Exemple :

```text
+--------------------------------------------------------------+
| Rechercher...                                                |
+--------------------------------------------------------------+
|                                                              |
| REPRENDRE                                                    |
|                                                              |
| > [Note] Roadmap de lancement                                |
|   [Note] Notes de réunion                                    |
|                                                              |
| VOS ACTIONS FRÉQUENTES                                       |
|                                                              |
|   [Action] Exporter en Word                                  |
|   [Action] Ouvrir le journal du jour                          |
|   [Action] Insérer un modèle                                 |
|                                                              |
| AUTRES                                                       |
|                                                              |
|   [+] Créer une note                                         |
|                                                              |
+--------------------------------------------------------------+
```

L'utilisateur doit pouvoir retrouver une organisation prévisible : les résultats explicitement recherchés restent classés selon leur pertinence, et les habitudes personnelles ne doivent pas produire de changements incompréhensibles.

---

### 15. Périmètre fonctionnel recommandé

#### Priorité 1 — Expérience fondamentale

- Ouverture rapide de la palette.
- État initial avec dernières notes et actions fréquentes.
- Recherche de notes par titre.
- Recherche floue et insensible aux accents.
- Recherche et exécution de commandes.
- Navigation complète au clavier.
- Raccourcis cohérents.
- Création d'une note depuis la palette.
- Affichage des résultats par catégorie.
- Gestion des états vides et des commandes indisponibles.

#### Priorité 2 — Recherche et navigation approfondies

- Recherche dans le contenu des notes.
- Extraits contextualisés.
- Navigation directement au passage trouvé.
- Regroupement des occurrences d'une même note.
- Filtres de recherche.
- Ouverture en nouvel onglet ou panneau adjacent.
- Actions secondaires sur les résultats.

#### Priorité 3 — Fluidité contextuelle

- Suggestions selon la note active.
- Actions selon le texte sélectionné.
- Actions sur les fichiers sélectionnés dans l'explorateur.
- Extraction d'un passage en nouvelle note.
- Personnalisation des actions fréquentes.
- Accès aux fonctionnalités d'aide.

---

### 16. Critères de réussite UX

La palette sera considérée comme réussie si les comportements suivants sont vérifiés :

| Scénario | Résultat attendu |
|---|---|
| L'utilisateur connaît une partie du titre | Il retrouve sa note parmi les premiers résultats |
| Il connaît une phrase du document | Il retrouve directement le passage |
| Il cherche une fonction sans en connaître le nom exact | Une formulation courante permet de la retrouver |
| Il souhaite créer une note | Il peut la créer depuis une simple saisie |
| Il veut agir sur la sélection | Les commandes pertinentes sont immédiatement accessibles |
| Il souhaite ouvrir plusieurs notes | Il peut choisir entre onglet courant, nouvel onglet et panneau adjacent |
| Il utilise seulement le clavier | Aucune opération essentielle n'exige la souris |
| Il ferme la palette sans agir | Il retrouve exactement son contexte initial |
| Une commande n'est pas disponible | Il comprend immédiatement pourquoi |
| Aucun résultat ne correspond | Une solution utile lui est proposée |

### 17. Principe directeur

**La palette ne doit jamais imposer à l'utilisateur de comprendre l'organisation de Tomosona pour agir.**

Il sait ce qu'il veut faire : retrouver une note, chercher une phrase, exporter un document, créer une idée, modifier un passage.

La palette doit être capable de lui présenter rapidement l'action ou le contenu correspondant, avec un minimum d'étapes.

Trois qualités doivent guider tous les arbitrages :

- **Immédiateté :** peu de frappes, peu de clics, pas d'étape inutile.
- **Prévisibilité :** les mêmes actions produisent toujours les mêmes résultats.
- **Discrétion :** la palette disparaît dès qu'elle a rempli son rôle, sans perturber le travail en cours.

L'objectif n'est pas de proposer le plus grand nombre de commandes possible, mais de faire en sorte que **l'utilisateur trouve presque toujours ce qu'il cherche en quelques secondes**.
