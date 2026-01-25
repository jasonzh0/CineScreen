import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Features from './components/Features'
import StudioPreview from './components/StudioPreview'
import Download from './components/Download'
import Footer from './components/Footer'

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <StudioPreview />
        <Download />
      </main>
      <Footer />
    </div>
  )
}
