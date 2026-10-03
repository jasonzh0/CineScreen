#!/usr/bin/env bash
# Compile the production motion code without the app host or Metal compiler.
# Exit 1 means the audit's proposed motion checks detected an issue.
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
audit_dir="$(mktemp -d "${TMPDIR:-/tmp}/cinescreen-motion-audit.XXXXXX")"
trap 'rm -rf "$audit_dir"' EXIT
cd "$repo_dir"

python3 - "$audit_dir" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
fixtures = Path('Tests/CineScreenTests/Fixtures.swift').read_text()
(out / 'Fixtures.swift').write_text(fixtures.replace('@testable import CineScreen', ''))
PY

cp docs/audit/motion.swift "$audit_dir/main.swift"
xcrun swiftc -O \
  CineScreen/Models/Metadata.swift \
  CineScreen/Models/CanvasBackground.swift \
  CineScreen/Models/EditTimeline.swift \
  CineScreen/Models/OutputGeometry.swift \
  CineScreen/Util/Spring.swift \
  CineScreen/Util/RGBAColor.swift \
  CineScreen/Editor/RenderSnapshot.swift \
  CineScreen/Compositor/RenderState.swift \
  "$audit_dir/Fixtures.swift" \
  "$audit_dir/main.swift" \
  -o "$audit_dir/motion-audit"
"$audit_dir/motion-audit"
