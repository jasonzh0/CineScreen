.PHONY: build bump-patch bump-minor bump-major version

# Build the application
build:
	@npm run build
	@npm run package:mac

# Show current version
version:
	@echo "Current version: $$(node -p "require('./package.json').version")"

# Bump patch version (1.0.0 -> 1.0.1)
bump-patch:
	@echo "Bumping patch version..."
	@npm version patch --no-git-tag-version
	@echo "New version: $$(node -p "require('./package.json').version")"

# Bump minor version (1.0.0 -> 1.1.0)
bump-minor:
	@echo "Bumping minor version..."
	@npm version minor --no-git-tag-version
	@echo "New version: $$(node -p "require('./package.json').version")"

# Bump major version (1.0.0 -> 2.0.0)
bump-major:
	@echo "Bumping major version..."
	@npm version major --no-git-tag-version
	@echo "New version: $$(node -p "require('./package.json').version")"
