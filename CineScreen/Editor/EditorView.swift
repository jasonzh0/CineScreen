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
        .background(Color(white: 0.06))
        .preferredColorScheme(.dark)
    }

    private var mainPane: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

            // Canvas surface with subtle rounded frame, breathing room around it.
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.black)
                MetalPreviewView(
                    player: vm.player,
                    webcamPlayer: vm.webcamPlayer,
                    cursorStateProvider: { [weak vm] in vm?.cursorState() },
                    clickStatesProvider: { [weak vm] in vm?.clickRingStates() ?? [] },
                    zoomStateProvider: { [weak vm] in vm?.zoomState() ?? .identity },
                    canvasStyleProvider: { [weak vm] in vm?.canvasStyle ?? .none },
                    webcamLayoutProvider: { [weak vm] in vm?.webcamLayout ?? .default }
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))

                WebcamHandleOverlay(vm: vm)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
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
            // Window controls live in the native title bar; this row is a thin
            // toolbar below it for editor-specific actions.
            Text(vm.videoURL.deletingPathExtension().lastPathComponent)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)

            Spacer()

            iconButton("arrow.uturn.backward") {}
                .disabled(true)
            iconButton("arrow.uturn.forward") {}
                .disabled(true)
        }
    }

    private func iconButton(_ systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .medium))
                .frame(width: 32, height: 28)
                .foregroundStyle(.secondary)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Transport

    private var transport: some View {
        HStack(spacing: 14) {
            Text(format(vm.currentTimeMs))
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(.primary)
                .frame(width: 78, alignment: .leading)

            Spacer()

            HStack(spacing: 8) {
                transportButton("backward.fill") { vm.seek(toMilliseconds: 0) }
                Button {
                    vm.togglePlayPause()
                } label: {
                    Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 44, height: 32)
                        .foregroundStyle(.white)
                        .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.space, modifiers: [])
                transportButton("forward.fill") { vm.seek(toMilliseconds: vm.durationMs) }
            }

            Spacer()

            Text(format(vm.durationMs))
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 78, alignment: .trailing)
        }
    }

    private func transportButton(_ systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 32, height: 32)
                .foregroundStyle(.secondary)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func format(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        let m = total / 60
        let s = total % 60
        let cs = Int((ms.truncatingRemainder(dividingBy: 1000)) / 10)
        return String(format: "%02d:%02d.%02d", m, s, cs)
    }
}
