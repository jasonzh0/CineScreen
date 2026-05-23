import SwiftUI
import AppKit

struct SidebarView: View {
    @Bindable var vm: EditorViewModel
    @State private var saveMessage: String?
    @State private var exportFraction: Double = 0
    @State private var isExporting: Bool = false
    @State private var exportError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header("Recording")
            info

            header("Cursor")
            cursorControls

            header("Zoom")
            zoomControls

            header("Canvas")
            canvasControls

            header("Trim")
            trimControls

            Spacer()

            if let saveMessage = saveMessage {
                Text(saveMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if isExporting {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Exporting…").font(.caption).foregroundStyle(.secondary)
                    ProgressView(value: exportFraction, total: 1.0)
                }
            }
            if let exportError = exportError {
                Text(exportError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Button {
                    saveEdits()
                } label: {
                    Label("Save Edits", systemImage: "checkmark.circle")
                }
                .buttonStyle(.bordered)
                .disabled(vm.metadataURL == nil || vm.metadata == nil)

                Button {
                    startExport()
                } label: {
                    Label("Export…", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isExporting || vm.metadata == nil)
            }
        }
        .padding(16)
        .frame(width: 260)
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    // MARK: - Sections

    private func header(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .tracking(0.6)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            row("File", vm.videoURL.lastPathComponent)
            if let meta = vm.metadata {
                row("Size", "\(meta.video.width) × \(meta.video.height)")
                row("FPS", String(format: "%.0f", meta.video.frameRate))
                row("Keyframes", String(meta.cursor.keyframes.count))
                row("Clicks", String(meta.clicks.count))
            } else if vm.loadError != nil {
                Text(vm.loadError ?? "")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private var cursorControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let metadata = vm.metadata, !metadata.cursor.keyframes.isEmpty {
                HStack {
                    Text("Size")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Int(metadata.cursor.config.size)) px")
                        .font(.system(.caption, design: .monospaced))
                }
                Slider(
                    value: Binding(
                        get: { vm.metadata?.cursor.config.size ?? 64 },
                        set: { vm.metadata?.cursor.config.size = $0 }
                    ),
                    in: 16...256, step: 1
                )
                HStack {
                    Text("Keyframes")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(metadata.cursor.keyframes.count)")
                        .font(.system(.caption, design: .monospaced))
                }
            } else if vm.metadata == nil {
                Label("No metadata loaded", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                Text("This recording is missing its `recording.json` sidecar — the cursor track can't be rendered. Try recording a new project.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label("No cursor keyframes", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                Text("Accessibility permission may not have been granted during recording, so no mouse events were captured.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

        }
        .padding(10)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private var zoomControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button {
                    vm.addZoomSection()
                } label: {
                    Label("Add", systemImage: "plus")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Button {
                    vm.suggestZoomSections()
                } label: {
                    Label("Suggest", systemImage: "sparkles")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help("Replace all zoom sections with auto-detected ones based on click events")
                Spacer()
            }

            let sections = vm.effectiveZoomSections
            if sections.isEmpty {
                Text("No zoom sections. Click Add to insert one at the playhead.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                if vm.isAutoZoomMode {
                    Text("Auto-generated from clicks. Add or delete any section to start editing manually.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 4) {
                    ForEach(Array(sections.enumerated()), id: \.offset) { idx, section in
                        zoomRow(index: idx, section: section)
                    }
                }
                if let selected = vm.selectedZoomIndex, sections.indices.contains(selected) {
                    selectedZoomEditor(index: selected, section: sections[selected])
                }
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private func selectedZoomEditor(index: Int, section: ZoomSection) -> some View {
        let videoW = Double(vm.metadata?.video.width ?? 1920)
        let videoH = Double(vm.metadata?.video.height ?? 1080)

        let scaleBinding = Binding<Double>(
            get: { section.scale },
            set: { vm.updateZoomSection(at: index, scale: $0) }
        )
        let centerXBinding = Binding<Double>(
            get: { section.centerX / max(1, videoW) },
            set: { vm.updateZoomSection(at: index, centerX: $0 * videoW) }
        )
        let centerYBinding = Binding<Double>(
            get: { section.centerY / max(1, videoH) },
            set: { vm.updateZoomSection(at: index, centerY: $0 * videoH) }
        )
        let lengthBinding = Binding<Double>(
            get: { section.endTime - section.startTime },
            set: { newLen in
                let clamped = max(100, min((vm.metadata?.video.duration ?? 0) - section.startTime, newLen))
                vm.updateZoomSection(at: index, endTime: section.startTime + clamped)
            }
        )

        VStack(alignment: .leading, spacing: 8) {
            Divider().padding(.vertical, 4)

            // Scale
            HStack {
                Text("Scale").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.2fx", section.scale))
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: scaleBinding, in: 1.0...4.0, step: 0.05)

            // Length
            HStack {
                Text("Length").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(format(section.endTime - section.startTime))
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: lengthBinding,
                   in: 100...max(500, vm.metadata?.video.duration ?? 1000),
                   step: 50)

            // Centre X / Y as 0..100% sliders so users can dial where the zoom
            // focuses without doing pixel math.
            HStack {
                Text("Centre X").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.0f%%", section.centerX / max(1, videoW) * 100))
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: centerXBinding, in: 0...1)

            HStack {
                Text("Centre Y").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.0f%%", section.centerY / max(1, videoH) * 100))
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: centerYBinding, in: 0...1)

            HStack {
                Button("Centre on playhead cursor") {
                    centerOnCursor(index: index)
                }
                .font(.caption)
                .controlSize(.small)
                Spacer()
            }
            .padding(.top, 2)

            Text("Drag the block on the timeline to move it; drag the 3-pt edges to resize.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Snap the selected zoom section's centre to wherever the cursor is at
    /// playhead time — useful when you want the camera to follow a specific
    /// click or interaction.
    private func centerOnCursor(index: Int) {
        guard let snapshot = vm.makeRenderSnapshot(),
              let cursor = snapshot.cursorStateForExport(atMilliseconds: vm.currentTimeMs) else { return }
        vm.updateZoomSection(
            at: index,
            centerX: Double(cursor.positionInVideoPixels.x),
            centerY: Double(cursor.positionInVideoPixels.y)
        )
    }

    private func zoomRow(index: Int, section: ZoomSection) -> some View {
        let selected = vm.selectedZoomIndex == index
        return HStack(spacing: 6) {
            Text(String(format: "%.1fx", section.scale))
                .font(.system(.caption, design: .monospaced))
                .frame(width: 36, alignment: .leading)
                .foregroundStyle(.primary)
            Text("\(format(section.startTime)) → \(format(section.endTime))")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                vm.removeZoomSection(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(selected ? Color.accentColor.opacity(0.18) : Color.clear)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            vm.selectedZoomIndex = index
            vm.seek(toMilliseconds: section.startTime)
        }
    }

    private var canvasControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Padding")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(vm.canvasPadding * 200))%")
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: $vm.canvasPadding, in: 0...0.25)

            HStack {
                Text("Corner Radius")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.0f", vm.canvasCornerRadius * 100))
                    .font(.system(.caption, design: .monospaced))
            }
            Slider(value: $vm.canvasCornerRadius, in: 0...0.2)

            HStack {
                Text("Background")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                ForEach(["#000000", "#1a1a1a", "#2b2b2b", "#6aabdf", "#dd5a5a", "#5acf85"], id: \.self) { hex in
                    Button {
                        vm.canvasBackgroundHex = hex
                    } label: {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(swatchColor(hex))
                            .frame(width: 18, height: 18)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4)
                                    .stroke(vm.canvasBackgroundHex == hex ? Color.accentColor : .clear, lineWidth: 2)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    private func swatchColor(_ hex: String) -> Color {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return .black }
        return Color(
            red: Double((v >> 16) & 0xff) / 255,
            green: Double((v >> 8) & 0xff) / 255,
            blue: Double(v & 0xff) / 255
        )
    }

    private var trimControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            row("Start", format(vm.trimStartMs))
            row("End", format(vm.trimEndMs))
            row("Length", format(vm.trimEndMs - vm.trimStartMs))
        }
        .padding(10)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Helpers

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.system(.caption, design: .monospaced))
        }
    }

    private func format(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        let m = total / 60
        let s = total % 60
        let cs = Int((ms.truncatingRemainder(dividingBy: 1000)) / 10)
        return String(format: "%02d:%02d.%02d", m, s, cs)
    }

    private func saveEdits() {
        guard let url = vm.metadataURL else { return }
        // Write current trim + cursor config back into metadata.
        vm.metadata?.trim = TrimRange(startMs: vm.trimStartMs, endMs: vm.trimEndMs)
        do {
            try vm.metadata?.write(to: url)
            saveMessage = "Saved to \(url.lastPathComponent)"
        } catch {
            saveMessage = "Save failed: \(error.localizedDescription)"
        }
    }

    private func startExport() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.mpeg4Movie]
        panel.nameFieldStringValue = vm.videoURL.deletingPathExtension().lastPathComponent + "_export.mp4"
        guard panel.runModal() == .OK, let outURL = panel.url else { return }

        let trimRange: Range<Double> =
            (vm.trimStartMs < vm.trimEndMs) ? (vm.trimStartMs ..< vm.trimEndMs) : (0 ..< 0)

        // Snapshot all per-frame state inputs on the main actor BEFORE the
        // export task spins up. The pipeline runs its closures on
        // background DispatchQueues — touching `vm` from there crashed the
        // app via `_dispatch_assert_queue_fail`.
        guard let snapshot = vm.makeRenderSnapshot() else {
            exportError = "Recording has no metadata to export."
            return
        }

        // Spring-smooth the export cursor so it glides between sparse
        // keyframes like the live preview does. Stateful across frames —
        // safe because the export pipeline processes video frames serially
        // on a single queue.
        let cursorSmoother = ExportCursorSmoother(smoothTime: snapshot.cursorSmoothTime)

        let cursorAt: @Sendable (Double) -> CursorRenderState? = { ms in
            guard var state = snapshot.cursorStateForExport(atMilliseconds: ms) else { return nil }
            state.positionInVideoPixels = cursorSmoother.smoothed(
                target: state.positionInVideoPixels, atMilliseconds: ms
            )
            return state
        }
        let clicksAt: @Sendable (Double) -> [ClickRingState] = { ms in
            snapshot.clickRingStates(atMilliseconds: ms)
        }
        let zoomAt: @Sendable (Double) -> ZoomState = { ms in
            snapshot.zoomState(atMilliseconds: ms)
        }

        isExporting = true
        exportError = nil
        exportFraction = 0
        Task { @MainActor in
            do {
                let pipeline = ExportPipeline()
                _ = try await pipeline.export(.init(
                    sourceVideoURL: vm.videoURL,
                    outputURL: outURL,
                    trimRangeMs: trimRange,
                    cursorAt: cursorAt,
                    clicksAt: clicksAt,
                    zoomAt: zoomAt,
                    canvas: vm.canvasStyle
                )) { progress in
                    Task { @MainActor in
                        switch progress {
                        case .starting:
                            self.exportFraction = 0
                        case let .running(fraction):
                            self.exportFraction = fraction
                        case .finished:
                            self.exportFraction = 1
                        case let .failed(message):
                            self.exportError = message
                        }
                    }
                }
                saveMessage = "Exported to \(outURL.lastPathComponent)"
                isExporting = false
            } catch {
                exportError = error.localizedDescription
                isExporting = false
            }
        }
    }
}
