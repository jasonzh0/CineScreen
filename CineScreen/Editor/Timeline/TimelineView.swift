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
    @State private var active: Drag = .none

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
                .background(Color.black.opacity(0.25))

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
        .background(Color(nsColor: .underPageBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var timelineHeight: CGFloat {
        rulerHeight + trackSpacing + trackHeight + trackSpacing + trackHeight
    }

    private func trackLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.secondary)
            .tracking(0.5)
            .frame(width: labelWidth, height: trackHeight, alignment: .center)
    }

    // MARK: - Backgrounds + ruler

    private var background: some View {
        Color(nsColor: .controlBackgroundColor)
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
                        .fill(Color.secondary.opacity(0.4))
                        .frame(width: 1, height: 6)
                    Text(formatSeconds(seconds))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .offset(x: x, y: 2)
            }
        }
        .frame(width: width, height: rulerHeight, alignment: .topLeading)
    }

    // MARK: - Video (main) track with trim handles

    private func videoTrack(width: CGFloat, duration: Double) -> some View {
        let startX = CGFloat(vm.trimStartMs / duration) * width
        let endX = CGFloat(vm.trimEndMs / duration) * width
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.accentColor.opacity(0.14))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.accentColor.opacity(0.35), lineWidth: 1)
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
        return ZStack {
            Rectangle().fill(Color.clear).frame(width: 16)
            Rectangle()
                .fill(Color.accentColor.opacity(0.85))
                .frame(width: 3)
            VStack(spacing: 2) {
                Circle().fill(.white).frame(width: 3, height: 3)
                Circle().fill(.white).frame(width: 3, height: 3)
                Circle().fill(.white).frame(width: 3, height: 3)
            }
        }
        .frame(maxHeight: .infinity)
        .offset(x: x - 8)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if active == .none {
                        active = isStart ? .trimStart : .trimEnd
                    }
                    guard active == (isStart ? .trimStart : .trimEnd) else { return }
                    let newMs = max(0, min(duration, Double(value.location.x / width) * duration))
                    if isStart {
                        vm.trimStartMs = min(newMs, vm.trimEndMs - 100)
                    } else {
                        vm.trimEndMs = max(newMs, vm.trimStartMs + 100)
                    }
                }
                .onEnded { _ in active = .none }
        )
    }

    // MARK: - Zoom track

    private func zoomTrack(width: CGFloat, duration: Double) -> some View {
        let sections = vm.effectiveZoomSections
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.black.opacity(0.25))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.secondary.opacity(0.15), lineWidth: 1)
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

        @State private var dragStart: (startTime: Double, endTime: Double)?

        private enum Edge { case left, right }
        private let edgeWidth: CGFloat = 8

        var body: some View {
            let x = CGFloat(section.startTime / duration) * trackWidth
            let w = max(20, CGFloat((section.endTime - section.startTime) / duration) * trackWidth)
            let fill = Color(red: 0.78, green: 0.45, blue: 0.40)
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
                RoundedRectangle(cornerRadius: 4)
                    .fill(fill.opacity(isSelected ? 0.55 : 0.30))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(isSelected ? Color.white.opacity(0.85) : fill, lineWidth: isSelected ? 1.5 : 1)
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
                            .onChanged { value in
                                let origin = dragStart ?? (section.startTime, section.endTime)
                                if dragStart == nil {
                                    dragStart = origin
                                    vm.selectedZoomIndex = index
                                }
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
                            .onEnded { _ in dragStart = nil }
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
                    .onChanged { value in
                        let origin = dragStart ?? (section.startTime, section.endTime)
                        if dragStart == nil {
                            dragStart = origin
                            vm.selectedZoomIndex = index
                        }
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
                    .onEnded { _ in dragStart = nil }
            )
        }
    }

    // MARK: - Playhead

    private func playhead(width: CGFloat, duration: Double) -> some View {
        let x = CGFloat(vm.currentTimeMs / duration) * width
        return Rectangle()
            .fill(Color.accentColor)
            .frame(width: 2)
            .frame(maxHeight: .infinity)
            .offset(x: x - 1)
            .shadow(color: Color.accentColor.opacity(0.4), radius: 2)
            .allowsHitTesting(false)
    }

    // MARK: - Scrubbing + zoom gestures

    private func scrubGesture(width: CGFloat, duration: Double) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard active == .none || active == .playhead else { return }
                active = .playhead
                let ratio = max(0, min(1, value.location.x / width))
                vm.seek(toMilliseconds: ratio * duration)
            }
            .onEnded { _ in
                if active == .playhead { active = .none }
            }
    }

    private var zoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let new = max(1.0, min(20.0, vm.timelineZoom * Double(value.magnification)))
                vm.timelineZoom = new
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
            .disabled(vm.timelineZoom <= 1.0)

            Slider(value: $vm.timelineZoom, in: 1.0...20.0)
                .controlSize(.small)
                .frame(maxWidth: 220)

            Button {
                vm.timelineZoom = min(20.0, vm.timelineZoom * 1.5)
            } label: {
                Image(systemName: "plus.magnifyingglass")
            }
            .buttonStyle(.plain)
            .disabled(vm.timelineZoom >= 20.0)

            Text("\(Int(vm.timelineZoom * 100))%")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .trailing)

            Spacer()

            Button("Fit") { vm.timelineZoom = 1.0 }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.15))
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
