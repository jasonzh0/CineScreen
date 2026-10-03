import SwiftUI
import AppKit

struct SidebarView: View {
    @Bindable var vm: EditorViewModel
    @State private var saveMessage: String?
    @State private var inspectorTab = 0
    @State private var exportedURL: URL?
    @State private var presetName = "My look"
    @State private var exportFraction: Double = 0
    @State private var isExporting: Bool = false
    @State private var exportError: String?
    /// Live pipeline while an export runs — kept so the Cancel button can
    /// reach it. Nil outside an export.
    @State private var exportPipeline: ExportPipeline?
    @State private var showExportOptions = false
    /// Output size as a fraction of the source (1.0 = native).
    @State private var exportScale: Double = 1.0
    /// H.264 bits-per-pixel budget; 0.10 matches the previous fixed value.
    @State private var exportBitsPerPixel: Double = 0.10
    @State private var exportFormat: ExportPipeline.Format = .mp4

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            exportRow

            Picker("Inspector", selection: $inspectorTab) {
                Text("Edit").tag(0)
                Text("Appearance").tag(1)
            }
            .pickerStyle(.segmented)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if inspectorTab == 0 {
                        if let selected = vm.selectedZoomIndex,
                           vm.effectiveZoomSections.indices.contains(selected) {
                            card(title: "Selected Zoom", icon: "plus.magnifyingglass") {
                                selectedZoomEditor(index: selected, section: vm.effectiveZoomSections[selected])
                            }
                        } else if let id = vm.selectedSegmentID,
                                  let segment = vm.retainedSegments.first(where: { $0.id == id }) {
                            card(title: "Selected Clip", icon: "film") { segmentControls(segment) }
                        }
                        card(title: "Zoom", icon: "plus.magnifyingglass") { zoomControls }
                        card(title: "Output", icon: "aspectratio") { outputControls }
                        card(title: "Audio", icon: "waveform") { audioControls }
                        card(title: "Trim", icon: "scissors") { trimControls }
                        card(title: "Recording", icon: "info.circle") { info }
                    } else {
                        card(title: "Saved Looks", icon: "star") { presetControls }
                        card(title: "Background", icon: "photo.on.rectangle.angled") { canvasControls }
                        card(title: "Cursor", icon: "cursorarrow.rays") { cursorControls }
                        card(title: "Clicks", icon: "hand.tap") { clickControls }
                        if vm.webcamPlayer != nil {
                            card(title: "Webcam", icon: "video.fill") { webcamControls }
                        }
                    }
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
            if let out = exportedURL {
                HStack {
                    Button("Reveal") { NSWorkspace.shared.activateFileViewerSelecting([out]) }
                    Button("Open") { NSWorkspace.shared.open(out) }
                    Button("Copy Video") { NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects([out as NSURL]) }
                }.controlSize(.small)
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
        .onChange(of: vm.selectedZoomIndex) { _, selected in if selected != nil { inspectorTab = 0 } }
        .onChange(of: vm.selectedSegmentID) { _, selected in if selected != nil { inspectorTab = 0 } }
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
                showExportOptions = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 32, height: 32)
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
            .disabled(isExporting)
            .help("Export options")
            .popover(isPresented: $showExportOptions, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Format", selection: $exportFormat) {
                        Text("MP4").tag(ExportPipeline.Format.mp4)
                        Text("GIF").tag(ExportPipeline.Format.gif)
                    }
                    .pickerStyle(.segmented)
                    Picker("Resolution", selection: $exportScale) {
                        Text("Full").tag(1.0)
                        Text("75%").tag(0.75)
                        Text("50%").tag(0.5)
                    }
                    .pickerStyle(.segmented)
                    .disabled(exportFormat == .gif)
                    Picker("Quality", selection: $exportBitsPerPixel) {
                        Text("Low").tag(0.05)
                        Text("Medium").tag(0.10)
                        Text("High").tag(0.16)
                    }
                    .pickerStyle(.segmented)
                    .disabled(exportFormat == .gif)
                    if exportFormat == .gif {
                        Text("GIF exports at up to 15 fps, capped at 960 px, without audio.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .frame(width: 240)
            }

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

    private func segmentControls(_ segment: EditSegment) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            row("Source", "\(format(segment.startMs)) – \(format(segment.endMs))")
            Picker("Speed", selection: Binding(get: { segment.speed }, set: vm.setSelectedSegmentSpeed)) {
                ForEach([0.25, 0.5, 1.0, 1.5, 2.0, 4.0], id: \.self) { speed in
                    Text(String(format: "%.2g×", speed)).tag(speed)
                }
            }
            HStack {
                Button("Split at playhead", action: vm.splitAtPlayhead)
                Button("Delete clip", role: .destructive, action: vm.removeSelectedSegment)
            }.controlSize(.small)
            Text("Deleting a clip closes the gap in playback and export. The original recording stays available.")
                .font(.caption2).foregroundStyle(CTheme.textSecondary)
        }
    }

    private var outputControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Canvas", selection: Binding(get: { vm.outputSettings.aspectRatio }, set: { vm.outputSettings.aspectRatio = $0 })) {
                ForEach(OutputAspectRatio.allCases) { ratio in Text(ratio.label).tag(ratio) }
            }
            if let video = vm.metadata?.video {
                let size = vm.outputSettings.dimensions(sourceWidth: video.width, sourceHeight: video.height)
                row("Dimensions", "\(size.width) × \(size.height)")
            }
            Picker("Frame rate", selection: Binding(get: { vm.outputSettings.frameRate }, set: { vm.outputSettings.frameRate = $0 })) {
                Text("30 fps").tag(30)
                Text("60 fps").tag(60)
            }
            Text("Source crop").font(.caption).foregroundStyle(CTheme.textSecondary)
            Slider(value: Binding(get: { vm.outputSettings.crop.width }, set: { width in
                let centerX = vm.outputSettings.crop.x + vm.outputSettings.crop.width / 2
                let centerY = vm.outputSettings.crop.y + vm.outputSettings.crop.height / 2
                vm.outputSettings.crop = NormalizedCrop(x: centerX - width / 2, y: centerY - width / 2,
                                                       width: width, height: width).clamped()
            }), in: 0.25...1, onEditingChanged: vm.sliderEditing)
            HStack {
                Text("Horizontal").font(.caption)
                Slider(value: Binding(get: { vm.outputSettings.crop.x }, set: { vm.outputSettings.crop.x = $0 }),
                       in: 0...max(0.001, 1 - vm.outputSettings.crop.width), onEditingChanged: vm.sliderEditing)
            }.disabled(vm.outputSettings.crop.width >= 1)
            HStack {
                Text("Vertical").font(.caption)
                Slider(value: Binding(get: { vm.outputSettings.crop.y }, set: { vm.outputSettings.crop.y = $0 }),
                       in: 0...max(0.001, 1 - vm.outputSettings.crop.height), onEditingChanged: vm.sliderEditing)
            }.disabled(vm.outputSettings.crop.height >= 1)
            Button("Reset crop") { vm.outputSettings.crop = .full }.controlSize(.small)
        }
    }

    private var audioControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Mute captured audio", isOn: Binding(get: { vm.outputSettings.audioMuted }, set: { vm.outputSettings.audioMuted = $0 }))
            HStack {
                Text("Volume").font(.caption)
                Spacer()
                Text("\(Int(vm.outputSettings.audioGain * 100))%").font(.caption.monospacedDigit())
            }
            Slider(value: Binding(get: { vm.outputSettings.audioGain }, set: { vm.outputSettings.audioGain = $0 }),
                   in: 0...2, onEditingChanged: vm.sliderEditing).disabled(vm.outputSettings.audioMuted)
        }.font(.caption)
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
                    in: 16...256, step: 1, onEditingChanged: vm.sliderEditing
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
                    Slider(value: motionBlurStrength, in: 0...1, onEditingChanged: vm.sliderEditing)
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
    private var clickControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $vm.clickRingsEnabled) {
                Text("Click Rings").font(.caption).foregroundStyle(CTheme.textSecondary)
            }
            .toggleStyle(.switch)
            .controlSize(.small)
            .disabled(vm.metadata == nil)

            if vm.clickRingsEnabled {
                HStack {
                    Text("Size").font(.caption).foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Text("\(Int(vm.clickRingSize)) px")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(CTheme.textSecondary)
                }
                Slider(value: $vm.clickRingSize, in: 24...140, step: 1, onEditingChanged: vm.sliderEditing)
                    .tint(CTheme.accent)

                HStack {
                    Text("Duration").font(.caption).foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    Text("\(Int(vm.clickRingDuration)) ms")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(CTheme.textSecondary)
                }
                Slider(value: $vm.clickRingDuration, in: 250...1200, step: 50, onEditingChanged: vm.sliderEditing)
                    .tint(CTheme.accent)

                HStack {
                    Text("Color").font(.caption).foregroundStyle(CTheme.textSecondary)
                    Spacer()
                    ColorPicker("", selection: ringColorBinding, supportsOpacity: false)
                        .labelsHidden()
                        .controlSize(.small)
                }
            }
        }
    }

    /// Bridges the metadata's hex string to SwiftUI's ColorPicker.
    private var ringColorBinding: Binding<Color> {
        Binding(
            get: {
                let v = RGBAColor.parseHex(vm.clickRingColorHex)
                return Color(.sRGB, red: Double(v.x), green: Double(v.y), blue: Double(v.z))
            },
            set: { newColor in
                let ns = NSColor(newColor).usingColorSpace(.sRGB) ?? .white
                vm.clickRingColorHex = String(
                    format: "#%02x%02x%02x",
                    Int(round(ns.redComponent * 255)),
                    Int(round(ns.greenComponent * 255)),
                    Int(round(ns.blueComponent * 255))
                )
            }
        )
    }

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
            Slider(value: scaleBinding, in: 1.0...4.0, step: 0.05, onEditingChanged: vm.sliderEditing)
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
                   step: 50, onEditingChanged: vm.sliderEditing)
                .tint(CTheme.accent)

            Picker("Framing", selection: Binding(get: { section.targetMode ?? .followCursor }, set: { mode in
                vm.updateZoomTarget(at: index, mode: mode)
            })) {
                Text("Follow cursor").tag(ZoomTargetMode.followCursor)
                Text("Fixed target").tag(ZoomTargetMode.fixed)
            }
            if section.targetMode == .fixed {
                labeledSlider("Target X", value: Binding(get: { section.centerX }, set: { vm.updateZoomTarget(at: index, x: $0) }), range: 0...1)
                labeledSlider("Target Y", value: Binding(get: { section.centerY }, set: { vm.updateZoomTarget(at: index, y: $0) }), range: 0...1)
            }
            Text("Follow the cursor, or keep a fixed feature framed while you explain it.")
                .font(.caption2)
                .foregroundStyle(CTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            Text("Drag the block to move it; drag the highlighted edges to resize. Hold Option to disable snapping.")
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

    private var presetControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Look name", text: $presetName).textFieldStyle(.roundedBorder)
                Button("Save") { vm.saveLookPreset(named: presetName) }
                    .disabled(presetName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || vm.metadata == nil)
            }.controlSize(.small)
            if !vm.lookPresets.isEmpty {
                Menu("Apply saved look") {
                    ForEach(vm.lookPresets) { preset in
                        Button(preset.name) { vm.applyLookPreset(preset) }
                    }
                }.controlSize(.small)
            }
            Text("Reuses canvas, cursor, camera, zoom style and output settings. Applying a look can be undone.")
                .font(.caption2).foregroundStyle(CTheme.textSecondary)
        }
    }

    private var canvasControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Padding")
                    .font(.caption)
                    .foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text("\(Int((vm.canvasPadding * 200).rounded()))%")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: $vm.canvasPadding, in: 0...0.25, onEditingChanged: vm.sliderEditing)
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
                Text("\(Int((vm.canvasShadowStrength * 100).rounded()))%")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: $vm.canvasShadowStrength, in: 0...1, onEditingChanged: vm.sliderEditing)
                .tint(CTheme.accent)
                .disabled(!vm.canvasDropShadow)
                .opacity(vm.canvasDropShadow ? 1.0 : 0.5)

            labeledSlider("Softness", value: $vm.canvasShadowSoftness, range: 0.02...0.30)
                .disabled(!vm.canvasDropShadow)
            labeledSlider("Distance", value: $vm.canvasShadowDistance, range: 0...0.15)
                .disabled(!vm.canvasDropShadow)
            labeledSlider("Shadow angle", value: $vm.canvasShadowAngle, range: 0...360)
                .disabled(!vm.canvasDropShadow)
            labeledSlider("Corner radius", value: $vm.canvasCornerRadius, range: 0...0.08)

            Picker("Lighting", selection: Binding(get: { vm.canvasBackground.style ?? .linear }, set: { vm.canvasBackground.style = $0 })) {
                Text("Linear").tag(CanvasBackground.GradientStyle.linear)
                Text("Radial").tag(CanvasBackground.GradientStyle.radial)
            }.font(.caption)
            labeledSlider("Vignette", value: Binding(get: { Double(vm.canvasBackground.vignette ?? 0) }, set: { vm.canvasBackground.vignette = Float($0) }), range: 0...0.5)
            labeledSlider("Grain", value: Binding(get: { Double(vm.canvasBackground.grain ?? 0) }, set: { vm.canvasBackground.grain = Float($0) }), range: 0...0.025)

            HStack {
                Text("Custom color").font(.caption).foregroundStyle(CTheme.textSecondary)
                Spacer()
                ColorPicker("", selection: Binding(get: {
                    let color = vm.canvasBackground.firstColor
                    return Color(.sRGB, red: Double(color.x), green: Double(color.y), blue: Double(color.z))
                }, set: { color in
                    let ns = NSColor(color).usingColorSpace(.sRGB) ?? .black
                    vm.canvasBackground = .solid(String(format: "#%02x%02x%02x", Int(ns.redComponent * 255), Int(ns.greenComponent * 255), Int(ns.blueComponent * 255)))
                }), supportsOpacity: false).labelsHidden()
            }

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

    private func labeledSlider(_ label: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption).foregroundStyle(CTheme.textSecondary)
                Spacer()
                Text(label == "Shadow angle" ? "\(Int(value.wrappedValue.rounded()))°" : label == "Grain" ? String(format: "%.1f%%", value.wrappedValue * 100) : "\(Int((value.wrappedValue * 100).rounded()))%")
                    .font(.caption.monospacedDigit()).foregroundStyle(CTheme.textSecondary)
            }
            Slider(value: value, in: range, onEditingChanged: vm.sliderEditing)
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
            row("Edited length", format(vm.editedDurationMs))

            Button("Reset to full clip") {
                vm.performEdit {
                    vm.trimStartMs = 0
                    vm.trimEndMs = vm.durationMs
                    vm.resetCuts()
                }
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
                    in: 0.05...0.6, onEditingChanged: vm.sliderEditing
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
        let ext = exportFormat == .gif ? "gif" : "mp4"
        panel.allowedContentTypes = exportFormat == .gif ? [.gif] : [.mpeg4Movie]
        panel.nameFieldStringValue = vm.projectTitle + "_export.\(ext)"
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

        // The cursor glide is fully baked into the snapshot's precomputed
        // track, so the export just samples it — deterministic, stateless, and
        // identical to the live preview. (Previously a stateful spring lived
        // here; it could diverge from the preview and, because the pipeline
        // calls this closure from more than one loop, corrupt its own state.)
        let cursorAt: @Sendable (Double) -> CursorRenderState? = { ms in
            snapshot.cursorStateForExport(atMilliseconds: ms)
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
        let editSegments = vm.metadata?.editSegments
        let outputSettings = vm.outputSettings
        let canvasStyle = vm.canvasStyle
        let webcamOffsetMs = vm.metadata?.webcamOffsetMs ?? 0
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
                    canvas: canvasStyle,
                    webcamURL: vm.webcamURL,
                    webcamLayout: webcamLayout,
                    webcamOffsetMs: webcamOffsetMs,
                    outputScale: exportScale,
                    bitsPerPixel: exportBitsPerPixel,
                    format: exportFormat,
                    editSegments: editSegments,
                    output: outputSettings
                )) { progress in
                    progressCont.yield(progress)
                }
                exportedURL = out
                saveMessage = "Exported to \(out.lastPathComponent)"
            } catch ExportError.cancelled {
                saveMessage = "Export cancelled"
            } catch {
                exportError = error.localizedDescription
            }
        }
    }
}
