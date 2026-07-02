import SwiftUI
import AppKit

struct SidebarView: View {
    @Bindable var vm: EditorViewModel
    @State private var saveMessage: String?
    @State private var exportFraction: Double = 0
    @State private var isExporting: Bool = false
    @State private var exportError: String?
    /// Live pipeline while an export runs — kept so the Cancel button can
    /// reach it. Nil outside an export.
    @State private var exportPipeline: ExportPipeline?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            exportRow

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    card(title: "Background", icon: "photo.on.rectangle.angled") { canvasControls }
                    card(title: "Cursor",     icon: "cursorarrow.rays")           { cursorControls }
                    card(title: "Zoom",       icon: "plus.magnifyingglass")       { zoomControls }
                    if vm.webcamPlayer != nil {
                        card(title: "Webcam",  icon: "video.fill")                { webcamControls }
                    }
                    card(title: "Trim",       icon: "scissors")                   { trimControls }
                    card(title: "Recording",  icon: "info.circle")                { info }
                }
            }
            .scrollIndicators(.never)

            if isExporting {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Exporting…").font(.caption).foregroundStyle(CTheme.textSecondary)
                        Spacer()
                        Button("Cancel") { exportPipeline?.cancel() }
                            .buttonStyle(.plain)
                            .font(.caption)
                            .foregroundStyle(CTheme.textSecondary)
                            .help("Stop the export and delete the partial file")
                    }
                    ProgressView(value: exportFraction, total: 1.0)
                }
            }
            if let exportError = exportError {
                Text(exportError)
                    .font(.caption)
                    .foregroundStyle(CTheme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let saveMessage = saveMessage {
                Text(saveMessage)
                    .font(.caption2)
                    .foregroundStyle(CTheme.textSecondary)
            }
        }
        .padding(14)
        .frame(width: 304)
        .background(CTheme.panel)
        .tint(CTheme.accent)
    }

    // MARK: - Top export row

    private var exportRow: some View {
        HStack(spacing: 8) {
            Button {
                saveEdits()
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 36, height: 32)
                    .foregroundStyle(CTheme.textSecondary)
                    .background(
                        RoundedRectangle(cornerRadius: CTheme.Radius.sm, style: .continuous)
                            .fill(CTheme.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CTheme.Radius.sm, style: .continuous)
                            .strokeBorder(CTheme.stroke, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .disabled(vm.metadataURL == nil || vm.metadata == nil)
            .help("Save edits to metadata")

            Spacer()

            Button {
                startExport()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 12, weight: .semibold))
                    Text("Export")
                        .font(.system(size: 13, weight: .semibold))
                }
                .frame(height: 32)
            }
            .buttonStyle(CineFilledButtonStyle(palette: .accent, shape: .rounded(CTheme.Radius.sm), font: .system(size: 13, weight: .semibold), hPad: 14, vPad: 0, glow: true))
            .disabled(isExporting || vm.metadata == nil)
        }
    }

    // MARK: - Card scaffolding

    @ViewBuilder
    private func card<Content: View>(title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                CineIconChip(symbol: icon, tint: CTheme.accent, size: 20)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(CTheme.textPrimary)
                Spacer()
            }
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cineCard(radius: CTheme.Radius.md)
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
                    .foregroundStyle(CTheme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var cursorControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let metadata = vm.metadata, !metadata.cursor.keyframes.isEmpty {
                HStack {
                    Text("Size")
                        .font(.caption)
                        .foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Text("\(Int(metadata.cursor.config.size)) px")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(CTheme.textSecondary)
                }
                Slider(
                    value: Binding(
                        get: { vm.metadata?.cursor.config.size ?? 64 },
                        set: { vm.metadata?.cursor.config.size = $0 }
                    ),
                    in: 16...256, step: 1
                )
                .tint(CTheme.accent)
                HStack {
                    Text("Keyframes")
                        .font(.caption)
                        .foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Text("\(metadata.cursor.keyframes.count)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(CTheme.textSecondary)
                }

                Divider().padding(.vertical, 2)

                // Glide style — drives the cursor + camera smoothing time.
                HStack {
                    Text("Glide").font(.caption).foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Picker("", selection: Binding(
                        get: { vm.metadata?.zoom.config.animationStyle ?? .slow },
                        set: { vm.metadata?.zoom.config.animationStyle = $0 }
                    )) {
                        Text("Slow").tag(ZoomConfig.AnimationStyle.slow)
                        Text("Mellow").tag(ZoomConfig.AnimationStyle.mellow)
                        Text("Quick").tag(ZoomConfig.AnimationStyle.quick)
                        Text("Rapid").tag(ZoomConfig.AnimationStyle.rapid)
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .controlSize(.small)
                    .fixedSize()
                }

                Toggle(isOn: motionBlurEnabled) {
                    Text("Motion Blur").font(.caption).foregroundStyle(CTheme.textSecondary)
                }
                .toggleStyle(.switch)
                .controlSize(.small)

                if vm.metadata?.cursor.config.motionBlur?.enabled == true {
                    Slider(value: motionBlurStrength, in: 0...1)
                        .tint(CTheme.accent)
                }

                Toggle(isOn: hideWhenStatic) {
                    Text("Hide When Idle").font(.caption).foregroundStyle(CTheme.textSecondary)
                }
                .toggleStyle(.switch)
                .controlSize(.small)
            } else if vm.metadata == nil {
                Label("No metadata loaded", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(CTheme.warning)
                Text("This recording is missing its `recording.json` sidecar — the cursor track can't be rendered. Try recording a new project.")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label("No cursor keyframes", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(CTheme.warning)
                Text("Accessibility permission may not have been granted during recording, so no mouse events were captured.")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

        }

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
                    .foregroundStyle(CTheme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                if vm.isAutoZoomMode {
                    Text("Auto-generated from clicks. Add or delete any section to start editing manually.")
                        .font(.caption2)
                        .foregroundStyle(CTheme.textSecondary)
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

    }

    @ViewBuilder
    private func selectedZoomEditor(index: Int, section: ZoomSection) -> some View {
        let scaleBinding = Binding<Double>(
            get: { section.scale },
            set: { vm.updateZoomSection(at: index, scale: $0) }
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
                Text("Scale").font(.caption).foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text(String(format: "%.2fx", section.scale))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: scaleBinding, in: 1.0...4.0, step: 0.05)
                .tint(CTheme.accent)

            // Length
            HStack {
                Text("Length").font(.caption).foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text(format(section.endTime - section.startTime))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: lengthBinding,
                   in: 100...max(500, vm.metadata?.video.duration ?? 1000),
                   step: 50)
                .tint(CTheme.accent)

            Text("Pan is auto-framed to follow the cursor with rule-of-thirds smoothing — no manual focal point needed.")
                .font(.caption2)
                .foregroundStyle(CTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            Text("Drag the block on the timeline to move it; drag the 3-pt edges to resize.")
                .font(.caption2)
                .foregroundStyle(CTheme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func zoomRow(index: Int, section: ZoomSection) -> some View {
        let selected = vm.selectedZoomIndex == index
        return HStack(spacing: 6) {
            Text(String(format: "%.1fx", section.scale))
                .font(.system(.caption, design: .monospaced))
                .frame(width: 36, alignment: .leading)
                .foregroundStyle(CTheme.textPrimary)
            Text("\(format(section.startTime)) → \(format(section.endTime))")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(CTheme.textSecondary)
            Spacer()
            Button {
                vm.removeZoomSection(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(CTheme.brand)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: CTheme.Radius.xs)
                .fill(selected ? CTheme.accent.opacity(0.18) : Color.clear)
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
                    .foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text("\(Int(vm.canvasPadding * 200))%")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: $vm.canvasPadding, in: 0...0.25)
                .tint(CTheme.accent)

            Toggle(isOn: $vm.canvasDropShadow) {
                Text("Drop Shadow")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
            }
            .toggleStyle(.switch)
            .controlSize(.small)

            HStack {
                Text("Shadow Strength")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text("\(Int(vm.canvasShadowStrength * 100))%")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: $vm.canvasShadowStrength, in: 0...1)
                .tint(CTheme.accent)
                .disabled(!vm.canvasDropShadow)
                .opacity(vm.canvasDropShadow ? 1.0 : 0.5)

            HStack {
                Text("Background")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
                Spacer()
            }
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 36, maximum: 44), spacing: 6)],
                spacing: 6
            ) {
                ForEach(CanvasBackground.presets, id: \.name) { preset in
                    Button {
                        vm.canvasBackground = preset.bg
                    } label: {
                        backgroundPresetTile(preset.bg)
                            .frame(height: 32)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(vm.canvasBackground == preset.bg ? CTheme.accent : CTheme.stroke, lineWidth: vm.canvasBackground == preset.bg ? 2 : 1)
                            )
                            .help(preset.name)
                    }
                    .buttonStyle(.plain)
                }
            }
        }

    }

    /// SwiftUI preview tile mirroring the GPU gradient — same colours, same angle.
    @ViewBuilder
    private func backgroundPresetTile(_ bg: CanvasBackground) -> some View {
        let colors = bg.stops.map { stop in
            Color(red: Double(stop.color.x), green: Double(stop.color.y), blue: Double(stop.color.z))
        }
        // GPU angle: 0 = left→right; 90 = bottom→top. SwiftUI's UnitPoint is
        // y-down, so convert by negating sin.
        let rad = Double(bg.angleDegrees) * .pi / 180
        let dx = cos(rad), dy = -sin(rad)
        if colors.count <= 1 {
            RoundedRectangle(cornerRadius: 6).fill(colors.first ?? .black)
        } else {
            RoundedRectangle(cornerRadius: 6).fill(
                LinearGradient(
                    colors: colors,
                    startPoint: UnitPoint(x: 0.5 - dx * 0.5, y: 0.5 - dy * 0.5),
                    endPoint: UnitPoint(x: 0.5 + dx * 0.5, y: 0.5 + dy * 0.5)
                )
            )
        }
    }

    private var trimControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            trimStepperRow(
                "Start",
                value: $vm.trimStartMs,
                range: 0...max(0, vm.trimEndMs - 100)
            )
            trimStepperRow(
                "End",
                value: $vm.trimEndMs,
                range: (vm.trimStartMs + 100)...max(vm.trimStartMs + 100, vm.durationMs)
            )
            row("Length", format(vm.trimEndMs - vm.trimStartMs))

            Button("Reset to full clip") {
                vm.trimStartMs = 0
                vm.trimEndMs = vm.durationMs
            }
            .buttonStyle(CineGhostButtonStyle(
                shape: .rounded(CTheme.Radius.sm),
                font: .system(size: 11, weight: .medium), hPad: 10, vPad: 5
            ))
            .disabled(vm.trimStartMs == 0 && vm.trimEndMs == vm.durationMs)
        }
    }

    private func trimStepperRow(_ label: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(CTheme.textSecondary)
            Spacer()
            Text(format(value.wrappedValue))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(CTheme.textPrimary)
            Stepper("", value: value, in: range, step: 100)
                .labelsHidden()
                .controlSize(.small)
        }
    }

    // MARK: - Webcam

    private var webcamControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Show webcam overlay", isOn: Binding(
                get: { vm.webcamLayout.enabled },
                set: { vm.setWebcamEnabled($0) }
            ))
            .font(.system(size: 12))

            // Size slider — the diameter is clamped 5%..60% in the model.
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Size").font(.caption).foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Text("\(Int(vm.webcamLayout.diameterNorm * 100))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(CTheme.textSecondary)
                }
                Slider(
                    value: Binding(
                        get: { Double(vm.webcamLayout.diameterNorm) },
                        set: {
                            var next = vm.webcamLayout
                            next.diameterNorm = Float($0)
                            vm.setWebcamLayout(next)
                        }
                    ),
                    in: 0.05...0.6
                )
                .tint(CTheme.accent)
            }
            .disabled(!vm.webcamLayout.enabled)
            .opacity(vm.webcamLayout.enabled ? 1.0 : 0.5)

            Button("Reset Position") { vm.resetWebcamLayout() }
                .font(.caption)
                .disabled(!vm.webcamLayout.enabled)

            Text("Drag the circle in the preview to reposition; drag the corner handle to resize.")
                .font(.caption2)
                .foregroundStyle(CTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Cursor effect bindings

    private var motionBlurEnabled: Binding<Bool> {
        Binding(
            get: { vm.metadata?.cursor.config.motionBlur?.enabled ?? false },
            set: { on in
                let strength = vm.metadata?.cursor.config.motionBlur?.strength ?? 0.5
                vm.metadata?.cursor.config.motionBlur = CursorConfig.MotionBlur(enabled: on, strength: strength)
            }
        )
    }

    private var motionBlurStrength: Binding<Double> {
        Binding(
            get: { vm.metadata?.cursor.config.motionBlur?.strength ?? 0.5 },
            set: { vm.metadata?.cursor.config.motionBlur = CursorConfig.MotionBlur(enabled: true, strength: $0) }
        )
    }

    private var hideWhenStatic: Binding<Bool> {
        Binding(
            get: { vm.metadata?.cursor.config.hideWhenStatic ?? false },
            set: { vm.metadata?.cursor.config.hideWhenStatic = $0 }
        )
    }

    // MARK: - Helpers

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(CTheme.textSecondary)
            Spacer()
            Text(value).font(.system(.caption, design: .monospaced)).foregroundStyle(CTheme.textSecondary)
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
        // All edits (trim, canvas, webcam, zoom) are already mirrored into
        // vm.metadata by their didSet/mutation paths — this just flushes the
        // debounced autosave immediately for explicit feedback.
        if vm.saveNow() {
            saveMessage = "Saved to \(url.lastPathComponent)"
        } else {
            saveMessage = "Save failed: \(vm.lastSaveError ?? "unknown error")"
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
        let cursorSmoother = ExportCursorSmoother()

        let cursorAt: @Sendable (Double) -> CursorRenderState? = { ms in
            guard var state = snapshot.cursorStateForExport(atMilliseconds: ms) else { return nil }
            state.positionInVideoPixels = cursorSmoother.smoothed(
                target: state.positionInVideoPixels,
                atMilliseconds: ms,
                smoothTime: snapshot.adaptiveCursorSmoothTime(
                    atMilliseconds: ms,
                    spriteAt: cursorSmoother.currentPosition
                )
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
        // Pause the editor preview while the export runs. The preview's
        // MetalRenderer fires at 60fps and pulls frames via the same Metal
        // device — keeping it active during export contends for the GPU
        // and the source files' decoder pools, slowing exports and (in
        // some configs) stalling them entirely.
        vm.pause()

        let pipeline = ExportPipeline()
        exportPipeline = pipeline
        let webcamLayout = vm.webcamLayout
        // Progress events flow through one ordered stream consumed by a
        // single task. The old per-event `Task { @MainActor }` fan-out could
        // run events out of order — progress jumping backwards, or a late
        // failure landing after the success toast.
        let (progressStream, progressCont) = AsyncStream.makeStream(of: ExportPipeline.Progress.self)
        Task { @MainActor in
            for await progress in progressStream {
                switch progress {
                case let .running(fraction): exportFraction = fraction
                case .finished:              exportFraction = 1
                }
            }
        }
        Task { @MainActor in
            defer {
                progressCont.finish()
                isExporting = false
                exportPipeline = nil
            }
            do {
                let out = try await pipeline.export(.init(
                    sourceVideoURL: vm.videoURL,
                    outputURL: outURL,
                    trimRangeMs: trimRange,
                    cursorAt: cursorAt,
                    clicksAt: clicksAt,
                    zoomAt: zoomAt,
                    canvas: vm.canvasStyle,
                    webcamURL: vm.webcamURL,
                    webcamLayout: webcamLayout
                )) { progress in
                    progressCont.yield(progress)
                }
                saveMessage = "Exported to \(out.lastPathComponent)"
            } catch ExportError.cancelled {
                saveMessage = "Export cancelled"
            } catch {
                exportError = error.localizedDescription
            }
        }
    }
}
