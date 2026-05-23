import SwiftUI
import AVKit
import AppKit

/// NSViewRepresentable wrapping AVPlayerView with the system controls hidden.
/// This is the Phase 2.A interim preview — Phase 2.C swaps in a Metal-backed
/// compositor that can layer cursor + zoom on top.
struct SimplePlayerView: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = .none
        view.showsFullScreenToggleButton = false
        view.videoGravity = .resizeAspect
        view.allowsPictureInPicturePlayback = false
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
    }
}
