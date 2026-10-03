import SwiftUI

struct EditorView: View {
    @State private var vm: EditorViewModel

    init(videoURL: URL) {
        _vm = State(initialValue: EditorViewModel(videoURL: videoURL))
    }

    var body: some View {
        HStack(spacing: 0) {
            mainPane
            SidebarView(vm: vm)
        }
        .frame(minWidth: 1100, minHeight: 720)
        .background(CTheme.panelDeep)
        .tint(CTheme.accent)
        .preferredColorScheme(.dark)
        .onDisappear {
            // Flush any pending debounced autosave — closing the Studio
            // window must never lose edits.
            vm.saveNow()
        }
        .background { keyboardShortcuts }
    }

    /// Editor-wide keys, delivered through invisible buttons — the same
    /// mechanism the play button already uses for Space, so shortcuts work
    /// without fighting SwiftUI focus. ←/→ frame-step, ⇧←/→ jump 1s,
    /// I/O set trim in/out at the playhead, ⌘S saves, ⌫ removes the
    /// selected zoom section, ⎋ deselects.
    private var keyboardShortcuts: some View {
        Group {
            Button("") { vm.stepFrame(-1) }
                .keyboardShortcut(.leftArrow, modifiers: [])
            Button("") { vm.stepFrame(1) }
                .keyboardShortcut(.rightArrow, modifiers: [])
            Button("") { vm.seek(toMilliseconds: vm.currentTimeMs - 1000) }
                .keyboardShortcut(.leftArrow, modifiers: .shift)
            Button("") { vm.seek(toMilliseconds: vm.currentTimeMs + 1000) }
                .keyboardShortcut(.rightArrow, modifiers: .shift)
            Button("") { vm.undo() }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(!vm.canUndo)
            Button("") { vm.redo() }
                .keyboardShortcut("z", modifiers: [.command, .shift])
                .disabled(!vm.canRedo)
            Button("") { vm.splitAtPlayhead() }
                .keyboardShortcut("b", modifiers: .command)
            Button("") { vm.saveNow() }
                .keyboardShortcut("s", modifiers: .command)
            Button("") {
                if vm.durationMs > 0 {
                    vm.trimStartMs = max(0, min(vm.currentTimeMs, vm.trimEndMs - 100))
                }
            }
            .keyboardShortcut("i", modifiers: [])
            Button("") {
                if vm.durationMs > 0 {
                    vm.trimEndMs = min(vm.durationMs, max(vm.currentTimeMs, vm.trimStartMs + 100))
                }
            }
            .keyboardShortcut("o", modifiers: [])
            Button("") {
                vm.deleteSelection()
            }
            .keyboardShortcut(.delete, modifiers: [])
            Button("") { vm.selectedZoomIndex = nil; vm.selectedSegmentID = nil }
                .keyboardShortcut(.escape, modifiers: [])
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }

    private var mainPane: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

            // Canvas surface — the Metal compositor's own background + drop
            // shadow handle the card aesthetic, so we let the gradient fill
            // the full preview rectangle instead of clipping to a rounded
            // shape (which exposed the editor's dark background in the
            // corners when the recording was zoomed in).
            ZStack {
                MetalPreviewView(
                    player: vm.player,
                    webcamPlayer: vm.webcamPlayer,
                    isPlaying: vm.isPlaying,
                    renderRevision: vm.renderRevision,
                    requestedTimeMs: vm.playbackTimeMs,
                    webcamOffsetMs: vm.metadata?.webcamOffsetMs ?? 0,
                    sourceTimeForPlayback: { [weak vm] in vm?.sourceTimeForPlayback($0) ?? $0 },
                    stateAtTime: { [weak vm] in vm?.compositionState(atMilliseconds: $0) ?? CompositionState() }
                )

                WebcamHandleOverlay(vm: vm)
            }
            // Lock the preview canvas to the recording's aspect so what you
            // see (webcam placement, padding proportions, shadow) is what the
            // export produces — its canvas is exactly the video frame.
            .aspectRatio(vm.previewAspect, contentMode: .fit)
            .padding(.horizontal, 24)
            .padding(.top, 4)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            transport
                .padding(.horizontal, 24)
                .padding(.vertical, 8)

            TimelineView(vm: vm)
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
        }
    }

    // MARK: - Top toolbar

    private var topBar: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(vm.projectTitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(CTheme.textPrimary)
                if let error = vm.lastSaveError {
                    Text("Save failed: \(error)").foregroundStyle(CTheme.danger)
                        .font(.caption2).lineLimit(1).help(error)
                } else {
                    Text(vm.hasUnsavedChanges ? "Saving changes…" : "All changes saved")
                        .font(.caption2).foregroundStyle(CTheme.textTertiary)
                }
            }
            Spacer()
            toolbarButton("Undo", icon: "arrow.uturn.backward", action: vm.undo).disabled(!vm.canUndo)
            toolbarButton("Redo", icon: "arrow.uturn.forward", action: vm.redo).disabled(!vm.canRedo)
            Divider().frame(height: 20)
            toolbarButton("Split", icon: "scissors", action: vm.splitAtPlayhead)
                .help("Split at playhead (⌘B)").disabled(vm.retainedSegments.isEmpty)
            toolbarButton("Zoom", icon: "plus.magnifyingglass", action: vm.addZoomSection)
            Picker("Aspect ratio", selection: Binding(
                get: { vm.outputSettings.aspectRatio },
                set: { vm.outputSettings.aspectRatio = $0 }
            )) {
                ForEach(OutputAspectRatio.allCases) { ratio in Text(ratio.label).tag(ratio) }
            }
            .labelsHidden().frame(width: 105).controlSize(.small)

        }
    }

    private func toolbarButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: icon).font(.caption) }
            .buttonStyle(.bordered).controlSize(.small)
    }

    // MARK: - Transport

    private var transport: some View {
        HStack(spacing: 14) {
            Text(format(vm.editedTimeMs))
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(CTheme.textPrimary)
                .frame(width: 78, alignment: .leading)

            Spacer()

            HStack(spacing: 8) {
                transportButton("backward.end.fill") { vm.seek(toMilliseconds: vm.retainedSegments.first?.startMs ?? 0) }
                transportButton("backward.frame.fill") { vm.stepFrame(-1) }
                Button {
                    vm.togglePlayPause()
                } label: {
                    Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 44, height: 32)
                        .foregroundStyle(Color.black.opacity(0.88))
                        .background(CTheme.accentGradient, in: RoundedRectangle(cornerRadius: CTheme.Radius.sm))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.space, modifiers: [])
                .disabled(vm.isPreparingPlayback || vm.retainedSegments.isEmpty)
                transportButton("forward.frame.fill") { vm.stepFrame(1) }
                transportButton("forward.end.fill") { vm.seek(toMilliseconds: vm.retainedSegments.last?.endMs ?? vm.durationMs) }
            }

            Spacer()

            Text(format(vm.editedDurationMs))
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(CTheme.textSecondary)
                .frame(width: 78, alignment: .trailing)
        }
    }

    private func transportButton(_ systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 32, height: 32)
                .foregroundStyle(CTheme.textSecondary)
                .background(CTheme.surface, in: RoundedRectangle(cornerRadius: CTheme.Radius.sm))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(systemName == "backward.end.fill" ? "Go to start" : systemName == "forward.end.fill" ? "Go to end" : systemName == "backward.frame.fill" ? "Previous frame" : "Next frame")
    }

    private func format(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        let m = total / 60
        let s = total % 60
        let cs = Int((ms.truncatingRemainder(dividingBy: 1000)) / 10)
        return String(format: "%02d:%02d.%02d", m, s, cs)
    }
}
