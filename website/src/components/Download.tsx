import { useState, useEffect } from 'react'

const REPO = 'jasonzh0/CineScreen'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface Release {
  tag_name: string
  assets: ReleaseAsset[]
}

interface Platform {
  name: string
  arch: string
  icon: JSX.Element
  requirements: string
  assetPattern: RegExp
  primary: boolean
}

const platforms: Platform[] = [
  {
    name: 'macOS',
    arch: 'Apple Silicon (ARM64)',
    icon: (
      <svg className="w-12 h-12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
    requirements: 'macOS 11.0 or later',
    assetPattern: /arm64-mac\.zip$/,
    primary: true
  },
  {
    name: 'Windows',
    arch: 'x64',
    icon: (
      <svg className="w-12 h-12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .15V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm17 .25V22l-10-1.91V13.1l10 .15z"/>
      </svg>
    ),
    requirements: 'Windows 10 or later',
    assetPattern: /-win\.zip$/,
    primary: false
  }
]

export default function Download() {
  const [version, setVersion] = useState<string | null>(null)
  const [assets, setAssets] = useState<ReleaseAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then(res => res.json())
      .then((data: Release) => {
        setVersion(data.tag_name)
        setAssets(data.assets || [])
      })
      .catch(() => {
        // Fallback if API fails
        setVersion('v1.2.2')
      })
      .finally(() => setLoading(false))
  }, [])

  const getDownloadUrl = (platform: Platform): string => {
    const asset = assets.find(a => platform.assetPattern.test(a.name))
    if (asset) return asset.browser_download_url
    // Fallback to releases page
    return `https://github.com/${REPO}/releases/latest`
  }

  return (
    <section id="download" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            Download CineScreen
          </h2>
          <p className="text-xl text-neutral-500 max-w-2xl mx-auto mb-4">
            Free and open source. Available for macOS and Windows.
          </p>
          <span className="inline-flex items-center gap-2 text-sm text-neutral-500 bg-neutral-900 px-3 py-1 rounded-full">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            {loading ? 'Loading...' : `Latest: ${version}`}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {platforms.map((platform) => (
            <div
              key={platform.name}
              className="glass-card rounded-2xl p-8 text-center"
            >
              <div className="text-neutral-300 mb-4 flex justify-center">
                {platform.icon}
              </div>
              <h3 className="text-2xl font-bold mb-1">{platform.name}</h3>
              <p className="text-neutral-500 mb-4">{platform.arch}</p>
              <a
                href={getDownloadUrl(platform)}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors text-black ${
                  platform.primary
                    ? 'bg-white hover:bg-neutral-200'
                    : 'bg-neutral-300 hover:bg-neutral-400'
                } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
              <p className="text-sm text-neutral-600 mt-4">{platform.requirements}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <a
            href={`https://github.com/${REPO}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-500 hover:text-white transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View all releases on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}
