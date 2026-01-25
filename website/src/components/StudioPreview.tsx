export default function StudioPreview() {
  return (
    <section id="studio" className="py-24 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            Powerful Studio Editor
          </h2>
          <p className="text-xl text-neutral-500 max-w-2xl mx-auto">
            Fine-tune every aspect of your recording with the built-in timeline editor.
          </p>
        </div>

        <div className="relative">
          <div className="rounded-2xl overflow-hidden shadow-2xl shadow-white/5 border border-neutral-800">
            <img
              src="./assets/studio.png"
              alt="CineScreen Studio Editor"
              className="w-full"
            />
          </div>

          {/* Feature callouts */}
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="font-medium">Video Preview</span>
              </div>
              <p className="text-sm text-neutral-500">Real-time preview with cursor overlay</p>
            </div>

            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="font-medium">Timeline Editor</span>
              </div>
              <p className="text-sm text-neutral-500">Frame-accurate zoom effect control</p>
            </div>

            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                  </svg>
                </div>
                <span className="font-medium">Cursor Settings</span>
              </div>
              <p className="text-sm text-neutral-500">Shape, color, and motion controls</p>
            </div>

            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <span className="font-medium">Export Options</span>
              </div>
              <p className="text-sm text-neutral-500">H.264/H.265 with quality presets</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
