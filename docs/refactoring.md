# Plan de refactoring

Ce document suit les améliorations de maintenabilité de Tomosona. Les lots sont
à réaliser dans cet ordre afin de sécuriser les flux asynchrones avant de
réorganiser les modules qui les portent.

## Principes de travail

- [ ] Préserver les comportements utilisateur et les contrats IPC existants sauf
      correction de défaut avéré.
- [ ] Garder les changements petits, testés et faciles à relire.
- [ ] Préférer une responsabilité claire à une extraction qui ne ferait que
      déplacer des callbacks ou des `ref`.
- [ ] Mettre à jour ce document après chaque lot terminé, avec les décisions ou
      écarts utiles.

## Lot 1 — Consolider le filet de sécurité

- [ ] Faire exécuter les tests Rust dans la CI, en plus de `cargo check`.
- [ ] Ajouter des tests directs pour `useWorkspaceMutationEffects` : ordre des
      mutations, échec d'une tâche, mise à jour immédiate et synchronisation
      différée.
- [ ] Ajouter des tests directs pour `useAppNotePersistence` : document virtuel,
      renommage, conflit de sauvegarde et échec d'E/S.
- [ ] Ajouter des tests directs pour `useAppShellRootWorkflow` sur ses parcours
      réellement observables.
- [ ] Réduire les tests qui vérifient uniquement du texte source lorsqu'un test
      de comportement ou une règle d'import peut protéger la même intention.
- [ ] Mesurer l'intérêt de réserver JSDOM aux tests de composants et aux
      composables qui dépendent du DOM.

Critère de fin : la CI exécute les tests frontend et Rust ; les flux sensibles
ont des tests de régression centrés sur leurs résultats.

## Lot 2 — Fiabiliser les opérations asynchrones par workspace

- [ ] Introduire un contexte minimal d'opération frontend contenant l'identité
      du workspace et une génération.
- [ ] Capturer ce contexte au lancement d'une mutation, d'une indexation ou d'un
      travail différé ; ignorer les résultats devenus obsolètes.
- [ ] Ne plus relire implicitement le workspace courant à la fin d'une opération
      commencée dans un autre workspace.
- [ ] Faire porter explicitement au backend la racine capturée lors d'une
      opération d'indexation ou d'ouverture de base.
- [ ] Tester un changement de workspace pendant une indexation, une sauvegarde
      et une mutation de chemin en attente.

Critère de fin : une opération lancée dans le workspace A ne peut ni modifier
l'état visible ni écrire dans l'index du workspace B.

## Lot 3 — Corriger le cycle de vie de la synchronisation filesystem

- [ ] Rendre `start()` et `dispose()` idempotents dans
      `useAppShellWorkspaceFsSync`.
- [ ] Désabonner une inscription qui se termine après un `dispose()`.
- [ ] Autoriser une nouvelle tentative après un échec d'abonnement.
- [ ] Ajouter les tests d'entrelacement : arrêt avant résolution, échec puis
      reprise, appels répétés de démarrage et d'arrêt.

Critère de fin : il n'existe ni abonnement orphelin ni état bloquant une reprise
de la synchronisation.

## Lot 4 — Rétablir les frontières entre couches

- [ ] Supprimer les imports `domains -> app` en déplaçant les règles réellement
      partagées dans des modules partagés, aux responsabilités limitées.
- [ ] Déplacer les règles propres aux notes dans le domaine éditeur ; conserver
      dans `app` le routage et l'orchestration d'interface.
- [ ] Centraliser les règles Rust de validation et de normalisation des chemins
      dans `workspace_paths.rs` ; supprimer les doublons de `fs_ops.rs`.
- [ ] Ajouter une règle automatisée qui détecte les imports interdits entre
      couches.
- [ ] Couvrir les chemins avec séparateurs variés, Unicode, liens symboliques et
      casse pertinente.

Critère de fin : les dépendances suivent `app -> domains -> shared` et chaque
règle de sécurité sur les chemins possède une seule implémentation backend.

## Lot 5 — Simplifier l'assemblage du shell

- [ ] Supprimer les composables qui ne font que relayer un appel sans porter de
      règle, d'état ou de cycle de vie.
- [ ] Remplacer les ports initialisés par des actions silencieusement inertes par
      des contrats construits avec toutes leurs dépendances requises.
- [ ] Répartir les responsabilités hétérogènes de `useAppShellRootWorkflow`
      selon leur vrai propriétaire.
- [ ] Réduire `App.vue` à l'assemblage de contrôleurs, aux view-models typés et
      au rendu des surfaces.
- [ ] Ajouter des tests aux workflows conservés, plutôt que des tests de forme
      sur les fichiers sources.

Critère de fin : un comportement global a un propriétaire évident et son ajout
ne nécessite pas de modifier une chaîne de relais ou d'initialisations partielles.

## Lot 6 — Découper les modules aux responsabilités multiples

- [ ] Séparer `fs_ops.rs` entre opérations de fichiers, aperçus de documents et
      intégrations système, sans changer les commandes Tauri publiques.
- [ ] Séparer `markdownBlocks.ts` entre parsing Markdown, sérialisation Markdown
      et adaptation du presse-papiers.
- [ ] Extraire du runtime de chrome de l'éditeur le menu orthographique avec son
      état, ses requêtes et son cycle de vie.
- [ ] Séparer dans l'export DOCX le parcours Markdown, le calcul des tableaux et
      le post-traitement du fichier produit.
- [ ] Après chaque extraction, ajouter ou déplacer les tests vers l'unité qui
      porte effectivement le comportement.

Critère de fin : chaque module peut évoluer dans son domaine sans demander de
connaître des détails non liés.

## Lot 7 — Rendre les contrats de l'éditeur plus explicites

- [ ] Remplacer progressivement `EditorBlock` (`type: string` +
      `Record<string, unknown>`) par une union discriminée pour les blocs connus
      et un cas de repli explicite.
- [ ] Partager les invariants communs des sessions texte et riches sans imposer
      une abstraction sur les moteurs CodeMirror et Tiptap.
- [ ] Terminer les nettoyages déjà identifiés dans le backlog du runtime éditeur :
      supprimer le `computed` statique des commandes slash, supprimer ou justifier
      `void documentPersistence`, puis grouper les sorties cohérentes.
- [ ] Tester les conversions Markdown ↔ blocs ↔ document Tiptap avec des
      fixtures incluant frontmatter, tableaux, listes, HTML et blocs inconnus.

Critère de fin : le compilateur exprime les formes de blocs prises en charge et
les contrats publics des runtimes restent courts et cohérents.

## Lot 8 — Réduire le coût d'entretien quotidien

- [ ] Aligner les documents d'architecture et le guide de tests sur les modules
      réellement présents.
- [ ] Corriger la commande `preflight:full` et vérifier les commandes de release.
- [ ] Documenter clairement la convention de version publique et interne.
- [ ] Étudier les imports lourds du bundle principal et extraire uniquement les
      fonctionnalités dont le chargement différé améliore réellement le démarrage.
- [ ] Ajouter des contrôles non correctifs adaptés au projet si leur signal est
      utile et stable.

Critère de fin : les guides, scripts et contrôles reflètent le fonctionnement
réel du dépôt.

## Vérifications à exécuter après chaque lot

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` lorsque le backend est
      touché
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` lorsque le backend est
      touché

## Décisions et suivi

Ajouter ici, au fil des lots, les décisions qui changent l'ordre ou l'approche.

- Aucune décision consignée pour le moment.
