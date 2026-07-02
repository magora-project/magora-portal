import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import MapPage from './pages/MapPage'
import RegisterNode from './pages/RegisterNode'
import AboutPage from './pages/AboutPage'
import NodePage from './pages/NodePage'
import SpeciesPage from './pages/SpeciesPage'
import DonatePage from './pages/DonatePage'
import JournalPage from './pages/JournalPage'
import DonatePrompt from './components/DonatePrompt'
import { AuthProvider } from './lib/auth'
import { initListenQueue } from './lib/listenQueue'
import './App.css'

function App() {
  useEffect(() => {
    const cleanup = initListenQueue()
    return cleanup
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/node/:id" element={<NodePage />} />
              <Route path="/species/:name" element={<SpeciesPage />} />
              <Route path="/journal/:handle" element={<JournalPage />} />
              <Route path="/register" element={<RegisterNode />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/donate" element={<DonatePage />} />
            </Routes>
          </main>
          <DonatePrompt />
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App