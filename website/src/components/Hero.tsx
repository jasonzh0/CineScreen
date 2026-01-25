export default function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-4 pt-12">
      <div className="text-center max-w-4xl mx-auto">
        <img
          src="./assets/icon.png"
          alt="CineScreen"
          className="w-24 h-24 mx-auto mb-8 rounded-2xl shadow-2xl shadow-white/10"
        />

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6">
          <span className="gradient-text">CineScreen</span>
        </h1>

        <p className="text-xl sm:text-2xl text-neutral-300 mb-4">
          Professional Screen Recording Studio
        </p>

        <p className="text-lg text-neutral-500 mb-12 max-w-2xl mx-auto">
          Native cursor-free capture with powerful post-processing.
          Add beautiful custom cursors, smooth zoom effects, and export cinema-quality recordings.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <a
            href="#download"
            className="bg-white hover:bg-neutral-200 text-black px-8 py-3 rounded-xl font-semibold text-lg transition-colors"
          >
            Download Now
          </a>
          <a
            href="#features"
            className="border border-neutral-700 hover:border-neutral-500 px-8 py-3 rounded-xl font-semibold text-lg transition-colors"
          >
            View Features
          </a>
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto">
        <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-white/5 border border-neutral-800">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full"
          >
            <source src="./assets/demo.mp4" type="video/mp4" />
          </video>
        </div>
      </div>

      <div className="mt-12 animate-bounce">
        <a href="#features" className="text-neutral-600 hover:text-neutral-400 transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </section>
  )
}
