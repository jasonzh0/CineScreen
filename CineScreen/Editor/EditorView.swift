import SwiftUI

struct EditorView: View {
    @State private var vm: EditorViewModel

    init(videoURL: URL) {
        _vm = State(initialValue: EditorViewModel(videoURL: videoURL))
    }

    var body: some View {
        HStack(spacing: 0) {
            mainPane
            Divider()
            SidebarView(vm: vm)
        }
        .frame(minWidth: 960, minHeight: 600)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var mainPane: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                MetalPreviewView(
                    player: vm.player,
                    cursorStateProvider: { [weak vm] in vm?.cursorState() },
                    clickStatesProvider: { [weak vm] in vm?.clickRingStates() ?? [] },
                    zoomStateProvider: { [weak vm] in vm?.zoomState() ?? .identity },
                    canvasStyleProvider: { [weak vm] in vm?.canvasStyle ?? .none }
                )
                .padding(16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            transport

            TimelineView(vm: vm)
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                .padding(.top, 8)
        }
    }

    private var transport: some View {
        HStack(spacing: 12) {
            Button {
                vm.togglePlayPause()
            } label: {
                Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16))
                    .frame(width: 36, height: 32)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.space, modifiers: [])

            Text(format(vm.currentTimeMs))
                .font(.system(.body, design: .monospaced))
                .frame(width: 80, alignment: .trailing)
            Text("/")
                .foregroundStyle(.secondary)
            Text(format(vm.durationMs))
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private func format(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        let m = total / 60
        let s = total % 60
        let cs = Int((ms.truncatingRemainder(dividingBy: 1000)) / 10)
        return String(format: "%02d:%02d.%02d", m, s, cs)
    }
}
