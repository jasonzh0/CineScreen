import Foundation
import simd

func snapshot(_ m: RecordingMetadata) -> RenderSnapshot { RenderSnapshot(metadata: m, zoomSections: m.zoom.sections) }
var failures = 0
func check(_ name: String, _ ok: Bool, _ details: String) {
    print("\(ok ? "PASS" : "FAIL") \(name): \(details)")
    if !ok { failures += 1 }
}
// Actual event-driven capture emits no positions during a long idle gap.
let idle = Fixtures.metadata(keyframes: [Fixtures.keyframe(0, 100, 500), Fixtures.keyframe(2000, 100, 500), Fixtures.keyframe(5000, 110, 500), Fixtures.keyframe(5100, 900, 500)])
let rawIdle = RenderSnapshot.rawCursorPosition(atMilliseconds: 3500, metadata: idle)!
let smoothIdle = snapshot(idle).smoothedCursorPosition(atMilliseconds: 3500)!
check("idle gap preserves cursor position", abs(rawIdle.x-100)<0.01 && abs(smoothIdle.x-100)<0.01, "raw x=\(rawIdle.x), rendered x=\(smoothIdle.x); actual last event x=100")
// RecordingSession appends an endpoint with the same position; it is not motion.
var hidden=Fixtures.metadata(duration:5000,keyframes:[Fixtures.keyframe(0,100,500),Fixtures.keyframe(1000,100,500),Fixtures.keyframe(1100,1000,500),Fixtures.keyframe(5000,1000,500)])
hidden.cursor.config.hideWhenStatic=true
let hiddenSnapshot=snapshot(hidden)
let beforeEnd=hiddenSnapshot.cursorStateForExport(atMilliseconds:4999)!.opacity
let atEnd=hiddenSnapshot.cursorStateForExport(atMilliseconds:5000)!.opacity
check("idle cursor stays hidden at synthetic endpoint", atEnd == beforeEnd, "opacity before endpoint=\(beforeEnd), at endpoint=\(atEnd)")
var tuned=Fixtures.metadata(keyframes:stride(from:0.0,through:5000,by:20).map { Fixtures.keyframe($0,200+$0/3,500) },sections:[Fixtures.section(0,5000)])
let original=snapshot(tuned)
tuned.zoom.config.transitionSpeed=1000; tuned.zoom.config.followSpeed=0.1; tuned.zoom.config.deadZone=100
let changed=snapshot(tuned)
check("persisted zoom controls affect motion", original.panSamples != changed.panSamples && original.zoomState(atMilliseconds:300).scale != changed.zoomState(atMilliseconds:300).scale, " transitionSpeed/followSpeed/deadZone changed; pan tracks equal=\(original.panSamples==changed.panSamples), scale at 300ms equal=\(original.zoomState(atMilliseconds:300).scale==changed.zoomState(atMilliseconds:300).scale)")
let firstClick=Fixtures.metadata(keyframes:[Fixtures.keyframe(0,1000,500),Fixtures.keyframe(5000,1000,500)],sections:[Fixtures.section(700,2200)])
let firstClickSnapshot=snapshot(firstClick)
let zoomRamp = RenderSnapshot.zoomTransitionDuration(config: firstClick.zoom.config, sectionDuration: 1500)
let zoomHold = 1500 - 2 * zoomRamp
check("isolated auto-zoom arrives by click and holds", firstClickSnapshot.zoomState(atMilliseconds:1000).scale == 2 && zoomHold >= 600, "scale at click=\(firstClickSnapshot.zoomState(atMilliseconds:1000).scale); full-scale hold=\(zoomHold)ms of 1500ms section")
// Near-click motion should not accelerate abruptly on a constant-speed path.
let sweep = stride(from: 0.0, through: 3000, by: 20).map { Fixtures.keyframe($0, $0, 500) }
let withoutClick = snapshot(Fixtures.metadata(keyframes:sweep))
let withClick = snapshot(Fixtures.metadata(keyframes:sweep,clicks:[Fixtures.click(1500,x:1500,y:500)]))
func maxSpeed(_ s: RenderSnapshot, from: Double, to: Double) -> Double {
    var result = 0.0
    for t in stride(from: from, through: to, by: 1000.0/60) {
        let a=s.smoothedCursorPosition(atMilliseconds:t)!, b=s.smoothedCursorPosition(atMilliseconds:t-1000.0/60)!
        result=max(result, Double(simd_length(a-b))*60)
    }
    return result
}
let base=maxSpeed(withoutClick,from:1350,to:1600), clicked=maxSpeed(withClick,from:1350,to:1600)
let clickPosition = withClick.smoothedCursorPosition(atMilliseconds: 1500)!
check("click landing remains accurate", abs(clickPosition.x - 1500) < 0.01, "rendered x=\(clickPosition.x), click x=1500")
check("constant-speed cursor avoids click acceleration burst", clicked/base <= 1.5, "proposed audit budget <=1.5x; measured \(clicked/base)x")
print("MEASURE click window: raw speed=1000px/s, peak no-click=\(base), peak with-click=\(clicked), ratio=\(clicked/base)")
let stopped = snapshot(Fixtures.metadata(keyframes: stride(from: 0.0, through: 3000, by: 20).map { Fixtures.keyframe($0, min(1300, $0), 500) }, clicks: [Fixtures.click(1300, x: 1300, y: 500)]))
let stopPeak = stride(from: 1200.0, through: 2000, by: 1000.0 / 60).map { stopped.smoothedCursorPosition(atMilliseconds: $0)!.x }.max()!
check("move-stop-click does not overshoot target", stopPeak <= 1300.01, "overshoot=\(stopPeak - 1300)px")
// Estimate rebuild cost for an active 10-minute recording, for main-actor edits.
let longFrames=stride(from:0.0,through:600000,by:1000.0/60).map { Fixtures.keyframe($0,1000+sin($0/1000)*750,500+cos($0/700)*300) }
let long=Fixtures.metadata(duration:600000,keyframes:longFrames,sections:[Fixtures.section(0,600000)])
var costs:[Double]=[]
for _ in 0..<3 {
 let start=Date(); let s=snapshot(long); costs.append(Date().timeIntervalSince(start)*1000)
 print("MEASURE 10min snapshot rebuild: \(costs.last!)ms; cursor samples=\(s.cursorSamples.count), pan samples=\(s.panSamples.count)")
}
print("AUDIT_RESULT failures=\(failures)")
if failures>0 { exit(1) }
