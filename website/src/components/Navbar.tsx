export default function Navbar() {
  return (
    <nav className="mt-4 bg-black border-b border-neutral-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <a href="#" className="flex items-center gap-3">
            <img
              src="./assets/icon.png"
              alt="CineScreen"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-semibold text-lg">CineScreen</span>
          </a>

          <div className="hidden sm:flex items-center gap-8">
            <a
              href="#features"
              className="text-neutral-400 hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="#studio"
              className="text-neutral-400 hover:text-white transition-colors"
            >
              Studio
            </a>
            <a
              href="#download"
              className="bg-white hover:bg-neutral-200 text-black px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Download
            </a>
          </div>

          <a
            href="#download"
            className="sm:hidden bg-white hover:bg-neutral-200 text-black px-4 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  )
}
