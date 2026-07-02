# CineScreen — Makefile

PROJECT       := CineScreen.xcodeproj
SCHEME        := CineScreen
APP_NAME      := CineScreen
CONFIG_DEBUG  := Debug
CONFIG_RELEASE:= Release
BUILD_DIR     := build
ARCHIVE       := $(BUILD_DIR)/$(APP_NAME).xcarchive
EXPORT_DIR    := $(BUILD_DIR)/export
APP_BUNDLE    := $(EXPORT_DIR)/$(APP_NAME).app
DMG_PATH      := $(BUILD_DIR)/$(APP_NAME).dmg

SIGNING_IDENTITY ?= Developer ID Application: Jiajun Zhang (JAT3GYBPJ4)
TEAM_ID          ?= JAT3GYBPJ4
NOTARY_PROFILE   ?= cinescreen-notary

# --- Project generation -----------------------------------------------------

.PHONY: project
project:
	xcodegen generate

# --- Build ------------------------------------------------------------------

.PHONY: build
build: project
	xcodebuild \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration $(CONFIG_DEBUG) \
	  -derivedDataPath $(BUILD_DIR)/derived \
	  build

.PHONY: test
test: project
	xcodebuild \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration $(CONFIG_DEBUG) \
	  -derivedDataPath $(BUILD_DIR)/derived \
	  test

.PHONY: build-release
build-release: project
	xcodebuild \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration $(CONFIG_RELEASE) \
	  -derivedDataPath $(BUILD_DIR)/derived \
	  build

# --- Archive + export for distribution -------------------------------------

.PHONY: archive
archive: project
	xcodebuild \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration $(CONFIG_RELEASE) \
	  -archivePath $(ARCHIVE) \
	  archive

.PHONY: export
export: archive
	@mkdir -p $(EXPORT_DIR)
	xcodebuild \
	  -exportArchive \
	  -archivePath $(ARCHIVE) \
	  -exportPath $(EXPORT_DIR) \
	  -exportOptionsPlist exportOptions.plist

# --- Notarization -----------------------------------------------------------
# Prereq (run once): xcrun notarytool store-credentials cinescreen-notary \
#                      --apple-id you@example.com \
#                      --team-id JAT3GYBPJ4 \
#                      --password APP-SPECIFIC-PASSWORD

.PHONY: dmg
dmg: export
	hdiutil create -volname $(APP_NAME) \
	  -srcfolder $(APP_BUNDLE) \
	  -ov -format UDZO $(DMG_PATH)

.PHONY: notarize
notarize: dmg
	xcrun notarytool submit $(DMG_PATH) \
	  --keychain-profile $(NOTARY_PROFILE) \
	  --wait
	xcrun stapler staple $(DMG_PATH)

.PHONY: release
release: notarize
	@echo "Release artifact: $(DMG_PATH)"

# --- Utilities --------------------------------------------------------------

.PHONY: open
open: project
	open $(PROJECT)

.PHONY: clean
clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(PROJECT)

.PHONY: help
help:
	@echo "Targets:"
	@echo "  project        — regenerate $(PROJECT) from project.yml"
	@echo "  build          — debug build"
	@echo "  test           — run unit tests"
	@echo "  build-release  — release build"
	@echo "  archive        — create xcarchive"
	@echo "  export         — export signed .app from archive"
	@echo "  dmg            — package .app into .dmg"
	@echo "  notarize       — submit DMG to Apple and staple"
	@echo "  release        — full pipeline: archive→export→dmg→notarize"
	@echo "  open           — open Xcode"
	@echo "  clean          — remove generated project and build artifacts"
