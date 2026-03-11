.PHONY: help install dev tauri-dev tauri-dev-open-debug build tauri-build tauri-prod-local tauri-prod-local-open-debug preflight preflight-full clean clean-frontend clean-tauri clean-deps prepare-release

# VS Code installed via Snap injects GTK paths/modules that break WebKitGTK child
# processes on some Ubuntu/Kubuntu setups. Clear them for Tauri launches.
TAURI_ENV_CLEAN = env -u GIO_MODULE_DIR -u GTK_PATH -u GTK_EXE_PREFIX -u GTK_DATA_PREFIX -u GTK_MODULES -u GTK3_MODULES -u GTK4_MODULES

help:
	@echo "Available targets:"
	@echo "  make install      Install dependencies"
	@echo "  make dev          Run frontend dev server"
	@echo "  make tauri-dev    Run Tauri desktop app in dev mode"
	@echo "  make tauri-dev-open-debug  Run Tauri dev with note-open tracing enabled"
	@echo "  make build        Build frontend production bundle"
	@echo "  make tauri-build  Build Tauri desktop app bundle/installers"
	@echo "  make tauri-prod-local  Build and run the local release binary with production frontend assets"
	@echo "  make tauri-prod-local-open-debug  Same as tauri-prod-local with note-open tracing enabled"
	@echo "  make preflight    Run local CI-like frontend checks (typecheck + vite build)"
	@echo "  make preflight-full  Run preflight plus Tauri Linux bundles (appimage,deb)"
	@echo "  make clean        Remove frontend and Tauri build artifacts"
	@echo "  make clean-frontend  Remove dist/"
	@echo "  make clean-tauri  Remove src-tauri/target/"
	@echo "  make clean-deps   Remove node_modules/"
	@echo "  make prepare-release VERSION=X.Y.Z  Update app versions and build changelog release entry"

install:
	npm install

dev:
	npm run dev

tauri-dev:
	$(TAURI_ENV_CLEAN) npm run tauri:dev

tauri-dev-open-debug:
	$(TAURI_ENV_CLEAN) TOMOSONA_DEBUG_OPEN=1 npm run tauri:dev

build:
	npm run build

tauri-build:
	npm run tauri:build

tauri-prod-local:
	$(TAURI_ENV_CLEAN) npm run tauri:build -- --no-bundle
	$(TAURI_ENV_CLEAN) ./src-tauri/target/release/tomosona

tauri-prod-local-open-debug:
	$(TAURI_ENV_CLEAN) npm run tauri:build -- --no-bundle
	$(TAURI_ENV_CLEAN) TOMOSONA_DEBUG_OPEN=1 ./src-tauri/target/release/tomosona

preflight:
	npm run preflight

preflight-full:
	npm run preflight:full

clean: clean-frontend clean-tauri

clean-frontend:
	rm -rf dist

clean-tauri:
	rm -rf src-tauri/target

clean-deps:
	rm -rf node_modules

prepare-release:
	@if [ -z "$(VERSION)" ]; then \
		echo "Usage: make prepare-release VERSION=X.Y.Z"; \
		exit 1; \
	fi
	@if ! echo "$(VERSION)" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		echo "Invalid VERSION '$(VERSION)'. Expected format: X.Y.Z (or vX.Y.Z)"; \
		exit 1; \
	fi
	@./scripts/prepare-version.sh "$(VERSION)"
	@./scripts/build-changelog.sh --version "$(VERSION)"
	@VERSION_NO_V="$(VERSION)"; VERSION_NO_V=$${VERSION_NO_V#v}; \
	CURRENT_BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	echo ""; \
	echo "Release files are prepared. Review changes before committing:"; \
	echo "  git status"; \
	echo "  git diff"; \
	echo ""; \
	echo "Suggested commit message:"; \
	echo "  chore(release): prepare v$$VERSION_NO_V"; \
	echo ""; \
	echo "Suggested commands:"; \
	echo "  git commit -m \"chore(release): prepare v$$VERSION_NO_V\""; \
	echo "  git tag v$$VERSION_NO_V"; \
	echo "  git push origin $$CURRENT_BRANCH"; \
	echo "  git push origin v$$VERSION_NO_V"; \
	echo ""; \
	echo "One-liner command:"; \
	echo "  git commit -m \"chore(release): prepare v$$VERSION_NO_V\" && git tag v$$VERSION_NO_V && git push origin $$CURRENT_BRANCH && git push origin v$$VERSION_NO_V"
