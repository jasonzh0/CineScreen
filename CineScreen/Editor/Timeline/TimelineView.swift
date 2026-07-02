import SwiftUI
import AppKit

struct TimelineView: View {
    @Bindable var vm: EditorViewModel

    private enum Drag: Equatable {
        case none
        case playhead
        case trimStart
        case trimEnd
    }
    /// Which drag interaction owns the pointer. @GestureState (not @State):
    /// SwiftUI never calls onEnded for a *cancelled* gesture (window
    /// deactivation, popover), and a stuck value here permanently blocked
    /// timeline scrubbing until the handle was grabbed again — @GestureState
    /// resets automatically however the gesture ends.
    @GestureState private var active: Drag = .none
    /// Timeline zoom at pinch start — magnification is cumulative from
    /// gesture start, so it must scale a fixed baseline, not the live value.
    @GestureState private var magnifyStart: Double?

    private let rulerHeight: CGFloat = 22
    private let trackHeight: CGFloat = 36
    private let trackSpacing: CGFloat = 4
    private let labelWidth: CGFloat = 64

    // Named coordinate space used by block drag gestures so translation is
    // measured in the same units as the track's contentW.
    fileprivate static let TimelineCoordSpace = "ZoomTimelineContent"

    var body: some View {
        @Bindable var vm = vm
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                // Left label column
                VStack(spacing: trackSpacing) {
                    Color.clear.frame(height: rulerHeight)
                    trackLabel("Video")
                    trackLabel("Zoom")
                }
                .frame(width: labelWidth)
                .background(CTheme.panel)

                // Scrolling content
                GeometryReader { geo in
                    let viewportW = geo.size.width
                    let duration = max(1, vm.durationMs)
                    let contentW = viewportW * CGFloat(vm.timelineZoom)

                    ScrollView(.horizontal, showsIndicators: false) {
                        ZStack(alignment: .topLeading) {
                            background.frame(width: contentW, height: timelineHeight)

                            VStack(spacing: trackSpacing) {
                                ruler(width: contentW)
                                videoTrack(width: contentW, duration: duration)
                                zoomTrack(width: contentW, duration: duration)
                            }
                            .frame(width: contentW)

                            playhead(width: contentW, duration: duration)
                        }
                        .frame(width: contentW, height: timelineHeight)
                        // Named coordinate space so block drags measure
                        // translation in the same units as `contentW`.
                        .coordinateSpace(name: TimelineView.TimelineCoordSpace)
                        .contentShape(Rectangle())
                        .gesture(scrubGesture(width: contentW, duration: duration))
                    }
                    .gesture(zoomGesture)
                }
                .frame(height: timelineHeight)
            }

