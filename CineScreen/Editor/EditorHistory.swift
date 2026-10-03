/// Bounded metadata history. Gestures record their starting state once;
/// ordinary edits record immediately. Restoring a returned state is the
/// caller's responsibility and must not feed back through recordChange.
struct EditorHistory {
    private let limit: Int
    private var undoStack: [RecordingMetadata] = []
    private var redoStack: [RecordingMetadata] = []
    private var gestureStart: RecordingMetadata?

    init(limit: Int = 100) { self.limit = max(1, limit) }

    var isEditing: Bool { gestureStart != nil }
    var canRedo: Bool { !redoStack.isEmpty }
    func canUndo(current: RecordingMetadata?) -> Bool {
        !undoStack.isEmpty || (gestureStart != nil && gestureStart != current)
    }

    mutating func beginEditing(current: RecordingMetadata?) {
        if gestureStart == nil { gestureStart = current }
    }

    mutating func endEditing(current: RecordingMetadata?) {
        guard let start = gestureStart else { return }
        gestureStart = nil
        guard let current, start != current else { return }
        pushUndo(start)
        redoStack.removeAll()
    }

    mutating func recordChange(from previous: RecordingMetadata?, to current: RecordingMetadata?) {
        guard !isEditing, let previous, let current, previous != current else { return }
        pushUndo(previous)
        redoStack.removeAll()
    }

    mutating func undo(current: RecordingMetadata?) -> RecordingMetadata? {
        endEditing(current: current)
        guard let current, let previous = undoStack.popLast() else { return nil }
        redoStack.append(current)
        return previous
    }

    mutating func redo(current: RecordingMetadata?) -> RecordingMetadata? {
        endEditing(current: current)
        guard let current, let next = redoStack.popLast() else { return nil }
        pushUndo(current)
        return next
    }

    private mutating func pushUndo(_ state: RecordingMetadata) {
        undoStack.append(state)
        if undoStack.count > limit { undoStack.removeFirst(undoStack.count - limit) }
    }
}