            zoomControls
        }
        .background(CTheme.panelDeep)
        .clipShape(RoundedRectangle(cornerRadius: CTheme.Radius.sm))
        .tint(CTheme.accent)
    }

    private var timelineHeight: CGFloat {
        rulerHeight + trackSpacing + trackHeight + trackSpacing + trackHeight
    }

    private func trackLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(CTheme.textSecondary)
            .tracking(0.5)
            .frame(width: labelWidth, height: trackHeight, alignment: .center)
    }

    // MARK: - Backgrounds + ruler

    private var background: some View {
        CTheme.panelDeep
    }

    private func ruler(width: CGFloat) -> some View {
        let duration = max(1, vm.durationMs / 1000)
        let tickEvery = tickInterval(forDurationSeconds: duration, width: width)
        let count = Int(duration / tickEvery) + 1
        return ZStack(alignment: .topLeading) {
            ForEach(0..<count, id: \.self) { i in
                let seconds = Double(i) * tickEvery
                let x = CGFloat(seconds / duration) * width
                VStack(alignment: .leading, spacing: 2) {
                    Rectangle()
                        .fill(CTheme.textTertiary)
                        .frame(width: 1, height: 6)
                    Text(formatSeconds(seconds))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(CTheme.textTertiary)
                }
                .offset(x: x, y: 2)
            }
        }
        .frame(width: width, height: rulerHeight, alignment: .topLeading)
    }

    // MARK: - Video (main) track with trim handles

    private static let videoTint = CTheme.accent   // warm gold
    private static let zoomTint  = CTheme.teal      // cool teal

    private func videoTrack(width: CGFloat, duration: Double) -> some View {
        let startX = CGFloat(vm.trimStartMs / duration) * width
        let endX = CGFloat(vm.trimEndMs / duration) * width
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 6)
                .fill(
                    LinearGradient(
                        colors: [Self.videoTint.opacity(0.35), Self.videoTint.opacity(0.22)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Self.videoTint.opacity(0.5), lineWidth: 1)
                )

            // Greyed-out regions outside trim
            Rectangle()
                .fill(Color.black.opacity(0.4))
                .frame(width: max(0, startX))
            Rectangle()
                .fill(Color.black.opacity(0.4))
                .frame(width: max(0, width - endX))
                .offset(x: endX)

            trimHandle(width: width, duration: duration, isStart: true)
            trimHandle(width: width, duration: duration, isStart: false)
        }
        .frame(width: width, height: trackHeight)
    }

    private func trimHandle(width: CGFloat, duration: Double, isStart: Bool) -> some View {
        let position = isStart ? vm.trimStartMs : vm.trimEndMs
        let x = CGFloat(position / duration) * width
        let hitWidth: CGFloat = 18  // generous hit zone so it's easy to grab
        let barWidth: CGFloat = 5
        return ZStack {
            // Hit zone — invisible but full height + width so the grip is
            // forgiving. Matches the zoom-edge feel.
            Rectangle()
                .fill(Color.clear)
                .frame(width: hitWidth)
                .contentShape(Rectangle())
            // Visible bar — a touch wider than before, with subtle inner
            // highlight so it reads as a tactile grip rather than a hairline.
            RoundedRectangle(cornerRadius: 1.5)
                .fill(Self.videoTint)
                .frame(width: barWidth)
                .overlay(
                    RoundedRectangle(cornerRadius: 1.5)
                        .stroke(Color.white.opacity(0.35), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.35), radius: 2, x: 0, y: 1)
            // Dots in the centre as a "drag this" affordance.
            VStack(spacing: 3) {
                Circle().fill(.white).frame(width: 3, height: 3)
                Circle().fill(.white).frame(width: 3, height: 3)
                Circle().fill(.white).frame(width: 3, height: 3)
            }
            .allowsHitTesting(false)
        }
        .frame(maxHeight: .infinity)
        .offset(x: x - hitWidth / 2)
        .onHover { hovering in
            if hovering {
                NSCursor.resizeLeftRight.push()
            } else {
                NSCursor.pop()
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .updating($active) { _, state, _ in
                    if state == .none { state = isStart ? .trimStart : .trimEnd }
                }
                .onChanged { value in
                    guard active == (isStart ? .trimStart : .trimEnd) else { return }
                    let newMs = max(0, min(duration, Double(value.location.x / width) * duration))
                    if isStart {
                        vm.trimStartMs = min(newMs, vm.trimEndMs - 100)
                    } else {
                        vm.trimEndMs = max(newMs, vm.trimStartMs + 100)
                    }
                }
        )
    }

    // MARK: - Zoom track

    private func zoomTrack(width: CGFloat, duration: Double) -> some View {
        let sections = vm.effectiveZoomSections
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(CTheme.panel)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(CTheme.stroke, lineWidth: 1)
                )

            ForEach(Array(sections.enumerated()), id: \.offset) { index, section in
                ZoomBlock(
                    vm: vm,
                    index: index,
                    section: section,
                    isSelected: vm.selectedZoomIndex == index,
                    trackWidth: width,
                    trackHeight: trackHeight,
                    duration: duration
                )
            }
        }
        .frame(width: width, height: trackHeight)
    }

    // MARK: - Editable zoom block

    private struct ZoomBlock: View {
        @Bindable var vm: EditorViewModel
        let index: Int
        let section: ZoomSection
        let isSelected: Bool
        let trackWidth: CGFloat
        let trackHeight: CGFloat
        let duration: Double

        /// Section bounds at gesture start. @GestureState so a *cancelled*
        /// drag (which never fires onEnded) can't leave a stale origin that
        /// the next drag would jump from.
        @GestureState private var dragStart: (startTime: Double, endTime: Double)?

        private enum Edge { case left, right }
        private let edgeWidth: CGFloat = 8

        var body: some View {
            let x = CGFloat(section.startTime / duration) * trackWidth
            let w = max(20, CGFloat((section.endTime - section.startTime) / duration) * trackWidth)
            let fill = TimelineView.zoomTint
            let h = trackHeight - 4

            // Lay the block out via HStack + non-interactive Spacers so each
            // block is its own full-width layer in the ZStack. .position
            // wasn't reliably moving SwiftUI's hit-test region in a stacked
            // ForEach — only the topmost block in z-order would receive
            // clicks no matter where the user actually tapped.
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: x)
                    .allowsHitTesting(false)

                blockContent(width: w, height: h, fill: fill)

                Color.clear
                    .frame(maxWidth: .infinity)
                    .allowsHitTesting(false)
            }
            .frame(width: trackWidth, height: trackHeight, alignment: .topLeading)
            // Anti-jitter: disable any implicit layout animation when the
            // section's start or end moves. `.animation(nil, value:)` defeats
            // SwiftUI's default animated layout transition that fights every
            // drag tick mid-gesture.
            .animation(nil, value: section.startTime)
            .animation(nil, value: section.endTime)
            .transaction { $0.animation = nil }
        }

        @ViewBuilder
        private func blockContent(width: CGFloat, height: CGFloat, fill: Color) -> some View {
            ZStack(alignment: .center) {
                // Visual: background fill + outline. Hit testing disabled so
                // it doesn't intercept the body / edge gestures sitting on top.
                RoundedRectangle(cornerRadius: 6)
                    .fill(
                        LinearGradient(
                            colors: [
                                fill.opacity(isSelected ? 0.85 : 0.55),
                                fill.opacity(isSelected ? 0.65 : 0.40)
                            ],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(isSelected ? Color.white.opacity(0.85) : fill.opacity(0.9), lineWidth: isSelected ? 1.5 : 1)
                    )
                    .allowsHitTesting(false)

                Text(String(format: "%.1fx", section.scale))
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .allowsHitTesting(false)

                // BODY drag-and-select region: smaller than the block, leaving
                // the outer `edgeWidth` pixels on each side for the resize
                // handles. Otherwise the body gesture wins clicks on the edge.
                Color.clear
                    .contentShape(Rectangle())
                    .padding(.horizontal, edgeWidth)
                    .onHover { hovering in
                        if hovering {
                            NSCursor.openHand.push()
                        } else {
                            NSCursor.pop()
                        }
                    }
                    .highPriorityGesture(
                        TapGesture()
                            .onEnded {
                                vm.selectedZoomIndex = index
                                vm.seek(toMilliseconds: section.startTime)
                            }
                    )
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 4, coordinateSpace: .named(TimelineView.TimelineCoordSpace))
                            .updating($dragStart) { _, start, _ in
                                if start == nil { start = (section.startTime, section.endTime) }
                            }
                            .onChanged { value in
                                guard let origin = dragStart else { return }
                                if vm.selectedZoomIndex != index { vm.selectedZoomIndex = index }
                                let deltaMs = Double(value.translation.width / trackWidth) * duration
                                let len = origin.endTime - origin.startTime
                                var newStart = origin.startTime + deltaMs
                                newStart = max(0, min(duration - len, newStart))
                                var t = Transaction(); t.disablesAnimations = true
                                withTransaction(t) {
                                    vm.updateZoomSection(at: index,
                                                         startTime: newStart,
                                                         endTime: newStart + len)
                                }
                            }
                    )

                // EDGE handles sit on top of the body region at the left and
                // right; they get clicks at the edges because they're z-above.
                HStack(spacing: 0) {
                    handle(.left, fill: fill)
                    Spacer(minLength: 0).allowsHitTesting(false)
                    handle(.right, fill: fill)
                }
            }
            .frame(width: width, height: height)
            .padding(.top, 2)
            // Kill any implicit layout animation on the HStack spacer width
            // change — without this, every drag tick triggered an animated
            // resize transition that fought the next tick and produced jitter.
            .transaction { $0.animation = nil }
        }

        private func handle(_ edge: Edge, fill: Color) -> some View {
            // 8pt-wide hit zone with a visible 3pt bar centred inside. Without
            // explicitly framing the hit area, the contentShape was only the
            // 3pt bar — the user kept missing it.
            ZStack {
                Rectangle()
                    .fill(fill)
                    .frame(width: 3)
            }
            .frame(width: edgeWidth)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .onHover { hovering in
                if hovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .highPriorityGesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named(TimelineView.TimelineCoordSpace))
                    .updating($dragStart) { _, start, _ in
                        if start == nil { start = (section.startTime, section.endTime) }
                    }
                    .onChanged { value in
                        guard let origin = dragStart else { return }
                        if vm.selectedZoomIndex != index { vm.selectedZoomIndex = index }
                        let deltaMs = Double(value.translation.width / trackWidth) * duration
                        var t = Transaction(); t.disablesAnimations = true
                        withTransaction(t) {
                            switch edge {
                            case .left:
                                let new = max(0, min(origin.endTime - 100, origin.startTime + deltaMs))
                                vm.updateZoomSection(at: index, startTime: new)
                            case .right:
                                let new = max(origin.startTime + 100, min(duration, origin.endTime + deltaMs))
                                vm.updateZoomSection(at: index, endTime: new)
                            }
                        }
                    }
            )
        }
    }

    // MARK: - Playhead

    private func playhead(width: CGFloat, duration: Double) -> some View {
        let x = CGFloat(vm.currentTimeMs / duration) * width
        // Crisp white "now" marker — high contrast against the gold video
        // track and teal zoom blocks, with a soft dark halo for separation.
        return Rectangle()
            .fill(Color.white)
            .frame(width: 2)
            .frame(maxHeight: .infinity)
            .offset(x: x - 1)
            .shadow(color: .black.opacity(0.55), radius: 2.5)
            .allowsHitTesting(false)
    }

    // MARK: - Scrubbing + zoom gestures

    private func scrubGesture(width: CGFloat, duration: Double) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($active) { _, state, _ in
                if state == .none { state = .playhead }
            }
            .onChanged { value in
                guard active == .playhead else { return }
                let ratio = max(0, min(1, value.location.x / width))
                vm.seek(toMilliseconds: ratio * duration)
            }
    }

    private var zoomGesture: some Gesture {
        // Scale a gesture-start baseline: `magnification` is cumulative from
        // pinch start, so multiplying it into the live zoom compounded
        // exponentially — a slow 2x pinch hit the 20x clamp within a few
        // ticks.
        MagnifyGesture()
            .updating($magnifyStart) { _, start, _ in
                if start == nil { start = vm.timelineZoom }
            }
            .onChanged { value in
                guard let base = magnifyStart else { return }
                vm.timelineZoom = max(1.0, min(20.0, base * Double(value.magnification)))
            }
    }

    private var zoomControls: some View {
        HStack(spacing: 8) {
            Button {
                vm.timelineZoom = max(1.0, vm.timelineZoom / 1.5)
            } label: {
                Image(systemName: "minus.magnifyingglass")
            }
            .buttonStyle(.plain)
            .foregroundStyle(CTheme.textSecondary)
            .disabled(vm.timelineZoom <= 1.0)

            Slider(value: $vm.timelineZoom, in: 1.0...20.0)
                .controlSize(.small)
                .frame(maxWidth: 220)
                .tint(CTheme.accent)

            Button {
                vm.timelineZoom = min(20.0, vm.timelineZoom * 1.5)
            } label: {
                Image(systemName: "plus.magnifyingglass")
            }
            .buttonStyle(.plain)
            .foregroundStyle(CTheme.textSecondary)
            .disabled(vm.timelineZoom >= 20.0)

            Text("\(Int(vm.timelineZoom * 100))%")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(CTheme.textSecondary)
                .frame(width: 50, alignment: .trailing)

            Spacer()

            Button("Fit") { vm.timelineZoom = 1.0 }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(CTheme.textSecondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(CTheme.panelDeep)
    }

    // MARK: - Tick spacing

    private func tickInterval(forDurationSeconds duration: Double, width: CGFloat) -> Double {
        let targetTicks = max(2.0, Double(width) / 80)
        let rawSpacing = duration / targetTicks
        let candidates: [Double] = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        for c in candidates where c >= rawSpacing { return c }
        return candidates.last ?? 60
    }

    private func formatSeconds(_ s: Double) -> String {
        let total = Int(s)
        let m = total / 60
        let sec = total % 60
        return String(format: "%d:%02d", m, sec)
    }
}
